import { Mistral } from '@mistralai/mistralai';
import { parseClassificationJson } from '../classification.js';
import type { AcceptedAttachment, ClassificationResult, EmailMessage, OcrDocument } from '../types.js';

export interface MistralClientConfig {
  apiKey: string;
  ocrModel: string;
  chatModel: string;
}

export class MistralReceiptClient {
  private readonly client: Mistral;

  constructor(private readonly config: MistralClientConfig) {
    this.client = new Mistral({ apiKey: config.apiKey });
  }

  async ocrAttachment(attachment: AcceptedAttachment): Promise<OcrDocument> {
    const document = buildMistralDocument(attachment);
    const response = await this.client.ocr.process({
      model: this.config.ocrModel,
      document: document as never,
    });

    const pages = response.pages ?? [];
    const markdown = pages
      .map((page) => page.markdown ?? '')
      .filter(Boolean)
      .join('\n\n')
      .trim();

    return {
      attachmentId: attachment.id,
      fileName: attachment.name,
      markdown,
      pageCount: pages.length,
    };
  }

  async classifyReceipts(input: {
    email: EmailMessage;
    attachments: AcceptedAttachment[];
    ocrDocuments: OcrDocument[];
    confidenceThreshold: number;
  }): Promise<ClassificationResult> {
    const prompt = buildClassificationPrompt(input);
    const response = await this.client.chat.complete({
      model: this.config.chatModel,
      responseFormat: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You classify receipt emails for monday.com item creation. Return only valid JSON matching the requested schema.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const content = response.choices?.[0]?.message?.content;
    const raw = Array.isArray(content) ? content.map((part) => ('text' in part ? part.text : '')).join('') : content;

    if (!raw) {
      throw new Error('Mistral classifier returned an empty response');
    }

    return parseClassificationJson(raw);
  }
}

function buildMistralDocument(attachment: AcceptedAttachment): { type: 'document_url' | 'image_url'; documentUrl?: string; imageUrl?: string } {
  const contentType = attachment.contentType ?? contentTypeFromName(attachment.name);
  const dataUrl = `data:${contentType};base64,${attachment.contentBytes}`;

  if (contentType.startsWith('image/')) {
    return { type: 'image_url', imageUrl: dataUrl };
  }

  return { type: 'document_url', documentUrl: dataUrl };
}

function contentTypeFromName(fileName: string): string {
  const lower = fileName.toLowerCase();

  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  return 'image/jpeg';
}

function buildClassificationPrompt(input: {
  email: EmailMessage;
  attachments: AcceptedAttachment[];
  ocrDocuments: OcrDocument[];
  confidenceThreshold: number;
}): string {
  const attachmentSummaries = input.attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size,
  }));
  const ocrDocuments = input.ocrDocuments.map((document) => ({
    attachmentId: document.attachmentId,
    fileName: document.fileName,
    pageCount: document.pageCount,
    markdown: document.markdown.slice(0, 12000),
  }));

  return JSON.stringify(
    {
      task:
        'Group attachments into one monday.com item per receipt/invoice, choose an item name, extract only the requested fields, and route uncertain cases to review.',
      rules: [
        `Use decision=create_items only when every group confidence is at least ${input.confidenceThreshold}.`,
        'Use decision=review when the email is body-only, unsupported, ambiguous, or attachments cannot be confidently grouped.',
        'typeDeFacture must be exactly Factures or Carte.',
        'Carte means the payment has already been made by card (examples: paid by card, paiement par carte, CB, Visa, Mastercard, carte bancaire).',
        'Factures means an invoice/bill to pay, often with a QR code, QR-facture, IBAN, payment reference, or bank transfer instructions.',
        'Do not choose Factures merely because the document is an invoice if the email or OCR says it was paid by card; card-paid receipts are Carte.',
        'datePaiement must be YYYY-MM-DD or null.',
        'montantFacture must be a JSON number or null.',
        'Every accepted attachment ID must appear in exactly one receipt group when decision=create_items.',
      ],
      schema: {
        decision: 'create_items | review',
        confidence: 'number 0..1',
        reviewReason: 'string | null',
        emailSummary: 'short summary of email content',
        receiptGroups: [
          {
            itemName: 'merchant/date/reference style item name',
            confidence: 'number 0..1',
            groupingExplanation: 'why files belong together',
            attachmentIds: ['attachment id'],
            referenceFacture: 'string | null',
            montantFacture: 'number | null',
            datePaiement: 'YYYY-MM-DD | null',
            typeDeFacture: 'Factures | Carte',
            notesParticulieres: 'email summary plus receipt-specific notes',
          },
        ],
      },
      email: {
        subject: input.email.subject,
        receivedDateTime: input.email.receivedDateTime,
        sender: input.email.sender,
        bodyText: input.email.bodyText?.slice(0, 4000),
      },
      attachments: attachmentSummaries,
      ocrDocuments,
    },
    null,
    2,
  );
}
