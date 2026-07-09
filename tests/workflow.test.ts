import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config.js';
import type { GraphMailClient } from '../src/clients/graph.js';
import type { MistralReceiptClient } from '../src/clients/mistral.js';
import type { MondayClient } from '../src/clients/monday.js';
import { createLogger } from '../src/logger.js';
import { EMAIL_AUTOMATION_NOTE } from '../src/mondayPayload.js';
import { ReceiptWorkflow } from '../src/workflow.js';
import type { AcceptedAttachment, EmailMessage, InvoiceType, ReceiptGroup } from '../src/types.js';

const config: AppConfig = {
  logging: { level: 'debug' },
  microsoft: {
    tenantId: 'tenant',
    clientId: 'client',
    clientSecret: 'secret',
    mailboxUserId: 'receipts@example.com',
    folders: { inbox: 'Inbox', processed: 'Processed', review: 'Review' },
  },
  polling: { intervalMinutes: 15, maxMessagesPerPoll: 10 },
  workflow: {
    autoCreateConfidenceThreshold: 0.7,
    uploadRetryAttempts: 3,
    uploadRetryDelayMs: 0,
    acceptedMimeTypes: ['application/pdf', 'image/png'],
    acceptedExtensions: ['.pdf', '.png'],
  },
  mistral: { apiKey: 'mistral', ocrModel: 'mistral-ocr-latest', chatModel: 'mistral-large-latest' },
  monday: {
    apiToken: 'monday',
    apiVersion: '2024-10',
    boardId: '123',
    columns: {
      facture: 'file_mm1ca2x1',
      dateReception: 'date_mm1c40cq',
      datePaiement: 'date_mm1ca3zv',
      referenceFacture: 'text_mm1g3ajw',
      montantFacture: 'numeric_mm1chk67',
      notesParticulieres: 'long_text_mm38snee',
      soumisPar: 'text_mm3seznv',
      typeDeFacture: 'dropdown_mm3sz6mp',
      statut: 'color_mm38nv5x',
      etatDeFacture: 'color_mm1cedyf',
      fournisseur: 'text_mm1cj8bv',
      provenanceSuggeree: 'dropdown_mm50vh09',
    },
    dropdownLabels: ['Factures', 'Carte'],
  },
};

const email: EmailMessage = {
  id: 'message-1',
  subject: 'Receipt email',
  receivedDateTime: '2026-06-22T12:00:00Z',
  webLink: 'https://outlook.office.com/mail/message-1',
  sender: { name: 'Alice', email: 'alice@example.com' },
  bodyText: 'Please find receipt attached.',
  hasAttachments: true,
};

const attachment: AcceptedAttachment = {
  id: 'attachment-1',
  name: 'receipt.pdf',
  contentType: 'application/pdf',
  size: 12,
  isInline: false,
  contentBytes: Buffer.from('pdf').toString('base64'),
};

