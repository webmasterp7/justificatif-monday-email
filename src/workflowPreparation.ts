import type {
  AcceptedAttachment,
  AttachmentDocumentKind,
  AttachmentGroupingEvidence,
  ClassificationFieldStatus,
  ClassificationResult,
  EmailAttachment,
  ReceiptGroup,
} from './types.js';

export interface PreparedGroup {
  group: ReceiptGroup;
  statut: 'Nouveau' | 'Attention';
  attentionReasons: string[];
}

export function deriveGroupingAttentionReasons(
  classification: ClassificationResult,
  acceptedAttachments: AcceptedAttachment[],
  threshold: number,
): string[] {
  const reasons: string[] = [];

  if (classification.confidence < threshold) {
    reasons.push(`Confiance globale ${Math.round(classification.confidence * 100)}% inférieure au seuil ${Math.round(threshold * 100)}%`);
  }

  if (classification.receiptGroups.length === 0) {
    reasons.push('Le modèle de classification n\'a retourné aucun groupe');
  }

  const attachmentIds = new Set(acceptedAttachments.map((attachment) => attachment.id));
  const assignedIds = classification.receiptGroups.flatMap((group) => group.attachmentIds);
  const assignedSet = new Set(assignedIds);

  if (assignedIds.length !== assignedSet.size) {
    reasons.push('Une pièce jointe a été attribuée à plusieurs groupes');
  }

  for (const group of classification.receiptGroups) {
    if (group.confidence < threshold) {
      reasons.push(`Confiance du groupe "${group.itemName}" inférieure au seuil`);
    }

    for (const attachmentId of group.attachmentIds) {
      if (!attachmentIds.has(attachmentId)) {
        reasons.push(`Le modèle a utilisé une pièce jointe inconnue: ${attachmentId}`);
      }
    }
  }

  if (assignedSet.size !== attachmentIds.size) {
    reasons.push('Toutes les pièces jointes acceptées n\'ont pas été assignées');
  }

  return uniqueReasons(reasons);
}

export function buildPreparedReceiptGroups(
  classification: ClassificationResult,
  threshold: number,
  context: {
    acceptedAttachments: AcceptedAttachment[];
    unsupportedReasons: string[];
    groupingReasons: string[];
  },
): PreparedGroup[] {
  const assignment = analyzeAttachmentAssignments(classification, context.acceptedAttachments);

  if (classification.receiptGroups.length === 0 || assignment.duplicateIds.length > 0 || assignment.unknownIds.length > 0) {
    const consolidated = buildConsolidatedAttentionGroup(classification, context.acceptedAttachments);
    return [
      {
        group: consolidated,
        statut: 'Attention',
        attentionReasons: uniqueReasons([
          ...context.groupingReasons,
          ...consolidateGroupReasons(consolidated, threshold),
          ...context.unsupportedReasons,
        ]),
      },
    ];
  }

  const globalReasons = context.groupingReasons.filter((reason) => reason.startsWith('Confiance globale'));
  const attachmentsById = new Map(context.acceptedAttachments.map((attachment) => [attachment.id, attachment]));
  const preparedGroups = classification.receiptGroups.flatMap((group) => {
    const groupingValidation = validateStrictGrouping(group);

    if (!groupingValidation.valid) {
      return splitInvalidGroup(group, attachmentsById, groupingValidation.reason, globalReasons, context.unsupportedReasons);
    }

    const reasons = uniqueReasons([
      ...globalReasons,
      ...consolidateGroupReasons(group, threshold),
      ...context.unsupportedReasons,
    ]);

    return [
      {
        group,
        statut: reasons.length > 0 ? ('Attention' as const) : ('Nouveau' as const),
        attentionReasons: reasons,
      } satisfies PreparedGroup,
    ];
  });

  if (assignment.unassignedAttachments.length > 0) {
    preparedGroups.push({
      group: buildUnassignedAttentionGroup(classification, assignment.unassignedAttachments),
      statut: 'Attention',
      attentionReasons: uniqueReasons([
        'Toutes les pièces jointes acceptées n\'ont pas été assignées',
        ...globalReasons,
        ...context.unsupportedReasons,
      ]),
    });
  }

  return preparedGroups;
}

export function buildAttentionOnlyGroupsForBodyOnly(subject: string): PreparedGroup[] {
  const itemName = subject || 'Email sans pièces jointes';

  return [
    {
      group: {
        itemName,
        confidence: 1,
        groupingExplanation: 'Email sans pièce jointe supportée',
        attachmentIds: [],
        referenceFacture: null,
        montantFacture: null,
        datePaiement: null,
        typeDeFacture: 'Factures',
        notesParticulieres: 'Email sans pièce jointe',
      },
      statut: 'Attention',
      attentionReasons: ['Email sans pièce jointe prise en charge'],
    },
  ];
}

