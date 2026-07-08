import { z } from 'zod';
import type { InvoiceType } from './types.js';

export const MONDAY_COLUMNS = {
  facture: 'file_mm1ca2x1',
  dateReception: 'date_mm1c40cq',
  datePaiement: 'date_mm1ca3zv',
  referenceFacture: 'text_mm1g3ajw',
  montantFacture: 'numeric_mm1chk67',
  notesParticulieres: 'long_text_mm38snee',
  soumisPar: 'text_mm3seznv',
  typeDeFacture: 'dropdown_mm3sz6mp',
  statut: 'color_mm38nv5x',
  etatDeFacture: 'color_mm1cedyf',
  fournisseur: 'text_mm1cj8bv',
  provenanceSuggeree: 'dropdown_mm50vh09',
} as const;

export const MONDAY_INVOICE_TYPES = ['Factures', 'Carte'] as const satisfies readonly InvoiceType[];

export const MONDAY_STATUS_LABELS = ['Nouveau', 'Attention'] as const;
export const MONDAY_STATUTS = MONDAY_STATUS_LABELS;

export const MONDAY_INVOICE_STATE_FACTURE_RECUE = 'Facture Reçue';
export const MONDAY_INVOICE_STATES = [MONDAY_INVOICE_STATE_FACTURE_RECUE] as const;

export const MONDAY_AUTOMATION_NOTE = 'Ajouté automatiquement par email';
export const MONDAY_AUTOMATION_NOTE_TEXT = MONDAY_AUTOMATION_NOTE;

export const MONDAY_PROVENANCE_LABELS = [
  'Direction',
  'Préverenges',
  'Montreux',
  'Charmilles',
  'Cornavin',
  'Renens',
  'Chailly',
  'Avant-Poste',
  'Fribourg',
  'Formation Med3A',
  'E-shop',
  'Formation 4Med',
  '4MEd',
  'Med3A',
] as const;

export const MONDAY_PROVENANCE_COLUMN_ID = MONDAY_COLUMNS.provenanceSuggeree;

const nonEmptyString = z.string().trim().min(1);
const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const envSchema = z.object({
  LOG_LEVEL: z.enum(['debug', 'prod']).default('debug'),

  MS_TENANT_ID: nonEmptyString,
  MS_CLIENT_ID: nonEmptyString,
  MS_CLIENT_SECRET: nonEmptyString,
  MS_MAILBOX_USER_ID: nonEmptyString,
  MS_INBOX_FOLDER: z.string().trim().min(1).default('Inbox'),
  MS_PROCESSED_FOLDER: z.string().trim().min(1).default('Processed'),
  MS_REVIEW_FOLDER: z.string().trim().min(1).default('Review'),

  POLL_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  MAX_MESSAGES_PER_POLL: z.coerce.number().int().positive().max(1000).default(10),
  AUTO_CREATE_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  UPLOAD_RETRY_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  UPLOAD_RETRY_DELAY_MS: z.coerce.number().int().min(0).default(1000),

  MISTRAL_API_KEY: nonEmptyString,
  MISTRAL_OCR_MODEL: z.string().trim().min(1).default('mistral-ocr-latest'),
  MISTRAL_CHAT_MODEL: z.string().trim().min(1).default('mistral-large-latest'),

  MONDAY_API_TOKEN: nonEmptyString,
  MONDAY_BOARD_ID: nonEmptyString,
  MONDAY_GROUP_ID: optionalNonEmptyString,
  MONDAY_API_VERSION: z.string().trim().min(1).default('2024-10'),
});

export type RawEnv = z.input<typeof envSchema>;
export type ParsedEnv = z.output<typeof envSchema>;

export interface AppConfig {
  logging: {
    level: ParsedEnv['LOG_LEVEL'];
  };
  microsoft: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    mailboxUserId: string;
    folders: {
      inbox: string;
      processed: string;
      review: string;
    };
  };
  polling: {
    intervalMinutes: number;
    maxMessagesPerPoll: number;
  };
  workflow: {
    autoCreateConfidenceThreshold: number;
    uploadRetryAttempts: number;
    uploadRetryDelayMs: number;
    acceptedMimeTypes: string[];
    acceptedExtensions: string[];
  };
  mistral: {
    apiKey: string;
    ocrModel: string;
    chatModel: string;
  };
  monday: {
    apiToken: string;
    apiVersion: string;
    boardId: string;
    groupId?: string;
    columns: typeof MONDAY_COLUMNS;
    dropdownLabels: readonly InvoiceType[];
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return mapEnvToConfig(parsed.data);
}

function mapEnvToConfig(env: ParsedEnv): AppConfig {
  return {
    logging: {
      level: env.LOG_LEVEL,
    },
    microsoft: {
      tenantId: env.MS_TENANT_ID,
      clientId: env.MS_CLIENT_ID,
      clientSecret: env.MS_CLIENT_SECRET,
      mailboxUserId: env.MS_MAILBOX_USER_ID,
      folders: {
        inbox: env.MS_INBOX_FOLDER,
        processed: env.MS_PROCESSED_FOLDER,
        review: env.MS_REVIEW_FOLDER,
      },
    },
    polling: {
      intervalMinutes: env.POLL_INTERVAL_MINUTES,
      maxMessagesPerPoll: env.MAX_MESSAGES_PER_POLL,
    },
    workflow: {
      autoCreateConfidenceThreshold: env.AUTO_CREATE_CONFIDENCE_THRESHOLD,
      uploadRetryAttempts: env.UPLOAD_RETRY_ATTEMPTS,
      uploadRetryDelayMs: env.UPLOAD_RETRY_DELAY_MS,
      acceptedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
      acceptedExtensions: ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'],
    },
    mistral: {
      apiKey: env.MISTRAL_API_KEY,
      ocrModel: env.MISTRAL_OCR_MODEL,
      chatModel: env.MISTRAL_CHAT_MODEL,
    },
    monday: {
      apiToken: env.MONDAY_API_TOKEN,
      apiVersion: env.MONDAY_API_VERSION,
      boardId: env.MONDAY_BOARD_ID,
      groupId: env.MONDAY_GROUP_ID,
      columns: MONDAY_COLUMNS,
      dropdownLabels: MONDAY_INVOICE_TYPES,
    },
  };
}
