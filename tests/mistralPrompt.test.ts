import { afterEach, describe, expect, it, vi } from 'vitest';
import { MONDAY_PROVENANCE_LABELS } from '../src/config.js';
import { MistralReceiptClient } from '../src/clients/mistral.js';

const completeMock = vi.fn();

vi.mock('@mistralai/mistralai', () => ({
  Mistral: vi.fn().mockImplementation(function () {
    return {
      ocr: { process: vi.fn() },
      chat: { complete: completeMock },
    };
  }),
}));

const longEmailText = `Salut,

Merci pour le reçu.

${'l'.repeat(12000)}`;

const longMarkdown = `OCR content
${'x'.repeat(15000)}`;

const requestInput = {
  email: {
    id: 'message-1',
    subject: 'Facture #INV-99',
    receivedDateTime: '2026-06-22T10:00:00Z',
    webLink: 'https://outlook.office.com/mail/message-1',
    sender: {
      name: 'Dr. Alice Physio',
      email: 'alice@physio7.ch',
    },
    bodyText: longEmailText,
    hasAttachments: true,
  },
  attachments: [
    {
      id: 'att-1',
      name: 'receipt-1.pdf',
      contentType: 'application/pdf',
      size: 1200,
      isInline: false,
      contentBytes: 'base64',
    },
  ],
  ocrDocuments: [
    {
      attachmentId: 'att-1',
      fileName: 'receipt-1.pdf',
      markdown: longMarkdown,
      pageCount: 2,
    },
  ],
  confidenceThreshold: 0.72,
};

const successfulClassification = {
  decision: 'create_items',
  confidence: 0.95,
  reviewReason: null,
  emailSummary: 'Email summary',
  receiptGroups: [
    {
      itemName: { status: 'confident', value: 'Abonnement serveur Hetzner juillet' },
      confidence: 0.95,
      groupingExplanation: { status: 'confident', value: 'single PDF' },
      attachmentIds: ['att-1'],
      referenceFacture: { status: 'confident', value: 'INV-99' },
      montantFacture: { status: 'confident', value: 129.5 },
      datePaiement: { status: 'confident', value: null },
      typeDeFacture: { status: 'confident', value: 'Factures' },
      notesParticulieres: { status: 'confident', value: 'Email summary' },
      provenanceSuggeree: { status: 'confident', value: 'Montreux' },
      soumisPar: { status: 'confident', value: 'Dr. Alice Physio <alice@physio7.ch>' },
      fournisseur: { status: 'confident', value: 'Fournisseur SA' },
    },
  ],
};

afterEach(() => {
  completeMock.mockReset();
});

describe('Mistral classification prompt', () => {
  it('sends full email/thread context, attachment metadata, OCR, and provenance labels', async () => {
    completeMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify(successfulClassification),
          },
        },
      ],
    });

    const client = new MistralReceiptClient({
      apiKey: 'key',
      ocrModel: 'mistral-ocr-latest',
      chatModel: 'mistral-large-latest',
    });

    const result = await client.classifyReceipts(requestInput);
    const callArgs = completeMock.mock.calls[0]?.[0];
    expect(callArgs).toBeTruthy();

    const userMessage = callArgs.messages.at(-1);
    expect(userMessage?.role).toBe('user');

    const prompt = JSON.parse(userMessage.content as string);

    expect(prompt.context.email.sender.name).toBe('Dr. Alice Physio');
    expect(prompt.context.email.sender.email).toBe('alice@physio7.ch');
    expect(prompt.context.email.threadText).toBe(longEmailText);
    expect(prompt.context.ocrDocuments[0].markdown).toBe(longMarkdown);
    expect(prompt.context.attachments).toEqual([
      {
        id: 'att-1',
        name: 'receipt-1.pdf',
        contentType: 'application/pdf',
        size: 1200,
      },
    ]);
    expect(prompt.context.allowedProvenanceLabels).toEqual(MONDAY_PROVENANCE_LABELS);
    expect(prompt.output.receiptGroups[0].provenanceSuggeree.value).toContain('one of:');

    expect(result.receiptGroups[0]?.provenanceSuggeree).toBe('Montreux');
    expect(result.receiptGroups[0]?.fournisseur).toBe('Fournisseur SA');
  });

  it('requests strict Carte/Factures, provenance fallback, and date semantics plus Physio 7 guidance', async () => {
    completeMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify(successfulClassification),
          },
        },
      ],
    });

    const client = new MistralReceiptClient({
      apiKey: 'key',
      ocrModel: 'mistral-ocr-latest',
      chatModel: 'mistral-large-latest',
    });

    await client.classifyReceipts(requestInput);

    const userPrompt = completeMock.mock.calls[0][0].messages.at(-1).content as string;
    const parsedPrompt = JSON.parse(userPrompt);

    expect(parsedPrompt.instructions.join(' ')).toContain('Type de facture MUST be exactly Factures or Carte.');
    expect(parsedPrompt.instructions.join(' ')).toContain('online-service invoices with wording like paid by card');
    expect(parsedPrompt.instructions.join(' ')).toContain('debited from credit card');
    expect(parsedPrompt.instructions.join(' ')).toContain('use Factures only when OCR/email shows QR/QR-facture/Swiss QR evidence together with IBAN/QR-IBAN/bank-transfer/bulletin evidence');
    expect(parsedPrompt.instructions.join(' ')).toContain('Do not classify as Factures just because the document says invoice/facture');
    expect(parsedPrompt.instructions.join(' ')).toContain('no QR/QR-facture and no IBAN/QR-IBAN/bank-transfer evidence');
    expect(parsedPrompt.instructions.join(' ')).toContain('Date de Paiement rules: for Carte, always extract the actual transaction/payment date');
    expect(parsedPrompt.instructions.join(' ')).toContain('Group by transaction/expense, not by email');
    expect(parsedPrompt.instructions.join(' ')).toContain('invoice and receipt/proof of payment for the same amount/vendor/reference/service');
    expect(parsedPrompt.instructions.join(' ')).toContain('Separate unrelated supplier invoices/receipts into separate groups');
    expect(parsedPrompt.instructions.join(' ')).toContain('Supporting documents such as participant lists');
    expect(parsedPrompt.instructions.join(' ')).toContain('When grouping is uncertain, return create_items with one fallback group');
    expect(parsedPrompt.instructions.join(' ')).toContain('purpose/service + vendor/service + month/period');
    expect(parsedPrompt.instructions.join(' ')).toContain('Abonnement serveur Hetzner juillet');
    expect(parsedPrompt.instructions.join(' ')).toContain('MUST NOT include full dates, invoice/reference numbers');
    expect(parsedPrompt.instructions.join(' ')).toContain('Provenance suggérée');
    expect(parsedPrompt.instructions.join(' ')).toContain('Physio 7');
    expect(parsedPrompt.output.receiptGroups[0]).toMatchObject({
      itemName: {
        status: 'confident | uncertain | missing',
        value: expect.stringContaining('without full date or invoice/reference number'),
      },
      typeDeFacture: { status: 'confident | uncertain | missing', value: 'Factures | Carte' },
      provenanceSuggeree: { status: 'confident | uncertain | missing' },
      fournisseur: { status: 'confident | uncertain | missing' },
    });
  });
});
