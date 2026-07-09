import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FacturesEmailFixture, FacturesScenarioTag, FacturesAttachmentFixture } from './helpers/facturesFixtureManifest.js';
import { makeFixtureAttachment, makeFixtureEmail } from './helpers/facturesFixtureManifest.js';
import { makeClassification, makeReceiptGroup, processFixture } from './helpers/facturesSimulationHarness.js';

type SeedEmail = {
  subject: string;
  receivedAt: string;
  from: string;
  hasAttachments: boolean;
  scenarioTags: FacturesScenarioTag[];
};

type Manifest = {
  emails: SeedEmail[];
};

const defaultManifest: Manifest = {
  emails: [
    {
      subject: 'Hetzner Online GmbH - Invoice fixture',
      receivedAt: '2026-07-05T02:29:07Z',
      from: 'billing@hetzner.com',
      hasAttachments: true,
      scenarioTags: ['direct-single-attachment'],
    },
    {
      subject: 'Your Invoice from Mistral AI SAS fixture',
      receivedAt: '2026-06-30T23:38:06Z',
      from: 'no-reply@mistral.ai',
      hasAttachments: true,
      scenarioTags: ['direct-single-attachment'],
    },
    {
      subject: 'TR: Quittance d’achat EasyRide fixture',
      receivedAt: '2026-06-20T09:02:55Z',
      from: 'mateo.tiedra@outlook.com',
      hasAttachments: false,
      scenarioTags: ['forwarded-body-only'],
    },
    {
      subject: 'Votre reçu Anomaly fixture',
      receivedAt: '2026-06-10T15:17:39Z',
      from: 'invoice+statements@anoma.ly',
      hasAttachments: true,
      scenarioTags: ['direct-single-attachment'],
    },
    {
      subject: 'RE: Votre reçu Anomaly fixture',
      receivedAt: '2026-06-10T13:19:59Z',
      from: 'justificatifs@physio-7.ch',
      hasAttachments: false,
      scenarioTags: ['reply-thread'],
    },
    {
      subject: 'Your receipt from OpenRouter fixture',
      receivedAt: '2026-04-15T18:05:16Z',
      from: 'invoice+statements@openrouter.ai',
      hasAttachments: true,
      scenarioTags: ['direct-single-attachment'],
    },
    {
      subject: 'Your payment receipt from Mistral AI SAS fixture',
      receivedAt: '2026-04-21T06:03:37Z',
      from: 'no-reply@mistral.ai',
      hasAttachments: true,
      scenarioTags: ['payment-receipt-multiple-invoices'],
    },
    {
      subject: 'Votre facture VistaPrint est prête fixture',
      receivedAt: '2025-11-07T12:34:19Z',
      from: 'no-reply@t.vistaprint.ch',
      hasAttachments: false,
      scenarioTags: ['forwarded-body-only'],
    },
    {
      subject: 'Facture mise en place salle dry needling',
      receivedAt: '2025-09-19T09:01:08Z',
      from: 'philippe.tschanun@physio-7.ch',
      hasAttachments: true,
      scenarioTags: ['direct-single-attachment'],
    },
  ],
};

function loadSeedManifest(): Manifest {
  const localManifestUrl = new URL('../.fixtures/factures/manifest.local.json', import.meta.url);
  if (!existsSync(localManifestUrl)) {
    return defaultManifest;
  }

  return JSON.parse(readFileSync(localManifestUrl, 'utf8')) as Manifest;
}

const manifest = loadSeedManifest();

function getSeedByTag(tag: FacturesScenarioTag, match?: (seed: SeedEmail) => boolean): SeedEmail {
  const candidates = manifest.emails.filter((seed) => seed.scenarioTags.includes(tag));
  const seed = candidates.find((entry) => match?.(entry) ?? true);
  if (!seed) {
    throw new Error(`Could not find fixture seed for tag "${tag}"`);
  }

  return seed;
}

