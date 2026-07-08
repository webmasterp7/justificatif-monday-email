import { MONDAY_AUTOMATION_NOTE, MONDAY_COLUMNS, MONDAY_INVOICE_STATE_FACTURE_RECUE, MONDAY_STATUS_LABELS } from './config.js';
import type { EmailMessage, MondayColumnValues, ReceiptGroup } from './types.js';

const MAX_THREAD_BODY_LENGTH = 2000;
const EMAIL_THREAD_TRUNCATION_NOTE = 'caractères tronqués';

export const EMAIL_AUTOMATION_NOTE = MONDAY_AUTOMATION_NOTE;

export interface AttentionPayloadOptions {
  statut: typeof MONDAY_STATUS_LABELS[number];
  attentionReasons?: string[];
}

export function withEmailAutomationNote(
  attentionReasons: string[] = [],
  extraNotes: string[] = [],
): string {
  const reasons = normalizeReasonList(attentionReasons)
    .map((reason) => `Attention: ${reason}`)
    .join(' / ');

  const parts = [
    EMAIL_AUTOMATION_NOTE,
    ...normalizeReasonList(extraNotes),
    ...(reasons ? [reasons] : []),
  ];

  return parts.join('\n\n');
}

export function buildMondayColumnValues(values: MondayColumnValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    [MONDAY_COLUMNS.dateReception]: values.dateReception ? { date: values.dateReception } : undefined,
    [MONDAY_COLUMNS.notesParticulieres]: values.notesParticulieres,
    [MONDAY_COLUMNS.soumisPar]: values.soumisPar,
    [MONDAY_COLUMNS.typeDeFacture]: { labels: [values.typeDeFacture] },
    [MONDAY_COLUMNS.statut]: { label: values.statut },
    [MONDAY_COLUMNS.etatDeFacture]: { label: MONDAY_INVOICE_STATE_FACTURE_RECUE },
  };

  if (values.datePaiement) {
    payload[MONDAY_COLUMNS.datePaiement] = { date: values.datePaiement };
  }

  if (values.referenceFacture != null) {
    payload[MONDAY_COLUMNS.referenceFacture] = values.referenceFacture;
  }

  if (values.montantFacture !== undefined && values.montantFacture !== null) {
    payload[MONDAY_COLUMNS.montantFacture] = String(values.montantFacture);
  }

  if (values.fournisseur) {
    payload[MONDAY_COLUMNS.fournisseur] = values.fournisseur;
  }

  if (values.provenanceSuggeree) {
    payload[MONDAY_COLUMNS.provenanceSuggeree] = { labels: [values.provenanceSuggeree] };
  }

  return payload;
}

export function buildColumnValuesForReceipt(
  email: EmailMessage,
  group: ReceiptGroup,
  options: AttentionPayloadOptions,
): MondayColumnValues {
  const status = options.statut ?? MONDAY_STATUS_LABELS[0];
  const reasons = status === 'Attention' ? options.attentionReasons ?? [] : [];

  return {
    dateReception: toDateOnly(email.receivedDateTime),
    datePaiement: group.datePaiement,
    referenceFacture: group.referenceFacture,
    montantFacture: group.montantFacture,
    notesParticulieres: withEmailAutomationNote(reasons),
    soumisPar: group.soumisPar || email.sender.name || email.sender.email,
    typeDeFacture: group.typeDeFacture,
    statut: status,
    fournisseur: group.fournisseur ?? undefined,
    provenanceSuggeree: group.provenanceSuggeree,
    etatDeFacture: MONDAY_INVOICE_STATE_FACTURE_RECUE,
  };
}

export interface BuildUpdateInput {
  email: EmailMessage;
  group: ReceiptGroup;
  emailThread?: string;
  movedMessageLink?: string;
}

