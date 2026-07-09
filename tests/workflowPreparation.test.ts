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

function classification(receiptGroup: ReceiptGroup | ReceiptGroup[]): ClassificationResult {
  return {
    decision: 'create_items',
    confidence: 0.95,
    reviewReason: null,
    emailSummary: 'summary',
    receiptGroups: Array.isArray(receiptGroup) ? receiptGroup : [receiptGroup],
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

  it('preserves distinct transaction groups even when group confidence needs Attention', () => {
    const secondAttachment: AcceptedAttachment = { ...attachment, id: 'a2', name: 'invoice-2.pdf' };
    const firstGroup = group({ attachmentIds: ['a1'], itemName: 'Facture Camille', confidence: 0.6 });
    const secondGroup = group({ attachmentIds: ['a2'], itemName: 'Facture Anatole', referenceFacture: 'INV-2' });

    const prepared = buildPreparedReceiptGroups(classification([firstGroup, secondGroup]), 0.7, {
      acceptedAttachments: [attachment, secondAttachment],
      unsupportedReasons: [],
      groupingReasons: ['Confiance du groupe "Facture Camille" inférieure au seuil'],
    });

    expect(prepared).toHaveLength(2);
    expect(prepared.map((preparedGroup) => preparedGroup.group.itemName)).toEqual(['Facture Camille', 'Facture Anatole']);
    expect(prepared[0]?.statut).toBe('Attention');
    expect(prepared[1]?.statut).toBe('Nouveau');
  });

  it('creates a separate Attention group for unassigned accepted attachments', () => {
    const supportAttachment: AcceptedAttachment = { ...attachment, id: 'a2', name: 'liste-presence.pdf' };

    const prepared = buildPreparedReceiptGroups(classification(group()), 0.7, {
      acceptedAttachments: [attachment, supportAttachment],
      unsupportedReasons: [],
      groupingReasons: ['Toutes les pièces jointes acceptées n\'ont pas été assignées'],
    });

    expect(prepared).toHaveLength(2);
    expect(prepared[0]?.group.attachmentIds).toEqual(['a1']);
    expect(prepared[0]?.statut).toBe('Nouveau');
    expect(prepared[1]?.group.itemName).toBe('Pièces jointes à assigner');
    expect(prepared[1]?.group.attachmentIds).toEqual(['a2']);
    expect(prepared[1]?.statut).toBe('Attention');
    expect(prepared[1]?.attentionReasons).toContain('Toutes les pièces jointes acceptées n\'ont pas été assignées');
  });

  it('keeps invoice and proof of payment together when assigned to the same transaction group', () => {
    const proofAttachment: AcceptedAttachment = { ...attachment, id: 'a2', name: 'preuve-paiement.pdf' };
    const transactionGroup = group({
      attachmentIds: ['a1', 'a2'],
      itemName: 'Fournisseur facture et paiement',
      groupingExplanation: 'Même fournisseur, même référence et même montant',
    });

    const prepared = buildPreparedReceiptGroups(classification(transactionGroup), 0.7, {
      acceptedAttachments: [attachment, proofAttachment],
      unsupportedReasons: [],
      groupingReasons: [],
    });

    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.group.attachmentIds).toEqual(['a1', 'a2']);
    expect(prepared[0]?.statut).toBe('Nouveau');
  });
});
