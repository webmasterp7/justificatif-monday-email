import { vi } from 'vitest';
import type { AppConfig } from '../../src/config.js';
import type { GraphMailClient } from '../../src/clients/graph.js';
import type { MistralReceiptClient } from '../../src/clients/mistral.js';
import type { MondayClient } from '../../src/clients/monday.js';
import { createLogger } from '../../src/logger.js';
import type {
  AcceptedAttachment,
  ClassificationResult,
  EmailAttachment,
  EmailMessage,
  InvoiceType,
  OcrDocument,
  ReceiptGroup,
} from '../../src/types.js';
import { ReceiptWorkflow } from '../../src/workflow.js';
import type { FacturesEmailFixture } from './facturesFixtureManifest.js';

export const facturesSimulationConfig: AppConfig = {
  logging: { level: 'debug' },
  microsoft: {
    tenantId: 'tenant',
    clientId: 'client',
    clientSecret: 'secret',
    mailboxUserId: 'receipts@example.com',
    folders: { inbox: 'Factures', processed: 'Processed', review: 'Review' },
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

export function makeReceiptGroup(
  input: Partial<ReceiptGroup> & { itemName: string; attachmentIds: string[]; typeDeFacture?: InvoiceType },
): ReceiptGroup {
  return {
    itemName: input.itemName,
    confidence: input.confidence ?? 0.9,
    groupingExplanation: input.groupingExplanation ?? 'Grouped from fixture',
    attachmentIds: input.attachmentIds,
    typeDeFacture: input.typeDeFacture ?? 'Factures',
    notesParticulieres: input.notesParticulieres ?? 'Receipt email summary',
    referenceFacture: input.referenceFacture ?? 'INV-FX-1',
    montantFacture: input.montantFacture ?? 10,
    datePaiement: input.datePaiement ?? '2026-06-22',
    soumisPar: input.soumisPar ?? 'Sender Name <sender@example.com>',
    provenanceSuggeree: input.provenanceSuggeree,
    fournisseur: input.fournisseur,
    groupingEvidence: input.groupingEvidence,
    fieldStatuses: input.fieldStatuses,
  };
}

export function makeClassification(input: {
  groups?: ReceiptGroup[];
  decision?: 'create_items' | 'review';
  confidence?: number;
  reviewReason?: string | null;
  emailSummary?: string;
}): ClassificationResult {
  return {
    decision: input.decision ?? 'create_items',
    confidence: input.confidence ?? 0.9,
    reviewReason: input.reviewReason ?? null,
    emailSummary: input.emailSummary ?? 'Receipt email summary',
    receiptGroups:
      input.groups ??
      [
        makeReceiptGroup({
          itemName: 'Auto receipt',
          attachmentIds: ['attachment-1'],
          typeDeFacture: 'Factures',
        }),
      ],
  };
}

export function makeOcrDocuments(
  fixture: FacturesEmailFixture,
  markdownByAttachmentId?: Record<string, string>,
): OcrDocument[] {
  const knownDocuments = new Map(
    (fixture.ocrDocuments ?? []).map((document) => [document.attachmentId, document] as const),
  );

  return fixture.attachments.map((attachment) => {
    const markdown =
      markdownByAttachmentId?.[attachment.id] ??
      knownDocuments.get(attachment.id)?.markdown ??
      `OCR content for ${attachment.name}`;
    const matching = knownDocuments.get(attachment.id);

    return {
      attachmentId: attachment.id,
      fileName: attachment.name,
      markdown,
      pageCount: matching?.pageCount ?? 1,
    };
  });
}

export function createFixtureGraphClient(
  fixture: FacturesEmailFixture,
): Pick<GraphMailClient, 'listAttachments' | 'getAcceptedAttachment' | 'moveMessage'> {
  const listAttachments = vi.fn(async () =>
    fixture.attachments.map<EmailAttachment>((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
      isInline: attachment.isInline ?? false,
      contentBytes: attachment.contentBytes,
    })),
  );

  const getAcceptedAttachment = vi.fn(async (_messageId: string, attachmentId: string) => {
    const match = fixture.attachments.find((attachment) => attachment.id === attachmentId);

    if (!match) {
      throw new Error(`Attachment ${attachmentId} not found in fixture`);
    }

    return {
      id: match.id,
      name: match.name,
      contentType: match.contentType,
      size: match.size,
      isInline: match.isInline ?? false,
      contentBytes: match.contentBytes ?? Buffer.from(`bytes-${match.id}`).toString('base64'),
    } satisfies AcceptedAttachment;
  });

  const moveMessage = vi.fn(async (messageId: string, destinationId: string): Promise<EmailMessage> => ({
    ...fixture.email,
    id: messageId,
    webLink: `${fixture.email.webLink}#moved-to=${encodeURIComponent(destinationId)}`,
  }));

  return { listAttachments, getAcceptedAttachment, moveMessage };
}

export function createFixtureMistralClient(options: {
  fixture: FacturesEmailFixture;
  classification?: ClassificationResult;
  ocrDocuments?: OcrDocument[];
  ocrRejects?: boolean;
}): Pick<MistralReceiptClient, 'ocrAttachment' | 'classifyReceipts'> {
  const fallbackDocuments = options.ocrDocuments ?? makeOcrDocuments(options.fixture);
  const documentsByAttachmentId = new Map(fallbackDocuments.map((document) => [document.attachmentId, document] as const));
  const classification =
    options.classification ??
    options.fixture.classification ??
    makeClassification({
      groups: [
        makeReceiptGroup({
          itemName: options.fixture.email.subject,
          attachmentIds:
            options.fixture.attachments.length > 0
              ? options.fixture.attachments.map((attachment) => attachment.id)
              : ['attachment-1'],
          typeDeFacture: 'Factures',
        }),
      ],
    });

  const ocrAttachment = vi.fn(async (attachment: AcceptedAttachment) => {
    if (options.ocrRejects) {
      throw new Error('OCR failed');
    }

    const fallbackMarkdown = `OCR content for ${attachment.name}`;

    return {
      attachmentId: attachment.id,
      fileName: attachment.name,
      markdown: documentsByAttachmentId.get(attachment.id)?.markdown ?? fallbackMarkdown,
      pageCount: documentsByAttachmentId.get(attachment.id)?.pageCount ?? 1,
    };
  });

  const classifyReceipts = vi.fn(async () => structuredClone(classification));

  return { ocrAttachment, classifyReceipts };
}

export function createMondaySpy(
  options?: { uploadRejects?: boolean; createUpdateRejects?: boolean; rejectAttentionUpdate?: boolean },
): Pick<MondayClient, 'createItem' | 'uploadFile' | 'createUpdate' | 'updateItemStatus'> {
  let nextItemId = 1;
  let nextAssetId = 1;
  let nextUpdateId = 1;

  const createItem = vi.fn(async (request: { itemName: string }) => {
    const id = `item-${nextItemId}`;
    nextItemId += 1;
    return { id, name: request.itemName };
  });

  const uploadFile = vi.fn(async () => {
    if (options?.uploadRejects) {
      throw new Error('upload failed');
    }

    const id = `asset-${nextAssetId}`;
    nextAssetId += 1;
    return { id };
  });

  const createUpdate = vi.fn(async (request: { body: string }) => {
    if (options?.createUpdateRejects) {
      throw new Error('create update failed');
    }

    if (options?.rejectAttentionUpdate && request.body.includes('Points d’attention')) {
      throw new Error('create update failed');
    }

    const id = `update-${nextUpdateId}`;
    nextUpdateId += 1;
    return { id };
  });

  const updateItemStatus = vi.fn(async (request: { itemId: string }) => ({ id: request.itemId }));

  return { createItem, uploadFile, createUpdate, updateItemStatus };
}

export function makeFacturesWorkflow(clients: {
  graph: Pick<GraphMailClient, 'listAttachments' | 'getAcceptedAttachment' | 'moveMessage'>;
  mistral: Pick<MistralReceiptClient, 'ocrAttachment' | 'classifyReceipts'>;
  monday: Pick<MondayClient, 'createItem' | 'uploadFile' | 'createUpdate' | 'updateItemStatus'>;
}): ReceiptWorkflow {
  return new ReceiptWorkflow(
    facturesSimulationConfig,
    clients.graph as unknown as GraphMailClient,
    clients.mistral as unknown as MistralReceiptClient,
    clients.monday as unknown as MondayClient,
    createLogger('test'),
  );
}

export async function processFixture(
  fixture: FacturesEmailFixture,
  options?: {
    classification?: ClassificationResult;
    ocrDocuments?: OcrDocument[];
    ocrRejects?: boolean;
    uploadRejects?: boolean;
    createUpdateRejects?: boolean;
    rejectAttentionUpdate?: boolean;
  },
): Promise<{
  graph: ReturnType<typeof createFixtureGraphClient>;
  mistral: ReturnType<typeof createFixtureMistralClient>;
  monday: ReturnType<typeof createMondaySpy>;
  workflow: ReceiptWorkflow;
}> {
  const graph = createFixtureGraphClient(fixture);
  const mistral = createFixtureMistralClient({
    fixture,
    classification: options?.classification,
    ocrDocuments: options?.ocrDocuments,
    ocrRejects: options?.ocrRejects,
  });
  const monday = createMondaySpy({
    uploadRejects: options?.uploadRejects,
    createUpdateRejects: options?.createUpdateRejects,
    rejectAttentionUpdate: options?.rejectAttentionUpdate,
  });
  const workflow = makeFacturesWorkflow({ graph, mistral, monday });

  await workflow.processMessage(fixture.email, {
    processedFolderId: 'processed-folder',
    reviewFolderId: 'review-folder',
  });

  return { graph, mistral, monday, workflow };
}
