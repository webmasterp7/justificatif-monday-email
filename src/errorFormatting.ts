import { ClassificationParseError } from './classification.js';

export function formatTechnicalError(error: unknown): string {
  if (error instanceof ClassificationParseError) {
    return `${error.message} Details: ${error.details}`;
  }

  return error instanceof Error ? error.message : String(error);
}

export function formatReviewReason(error: unknown): string {
  if (error instanceof ClassificationParseError) {
    return error.message;
  }

  const technicalReason = error instanceof Error ? error.message : String(error);

  if (/microsoft graph .*\/attachments\//i.test(technicalReason)) {
    return 'Impossible de récupérer une pièce jointe depuis Microsoft Graph après plusieurs tentatives.';
  }

  return 'Erreur technique pendant le traitement automatique. Consulter les logs pour le détail.';
}
