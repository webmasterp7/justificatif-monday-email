import { describe, expect, it } from 'vitest';
import { filterReceiptAttachments } from '../src/attachments.js';
import { loadConfig, MONDAY_COLUMNS } from '../src/config.js';
import { parseClassificationJson } from '../src/classification.js';
import { buildMondayColumnValues, buildUpdateBody } from '../src/mondayPayload.js';
import type { EmailMessage, ReceiptGroup } from '../src/types.js';

const validEnv = {
  MS_TENANT_ID: 'tenant',
  MS_CLIENT_ID: 'client',
  MS_CLIENT_SECRET: 'secret',
  MS_MAILBOX_USER_ID: 'receipts@example.com',
  MISTRAL_API_KEY: 'mistral',
  MONDAY_API_TOKEN: 'monday',
  MONDAY_BOARD_ID: '123',
};

describe('config validation', () => {
  it('loads defaults and fixed monday columns', () => {
    const config = loadConfig(validEnv);

    expect(config.polling.intervalMinutes).toBe(15);
    expect(config.microsoft.folders.review).toBe('Review');
    expect(config.monday.columns.facture).toBe(MONDAY_COLUMNS.facture);
    expect(config.monday.dropdownLabels).toEqual(['Factures', 'Carte']);
  });

  it('throws clear errors for missing required env vars', () => {
    expect(() => loadConfig({})).toThrow(/Invalid environment configuration/);
  });
});

describe('attachment filtering', () => {
  it('accepts PDF and image attachments by mime type or extension', () => {
    const result = filterReceiptAttachments(
      [
        { id: '1', name: 'receipt.pdf', contentType: 'application/pdf', size: 10, isInline: false },
        { id: '2', name: 'photo.HEIC', size: 10, isInline: false },
        { id: '3', name: 'notes.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 10, isInline: false },
        { id: '4', name: 'logo.png', contentType: 'image/png', size: 10, isInline: true },
      ],
      {
        acceptedMimeTypes: ['application/pdf', 'image/png', 'image/heic'],
        acceptedExtensions: ['.pdf', '.png', '.heic'],
      },
    );

    expect(result.accepted.map((attachment) => attachment.id)).toEqual(['1', '2']);
    expect(result.unsupported.map((attachment) => attachment.id)).toEqual(['3']);
  });
});

describe('classification parsing', () => {
  it('normalizes date, amount, and dropdown values', () => {
    const parsed = parseClassificationJson(`{
      "decision": "create_items",
      "confidence": 0.9,
      "emailSummary": "Invoice email",
      "receiptGroups": [{
        "itemName": "Merchant 2026-06-22",
        "confidence": 0.91,
        "groupingExplanation": "single PDF",
        "attachmentIds": ["a1"],
        "referenceFacture": "INV-1",
        "montantFacture": "123,45",
        "datePaiement": "2026-06-22T10:00:00Z",
        "typeDeFacture": "facture",
        "notesParticulieres": "Email summary"
      }]
    }`);

    expect(parsed.receiptGroups[0]?.montantFacture).toBe(123.45);
    expect(parsed.receiptGroups[0]?.datePaiement).toBe('2026-06-22');
    expect(parsed.receiptGroups[0]?.typeDeFacture).toBe('Factures');
  });
});

describe('monday payloads', () => {
  it('builds fixed column values', () => {
    const payload = buildMondayColumnValues({
      dateReception: '2026-06-22',
      datePaiement: '2026-06-23',
      referenceFacture: 'INV-42',
      montantFacture: 42.5,
      notesParticulieres: 'Summary',
      soumisPar: 'Sender',
      typeDeFacture: 'Carte',
    });

    expect(payload[MONDAY_COLUMNS.dateReception]).toEqual({ date: '2026-06-22' });
    expect(payload[MONDAY_COLUMNS.montantFacture]).toBe('42.5');
    expect(payload[MONDAY_COLUMNS.typeDeFacture]).toEqual({ labels: ['Carte'] });
  });

  it('renders update body with source context and grouping confidence', () => {
    const email: EmailMessage = {
      id: 'm1',
      subject: 'Receipt',
      receivedDateTime: '2026-06-22T12:00:00Z',
      sender: { name: 'Alice', email: 'alice@example.com' },
      hasAttachments: true,
    };
    const group: ReceiptGroup = {
      itemName: 'Merchant receipt',
      confidence: 0.92,
      groupingExplanation: 'one image',
      attachmentIds: ['a1'],
      typeDeFacture: 'Factures',
      notesParticulieres: 'Summary',
    };

    const body = buildUpdateBody({ email, group, attachmentNames: ['receipt.png'] });

    expect(body).toContain('Alice');
    expect(body).toContain('receipt.png');
    expect(body).toContain('92%');
  });
});
