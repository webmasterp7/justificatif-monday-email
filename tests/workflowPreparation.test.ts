import { describe, expect, it } from 'vitest';
import { buildPreparedReceiptGroups } from '../src/workflowPreparation.js';
import type { AcceptedAttachment, ClassificationResult, ReceiptGroup } from '../src/types.js';

const attachment: AcceptedAttachment = {
  id: 'a1',
  name: 'invoice.pdf',
  contentType: 'application/pdf',
  size: 123,
  isInline: false,
  contentBytes: 'base64',
};

function group(overrides: Partial<ReceiptGroup> = {}): ReceiptGroup {
  return {
    itemName: 'Fournisseur Direction INV-1',
    confidence: 0.95,
    groupingExplanation: 'single invoice',
    attachmentIds: ['a1'],
    referenceFacture: 'INV-1',
    montantFacture: 100,
    datePaiement: null,
    typeDeFacture: 'Factures',
    notesParticulieres: 'notes',
    soumisPar: 'Alice <alice@physio7.ch>',
    provenanceSuggeree: 'Direction',
    fournisseur: 'Fournisseur SA',
    fieldStatuses: {
      itemName: { status: 'confident', value: 'Fournisseur Direction INV-1' },
      typeDeFacture: { status: 'confident', value: 'Factures' },
      soumisPar: { status: 'confident', value: 'Alice <alice@physio7.ch>' },
      provenanceSuggeree: { status: 'confident', value: 'Direction' },
      referenceFacture: { status: 'confident', value: 'INV-1' },
      montantFacture: { status: 'confident', value: 100 },
      fournisseur: { status: 'confident', value: 'Fournisseur SA' },
      datePaiement: { status: 'missing', value: null, reason: 'Facture non payée' },
    },
    ...overrides,
  };
}

function classification(receiptGroup: ReceiptGroup): ClassificationResult {
  return {
    decision: 'create_items',
    confidence: 0.95,
    reviewReason: null,
    emailSummary: 'summary',
    receiptGroups: [receiptGroup],
  };
}

describe('workflow group preparation', () => {
  it('keeps a Factures item Nouveau when Date de Paiement is empty by default', () => {
    const prepared = buildPreparedReceiptGroups(classification(group()), 0.7, {
      acceptedAttachments: [attachment],
      unsupportedReasons: [],
      groupingReasons: [],
    });

    expect(prepared[0]?.statut).toBe('Nouveau');
    expect(prepared[0]?.attentionReasons).toEqual([]);
  });

  it('sets Carte items to Attention when Date de Paiement is missing', () => {
    const receiptGroup = group({
      typeDeFacture: 'Carte',
      fieldStatuses: {
        ...group().fieldStatuses!,
        typeDeFacture: { status: 'confident', value: 'Carte' },
        datePaiement: { status: 'missing', value: null, reason: 'Transaction date not visible' },
      },
    });

    const prepared = buildPreparedReceiptGroups(classification(receiptGroup), 0.7, {
      acceptedAttachments: [attachment],
      unsupportedReasons: [],
      groupingReasons: [],
    });

    expect(prepared[0]?.statut).toBe('Attention');
    expect(prepared[0]?.attentionReasons).toEqual(['Date de paiement manquante pour un paiement par carte']);
    expect(prepared[0]?.attentionReasons.join(' ')).not.toContain('Transaction date not visible');
  });

  it('sets Attention when a required field is missing', () => {
    const receiptGroup = group({
      fournisseur: null,
      fieldStatuses: {
        ...group().fieldStatuses!,
        fournisseur: { status: 'missing', value: null, reason: 'Vendor not readable' },
      },
    });

    const prepared = buildPreparedReceiptGroups(classification(receiptGroup), 0.7, {
      acceptedAttachments: [attachment],
      unsupportedReasons: [],
      groupingReasons: [],
    });

    expect(prepared[0]?.statut).toBe('Attention');
    expect(prepared[0]?.attentionReasons).toContain('Fournisseur manquant: Vendor not readable');
  });

  it('sets Attention for approximate provenance matches', () => {
    const receiptGroup = group({
      fieldStatuses: {
        ...group().fieldStatuses!,
        provenanceSuggeree: { status: 'uncertain', value: 'Direction', reason: 'Closest site label' },
      },
    });

    const prepared = buildPreparedReceiptGroups(classification(receiptGroup), 0.7, {
      acceptedAttachments: [attachment],
      unsupportedReasons: [],
      groupingReasons: [],
    });

    expect(prepared[0]?.statut).toBe('Attention');
    expect(prepared[0]?.attentionReasons).toContain('Provenance suggérée incertain: Closest site label');
  });
});
