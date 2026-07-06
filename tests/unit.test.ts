import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterReceiptAttachments } from '../src/attachments.js';
import { loadConfig, MONDAY_COLUMNS } from '../src/config.js';
import { parseClassificationJson } from '../src/classification.js';
import { MondayClient } from '../src/clients/monday.js';
import { toEmailMessage } from '../src/clients/graph.js';
import {
  EMAIL_AUTOMATION_NOTE,
  buildColumnValuesForReceipt,
  buildMondayColumnValues,
  buildReviewUpdateBody,
  buildUpdateBody,
} from '../src/mondayPayload.js';
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

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('adds automation provenance to receipt item notes', () => {
    const email: EmailMessage = {
      id: 'm1',
      subject: 'Receipt',
      receivedDateTime: '2026-06-22T12:00:00Z',
      webLink: 'https://outlook.office.com/mail/id1',
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

    const values = buildColumnValuesForReceipt(email, group);

    expect(values.notesParticulieres).toContain(EMAIL_AUTOMATION_NOTE);
    expect(values.notesParticulieres).toContain('Lien email: https://outlook.office.com/mail/id1');
    expect(values.notesParticulieres).toContain('Summary');
  });

  it('renders update body with source context and grouping confidence', () => {
    const email: EmailMessage = {
      id: 'm1',
      subject: 'Receipt',
      receivedDateTime: '2026-06-22T12:00:00Z',
      webLink: 'https://outlook.office.com/mail/id1',
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
    expect(body).toContain('https://outlook.office.com/mail/id1');
  });

  it('includes source link in review update body', () => {
    const email: EmailMessage = {
      id: 'm1',
      subject: 'Receipt',
      receivedDateTime: '2026-06-22T12:00:00Z',
      webLink: 'https://outlook.office.com/mail/id1',
      sender: { name: 'Alice', email: 'alice@example.com' },
      hasAttachments: true,
    };

    const body = buildReviewUpdateBody({
      email,
      reason: 'No supported attachments',
      attachmentNames: ['receipt.png'],
    });

    expect(body).toContain('Raison: No supported attachments');
    expect(body).toContain('https://outlook.office.com/mail/id1');
  });

  it('maps webLink from Graph message and rejects missing web links', () => {
    const message = {
      id: 'm2',
      subject: 'Receipt',
      receivedDateTime: '2026-06-22T12:00:00Z',
      webLink: '  https://outlook.office.com/mail/id2  ',
      from: { emailAddress: { name: 'Bob', address: 'bob@example.com' } },
      body: { content: '<p>Hello</p>' },
      hasAttachments: false,
    };

    const email = toEmailMessage(message);

    expect(email.webLink).toBe('https://outlook.office.com/mail/id2');

    expect(() => toEmailMessage({ id: 'm3', subject: 'Broken', receivedDateTime: '2026-06-22T12:00:00Z' } as any)).toThrow(
      'did not include webLink',
    );
  });
});

describe('monday client', () => {
  it('uploads files with monday.com multipart variable mapping', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { add_file_to_column: { id: 'asset-1' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new MondayClient({
      apiToken: 'token',
      apiVersion: '2024-10',
      boardId: '123',
      uploadRetryAttempts: 1,
    });

    await client.uploadFile({
      itemId: '1234567890',
      fileName: 'receipt.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('pdf'),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.monday.com/v2/file',
      expect.objectContaining({ method: 'POST' }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const form = request.body as FormData;

    expect(form.get('query')).toContain('add_file_to_column');
    expect(form.get('query')).toContain(`item_id: 1234567890`);
    expect(form.get('query')).toContain(`column_id: "${MONDAY_COLUMNS.facture}"`);
    expect(form.has('variables')).toBe(false);
    expect(JSON.parse(String(form.get('map')))).toEqual({ file: 'variables.file' });
    expect(form.get('file')).toBeInstanceOf(Blob);
  });
});