function makeMocks(overrides: {
  attachments?: unknown[];
  classificationDecision?: 'create_items' | 'review';
  classificationType?: InvoiceType;
  groupConfidence?: number;
  ocrMarkdown?: string;
  uploadRejects?: boolean;
  createUpdateRejects?: boolean;
  rejectAttentionUpdate?: boolean;
  reviewReason?: string;
  attachmentGroups?: ReceiptGroup[];
  ocrTimeoutCount?: number;
  classificationTimeoutCount?: number;
} = {}) {
  const moveMessageResult = {
    ...email,
    webLink: 'https://outlook.office.com/mail/moved-message-1',
  };

  const listAttachments = overrides.attachments ?? [attachment];

  const graph = {
    listAttachments: vi.fn().mockResolvedValue(listAttachments),
    getAcceptedAttachment: vi.fn().mockImplementation((_messageId: string, attachmentId: string) => {
      const source = listAttachments.find((item) => (item as { id: string }).id === attachmentId) as
        | { id: string; name?: string; contentType?: string; size?: number; isInline?: boolean }
        | undefined;

      return Promise.resolve({
        id: source?.id ?? attachment.id,
        name: source?.name ?? attachment.name,
        contentType: source?.contentType ?? attachment.contentType,
        size: source?.size ?? attachment.size,
        isInline: source?.isInline ?? false,
        contentBytes: Buffer.from(`bytes-${source?.id ?? attachment.id}`).toString('base64'),
      });
    }),
    moveMessage: vi.fn().mockResolvedValue(moveMessageResult),
  };

  const attachmentGroups =
    overrides.attachmentGroups ??
    [
      {
        itemName: 'Merchant receipt',
        confidence: overrides.groupConfidence ?? 0.9,
        groupingExplanation: 'single receipt file',
        attachmentIds: [attachment.id],
        referenceFacture: 'INV-1',
        montantFacture: 10,
        datePaiement: '2026-06-22',
        typeDeFacture: overrides.classificationType ?? 'Factures',
        notesParticulieres: 'Receipt email summary',
      },
    ];

  const ocrAttachment = vi.fn();
  for (let attempt = 0; attempt < (overrides.ocrTimeoutCount ?? 0); attempt += 1) {
    ocrAttachment.mockRejectedValueOnce(makeTimeoutError());
  }
  ocrAttachment.mockResolvedValue({
    attachmentId: attachment.id,
    fileName: attachment.name,
    markdown: overrides.ocrMarkdown ?? 'Receipt total 10 EUR',
    pageCount: 1,
  });

  const classifyReceipts = vi.fn();
  for (let attempt = 0; attempt < (overrides.classificationTimeoutCount ?? 0); attempt += 1) {
    classifyReceipts.mockRejectedValueOnce(makeTimeoutError());
  }
  classifyReceipts.mockResolvedValue({
    decision: overrides.classificationDecision ?? 'create_items',
    confidence: overrides.groupConfidence ?? 0.9,
    emailSummary: 'Receipt email summary',
    reviewReason: overrides.reviewReason ?? null,
    receiptGroups: attachmentGroups,
  });

  const mistral = {
    ocrAttachment,
    classifyReceipts,
  };

  let createdItemCount = 0;
  const monday = {
    createItem: vi.fn().mockImplementation((request: { itemName: string }) => {
      createdItemCount += 1;
      return Promise.resolve({ id: `item-${createdItemCount}`, name: request.itemName });
    }),
    uploadFile: overrides.uploadRejects
      ? vi.fn().mockRejectedValue(new Error('upload failed'))
      : vi.fn().mockResolvedValue({ id: 'asset-1' }),
    createUpdate: vi.fn().mockImplementation((request: { body: string }) => {
      if (overrides.createUpdateRejects || (overrides.rejectAttentionUpdate && request.body.includes('Points d’attention'))) {
        return Promise.reject(new Error('update failed'));
      }

      return Promise.resolve({ id: 'update-1' });
    }),
    updateItemStatus: vi.fn().mockResolvedValue({ id: 'item-1' }),
  };

  return { graph, mistral, monday };
}

function makeWorkflow(mocks: ReturnType<typeof makeMocks>): ReceiptWorkflow {
  return new ReceiptWorkflow(
    config,
    mocks.graph as unknown as GraphMailClient,
    mocks.mistral as unknown as MistralReceiptClient,
    mocks.monday as unknown as MondayClient,
    createLogger('test'),
  );
}

