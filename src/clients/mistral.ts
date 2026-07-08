import { Mistral } from '@mistralai/mistralai';
import { MONDAY_PROVENANCE_LABELS } from '../config.js';
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
    markdown: document.markdown,
  }));

  const provenanceLabels = [...MONDAY_PROVENANCE_LABELS];

  return JSON.stringify(
    {
      task: 'Classify receipt/invoice email attachments and return only valid JSON for monday.com item creation.',
      context: {
        email: {
          subject: input.email.subject,
          receivedDateTime: input.email.receivedDateTime,
          sender: {
            name: input.email.sender.name,
            email: input.email.sender.email,
          },
          webLink: input.email.webLink,
          threadText: input.email.bodyText ?? '',
        },
        attachments: attachmentSummaries,
        ocrDocuments,
        allowedProvenanceLabels: provenanceLabels,
        threshold: input.confidenceThreshold,
      },
      instructions: [
        'Use decision=create_items for business uncertainty: return uncertain/missing field statuses and reasons instead of requesting review.',
        'Use decision=review only when the available content is unreadable or clearly not an invoice/receipt package.',
        'Every accepted attachment ID must be used in exactly one group when returning create_items.',
        'When grouping is uncertain, return create_items with one fallback group containing all attachments, low confidence, and uncertain groupingExplanation (do not lose any attachment).',
        'Item name MUST be a concise French description of what was paid or billed, inferred from email/OCR content: purpose/service + vendor/service + month/period when inferable, e.g. "Abonnement serveur Hetzner juillet".',
        'Item name MUST NOT include full dates, invoice/reference numbers, or blindly copy the email subject/invoice heading.',
        'Type de facture MUST be exactly Factures or Carte.',
        'Carte = invoice/receipt already paid by card or to be debited from a card; treat online-service invoices with wording like paid by card, charged to card, debited from credit card, CB, Visa, Mastercard, Amex, paiement par carte as Carte.',
        'Factures = bank-transfer invoice to pay; use Factures only when OCR/email shows QR/QR-facture/Swiss QR evidence together with IBAN/QR-IBAN/bank-transfer/bulletin evidence.',
        'Do not classify as Factures just because the document says invoice/facture, includes an invoice number/reference, payment reference, amount due/open amount, or billing period.',
        'If there is no QR/QR-facture and no IBAN/QR-IBAN/bank-transfer evidence, online-service invoices should be Carte when card payment/debit evidence appears.',
        'Date de Paiement rules: for Carte, always extract the actual transaction/payment date when present; for Factures, return null unless the document explicitly contains an already-paid date (e.g., preuve de paiement/reçu).',
        'Soumis par should default immediately to sender name <sender email> from metadata; only use body evidence if sender metadata is missing or blank.',
        'Provenance suggérée: pick closest match from allowedProvenanceLabels. If confidence is low, still choose the closest label and set provenanceSuggeree.status=uncertain with a reason.',
        'When classifying grouped receipts from Physio 7, favor Physio 7 sender metadata/domain/signature signals and branch/location mentions to infer provenance and submitted-by fields.',
      ],
      output: {
        decision: 'create_items | review',
        confidence: '0.0 to 1.0',
        reviewReason: 'short reason or null',
        emailSummary: 'short stripped-email summary',
        receiptGroups: [
          {
            itemName: {
              status: 'confident | uncertain | missing',
              value: 'descriptive French payment/service title without full date or invoice/reference number, e.g. Abonnement serveur Hetzner juillet',
              reason: 'required when status is uncertain or missing',
            },
            confidence: '0.0 to 1.0',
            groupingExplanation: {
              status: 'confident | uncertain | missing',
              value: 'why files belong together',
              reason: 'required when status is uncertain or missing',
            },
            attachmentIds: ['accepted attachment id'],
            typeDeFacture: {
              status: 'confident | uncertain | missing',
              value: 'Factures | Carte',
              reason: 'required when status is uncertain or missing',
            },
            soumisPar: {
              status: 'confident | uncertain | missing',
              value: 'name <email> or fallback',
              reason: 'required when status is uncertain or missing',
            },
            provenanceSuggeree: {
              status: 'confident | uncertain | missing',
              value: `one of: ${provenanceLabels.join(' | ')}`,
              reason: 'required when status is uncertain or missing',
            },
            referenceFacture: {
              status: 'confident | uncertain | missing',
              value: 'invoice/reference number or null',
              reason: 'required when status is uncertain or missing',
            },
            montantFacture: {
              status: 'confident | uncertain | missing',
              value: 'number or null',
              reason: 'required when status is uncertain or missing',
            },
            fournisseur: {
              status: 'confident | uncertain | missing',
              value: 'vendor name or null',
              reason: 'required when status is uncertain or missing',
            },
            datePaiement: {
              status: 'confident | uncertain | missing',
              value: 'YYYY-MM-DD or null',
              reason: 'required when status is uncertain or missing',
            },
            notesParticulieres: {
              status: 'confident | uncertain | missing',
              value: 'short receipt notes',
              reason: 'required when status is uncertain or missing',
            },
          },
        ],
      },
    },
    null,
    2,
  );
}
