import { z } from 'zod';
import { MONDAY_INVOICE_TYPES } from './config.js';
import {
  PROVENANCE_SUGGESTIONS,
  type AttachmentDocumentKind,
  type ClassificationFieldStatus,
  type ClassifiedField,
  type InvoiceType,
  type ProvenanceSuggestion,
  type ReceiptGroup,
  type ReceiptGroupFieldStatuses,
} from './types.js';

const nullableTrimmedString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().min(1).nullable().optional(),
);

const nullableTrimmedStringRequired = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().min(1).nullable(),
);

const nullableAmount = z.preprocess((value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const normalized = Number(value.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(normalized) ? normalized : value;
  }
  return value;
}, z.number().nullable().optional());

const nullableAmountRequired = z.preprocess((value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const normalized = Number(value.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(normalized) ? normalized : value;
  }
  return value;
}, z.number().nullable());

const nullableIsoDate = z.preprocess((value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional());

const nullableIsoDateRequired = z.preprocess((value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const invoiceType = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'facture' || normalized === 'factures') return 'Factures';
  if (normalized === 'carte') return 'Carte';
  return value;
}, z.enum(MONDAY_INVOICE_TYPES));

const nullableInvoiceType = z.preprocess((value) => (value === '' ? null : value), z.union([invoiceType, z.null()]));

const fieldStatus = z.enum(['confident', 'uncertain', 'missing']);
const statusReason = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().min(1).nullable().optional(),
);

const nullableProvenanceSuggestion = z.preprocess(
  (value) => (value === '' ? null : value),
  z.union([z.string().trim().min(1), z.null()]),
);

const fieldEnvelope = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z
    .object({
      status: fieldStatus,
      value: valueSchema,
      reason: statusReason,
    })
    .superRefine((field, context) => {
      if (field.status !== 'confident' && !field.reason) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'reason is required when status is uncertain or missing',
          path: ['reason'],
        });
      }
    });

const attachmentDocumentKind = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase().replace(/[ -]/g, '_');
  if (normalized === 'proof_of_payment' || normalized === 'payment_confirmation') return 'payment_proof';
  if (normalized === 'support' || normalized === 'supporting') return 'supporting_document';
  return normalized;
}, z.enum(['invoice', 'receipt', 'payment_proof', 'supporting_document', 'other']));

const groupingEvidenceSchema = z.object({
  attachmentId: z.string().trim().min(1),
  provider: nullableTrimmedStringRequired,
  service: nullableTrimmedStringRequired,
  documentKind: attachmentDocumentKind,
  reason: statusReason,
});

const legacyReceiptGroupSchema = z.object({
  itemName: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
  groupingExplanation: z.string().trim().min(1),
  attachmentIds: z.array(z.string().trim().min(1)).min(1),
  referenceFacture: nullableTrimmedString,
  montantFacture: nullableAmount,
  datePaiement: nullableIsoDate,
  typeDeFacture: invoiceType,
  notesParticulieres: z.string().trim().min(1),
  groupingEvidence: z.array(groupingEvidenceSchema).optional(),
});

type LegacyReceiptGroupInput = z.infer<typeof legacyReceiptGroupSchema>;

type EnrichedReceiptGroupInput = z.infer<typeof enrichedReceiptGroupSchema>;

type RawReceiptGroupInput = LegacyReceiptGroupInput | EnrichedReceiptGroupInput;

const enrichedReceiptGroupSchema = z.object({
  itemName: fieldEnvelope(nullableTrimmedStringRequired),
  confidence: z.number().min(0).max(1),
  groupingExplanation: fieldEnvelope(nullableTrimmedStringRequired),
  attachmentIds: z.array(z.string().trim().min(1)).min(1),
  referenceFacture: fieldEnvelope(nullableTrimmedStringRequired),
  montantFacture: fieldEnvelope(nullableAmountRequired),
  datePaiement: fieldEnvelope(nullableIsoDateRequired),
  typeDeFacture: fieldEnvelope(nullableInvoiceType),
  notesParticulieres: fieldEnvelope(nullableTrimmedStringRequired),
  provenanceSuggeree: fieldEnvelope(nullableProvenanceSuggestion),
  soumisPar: fieldEnvelope(nullableTrimmedStringRequired),
  fournisseur: fieldEnvelope(nullableTrimmedStringRequired),
  groupingEvidence: z.array(groupingEvidenceSchema).optional(),
});