function makeTimeoutError(): Error {
  const error = new Error('Request timed out: TimeoutError: The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

describe('ReceiptWorkflow', () => {
  it('creates a clean item as Attention, then promotes it to Nouveau after upload, move, and update', async () => {
    const mocks = makeMocks();
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        columnValues: expect.objectContaining({
          statut: 'Attention',
          notesParticulieres: EMAIL_AUTOMATION_NOTE,
        }),
      }),
    );
    expect(mocks.monday.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'item-1' }));
    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
    expect(mocks.monday.createUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.monday.createUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('https://outlook.office.com/mail/moved-message-1') }),
    );
    expect(mocks.monday.createUpdate.mock.calls[0]?.[0].body).not.toContain('Attention:');
    expect(mocks.monday.updateItemStatus).toHaveBeenCalledWith({ itemId: 'item-1', statut: 'Nouveau' });
    expect(mocks.graph.moveMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.monday.createUpdate.mock.invocationCallOrder[0],
    );
    expect(mocks.monday.createUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.monday.updateItemStatus.mock.invocationCallOrder[0],
    );
  });

  it('corrects classifier Factures output to Carte when card evidence is present without bank-transfer evidence', async () => {
    const mocks = makeMocks({
      classificationType: 'Factures',
      ocrMarkdown: 'Hetzner Online invoice. The open invoice amount will soon be debited from your credit card.',
    });
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        columnValues: expect.objectContaining({
          typeDeFacture: 'Carte',
        }),
      }),
    );
  });

  it('sets item status to Attention when classifier confidence is weak (no review fallback)', async () => {
    const mocks = makeMocks({ groupConfidence: 0.4 });
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        columnValues: expect.objectContaining({
          statut: 'Attention',
          notesParticulieres: expect.stringContaining(`${EMAIL_AUTOMATION_NOTE}`),
        }),
      }),
    );
    const updateBodies = mocks.monday.createUpdate.mock.calls.map(([request]) => request.body);
    expect(updateBodies).toHaveLength(2);
    expect(updateBodies[0]).not.toContain('Attention:');
    expect(updateBodies[1]).toContain('Points d’attention');
    expect(updateBodies[1]).toContain('Attention:');
    expect(mocks.monday.updateItemStatus).not.toHaveBeenCalled();
    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
  });

  it('creates Attention item for body-only invoice without any file upload', async () => {
    const workflowEmail: EmailMessage = { ...email, hasAttachments: false };
    const mocks = makeMocks();
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(workflowEmail, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.mistral.ocrAttachment).not.toHaveBeenCalled();
    expect(mocks.monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        columnValues: expect.objectContaining({ statut: 'Attention' }),
      }),
    );
    expect(mocks.monday.uploadFile).not.toHaveBeenCalled();
    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(workflowEmail.id, 'processed-folder');
  });

  it('processes mixed supported/unsupported attachments and keeps item in Attention with supported upload', async () => {
    const unsupportedAttachment = {
      id: 'docx',
      name: 'invoice.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 10,
      isInline: false,
    };

    const mocks = makeMocks({
      attachments: [attachment, unsupportedAttachment],
    });
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        columnValues: expect.objectContaining({ statut: 'Attention' }),
      }),
    );
    expect(mocks.monday.uploadFile).toHaveBeenCalledTimes(1);
    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
  });

  it('handles grouping uncertainty by preserving distinct Attention items for supported attachments', async () => {
    const secondAttachment = {
      id: 'attachment-2',
      name: 'receipt-2.pdf',
      contentType: 'application/pdf',
      size: 12,
      isInline: false,
    };

    const mocks = makeMocks({
      attachments: [attachment, secondAttachment],
      groupConfidence: 0.4,
      attachmentGroups: [
        {
          itemName: 'Receipt A',
          confidence: 0.4,
          groupingExplanation: 'file A',
          attachmentIds: ['attachment-1'],
          referenceFacture: 'INV-1',
          montantFacture: 10,
          datePaiement: '2026-06-22',
          typeDeFacture: 'Factures',
          notesParticulieres: 'Receipt email summary',
        },
        {
          itemName: 'Receipt B',
          confidence: 0.4,
          groupingExplanation: 'file B',
          attachmentIds: ['attachment-2'],
          referenceFacture: 'INV-2',
          montantFacture: 11,
          datePaiement: '2026-06-22',
          typeDeFacture: 'Factures',
          notesParticulieres: 'Receipt email summary',
        },
      ],
    });

    const workflow = makeWorkflow(mocks);
    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.monday.createItem).toHaveBeenCalledTimes(2);
    expect(mocks.monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemName: 'Receipt A',
        columnValues: expect.objectContaining({ statut: 'Attention' }),
      }),
    );
    expect(mocks.monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemName: 'Receipt B',
        columnValues: expect.objectContaining({ statut: 'Attention' }),
      }),
    );
    expect(mocks.monday.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'item-1', fileName: 'receipt.pdf' }));
    expect(mocks.monday.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'item-2', fileName: 'receipt-2.pdf' }));
    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
  });

  it('separates unrelated invoices and isolates an unassigned supporting attachment', async () => {
    const camilleAttachment = {
      ...attachment,
      id: 'camille',
      name: 'Facture Camille.pdf',
    };
    const anatoleAttachment = {
      ...attachment,
      id: 'anatole',
      name: 'Facture Anatole.pdf',
    };
    const presenceAttachment = {
      ...attachment,
      id: 'presence',
      name: 'Liste participants - présence.pdf',
    };

    const mocks = makeMocks({
      attachments: [camilleAttachment, anatoleAttachment, presenceAttachment],
      attachmentGroups: [
        {
          itemName: 'Installation et rangement Lower Body Camille',
          confidence: 0.9,
          groupingExplanation: 'Facture Camille uniquement',
          attachmentIds: ['camille'],
          referenceFacture: null,
          montantFacture: 200,
          datePaiement: null,
          typeDeFacture: 'Factures',
          notesParticulieres: 'Facture Camille',
        },
        {
          itemName: 'Accueil Lower Body Anatole',
          confidence: 0.9,
          groupingExplanation: 'Facture Anatole uniquement',
          attachmentIds: ['anatole'],
          referenceFacture: null,
          montantFacture: 341.2,
          datePaiement: null,
          typeDeFacture: 'Factures',
          notesParticulieres: 'Facture Anatole',
        },
      ],
    });

    const workflow = makeWorkflow(mocks);
    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.monday.createItem).toHaveBeenCalledTimes(3);
    expect(mocks.monday.createItem).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ itemName: 'Installation et rangement Lower Body Camille' }),
    );
    expect(mocks.monday.createItem).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ itemName: 'Accueil Lower Body Anatole' }),
    );
    expect(mocks.monday.createItem).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        itemName: 'Pièces jointes à assigner',
        columnValues: expect.objectContaining({ statut: 'Attention' }),
      }),
    );
    expect(mocks.monday.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'item-1', fileName: 'Facture Camille.pdf' }));
    expect(mocks.monday.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'item-2', fileName: 'Facture Anatole.pdf' }));
    expect(mocks.monday.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'item-3', fileName: 'Liste participants - présence.pdf' }));
  });

  it('routes upload failures to review/error after final review item creation', async () => {
    const mocks = makeMocks({ uploadRejects: true });
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.monday.uploadFile).toHaveBeenCalled();
    expect(mocks.monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemName: email.subject,
      }),
    );
    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'review-folder');
  });

  it('retries and logs final update failures after moving to Processed', async () => {
    const mocks = makeMocks({ createUpdateRejects: true });
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
    expect(mocks.monday.createUpdate).toHaveBeenCalledTimes(3);
    expect(mocks.monday.updateItemStatus).not.toHaveBeenCalled();
    expect(mocks.graph.moveMessage).not.toHaveBeenCalledWith(email.id, 'review-folder');
  });

  it('keeps item in Attention when the dedicated attention update fails', async () => {
    const mocks = makeMocks({ groupConfidence: 0.4, rejectAttentionUpdate: true });
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
    expect(mocks.monday.createUpdate).toHaveBeenCalledTimes(4);
    expect(mocks.monday.createUpdate.mock.calls[0]?.[0].body).not.toContain('Attention:');
    expect(mocks.monday.createUpdate.mock.calls.slice(1).every(([request]) => request.body.includes('Points d’attention'))).toBe(true);
    expect(mocks.monday.updateItemStatus).not.toHaveBeenCalled();
  });

  it('retries a transient Mistral OCR timeout and then processes successfully', async () => {
    const mocks = makeMocks({ ocrTimeoutCount: 1 });
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.mistral.ocrAttachment).toHaveBeenCalledTimes(2);
    expect(mocks.mistral.classifyReceipts).toHaveBeenCalledTimes(1);
    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
    expect(mocks.graph.moveMessage).not.toHaveBeenCalledWith(email.id, 'review-folder');
    expect(mocks.monday.updateItemStatus).toHaveBeenCalledWith({ itemId: 'item-1', statut: 'Nouveau' });
  });

  it('retries a transient Mistral classification timeout and then processes successfully', async () => {
    const mocks = makeMocks({ classificationTimeoutCount: 1 });
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.mistral.ocrAttachment).toHaveBeenCalledTimes(1);
    expect(mocks.mistral.classifyReceipts).toHaveBeenCalledTimes(2);
    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
    expect(mocks.graph.moveMessage).not.toHaveBeenCalledWith(email.id, 'review-folder');
    expect(mocks.monday.updateItemStatus).toHaveBeenCalledWith({ itemId: 'item-1', statut: 'Nouveau' });
  });

  it('routes to review after exhausting transient Mistral classification timeout retries', async () => {
    const mocks = makeMocks({ classificationTimeoutCount: config.workflow.uploadRetryAttempts });
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.mistral.classifyReceipts).toHaveBeenCalledTimes(config.workflow.uploadRetryAttempts);
    expect(mocks.monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemName: email.subject,
      }),
    );
    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'review-folder');
    expect(mocks.graph.moveMessage).not.toHaveBeenCalledWith(email.id, 'processed-folder');
  });

  it('routes classifier-decided review to review folder', async () => {
    const mocks = makeMocks({
      classificationDecision: 'review',
      reviewReason: 'LLM ambiguous',
    });
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemName: email.subject,
      }),
    );
    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'review-folder');
  });
});
