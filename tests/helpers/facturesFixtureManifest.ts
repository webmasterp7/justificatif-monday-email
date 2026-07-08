import type { ClassificationResult, EmailAttachment, EmailMessage, OcrDocument } from '../../src/types.js';

export type FacturesScenarioTag =
  | 'direct-single-attachment'
  | 'forwarded-body-only'
  | 'reply-thread'
  | 'multiple-invoices-one-email'
  | 'payment-receipt-multiple-invoices'
  | 'mixed-supported-unsupported'
  | 'unsupported-only'
  | 'missing-card-payment-date'
  | 'low-confidence-grouping'
  | 'classifier-review'
  | 'ocr-failure'
  | 'upload-failure'
  | 'final-update-failure';

export interface FacturesAttachmentFixture extends EmailAttachment {
  privateFixturePath?: string;
}

export interface FacturesEmailFixture {
  email: EmailMessage;
  scenarioTags: FacturesScenarioTag[];
  attachments: FacturesAttachmentFixture[];
  ocrDocuments?: OcrDocument[];
  classification?: ClassificationResult;
}

export interface FacturesFixtureManifest {
  sourceAccount: string;
  sourceFolder: string;
  exportedAt: string;
  emails: FacturesEmailFixture[];
}

export function makeFixtureEmail(input: {
  id: string;
  subject: string;
  receivedDateTime?: string;
  senderName?: string;
  senderEmail: string;
  bodyText?: string;
  hasAttachments?: boolean;
}): EmailMessage {
  return {
    id: input.id,
    subject: input.subject,
    receivedDateTime: input.receivedDateTime ?? '2026-07-01T00:00:00Z',
    webLink: `https://outlook.office.com/mail/${encodeURIComponent(input.id)}`,
    sender: { name: input.senderName, email: input.senderEmail },
    bodyText: input.bodyText,
    hasAttachments: input.hasAttachments ?? false,
  };
}

export function makeFixtureAttachment(input: {
  id: string;
  name: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentBytes?: string;
  privateFixturePath?: string;
}): FacturesAttachmentFixture {
  return {
    id: input.id,
    name: input.name,
    contentType: input.contentType,
    size: input.size ?? 12,
    isInline: input.isInline ?? false,
    contentBytes: input.contentBytes,
    privateFixturePath: input.privateFixturePath,
  };
}
