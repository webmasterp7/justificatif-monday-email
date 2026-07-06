import { MONDAY_COLUMNS } from './config.js';
import type { EmailMessage, MondayColumnValues, ReceiptGroup } from './types.js';

export const EMAIL_AUTOMATION_NOTE = 'Ajouté automatiquement par l’automatisation email.';

export function withEmailAutomationNote(notes: string, webLink: string): string {
  return [EMAIL_AUTOMATION_NOTE, `Lien email: ${webLink}`, notes].filter(Boolean).join('\n\n');
}

export function buildMondayColumnValues(values: MondayColumnValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    [MONDAY_COLUMNS.dateReception]: { date: values.dateReception },
    [MONDAY_COLUMNS.notesParticulieres]: values.notesParticulieres,
    [MONDAY_COLUMNS.soumisPar]: values.soumisPar,
    [MONDAY_COLUMNS.typeDeFacture]: { labels: [values.typeDeFacture] },
  };

  if (values.datePaiement) {
    payload[MONDAY_COLUMNS.datePaiement] = { date: values.datePaiement };
  }

  if (values.referenceFacture) {
    payload[MONDAY_COLUMNS.referenceFacture] = values.referenceFacture;
  }

  if (values.montantFacture !== undefined && values.montantFacture !== null) {
    payload[MONDAY_COLUMNS.montantFacture] = String(values.montantFacture);
  }

  return payload;
}

export function buildColumnValuesForReceipt(email: EmailMessage, group: ReceiptGroup): MondayColumnValues {
  return {
    dateReception: toDateOnly(email.receivedDateTime),
    datePaiement: group.datePaiement,
    referenceFacture: group.referenceFacture,
    montantFacture: group.montantFacture,
    notesParticulieres: withEmailAutomationNote(group.notesParticulieres, email.webLink),
    soumisPar: email.sender.name || email.sender.email,
    typeDeFacture: group.typeDeFacture,
  };
}

export function buildUpdateBody(input: {
  email: EmailMessage;
  group: ReceiptGroup;
  attachmentNames: string[];
  warnings?: string[];
}): string {
  const reference = input.group.referenceFacture ? ` / Référence ${escapeHtml(input.group.referenceFacture)}` : '';
  const amount = input.group.montantFacture !== undefined && input.group.montantFacture !== null ? ` / Montant ${input.group.montantFacture}` : '';
  const warnings = input.warnings?.length ? `<li>Avertissements: ${escapeHtml(input.warnings.join('; '))}</li>` : '';

  return [
    '<p>Justificatif ajouté automatiquement depuis l’email dédié.</p>',
    '<ul>',
    `<li>Objet email: ${escapeHtml(input.email.subject || '(sans objet)')}</li>`,
    `<li>Soumis par: ${escapeHtml(input.email.sender.name || input.email.sender.email)}</li>`,
    `<li>Date de réception: ${escapeHtml(toDateOnly(input.email.receivedDateTime))}</li>`,
    `<li>Facture: ${escapeHtml(input.group.itemName)}${reference}${amount}</li>`,
    `<li>Lien email: <a href="${escapeHtml(input.email.webLink)}">${escapeHtml(input.email.webLink)}</a></li>`,
    `<li>Fichiers ajoutés: ${escapeHtml(input.attachmentNames.join(', ') || 'aucun')}</li>`,
    `<li>Confiance: ${Math.round(input.group.confidence * 100)}%</li>`,
    `<li>Regroupement: ${escapeHtml(input.group.groupingExplanation)}</li>`,
    warnings,
    '</ul>',
  ]
    .filter(Boolean)
    .join('');
}

export function buildReviewUpdateBody(input: {
  email: EmailMessage;
  reason: string;
  attachmentNames: string[];
}): string {
  return [
    '<p>Email déplacé en revue par l’automatisation.</p>',
    '<ul>',
    `<li>Raison: ${escapeHtml(input.reason)}</li>`,
    `<li>Objet email: ${escapeHtml(input.email.subject || '(sans objet)')}</li>`,
    `<li>Soumis par: ${escapeHtml(input.email.sender.name || input.email.sender.email)}</li>`,
    `<li>Date de réception: ${escapeHtml(toDateOnly(input.email.receivedDateTime))}</li>`,
    `<li>Lien email: <a href="${escapeHtml(input.email.webLink)}">${escapeHtml(input.email.webLink)}</a></li>`,
    `<li>Fichiers: ${escapeHtml(input.attachmentNames.join(', ') || 'aucun')}</li>`,
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