export const receiptGroupSchema = z
  .union([enrichedReceiptGroupSchema, legacyReceiptGroupSchema])
  .transform((rawGroup: RawReceiptGroupInput): ReceiptGroup => {
    if (isEnrichedReceiptGroup(rawGroup)) {
      return normalizeEnrichedReceiptGroup(rawGroup);
    }

    return normalizeLegacyReceiptGroup(rawGroup);
  });

export const classificationResultSchema = z.object({
  decision: z.enum(['create_items', 'review']),
  confidence: z.number().min(0).max(1),
  reviewReason: z.string().trim().min(1).nullable().optional(),
  emailSummary: z.string().trim().min(1),
  receiptGroups: z.array(receiptGroupSchema),
});

export type ValidatedClassificationResult = z.infer<typeof classificationResultSchema>;

export class ClassificationParseError extends Error {
  constructor(
    message: string,
    readonly details: string,
  ) {
    super(message);
    this.name = 'ClassificationParseError';
  }
}

export function parseClassificationJson(raw: string): ValidatedClassificationResult {
  try {
    const cleaned = extractJson(raw);
    const parsed = JSON.parse(cleaned) as unknown;
    return classificationResultSchema.parse(parsed);
  } catch (error) {
    throw new ClassificationParseError(
      'La réponse du classificateur est invalide ou incomplète.',
      formatClassificationParseDetails(error),
    );
  }
}