export function buildUnsupportedOnlyAttentionGroups(subject: string, reasons: string[]): PreparedGroup[] {
  return [
    {
      group: {
        itemName: subject || 'Email non traitable',
        confidence: 1,
        groupingExplanation: 'Pièces jointes non supportées',
        attachmentIds: [],
        referenceFacture: null,
        montantFacture: null,
        datePaiement: null,
        typeDeFacture: 'Factures',
        notesParticulieres: 'Aucune pièce jointe supportée',
      },
      statut: 'Attention',
      attentionReasons: uniqueReasons(['Pièces jointes non prises en charge', ...reasons]),
    },
  ];
}

export function buildFallbackAttentionGroups(subject: string, reasons: string[]): PreparedGroup[] {
  return [
    {
      group: {
        itemName: subject || 'Email sans affectation',
        confidence: 0,
        groupingExplanation: 'Classification incomplète',
        attachmentIds: [],
        referenceFacture: null,
        montantFacture: null,
        datePaiement: null,
        typeDeFacture: 'Factures',
        notesParticulieres: 'Impossible de constituer des groupes de reçus fiables',
      },
      statut: 'Attention',
      attentionReasons: reasons.length ? reasons : ['Classification incomplète'],
    },
  ];
}

export function filterUnsupportedReasons(unsupported: EmailAttachment[]): string[] {
  return buildUnsupportedReasons(unsupported);
}

function analyzeAttachmentAssignments(
  classification: ClassificationResult,
  acceptedAttachments: AcceptedAttachment[],
): {
  duplicateIds: string[];
  unknownIds: string[];
  unassignedAttachments: AcceptedAttachment[];
} {
  const acceptedIds = new Set(acceptedAttachments.map((attachment) => attachment.id));
  const assignedCounts = new Map<string, number>();

  for (const group of classification.receiptGroups) {
    for (const attachmentId of group.attachmentIds) {
      assignedCounts.set(attachmentId, (assignedCounts.get(attachmentId) ?? 0) + 1);
    }
  }

  const duplicateIds = [...assignedCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([attachmentId]) => attachmentId);
  const unknownIds = [...assignedCounts.keys()].filter((attachmentId) => !acceptedIds.has(attachmentId));
  const unassignedAttachments = acceptedAttachments.filter((attachment) => !assignedCounts.has(attachment.id));

  return { duplicateIds, unknownIds, unassignedAttachments };
}

function buildUnassignedAttentionGroup(
  classification: ClassificationResult,
  attachments: AcceptedAttachment[],
): ReceiptGroup {
  return {
    itemName: 'Pièces jointes à assigner',
    confidence: Math.min(classification.confidence, 0.5),
    groupingExplanation: 'Pièces jointes acceptées non assignées à un justificatif précis',
    attachmentIds: attachments.map((attachment) => attachment.id),
    referenceFacture: null,
    montantFacture: null,
    datePaiement: null,
    typeDeFacture: 'Factures',
    notesParticulieres: `Pièces jointes acceptées à vérifier et assigner manuellement: ${attachments.map((attachment) => attachment.name).join(', ')}`,
  };
}

function validateStrictGrouping(group: ReceiptGroup): { valid: true } | { valid: false; reason: string } {
  if (group.attachmentIds.length <= 1) {
    return { valid: true };
  }

  const evidenceByAttachmentId = new Map(group.groupingEvidence?.map((evidence) => [evidence.attachmentId, evidence]));
  const evidence = group.attachmentIds.map((attachmentId) => evidenceByAttachmentId.get(attachmentId));

  if (evidence.some((entry) => !entry)) {
    return { valid: false, reason: 'preuve de regroupement manquante pour une ou plusieurs pièces jointes' };
  }

  const providerKeys = new Set(evidence.map((entry) => normalizeGroupingKey(entry?.provider)));
  if (providerKeys.has(null) || providerKeys.size !== 1) {
    return { valid: false, reason: 'fournisseurs différents ou manquants' };
  }

  const serviceKeys = new Set(evidence.map((entry) => normalizeGroupingKey(entry?.service)));
  if (serviceKeys.has(null) || serviceKeys.size !== 1) {
    return { valid: false, reason: 'services différents ou manquants' };
  }

  const documentKinds = evidence.map((entry) => entry?.documentKind).filter((kind): kind is AttachmentDocumentKind => Boolean(kind));
  if (documentKinds.length !== new Set(documentKinds).size) {
    return { valid: false, reason: 'plusieurs pièces jointes ont le même type de document' };
  }

  return { valid: true };
}