export function buildUpdateBody(input: BuildUpdateInput): string {
  const subject = input.email.subject || '(sans objet)';
  const sender = input.email.sender.name || input.email.sender.email;
  const emailThread = input.emailThread ?? '';
  const truncated = truncateEmailThread(emailThread);
  const formattedEmailThread = formatEmailThreadHtml(truncated.text);
  const messageLink = firstNonEmpty(input.movedMessageLink, input.email.webLink);

  return [
    '<p>Justificatif ajouté automatiquement depuis l’email dédié.</p>',
    '<ul>',
    `<li>Objet email: ${escapeHtml(subject)}</li>`,
    `<li>Soumis par: ${escapeHtml(sender)}</li>`,
    `<li>Date de réception: ${escapeHtml(toDateOnly(input.email.receivedDateTime))}</li>`,
    renderMessageLink(messageLink),
    `<li>Confiance: ${Math.round(input.group.confidence * 100)}%</li>`,
    `<li>Regroupement: ${escapeHtml(input.group.groupingExplanation)}</li>`,
    `<li>Message source:<br>${formattedEmailThread}</li>`,
    ...(truncated.wasTruncated ? ['<li>Le corps de l’e-mail a été tronqué pour rester dans les limites monday.</li>'] : []),
    '</ul>',
  ]
    .join('')
    .slice(0, 65500);
}

export function buildAttentionUpdateBody(attentionReasons: string[]): string {
  const reasons = normalizeReasonList(attentionReasons);

  return [
    '<p><strong>Points d’attention à traiter avant validation.</strong></p>',
    '<ul>',
    ...reasons.map((reason) => `<li>Attention: ${escapeHtml(reason)}</li>`),
    '</ul>',
  ].join('');
}

export function buildReviewUpdateBody(input: {
  email: EmailMessage;
  reason: string;
  attachmentNames: string[];
  emailThread?: string;
  attentionReasons?: string[];
  movedMessageLink?: string;
}): string {
  const subject = input.email.subject || '(sans objet)';
  const sender = input.email.sender.name || input.email.sender.email;
  const messageThread = input.emailThread ?? '';
  const truncated = truncateEmailThread(messageThread);
  const formattedEmailThread = formatEmailThreadHtml(truncated.text);
  const messageLink = firstNonEmpty(input.movedMessageLink, input.email.webLink);

  return [
    '<p><strong>Points d’attention à traiter avant validation.</strong></p>',
    '<ul>',
    `<li>Attention: ${escapeHtml(input.reason)}</li>`,
    `<li>Objet email: ${escapeHtml(subject)}</li>`,
    `<li>Soumis par: ${escapeHtml(sender)}</li>`,
    `<li>Date de réception: ${escapeHtml(toDateOnly(input.email.receivedDateTime))}</li>`,
    renderMessageLink(messageLink),
    `<li>Fichiers: ${escapeHtml(input.attachmentNames.join(', ') || 'aucun')}</li>`,
    `<li>Message source:<br>${formattedEmailThread}</li>`,
    ...(truncated.wasTruncated ? ['<li>Le corps de l’e-mail a été tronqué pour rester dans les limites monday.</li>'] : []),
    ...(input.attentionReasons?.filter(Boolean).map((reason) => `<li>Attention: ${escapeHtml(reason)}</li>`) ?? []),
    '</ul>',
  ].join('');
}

export function toDateOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

function truncateEmailThread(text: string): { text: string; wasTruncated: boolean } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { text: '(aucun contenu email disponible)', wasTruncated: false };
  }

  if (trimmed.length <= MAX_THREAD_BODY_LENGTH) {
    return { text: trimmed, wasTruncated: false };
  }

  const truncated = trimmed.slice(0, MAX_THREAD_BODY_LENGTH);
  const remaining = trimmed.length - MAX_THREAD_BODY_LENGTH;

  return {
    text: `${truncated}… (${remaining} ${EMAIL_THREAD_TRUNCATION_NOTE})`,
    wasTruncated: true,
  };
}

function normalizeReasonList(reasons: string[]): string[] {
  return reasons
    .map((reason) => reason.trim())
    .filter(Boolean)
    .filter((reason, index, all) => all.indexOf(reason) === index);
}

function formatEmailThreadHtml(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>');
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value): value is string => Boolean(value));
}

function renderMessageLink(messageLink: string | undefined): string {
  if (!messageLink) {
    return '<li>Lien du mail: indisponible après déplacement Outlook</li>';
  }

  const escapedLink = escapeHtml(messageLink);
  return `<li>Lien du mail: <a href="${escapedLink}">${escapedLink}</a></li>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