function formatClassificationParseDetails(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeEnrichedReceiptGroup(raw: z.infer<typeof enrichedReceiptGroupSchema>): ReceiptGroup {
  const itemName = normalizeRequiredField(raw.itemName, 'Réception à vérifier');
  const groupingExplanation = normalizeRequiredField(raw.groupingExplanation, 'Classification incomplète');
  const typeDeFacture = normalizeRequiredField<InvoiceType>(raw.typeDeFacture, 'Factures');
  const provenanceSuggeree = normalizeProvenanceField(raw.provenanceSuggeree);
  const soumisPar = normalizeField(raw.soumisPar, null);
  const referenceFacture = normalizeField(raw.referenceFacture, null);
  const montantFacture = normalizeField(raw.montantFacture, null);
  const fournisseur = normalizeField(raw.fournisseur, null);
  const datePaiement = normalizeField(raw.datePaiement, null);
  const notesParticulieres = normalizeRequiredField(raw.notesParticulieres, '');

  const normalizedDatePaiement = adjustDatePaiementForCarte(datePaiement, typeDeFacture.value);

  const fieldStatuses: ReceiptGroupFieldStatuses = {
    itemName: itemName,
    typeDeFacture: { status: typeDeFacture.status, value: typeDeFacture.value, reason: typeDeFacture.reason },
    soumisPar: { status: soumisPar.status, value: soumisPar.value, reason: soumisPar.reason },
    provenanceSuggeree: {
      status: provenanceSuggeree.status,
      value: provenanceSuggeree.value,
      reason: provenanceSuggeree.reason,
    },
    referenceFacture: {
      status: referenceFacture.status,
      value: referenceFacture.value,
      reason: referenceFacture.reason,
    },
    montantFacture: {
      status: montantFacture.status,
      value: montantFacture.value,
      reason: montantFacture.reason,
    },
    fournisseur: { status: fournisseur.status, value: fournisseur.value, reason: fournisseur.reason },
    datePaiement: {
      status: normalizedDatePaiement.status,
      value: normalizedDatePaiement.value,
      reason: normalizedDatePaiement.reason,
    },
  };

  return {
    itemName: itemName.value,
    confidence: raw.confidence,
    groupingExplanation: groupingExplanation.value,
    attachmentIds: raw.attachmentIds,
    referenceFacture: referenceFacture.value,
    montantFacture: montantFacture.value,
    datePaiement: normalizedDatePaiement.value,
    typeDeFacture: typeDeFacture.value,
    notesParticulieres: notesParticulieres.value,
    soumisPar: soumisPar.value,
    provenanceSuggeree: provenanceSuggeree.value,
    fournisseur: fournisseur.value,
    groupingEvidence: normalizeGroupingEvidence(raw.groupingEvidence),
    fieldStatuses,
  };
}

function normalizeProvenanceField(
  raw: { status: ClassificationFieldStatus; value: string | null; reason?: string | null },
): ClassifiedField<ProvenanceSuggestion | null> {
  const field = normalizeField(raw, null);

  if (!field.value) {
    return { status: field.status, value: null, reason: field.reason };
  }

  if (isProvenanceSuggestion(field.value)) {
    return { status: field.status, value: field.value, reason: field.reason };
  }

  return {
    status: 'uncertain',
    value: null,
    reason: [field.reason, `Valeur proposée non reconnue: ${field.value}`].filter(Boolean).join(' '),
  };
}

function isProvenanceSuggestion(value: string): value is ProvenanceSuggestion {
  return (PROVENANCE_SUGGESTIONS as readonly string[]).includes(value);
}

function normalizeLegacyReceiptGroup(raw: z.infer<typeof legacyReceiptGroupSchema>): ReceiptGroup {
  const fieldStatuses: ReceiptGroupFieldStatuses = {
    itemName: { status: 'confident', value: raw.itemName },
    typeDeFacture: { status: 'confident', value: raw.typeDeFacture },
    soumisPar: { status: 'missing', value: null },
    provenanceSuggeree: { status: 'missing', value: null },
    referenceFacture: { status: raw.referenceFacture === undefined ? 'missing' : 'confident', value: raw.referenceFacture ?? null },
    montantFacture: { status: raw.montantFacture === undefined ? 'missing' : 'confident', value: raw.montantFacture ?? null },
    fournisseur: { status: 'missing', value: null },
    datePaiement: { status: raw.datePaiement === undefined ? 'missing' : 'confident', value: raw.datePaiement ?? null },
  };

  return {
    itemName: raw.itemName,
    confidence: raw.confidence,
    groupingExplanation: raw.groupingExplanation,
    attachmentIds: raw.attachmentIds,
    referenceFacture: raw.referenceFacture,
    montantFacture: raw.montantFacture,
    datePaiement: raw.datePaiement,
    typeDeFacture: raw.typeDeFacture,
    notesParticulieres: raw.notesParticulieres,
    groupingEvidence: normalizeGroupingEvidence(raw.groupingEvidence),
    fieldStatuses,
  };
}

function normalizeGroupingEvidence(
  raw: Array<{ attachmentId: string; provider: string | null; service: string | null; documentKind: AttachmentDocumentKind; reason?: string | null }> | undefined,
): ReceiptGroup['groupingEvidence'] {
  if (!raw) {
    return undefined;
  }

  return raw.map((evidence) => ({
    attachmentId: evidence.attachmentId,
    provider: evidence.provider,
    service: evidence.service,
    documentKind: evidence.documentKind,
    reason: normalizeReason(evidence.reason),
  }));
}

function normalizeRequiredField<T>(
  raw: T | null | { status: ClassificationFieldStatus; value: T | null; reason?: string | null } | undefined,
  fallback: T,
): ClassifiedField<T> {
  const field = normalizeField(raw, fallback);
  return {
    status: field.status,
    value: field.value ?? fallback,
    reason: field.reason,
  };
}

function normalizeField<T>(
  raw: T | null | { status: ClassificationFieldStatus; value: T | null; reason?: string | null } | undefined,
  fallback?: T,
): ClassifiedField<T | null> {
  if (isFieldEnvelope(raw)) {
    return {
      status: raw.status,
      value: (raw.value as T) ?? (fallback as T),
      reason: normalizeReason(raw.reason),
    };
  }

  if (raw === undefined || raw === null) {
    return {
      status: 'missing',
      value: fallback as T,
    };
  }

  return {
    status: 'confident',
    value: raw,
  };
}

function normalizeReason(reason?: string | null): string | undefined {
  if (!reason) {
    return undefined;
  }

  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function adjustDatePaiementForCarte(
  datePaiement: ClassifiedField<string | null>,
  invoiceType: 'Factures' | 'Carte',
): ClassifiedField<string | null> {
  if (invoiceType === 'Carte' && datePaiement.value == null && datePaiement.status === 'missing') {
    return {
      status: 'uncertain',
      value: null,
      reason: datePaiement.reason ?? 'Date de paiement requise pour un paiement par carte.',
    };
  }

  return datePaiement;
}

function isEnrichedReceiptGroup(group: RawReceiptGroupInput): group is EnrichedReceiptGroupInput {
  return isFieldEnvelope(group.itemName);
}

function isFieldEnvelope(value: unknown): value is { status: ClassificationFieldStatus; value: unknown; reason?: string | null } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'value' in value &&
    (value as { status?: unknown }).status !== undefined
  );
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.startsWith('{')) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}
