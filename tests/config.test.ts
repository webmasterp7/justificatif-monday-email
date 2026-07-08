import { describe, expect, it } from 'vitest';
import { loadConfig, MONDAY_AUTOMATION_NOTE, MONDAY_COLUMNS, MONDAY_INVOICE_STATES, MONDAY_PROVENANCE_LABELS, MONDAY_STATUS_LABELS } from '../src/config.js';

describe('config constants', () => {
  it('contains updated fixed monday column IDs', () => {
    expect(MONDAY_COLUMNS.statut).toBe('color_mm38nv5x');
    expect(MONDAY_COLUMNS.etatDeFacture).toBe('color_mm1cedyf');
    expect(MONDAY_COLUMNS.fournisseur).toBe('text_mm1cj8bv');
    expect(MONDAY_COLUMNS.provenanceSuggeree).toBe('dropdown_mm50vh09');
  });

  it('exposes status and provenance metadata constants', () => {
    expect(MONDAY_STATUS_LABELS).toEqual(['Nouveau', 'Attention']);
    expect(MONDAY_INVOICE_STATES).toEqual(['Facture Reçue']);
    expect(MONDAY_AUTOMATION_NOTE).toBe('Ajouté automatiquement par email');
    expect(MONDAY_PROVENANCE_LABELS).toEqual([
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
    ]);
  });

  it('uses loadConfig defaults while exposing monday config columns', () => {
    const config = loadConfig({
      MS_TENANT_ID: 'tenant',
      MS_CLIENT_ID: 'client',
      MS_CLIENT_SECRET: 'secret',
      MS_MAILBOX_USER_ID: 'mailbox',
      MISTRAL_API_KEY: 'mistral',
      MONDAY_API_TOKEN: 'monday',
      MONDAY_BOARD_ID: '123',
    });

    expect(config.logging.level).toBe('debug');
    expect(config.monday.columns).toBe(MONDAY_COLUMNS);
    expect(config.microsoft.folders.review).toBe('Review');
    expect(config.mistral.chatModel).toBe('mistral-large-latest');
  });

  it('accepts prod logging level', () => {
    const config = loadConfig({
      LOG_LEVEL: 'prod',
      MS_TENANT_ID: 'tenant',
      MS_CLIENT_ID: 'client',
      MS_CLIENT_SECRET: 'secret',
      MS_MAILBOX_USER_ID: 'mailbox',
      MISTRAL_API_KEY: 'mistral',
      MONDAY_API_TOKEN: 'monday',
      MONDAY_BOARD_ID: '123',
    });

    expect(config.logging.level).toBe('prod');
  });

  it('rejects invalid logging levels', () => {
    expect(() =>
      loadConfig({
        LOG_LEVEL: 'verbose',
        MS_TENANT_ID: 'tenant',
        MS_CLIENT_ID: 'client',
        MS_CLIENT_SECRET: 'secret',
        MS_MAILBOX_USER_ID: 'mailbox',
        MISTRAL_API_KEY: 'mistral',
        MONDAY_API_TOKEN: 'monday',
        MONDAY_BOARD_ID: '123',
      }),
    ).toThrow(/LOG_LEVEL/);
  });
});
