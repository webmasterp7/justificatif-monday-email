import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config.js';
import type { GraphMailClient } from '../src/clients/graph.js';
import type { MistralReceiptClient } from '../src/clients/mistral.js';
import type { MondayClient } from '../src/clients/monday.js';
import { createLogger } from '../src/logger.js';
import { ReceiptWorkflow } from '../src/workflow.js';
import type { AcceptedAttachment, EmailMessage } from '../src/types.js';

const config: AppConfig = {
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
  mistral: { apiKey: 'mistral', ocrModel: 'mistral-ocr-latest', chatModel: 'mistral-small-latest' },
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
    },
    dropdownLabels: ['Factures', 'Carte'],
  },
};

const email: EmailMessage = {
  id: 'message-1',
  subject: 'Receipt email',
  receivedDateTime: '2026-06-22T12:00:00Z',
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
  groupConfidence?: number;
  uploadRejects?: boolean;
} = {}) {
  const graph = {
    listAttachments: vi.fn().mockResolvedValue(overrides.attachments ?? [attachment]),
    getAcceptedAttachment: vi.fn().mockResolvedValue(attachment),
    moveMessage: vi.fn().mockResolvedValue(email),
  };
  const mistral = {
    ocrAttachment: vi.fn().mockResolvedValue({
      attachmentId: attachment.id,
      fileName: attachment.name,
      markdown: 'Receipt total 10 EUR',
      pageCount: 1,
    }),
    classifyReceipts: vi.fn().mockResolvedValue({
      decision: overrides.classificationDecision ?? 'create_items',
      confidence: overrides.groupConfidence ?? 0.9,
      emailSummary: 'Receipt email summary',
      reviewReason: overrides.classificationDecision === 'review' ? 'Ambiguous grouping' : null,
      receiptGroups: [
        {
          itemName: 'Merchant receipt',
          confidence: overrides.groupConfidence ?? 0.9,
          groupingExplanation: 'single receipt file',
          attachmentIds: [attachment.id],
          referenceFacture: 'INV-1',
          montantFacture: 10,
          datePaiement: '2026-06-22',
          typeDeFacture: 'Factures',
          notesParticulieres: 'Receipt email summary',
        },
      ],
    }),
  };
  const monday = {
    createItem: vi.fn().mockResolvedValue({ id: 'item-1', name: 'Item' }),
    uploadFile: overrides.uploadRejects
      ? vi.fn().mockRejectedValue(new Error('upload failed'))
      : vi.fn().mockResolvedValue({ id: 'asset-1' }),
    createUpdate: vi.fn().mockResolvedValue({ id: 'update-1' }),
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

describe('ReceiptWorkflow', () => {
  it('creates a monday item, uploads the file, adds an update, and moves email to Processed', async () => {
    const mocks = makeMocks();
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ itemName: 'Merchant receipt' }),
    );
    expect(mocks.monday.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'item-1' }));
    expect(mocks.monday.createUpdate).toHaveBeenCalled();
    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
  });

  it('routes unsupported attachments to Review with a review item', async () => {
    const mocks = makeMocks({
      attachments: [
        { id: 'docx', name: 'receipt.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1, isInline: false },
      ],
    });
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.mistral.ocrAttachment).not.toHaveBeenCalled();
    expect(mocks.monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({ itemName: expect.stringContaining('[REVUE]') }),
    );
    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'review-folder');
  });

  it('routes low-confidence classifier output to Review', async () => {
    const mocks = makeMocks({ groupConfidence: 0.4 });
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.monday.uploadFile).not.toHaveBeenCalled();
    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'review-folder');
  });

  it('routes upload retry exhaustion to Review instead of Processed', async () => {
    const mocks = makeMocks({ uploadRejects: true });
    const workflow = makeWorkflow(mocks);

    await workflow.processMessage(email, { processedFolderId: 'processed-folder', reviewFolderId: 'review-folder' });

    expect(mocks.monday.uploadFile).toHaveBeenCalled();
    expect(mocks.graph.moveMessage).toHaveBeenCalledWith(email.id, 'review-folder');
    expect(mocks.graph.moveMessage).not.toHaveBeenCalledWith(email.id, 'processed-folder');
  });
});
