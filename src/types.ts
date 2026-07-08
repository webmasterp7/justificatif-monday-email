export type InvoiceType = 'Factures' | 'Carte';

export type ClassificationFieldStatus = 'confident' | 'uncertain' | 'missing';

export const PROVENANCE_SUGGESTIONS = [
  'Direction',
  'Préverenges',
  'Montreux',
  'Charmilles',
  'Cornavin',
  'Renens',
  'Chailly',
  'Avant-Poste',
  'Fribourg',
  'Formation Med3A',
  'E-shop',
  'Formation 4Med',
  '4MEd',
  'Med3A',
] as const;

export type ProvenanceSuggestion = (typeof PROVENANCE_SUGGESTIONS)[number];

export interface ClassifiedField<T> {
  status: ClassificationFieldStatus;
  value: T;
  reason?: string;
}

export interface ReceiptGroupFieldStatuses {
  itemName: ClassifiedField<string | null>;
  typeDeFacture: ClassifiedField<InvoiceType>;
  soumisPar: ClassifiedField<string | null>;
  provenanceSuggeree: ClassifiedField<ProvenanceSuggestion | null>;
  referenceFacture: ClassifiedField<string | null>;
  montantFacture: ClassifiedField<number | null>;
  fournisseur: ClassifiedField<string | null>;
  datePaiement: ClassifiedField<string | null>;
}

export interface EmailSender {
  name?: string;
  email: string;
}

export interface EmailMessage {
  id: string;
  subject: string;
  receivedDateTime: string;
  webLink?: string;
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

  soumisPar?: string | null;
  provenanceSuggeree?: ProvenanceSuggestion | null;
  fournisseur?: string | null;

  fieldStatuses?: ReceiptGroupFieldStatuses;
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
  statut: 'Nouveau' | 'Attention';
  fournisseur?: string;
  provenanceSuggeree?: ProvenanceSuggestion | null;
  etatDeFacture: 'Facture Reçue';
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

export interface MondayStatusUpdateRequest {
  itemId: string;
  statut: 'Nouveau' | 'Attention';
}

export interface WorkflowOutcome {
  route: 'processed' | 'review';
  messageId: string;
  mondayItemIds: string[];
  reason?: string;
}