function splitInvalidGroup(
  group: ReceiptGroup,
  attachmentsById: Map<string, AcceptedAttachment>,
  reason: string,
  globalReasons: string[],
  unsupportedReasons: string[],
): PreparedGroup[] {
  return group.attachmentIds.map((attachmentId) => {
    const attachment = attachmentsById.get(attachmentId);
    const itemName = attachment ? `À vérifier - ${stripFileExtension(attachment.name)}` : `${group.itemName} - ${attachmentId}`;
    const attentionReason = `Regroupement invalide: ${reason}`;

    return {
      group: {
        itemName,
        confidence: Math.min(group.confidence, 0.5),
        groupingExplanation: `Groupe scindé automatiquement: ${reason}`,
        attachmentIds: [attachmentId],
        referenceFacture: null,
        montantFacture: null,
        datePaiement: null,
        typeDeFacture: group.typeDeFacture,
        notesParticulieres: `Pièce jointe isolée depuis le groupe "${group.itemName}". ${attentionReason}.`,
        soumisPar: group.soumisPar,
        provenanceSuggeree: group.provenanceSuggeree,
        fournisseur: group.groupingEvidence?.find((evidence) => evidence.attachmentId === attachmentId)?.provider ?? group.fournisseur,
        groupingEvidence: group.groupingEvidence?.filter((evidence) => evidence.attachmentId === attachmentId),
      },
      statut: 'Attention' as const,
      attentionReasons: uniqueReasons([attentionReason, ...globalReasons, ...unsupportedReasons]),
    } satisfies PreparedGroup;
  });
}

function normalizeGroupingKey(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

function stripFileExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function buildConsolidatedAttentionGroup(
  classification: ClassificationResult,
  acceptedAttachments: AcceptedAttachment[],
): ReceiptGroup {
  const fallbackGroup: ReceiptGroup = {
    itemName: 'Réception à vérifier',
    confidence: classification.confidence,
    groupingExplanation: 'Regroupement incertain',
    attachmentIds: acceptedAttachments.map((attachment) => attachment.id),
    referenceFacture: null,
    montantFacture: null,
    datePaiement: null,
    typeDeFacture: 'Factures',
    notesParticulieres: 'Le modèle n\'a pas pu créer des groupes fiables.',
  };

  if (!classification.receiptGroups.length) {
    return fallbackGroup;
  }

  const best = [...classification.receiptGroups].sort((a, b) => b.confidence - a.confidence)[0];
  if (!best) {
    return fallbackGroup;
  }

  return {
    itemName: best.itemName,
    confidence: Math.min(classification.confidence, best.confidence),
    groupingExplanation: best.groupingExplanation,
    attachmentIds: acceptedAttachments.map((attachment) => attachment.id),
    referenceFacture: best.referenceFacture,
    montantFacture: best.montantFacture,
    datePaiement: best.datePaiement,
    typeDeFacture: best.typeDeFacture,
    notesParticulieres: best.notesParticulieres,
    soumisPar: best.soumisPar,
    provenanceSuggeree: best.provenanceSuggeree,
    fournisseur: best.fournisseur,
    fieldStatuses: best.fieldStatuses,
  };
}

function consolidateGroupReasons(group: ReceiptGroup, threshold: number): string[] {
  const reasons: string[] = [];

  if (group.confidence < threshold) {
    reasons.push(`Confiance insuffisante pour ${group.itemName}`);
  }

  addNonConfidentFieldReason(reasons, 'Nom', group.fieldStatuses?.itemName);
  addNonConfidentFieldReason(reasons, 'Type de facture', group.fieldStatuses?.typeDeFacture);
  addNonConfidentFieldReason(reasons, 'Soumis par', group.fieldStatuses?.soumisPar);
  addNonConfidentFieldReason(reasons, 'Provenance suggérée', group.fieldStatuses?.provenanceSuggeree);
  addNonConfidentFieldReason(reasons, 'Référence facture', group.fieldStatuses?.referenceFacture);
  addNonConfidentFieldReason(reasons, 'Montant', group.fieldStatuses?.montantFacture);
  addNonConfidentFieldReason(reasons, 'Fournisseur', group.fieldStatuses?.fournisseur);

  const dateStatus = group.fieldStatuses?.datePaiement;
  if (group.typeDeFacture === 'Carte') {
    if (group.datePaiement == null) {
      reasons.push('Date de paiement manquante pour un paiement par carte');
    } else if (dateStatus && dateStatus.status !== 'confident') {
      reasons.push(formatFieldReason('Date de paiement', dateStatus));
    }
  } else if (dateStatus?.status === 'uncertain') {
    reasons.push(formatFieldReason('Date de paiement', dateStatus));
  }

  return uniqueReasons(reasons);
}

function buildUnsupportedReasons(unsupported: EmailAttachment[]): string[] {
  if (!unsupported.length) {
    return [];
  }

  return [`Le courriel contient des pièces jointes ignorées (format non supporté): ${unsupported.map((attachment) => attachment.name).join(', ')}`];
}

function addNonConfidentFieldReason(
  reasons: string[],
  label: string,
  field: { status: ClassificationFieldStatus; reason?: string } | undefined,
): void {
  if (field && field.status !== 'confident') {
    reasons.push(formatFieldReason(label, field));
  }
}

function formatFieldReason(label: string, field: { status: ClassificationFieldStatus; reason?: string }): string {
  const confidenceLabel = field.status === 'uncertain' ? 'incertain' : 'manquant';
  if (field.reason) {
    return `${label} ${confidenceLabel}: ${field.reason}`;
  }

  return `${label} ${confidenceLabel}`;
}

function uniqueReasons(reasons: string[]): string[] {
  return reasons.map((reason) => reason.trim()).filter(Boolean).filter((reason, index, all) => all.indexOf(reason) === index);
}
