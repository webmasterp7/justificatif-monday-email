const confident = (value: string | number) => ({ status: 'confident', value, reason: null });
const missing = () => ({ status: 'missing', value: null, reason: 'Absent du document.' });

export const enrichedClassificationFixture = {
  decision: 'create_items',
  confidence: 0.95,
  reviewReason: null,
  emailSummary: 'Facture synthétique Swisscom.',
  receiptGroups: [{
    confidence: 0.95,
    attachmentIds: ['attachment-1'],
    itemName: confident('Swisscom facture'),
    groupingExplanation: confident('Une facture dans un PDF.'),
    referenceFacture: confident('SYNTH-2026-09'),
    montantFacture: confident(42.5),
    datePaiement: missing(),
    typeDeFacture: confident('Factures'),
    notesParticulieres: confident('Facture synthétique.'),
    provenanceSuggeree: missing(),
    soumisPar: missing(),
    fournisseur: confident('Swisscom'),
    groupingEvidence: [{ attachmentId: 'attachment-1', provider: 'Swisscom', service: 'Téléphonie', documentKind: 'invoice', reason: null }],
  }],
};

export const malformedEvidenceFixture = {
  ...enrichedClassificationFixture,
  receiptGroups: enrichedClassificationFixture.receiptGroups.map((group) => ({ ...group, groupingEvidence: [1] })),
};
