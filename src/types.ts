export type InvoiceType = 'Factures' | 'Carte';

export interface EmailSender {
  name?: string;
  email: string;
}

export interface EmailMessage {
  id: string;
  subject: string;
  receivedDateTime: string;
  sender: EmailSender;
  bodyText?: string;
  hasAttachments: boolean;
}

export interface EmailAttachment {
  id: string;
  name: string;
  contentType?: string;
  size: number;
  isInline: boolean;
  contentBytes?: string;
}

export interface AcceptedAttachment extends EmailAttachment {
  contentBytes: string;
}

export interface OcrDocument {
  attachmentId: string;
  fileName: string;
  markdown: string;
  pageCount: number;
}

export interface ReceiptGroup {
  itemName: string;
  confidence: number;
  groupingExplanation: string;
  attachmentIds: string[];
  referenceFacture?: string | null;
  montantFacture?: number | null;
  datePaiement?: string | null;
  typeDeFacture: InvoiceType;
  notesParticulieres: string;
}

export interface ClassificationResult {
  decision: 'create_items' | 'review';
  confidence: number;
  reviewReason?: string | null;
  emailSummary: string;
  receiptGroups: ReceiptGroup[];
}

export interface MondayColumnValues {
  dateReception?: string;
  datePaiement?: string | null;
  referenceFacture?: string | null;
  montantFacture?: number | null;
  notesParticulieres: string;
  soumisPar: string;
  typeDeFacture: InvoiceType;
}

export interface MondayItemRequest {
  itemName: string;
  columnValues: MondayColumnValues;
}

export interface MondayFileUploadRequest {
  itemId: string;
  fileName: string;
  contentType?: string;
  bytes: Buffer;
}

export interface MondayUpdateRequest {
  itemId: string;
  body: string;
}

export interface WorkflowOutcome {
  route: 'processed' | 'review';
  messageId: string;
  mondayItemIds: string[];
  reason?: string;
}
