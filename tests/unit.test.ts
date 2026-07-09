import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterReceiptAttachments } from '../src/attachments.js';
import { loadConfig, MONDAY_COLUMNS } from '../src/config.js';
import { parseClassificationJson } from '../src/classification.js';
import { MondayClient } from '../src/clients/monday.js';
import { GraphMailClient, toEmailMessage } from '../src/clients/graph.js';
import {
  EMAIL_AUTOMATION_NOTE,
  buildAttentionUpdateBody,
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
  vi.restoreAllMocks();
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
  it('normalizes legacy date, amount, and dropdown values', () => {
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
    expect(parsed.receiptGroups[0]?.groupingEvidence).toBeUndefined();
    expect(parsed.receiptGroups[0]?.fieldStatuses).toMatchObject({
      itemName: { status: 'confident', value: 'Merchant 2026-06-22' },
      referenceFacture: { status: 'confident', value: 'INV-1' },
    });
  });

  it('parses the new field-status contract with provenance and missing-value statuses', () => {
    const parsed = parseClassificationJson(`{
      "decision": "create_items",
      "confidence": 0.93,
      "emailSummary": "Receipt email",
      "receiptGroups": [{
        "itemName": {"status": "confident", "value": "Receipt from Direction"},
        "confidence": 0.93,
        "groupingExplanation": {"status": "confident", "value": "single PDF"},
        "attachmentIds": ["a1", "a2"],
        "referenceFacture": {"status": "uncertain", "value": null, "reason": "No invoice number visible"},
        "montantFacture": {"status": "confident", "value": 99.5},
        "datePaiement": {"status": "confident", "value": "2026-06-22"},
        "typeDeFacture": {"status": "confident", "value": "Carte"},
        "notesParticulieres": {"status": "confident", "value": "Email summary"},
        "provenanceSuggeree": {"status": "confident", "value": "Direction"},
        "soumisPar": {"status": "confident", "value": "Alice <alice@ex.com>"},
        "fournisseur": {"status": "uncertain", "value": null, "reason": "Unable to read vendor name"},
        "groupingEvidence": [
          {"attachmentId": "a1", "provider": "Merchant", "service": "Subscription", "documentKind": "invoice", "reason": "Invoice heading"},
          {"attachmentId": "a2", "provider": "Merchant", "service": "Subscription", "documentKind": "payment proof", "reason": "Payment confirmation"}
        ]
      }]
    }`);

    expect(parsed.receiptGroups[0]?.typeDeFacture).toBe('Carte');
    expect(parsed.receiptGroups[0]?.provenanceSuggeree).toBe('Direction');
    expect(parsed.receiptGroups[0]?.fieldStatuses?.referenceFacture).toEqual({
      status: 'uncertain',
      value: null,
      reason: 'No invoice number visible',
    });
    expect(parsed.receiptGroups[0]?.fieldStatuses?.soumisPar?.status).toBe('confident');
    expect(parsed.receiptGroups[0]?.fournisseur).toBeNull();
    expect(parsed.receiptGroups[0]?.groupingEvidence).toEqual([
      { attachmentId: 'a1', provider: 'Merchant', service: 'Subscription', documentKind: 'invoice', reason: 'Invoice heading' },
      { attachmentId: 'a2', provider: 'Merchant', service: 'Subscription', documentKind: 'payment_proof', reason: 'Payment confirmation' },
    ]);
  });
});

