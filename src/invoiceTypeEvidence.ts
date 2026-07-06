import type { EmailMessage, InvoiceType, OcrDocument, ReceiptGroup } from './types.js';

interface InvoiceTypeEvidenceMatch {
  type: InvoiceType;
  terms: string[];
}

export function applyInvoiceTypeEvidence(input: {
  email: EmailMessage;
  ocrDocuments: OcrDocument[];
  groups: ReceiptGroup[];
}): { groups: ReceiptGroup[]; reviewReason?: string } {
  const groups: ReceiptGroup[] = [];

  for (const group of input.groups) {
    const evidence = detectInvoiceTypeEvidence(buildEvidenceText(input.email, input.ocrDocuments, group));

    if (evidence.card && evidence.invoice) {
      return {
        groups: input.groups,
        reviewReason: `Conflicting invoice type evidence for "${group.itemName}": card-paid (${evidence.card.terms.join(', ')}) and invoice-to-pay (${evidence.invoice.terms.join(', ')})`,
      };
    }

    groups.push({
      ...group,
      typeDeFacture: evidence.card?.type ?? evidence.invoice?.type ?? group.typeDeFacture,
    });
  }

  return { groups };
}

function buildEvidenceText(email: EmailMessage, ocrDocuments: OcrDocument[], group: ReceiptGroup): string {
  const groupAttachmentIds = new Set(group.attachmentIds);
  const groupOcrText = ocrDocuments
    .filter((document) => groupAttachmentIds.has(document.attachmentId))
    .map((document) => document.markdown)
    .join('\n');

  return [email.subject, email.bodyText, group.itemName, group.notesParticulieres, groupOcrText]
    .filter(Boolean)
    .join('\n');
}

function detectInvoiceTypeEvidence(text: string): { card?: InvoiceTypeEvidenceMatch; invoice?: InvoiceTypeEvidenceMatch } {
  const cardTerms = matchingTerms(text, CARD_PAID_PATTERNS);
  const invoiceTerms = matchingTerms(text, INVOICE_TO_PAY_PATTERNS);

  return {
    card: cardTerms.length ? { type: 'Carte', terms: cardTerms } : undefined,
    invoice: invoiceTerms.length ? { type: 'Factures', terms: invoiceTerms } : undefined,
  };
}

function matchingTerms(text: string, patterns: Array<{ label: string; pattern: RegExp }>): string[] {
  return patterns
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label);
}

const CARD_PAID_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'paid by card', pattern: /\b(?:paid|payment|charged)\s+(?:by|with|via)\s+(?:credit\s+card|debit\s+card|card)\b/i },
  { label: 'card payment', pattern: /\b(?:card\s+payment|credit\s+card|debit\s+card)\b/i },
  { label: 'paiement par carte', pattern: /\b(?:paiement|pay[eé]|r[eè]gl[eé]|d[eé]bit[eé])\s+(?:par|avec|en)?\s*(?:carte|cb)\b/i },
  { label: 'carte bancaire', pattern: /\b(?:carte\s+bancaire|carte\s+de\s+cr[eé]dit|carte\s+de\s+d[eé]bit)\b/i },
  { label: 'card network', pattern: /\b(?:cb|visa|mastercard|maestro|amex|american\s+express)\b/i },
];

const INVOICE_TO_PAY_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'QR facture', pattern: /\b(?:qr[-\s]?facture|facture\s+qr|swiss\s+qr)\b/i },
  { label: 'QR code', pattern: /\bqr\s*code\b/i },
  { label: 'IBAN', pattern: /\biban\b/i },
  { label: 'payment reference', pattern: /\b(?:r[eé]f[eé]rence\s+(?:qr|de\s+paiement)|qr\s+r[eé]f[eé]rence|payment\s+reference)\b/i },
  { label: 'amount to pay', pattern: /\b(?:montant\s+(?:à|a)\s+payer|(?:à|a)\s+payer|amount\s+due)\b/i },
  { label: 'bank transfer', pattern: /\b(?:virement\s+bancaire|bank\s+transfer|bulletin\s+de\s+versement)\b/i },
];
