import { describe, expect, it } from 'vitest';
import { applyInvoiceTypeEvidence } from '../src/invoiceTypeEvidence.js';
import type { EmailMessage, OcrDocument, ReceiptGroup } from '../src/types.js';

const email: EmailMessage = {
  id: 'message-1',
  subject: 'Invoice 082001007517',
  receivedDateTime: '2026-07-07T10:00:00Z',
  webLink: 'https://outlook.office.com/mail/message-1',
  sender: { name: 'Billing', email: 'billing@example.com' },
  bodyText: '',
  hasAttachments: true,
};

function group(overrides: Partial<ReceiptGroup> = {}): ReceiptGroup {
  return {
    itemName: 'Abonnement serveur Hetzner juillet',
    confidence: 0.95,
    groupingExplanation: 'single PDF',
    attachmentIds: ['att-1'],
    referenceFacture: 'INV-1',
    montantFacture: 16.52,
    datePaiement: null,
    typeDeFacture: 'Factures',
    notesParticulieres: 'Online service invoice',
    ...overrides,
  };
}

function ocr(markdown: string): OcrDocument[] {
  return [
    {
      attachmentId: 'att-1',
      fileName: 'invoice.pdf',
      markdown,
      pageCount: 1,
    },
  ];
}

describe('invoice type evidence', () => {
  it('corrects card-debited online invoices without QR/IBAN to Carte', () => {
    const result = applyInvoiceTypeEvidence({
      email: {
        ...email,
        bodyText: 'The open invoice amount of €16.52 will soon be debited from your credit card.',
      },
      ocrDocuments: ocr('Hetzner Online GmbH invoice for hosting services. Billing period July 2026.'),
      groups: [group({ typeDeFacture: 'Factures' })],
    });

    expect(result.reviewReason).toBeUndefined();
    expect(result.groups[0]?.typeDeFacture).toBe('Carte');
  });

  it('does not force Factures from invoice wording, amount due, or payment reference alone', () => {
    const result = applyInvoiceTypeEvidence({
      email,
      ocrDocuments: ocr('Invoice INV-1. Amount due CHF 100. Payment reference 123456.'),
      groups: [group({ typeDeFacture: 'Carte' })],
    });

    expect(result.reviewReason).toBeUndefined();
    expect(result.groups[0]?.typeDeFacture).toBe('Carte');
  });

  it('classifies QR plus IBAN bank-transfer evidence as Factures', () => {
    const result = applyInvoiceTypeEvidence({
      email,
      ocrDocuments: ocr('QR-facture payable par virement bancaire. IBAN CH93 0076 2011 6238 5295 7.'),
      groups: [group({ typeDeFacture: 'Carte' })],
    });

    expect(result.reviewReason).toBeUndefined();
    expect(result.groups[0]?.typeDeFacture).toBe('Factures');
  });

  it('keeps card plus bank-transfer evidence as a review conflict', () => {
    const result = applyInvoiceTypeEvidence({
      email: {
        ...email,
        bodyText: 'This amount will be debited from your credit card.',
      },
      ocrDocuments: ocr('QR-facture avec QR-IBAN CH44 3199 9123 0008 8901 2.'),
      groups: [group({ typeDeFacture: 'Factures' })],
    });

    expect(result.reviewReason).toContain('Conflicting invoice type evidence');
    expect(result.groups[0]?.typeDeFacture).toBe('Factures');
  });
});