describe('monday payloads', () => {
  it('builds fixed column values', () => {
    const payload = buildMondayColumnValues({
      dateReception: '2026-06-22',
      datePaiement: '2026-06-23',
      referenceFacture: 'INV-42',
      montantFacture: 42.5,
      notesParticulieres: EMAIL_AUTOMATION_NOTE,
      soumisPar: 'Sender',
      typeDeFacture: 'Carte',
      statut: 'Nouveau',
      etatDeFacture: 'Facture Reçue',
    });

    expect(payload[MONDAY_COLUMNS.dateReception]).toEqual({ date: '2026-06-22' });
    expect(payload[MONDAY_COLUMNS.montantFacture]).toBe('42.5');
    expect(payload[MONDAY_COLUMNS.typeDeFacture]).toEqual({ labels: ['Carte'] });
    expect(payload[MONDAY_COLUMNS.statut]).toEqual({ label: 'Nouveau' });
    expect(payload[MONDAY_COLUMNS.etatDeFacture]).toEqual({ label: 'Facture Reçue' });
  });

  it('adds automation note and attention suffix for attention items', () => {
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

    const values = buildColumnValuesForReceipt(email, group, {
      statut: 'Attention',
      attentionReasons: ['Référence facture manquante'],
    });

    expect(values.notesParticulieres).toContain(EMAIL_AUTOMATION_NOTE);
    expect(values.notesParticulieres).toContain('Attention: Référence facture manquante');
  });

  it('builds update body including moved link and thread content', () => {
    const email: EmailMessage = {
      id: 'm1',
      subject: 'Receipt',
      receivedDateTime: '2026-06-22T12:00:00Z',
      webLink: 'https://outlook.office.com/mail/id1',
      sender: { name: 'Alice', email: 'alice@example.com' },
      hasAttachments: true,
      bodyText: 'Line1\n\nLine2',
    };
    const group: ReceiptGroup = {
      itemName: 'Merchant receipt',
      confidence: 0.92,
      groupingExplanation: 'one image',
      attachmentIds: ['a1'],
      typeDeFacture: 'Factures',
      notesParticulieres: 'Summary',
    };

    const body = buildUpdateBody({
      email,
      group,
      emailThread: email.bodyText,
      movedMessageLink: 'https://outlook.office.com/mail/moved-id1',
    });

    expect(body).toContain('Alice');
    expect(body).toContain('92%');
    expect(body).not.toContain('Statut interne:');
    expect(body).not.toContain('Facture:');
    expect(body).not.toContain('Fichiers ajoutés:');
    expect(body).not.toContain('receipt.png');
    expect(body).toContain('Lien du mail');
    expect(body).not.toContain('Source email déplacée');
    expect(body).toContain('https://outlook.office.com/mail/moved-id1');
    expect(body).toContain('Message source:<br>Line1<br><br>Line2');
    expect(body).not.toContain('Attention:');
  });

  it('builds a dedicated escaped attention update body', () => {
    const body = buildAttentionUpdateBody(['Date <paiement> manquante', 'Référence & montant incertains']);

    expect(body).toContain('Points d’attention');
    expect(body).toContain('Attention: Date &lt;paiement&gt; manquante');
    expect(body).toContain('Attention: Référence &amp; montant incertains');
  });

  it('includes source link and thread in review update body', () => {
    const email: EmailMessage = {
      id: 'm1',
      subject: 'Receipt',
      receivedDateTime: '2026-06-22T12:00:00Z',
      webLink: 'https://outlook.office.com/mail/id1',
      sender: { name: 'Alice', email: 'alice@example.com' },
      hasAttachments: true,
      bodyText: 'Thread content',
    };

    const body = buildReviewUpdateBody({
      email,
      reason: 'No supported attachments',
      attachmentNames: ['receipt.png'],
      emailThread: email.bodyText,
      movedMessageLink: 'https://outlook.office.com/mail/moved-id1',
    });

    expect(body).toContain('Attention: No supported attachments');
    expect(body).toContain('Lien du mail');
    expect(body).not.toContain('Source email déplacée');
    expect(body).toContain('https://outlook.office.com/mail/moved-id1');
    expect(body).toContain('Message source:<br>Thread content');
  });

  it('maps webLink from Graph message and tolerates missing web links', () => {
    const message = {
      id: 'm2',
      subject: 'Receipt',
      receivedDateTime: '2026-06-22T12:00:00Z',
      webLink: '  https://outlook.office.com/mail/id2  ',
      from: { emailAddress: { name: 'Bob', address: 'bob@example.com' } },
      body: { content: '<div>Hello<br>Line 2</div><p>Next paragraph</p>' },
      hasAttachments: false,
    };

    const email = toEmailMessage(message);

    expect(email.webLink).toBe('https://outlook.office.com/mail/id2');
    expect(email.bodyText).toBe('Hello\nLine 2\nNext paragraph');

    const messageWithoutWebLink: Parameters<typeof toEmailMessage>[0] = {
      id: 'm3',
      subject: 'Broken',
      receivedDateTime: '2026-06-22T12:00:00Z',
    };

    expect(toEmailMessage(messageWithoutWebLink).webLink).toBeUndefined();
  });

  it('uses the moved Graph webLink ItemID to build shared-mailbox Outlook links', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'immutable-moved-id',
          subject: 'Moved receipt',
          receivedDateTime: '2026-06-22T12:00:00Z',
          webLink: 'https://outlook.office365.com/owa/?ItemID=rest-id%2B%2F%3D&exvsurl=1&viewmodel=ReadMessageItem',
          from: { emailAddress: { name: 'Alice', address: 'alice@example.com' } },
          hasAttachments: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(GraphMailClient.prototype, 'getAccessToken').mockResolvedValue('token');

    const client = new GraphMailClient({
      tenantId: 'tenant',
      clientId: 'client',
      clientSecret: 'secret',
      mailboxUserId: 'receipts@example.com',
    });

    const moved = await client.moveMessage('old-id', 'review-folder');

    expect(moved.webLink).toBe(
      'https://outlook.office.com/mail/receipts%40example.com/deeplink?ItemID=rest-id%2B%2F%3D&exvsurl=1',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/messages/old-id/move');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Prefer: 'IdType="ImmutableId"' }),
      }),
    );
  });

  it('falls back to translated REST ids when moved Graph webLink has no ItemID', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'immutable-moved-id',
            subject: 'Moved receipt',
            receivedDateTime: '2026-06-22T12:00:00Z',
            webLink: 'https://outlook.office.com/mail/inbox',
            from: { emailAddress: { name: 'Alice', address: 'alice@example.com' } },
            hasAttachments: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [{ sourceId: 'immutable-moved-id', targetId: 'rest-id+/=' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(GraphMailClient.prototype, 'getAccessToken').mockResolvedValue('token');

    const client = new GraphMailClient({
      tenantId: 'tenant',
      clientId: 'client',
      clientSecret: 'secret',
      mailboxUserId: 'receipts@example.com',
    });

    const moved = await client.moveMessage('old-id', 'review-folder');

    expect(moved.webLink).toBe(
      'https://outlook.office.com/mail/receipts%40example.com/deeplink?ItemID=rest-id%2B%2F%3D&exvsurl=1',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/users/receipts%40example.com/translateExchangeIds');
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      inputIds: ['immutable-moved-id'],
      sourceIdType: 'restImmutableEntryId',
      targetIdType: 'restId',
    });
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
