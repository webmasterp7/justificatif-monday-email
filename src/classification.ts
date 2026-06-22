import { z } from 'zod';
import { MONDAY_INVOICE_TYPES } from './config.js';

const nullableTrimmedString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().min(1).nullable().optional(),
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

const nullableIsoDate = z.preprocess((value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional());

const invoiceType = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'facture' || normalized === 'factures') return 'Factures';
  if (normalized === 'carte') return 'Carte';
  return value;
}, z.enum(MONDAY_INVOICE_TYPES));

export const receiptGroupSchema = z.object({
  itemName: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
  groupingExplanation: z.string().trim().min(1),
  attachmentIds: z.array(z.string().trim().min(1)).min(1),
  referenceFacture: nullableTrimmedString,
  montantFacture: nullableAmount,
  datePaiement: nullableIsoDate,
  typeDeFacture: invoiceType,
  notesParticulieres: z.string().trim().min(1),
});

export const classificationResultSchema = z.object({
  decision: z.enum(['create_items', 'review']),
  confidence: z.number().min(0).max(1),
  reviewReason: z.string().trim().min(1).nullable().optional(),
  emailSummary: z.string().trim().min(1),
  receiptGroups: z.array(receiptGroupSchema),
});

export type ValidatedClassificationResult = z.infer<typeof classificationResultSchema>;

export function parseClassificationJson(raw: string): ValidatedClassificationResult {
  const cleaned = extractJson(raw);
  const parsed = JSON.parse(cleaned) as unknown;
  return classificationResultSchema.parse(parsed);
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