function getSeed(tag: FacturesScenarioTag, fallbackTag: FacturesScenarioTag, match?: (seed: SeedEmail) => boolean): SeedEmail {
  const candidates = manifest.emails.filter((seed) => seed.scenarioTags.includes(tag));
  const seed = candidates.find((entry) => match?.(entry) ?? true);
  if (seed) {
    return seed;
  }

  const fallback = manifest.emails.find((entry) => entry.scenarioTags.includes(fallbackTag));
  if (!fallback) {
    throw new Error(`Could not find fallback fixture seed for tag "${fallbackTag}"`);
  }

  return fallback;
}

function syntheticAttachment(id: string, name: string, contentType = 'application/pdf'): FacturesAttachmentFixture {
  return makeFixtureAttachment({
    id,
    name,
    contentType,
    contentBytes: Buffer.from(`fixture-${id}`).toString('base64'),
  });
}

function makeSeedEmail(seed: SeedEmail) {
  return makeFixtureEmail({
    id: `seed-${seed.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
    subject: seed.subject,
    senderEmail: seed.from,
    receivedDateTime: seed.receivedAt,
    hasAttachments: seed.hasAttachments,
    bodyText: `Simulated fixture body for ${seed.subject}`,
  });
}

describe('Factures workflow deterministic simulation scenarios', () => {
  const hetznerSeed = getSeedByTag('direct-single-attachment', (seed) => seed.subject.includes('Hetzner'));
  const mistralSeed = getSeedByTag('direct-single-attachment', (seed) => seed.subject.includes('Mistral AI'));
  const anomalySeed = getSeedByTag('direct-single-attachment', (seed) => seed.subject.includes('Anomaly'));
  const openrouterSeed = getSeedByTag('direct-single-attachment', (seed) => seed.subject.includes('OpenRouter'));
  const dryNeedlingSeed = getSeedByTag('direct-single-attachment', (seed) => seed.subject.includes('dry needling'));
  const easyrideSeed = getSeedByTag('forwarded-body-only', (seed) => seed.subject.includes('EasyRide'));
  const anomalyReplySeed = getSeedByTag('reply-thread', (seed) => seed.subject.includes('Anomaly'));
  const vistaSeed = getSeedByTag('forwarded-body-only', (seed) => seed.subject.includes('VistaPrint'));
  const paymentSeed = getSeedByTag('payment-receipt-multiple-invoices');

  const dryNeedlingEmail = makeSeedEmail(dryNeedlingSeed);

  it.each([
    {
      label: 'Hetzner',
      email: makeSeedEmail(hetznerSeed),
      fileName: 'hetzner-invoice.pdf',
      makeGroup: (attachmentId: string) =>
        makeReceiptGroup({
          itemName: 'Hetzner cloud invoice',
          attachmentIds: [attachmentId],
          referenceFacture: 'K1163913025',
          montantFacture: 12.3,
          datePaiement: '2026-06-22',
          typeDeFacture: 'Factures',
        }),
    },
    {
      label: 'Mistral',
      email: makeSeedEmail(mistralSeed),
      fileName: 'mistral-invoice.pdf',
      makeGroup: (attachmentId: string) =>
        makeReceiptGroup({
          itemName: 'Mistral API invoice',
          attachmentIds: [attachmentId],
          referenceFacture: 'MSTRL-API-725671-009',
          montantFacture: 42.5,
          datePaiement: '2026-06-30',
          typeDeFacture: 'Factures',
        }),
    },
    {
      label: 'Anomaly',
      email: makeSeedEmail(anomalySeed),
      fileName: 'anomaly-receipt.pdf',
      makeGroup: (attachmentId: string) =>
        makeReceiptGroup({
          itemName: 'Anomaly receipt',
          attachmentIds: [attachmentId],
          referenceFacture: '2991-2801',
          montantFacture: 29.1,
          datePaiement: '2026-06-10',
          typeDeFacture: 'Factures',
        }),
    },
    {
      label: 'OpenRouter',
      email: makeSeedEmail(openrouterSeed),
      fileName: 'openrouter-receipt.pdf',
      makeGroup: (attachmentId: string) =>
        makeReceiptGroup({
          itemName: 'OpenRouter receipt',
          attachmentIds: [attachmentId],
          referenceFacture: '2650-7211',
          montantFacture: 15,
          datePaiement: '2026-04-15',
          typeDeFacture: 'Factures',
        }),
    },
    {
      label: 'Dry Needling invoice',
      email: dryNeedlingEmail,
      fileName: 'dry-needling-invoice.pdf',
      makeGroup: (attachmentId: string) =>
        makeReceiptGroup({
          itemName: 'Salle dry needling',
          attachmentIds: [attachmentId],
          referenceFacture: 'DN-2026',
          montantFacture: 120,
          datePaiement: '2025-09-19',
          typeDeFacture: 'Factures',
        }),
    },
  ])('creates clean item and promotes to Nouveau for $label', async ({ email, fileName, makeGroup }) => {
    const attachment = syntheticAttachment(`${email.id}-single`, fileName);
    const fixture: FacturesEmailFixture = {
      email,
      scenarioTags: ['direct-single-attachment'],
      attachments: [attachment],
      classification: makeClassification({
        confidence: 0.95,
        groups: [makeGroup(attachment.id)],
        emailSummary: 'receipt processed from seeded manifest',
      }),
    };

    const { graph, mistral, monday } = await processFixture(fixture);

    expect(graph.listAttachments).toHaveBeenCalledWith(email.id);
    expect(mistral.ocrAttachment).toHaveBeenCalledTimes(1);
    expect(mistral.classifyReceipts).toHaveBeenCalledTimes(1);
    expect(monday.createItem).toHaveBeenCalledTimes(1);
    expect(monday.uploadFile).toHaveBeenCalledTimes(1);
    expect(monday.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'item-1',
        fileName: attachment.name,
      }),
    );
    expect(graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
    expect(monday.createUpdate).toHaveBeenCalledTimes(1);
    expect(monday.createUpdate.mock.calls[0]?.[0].body).not.toContain('Fichiers ajoutés:');
    expect(monday.updateItemStatus).toHaveBeenCalledWith({ itemId: 'item-1', statut: 'Nouveau' });
  });

  it.each([
    {
      label: 'SBB EasyRide forwarded receipt',
      email: makeSeedEmail(easyrideSeed),
    },
    {
      label: 'Anomaly reply thread',
      email: makeSeedEmail(anomalyReplySeed),
    },
    {
      label: 'VistaPrint body-only link',
      email: makeSeedEmail(vistaSeed),
    },
  ])('creates Attention item, no OCR/upload for $label', async ({ email }) => {
    const fixture: FacturesEmailFixture = {
      email,
      scenarioTags: ['forwarded-body-only'],
      attachments: [],
    };

    const { graph, mistral, monday } = await processFixture(fixture);

    expect(mistral.ocrAttachment).not.toHaveBeenCalled();
    expect(mistral.classifyReceipts).not.toHaveBeenCalled();
    expect(monday.uploadFile).not.toHaveBeenCalled();
    expect(monday.createItem).toHaveBeenCalledTimes(1);
    expect(monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemName: email.subject,
        columnValues: expect.objectContaining({
          statut: 'Attention',
        }),
      }),
    );
    expect(graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
    expect(monday.createUpdate).toHaveBeenCalledTimes(2);
    expect(monday.createUpdate.mock.calls[0]?.[0].body).not.toContain('Points d’attention');
    expect(monday.createUpdate.mock.calls[1]?.[0].body).toContain('Points d’attention');
  });

  it('creates one item per group and uploads each file to corresponding item', async () => {
    const sourceSeed = getSeed('multiple-invoices-one-email', 'direct-single-attachment');
    const email = makeSeedEmail(sourceSeed);
    const attachments = [
      syntheticAttachment(`${email.id}-a`, 'receipt-1.pdf'),
      syntheticAttachment(`${email.id}-b`, 'receipt-2.png', 'image/png'),
    ];

    const fixture: FacturesEmailFixture = {
      email,
      scenarioTags: ['multiple-invoices-one-email'],
      attachments,
      classification: makeClassification({
        confidence: 0.92,
        groups: [
          makeReceiptGroup({
            itemName: 'Invoice A',
            attachmentIds: [attachments[0]!.id],
            referenceFacture: 'INV-A',
            montantFacture: 10,
            datePaiement: '2026-06-01',
          }),
          makeReceiptGroup({
            itemName: 'Invoice B',
            attachmentIds: [attachments[1]!.id],
            referenceFacture: 'INV-B',
            montantFacture: 20,
            datePaiement: '2026-06-01',
          }),
        ],
      }),
    };

    const { graph, monday } = await processFixture(fixture);

    expect(monday.createItem).toHaveBeenCalledTimes(2);
    expect(monday.uploadFile).toHaveBeenCalledTimes(2);

    const uploadsByItem = new Map<string, string[]>();
    for (const [request] of monday.uploadFile.mock.calls) {
      uploadsByItem.set(request.itemId, [...(uploadsByItem.get(request.itemId) ?? []), request.fileName]);
    }

    expect(uploadsByItem.get('item-1')).toEqual([attachments[0]!.name]);
    expect(uploadsByItem.get('item-2')).toEqual([attachments[1]!.name]);
    expect(graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
    expect(monday.createUpdate).toHaveBeenCalledTimes(2);
    expect(monday.updateItemStatus).toHaveBeenCalledWith({ itemId: 'item-1', statut: 'Nouveau' });
    expect(monday.updateItemStatus).toHaveBeenCalledWith({ itemId: 'item-2', statut: 'Nouveau' });
  });

  it('creates one grouped item for an invoice with matching payment proof', async () => {
    const email = makeSeedEmail(paymentSeed);
    const attachments = [
      syntheticAttachment(`${email.id}-pay-a`, 'invoice.pdf'),
      syntheticAttachment(`${email.id}-pay-b`, 'payment-proof.pdf'),
    ];

    const fixture: FacturesEmailFixture = {
      email,
      scenarioTags: ['payment-receipt-multiple-invoices'],
      attachments,
      classification: makeClassification({
        confidence: 0.95,
        groups: [
          makeReceiptGroup({
            itemName: 'Mistral payment bundle',
            attachmentIds: [attachments[0]!.id, attachments[1]!.id],
            referenceFacture: 'MSTRL-RCPT',
            montantFacture: 72.8,
            datePaiement: '2026-04-30',
            typeDeFacture: 'Carte',
            groupingEvidence: [
              { attachmentId: attachments[0]!.id, provider: 'Mistral AI SAS', service: 'API usage', documentKind: 'invoice' },
              { attachmentId: attachments[1]!.id, provider: 'Mistral AI SAS', service: 'API usage', documentKind: 'payment_proof' },
            ],
          }),
        ],
      }),
    };

    const { graph, monday } = await processFixture(fixture);

    expect(monday.createItem).toHaveBeenCalledTimes(1);
    expect(monday.uploadFile).toHaveBeenCalledTimes(2);
    expect(monday.uploadFile.mock.calls.every(([request]) => request.itemId === 'item-1')).toBe(true);
    expect(graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
    expect(monday.createUpdate).toHaveBeenCalledTimes(1);
    expect(monday.updateItemStatus).toHaveBeenCalledWith({ itemId: 'item-1', statut: 'Nouveau' });
  });

  it('handles mixed supported+unsupported/inline attachments', async () => {
    const email = makeSeedEmail(getSeedByTag('direct-single-attachment', (seed) => seed.subject.includes('Hetzner')));
    const supported = syntheticAttachment(`${email.id}-supported`, 'supported.pdf');
    const unsupported = syntheticAttachment(`${email.id}-unsupported`, 'notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const inline = syntheticAttachment(`${email.id}-inline`, 'logo.png', 'image/png');
    inline.isInline = true;

    const fixture: FacturesEmailFixture = {
      email,
      scenarioTags: ['mixed-supported-unsupported'],
      attachments: [supported, unsupported, inline],
      classification: makeClassification({
        confidence: 0.95,
        groups: [
          makeReceiptGroup({
            itemName: 'Hetzner mixed',
            attachmentIds: [supported.id],
            referenceFacture: 'K1163913025',
            montantFacture: 8,
            datePaiement: '2026-06-22',
            typeDeFacture: 'Factures',
          }),
        ],
      }),
    };

    const { graph, monday, mistral } = await processFixture(fixture);

    expect(mistral.ocrAttachment).toHaveBeenCalledTimes(1);
    expect(monday.createItem).toHaveBeenCalledTimes(1);
    expect(monday.uploadFile).toHaveBeenCalledTimes(1);
    expect(monday.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'item-1',
        fileName: supported.name,
      }),
    );
    expect(graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
    expect(monday.createUpdate).toHaveBeenCalledTimes(2);
    expect(monday.createUpdate.mock.calls[1]![0].body).toContain('Points d’attention');
    expect(monday.updateItemStatus).not.toHaveBeenCalled();
  });

  it('routes unsupported-only emails to processed Attention item', async () => {
    const email = makeSeedEmail(getSeedByTag('direct-single-attachment', (seed) => seed.subject.includes('Hetzner')));
    const unsupported = syntheticAttachment(`${email.id}-unsupported`, 'notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    const fixture: FacturesEmailFixture = {
      email,
      scenarioTags: ['unsupported-only'],
      attachments: [unsupported],
    };

    const { graph, monday, mistral } = await processFixture(fixture);

    expect(mistral.ocrAttachment).not.toHaveBeenCalled();
    expect(mistral.classifyReceipts).not.toHaveBeenCalled();
    expect(monday.createItem).toHaveBeenCalledTimes(1);
    expect(monday.uploadFile).not.toHaveBeenCalled();
    expect(graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
    expect(monday.createUpdate).toHaveBeenCalledTimes(2);
    expect(monday.createUpdate.mock.calls[1]![0].body).toContain('Points d’attention');
    expect(monday.updateItemStatus).not.toHaveBeenCalled();
  });

  it('keeps card payment missing date in Attention', async () => {
    const email = makeSeedEmail(anomalySeed);
    const attachment = syntheticAttachment(`${email.id}-missing-date`, 'anomaly-missing-card-date.pdf');

    const fixture: FacturesEmailFixture = {
      email: {
        ...makeSeedEmail(anomalySeed),
        bodyText: 'Le paiement a été effectué par carte bancaire.',
      },
      scenarioTags: ['missing-card-payment-date'],
      attachments: [attachment],
      ocrDocuments: [
        {
          attachmentId: attachment.id,
          fileName: attachment.name,
          markdown: 'Paiement par carte bancaire confirmé.',
          pageCount: 1,
        },
      ],
      classification: makeClassification({
        confidence: 0.95,
        groups: [
          makeReceiptGroup({
            itemName: 'Missing card date',
            attachmentIds: [attachment.id],
            referenceFacture: 'CARD-1',
            montantFacture: 19.9,
            datePaiement: null,
            typeDeFacture: 'Carte',
          }),
        ],
      }),
    };

    const { graph, monday } = await processFixture(fixture);

    expect(graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
    expect(monday.uploadFile).toHaveBeenCalledTimes(1);
    expect(monday.createUpdate).toHaveBeenCalledTimes(1);
    expect(monday.createUpdate.mock.calls[0]?.[0].body).not.toContain('Fichiers ajoutés:');
  });

  it('keeps low-confidence groups in Attention', async () => {
    const email = makeSeedEmail(mistralSeed);
    const attachment = syntheticAttachment(`${email.id}-low-confidence`, 'mistral-low-confidence.pdf');

    const fixture: FacturesEmailFixture = {
      email,
      scenarioTags: ['low-confidence-grouping'],
      attachments: [attachment],
      classification: makeClassification({
        confidence: 0.45,
        groups: [
          makeReceiptGroup({
            itemName: 'Uncertain group',
            confidence: 0.45,
            attachmentIds: [attachment.id],
            referenceFacture: 'MSTRL-LOW',
            montantFacture: 9,
            datePaiement: '2026-06-22',
            typeDeFacture: 'Factures',
          }),
        ],
      }),
    };

    const { graph, monday } = await processFixture(fixture);

    expect(graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
    expect(monday.createUpdate).toHaveBeenCalledTimes(2);
    expect(monday.createUpdate.mock.calls[0]![0].body).toContain('45%');
    expect(monday.createUpdate.mock.calls[1]![0].body).toContain('Points d’attention');
    expect(monday.updateItemStatus).not.toHaveBeenCalled();
  });

  it('routes classifier review decision to Review', async () => {
    const email = makeSeedEmail(openrouterSeed);
    const attachment = syntheticAttachment(`${email.id}-review`, 'openrouter-review.pdf');

    const fixture: FacturesEmailFixture = {
      email,
      scenarioTags: ['classifier-review'],
      attachments: [attachment],
      classification: makeClassification({
        decision: 'review',
        confidence: 0.2,
        reviewReason: 'manual review required',
        emailSummary: 'Needs human review',
        groups: [],
      }),
    };

    const { graph, monday } = await processFixture(fixture);

    expect(graph.moveMessage).toHaveBeenCalledWith(email.id, 'review-folder');
    expect(monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemName: email.subject,
      }),
    );
    expect(monday.uploadFile).not.toHaveBeenCalled();
    expect(monday.updateItemStatus).not.toHaveBeenCalled();
    expect(monday.createUpdate).toHaveBeenCalledTimes(1);
  });

  it('routes OCR failure to Review', async () => {
    const email = makeSeedEmail(hetznerSeed);
    const attachment = syntheticAttachment(`${email.id}-ocr-fail`, 'ocr-fail.pdf');

    const fixture: FacturesEmailFixture = {
      email,
      scenarioTags: ['ocr-failure'],
      attachments: [attachment],
    };

    const { graph, monday } = await processFixture(fixture, { ocrRejects: true });

    expect(graph.moveMessage).toHaveBeenCalledWith(email.id, 'review-folder');
    expect(monday.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        itemName: email.subject,
      }),
    );
    expect(monday.uploadFile).not.toHaveBeenCalled();
    expect(monday.createUpdate).toHaveBeenCalledTimes(1);
    expect(monday.updateItemStatus).not.toHaveBeenCalled();
  });

  it('routes upload failure to Review after upload attempt', async () => {
    const email = makeSeedEmail(mistralSeed);
    const attachment = syntheticAttachment(`${email.id}-upload-fail`, 'upload-fail.pdf');

    const fixture: FacturesEmailFixture = {
      email,
      scenarioTags: ['upload-failure'],
      attachments: [attachment],
      classification: makeClassification({
        confidence: 0.95,
        groups: [
          makeReceiptGroup({
            itemName: 'Upload failure',
            attachmentIds: [attachment.id],
            referenceFacture: 'UP-1',
            montantFacture: 10,
            datePaiement: '2026-06-22',
          }),
        ],
      }),
    };

    const { graph, monday } = await processFixture(fixture, { uploadRejects: true });

    expect(monday.uploadFile).toHaveBeenCalledTimes(1);
    expect(graph.moveMessage).toHaveBeenCalledWith(email.id, 'review-folder');
    expect(monday.createItem).toHaveBeenCalledTimes(2);
    expect(monday.createItem.mock.calls[0]![0]).not.toHaveProperty('itemName', email.subject);
    expect(monday.createItem).toHaveBeenCalledWith(expect.objectContaining({ itemName: email.subject }));
    expect(monday.createUpdate).toHaveBeenCalledTimes(2);
    expect(monday.updateItemStatus).not.toHaveBeenCalled();
  });

  it('keeps Attention item when final update fails after processed move', async () => {
    const email = makeSeedEmail(openrouterSeed);
    const attachment = syntheticAttachment(`${email.id}-update-fail`, 'update-fail.pdf');

    const fixture: FacturesEmailFixture = {
      email,
      scenarioTags: ['final-update-failure'],
      attachments: [attachment],
      classification: makeClassification({
        confidence: 0.95,
        groups: [
          makeReceiptGroup({
            itemName: 'Update failure',
            attachmentIds: [attachment.id],
            referenceFacture: 'UF-1',
            montantFacture: 9,
            datePaiement: '2026-06-22',
          }),
        ],
      }),
    };

    const { graph, monday } = await processFixture(fixture, { createUpdateRejects: true });

    expect(graph.moveMessage).toHaveBeenCalledWith(email.id, 'processed-folder');
    expect(monday.createItem).toHaveBeenCalledTimes(1);
    expect(monday.uploadFile).toHaveBeenCalledTimes(1);
    expect(monday.createUpdate).toHaveBeenCalledTimes(3);
    expect(monday.updateItemStatus).not.toHaveBeenCalled();
  });
});
