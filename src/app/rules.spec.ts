import { describe, expect, it } from 'vitest';
import {
  canTransition,
  csvCell,
  isDate,
  isEmail,
  isValidStatus,
  isWeightKg,
  passwordProblem,
  sniffMime,
  STATUSES,
  TRANSITIONS,
} from './rules';

describe('relocation workflow', () => {
  it('allows the happy path step by step', () => {
    const path = ['request_submitted', 'request_confirmed', 'documents_under_review', 'documents_verified', 'pickup_scheduled', 'picked_up', 'in_transit', 'arrived', 'released', 'completed'];
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });
  it('blocks skipping verification, jumping ahead and going backwards', () => {
    expect(canTransition('request_confirmed', 'documents_verified')).toBe(false);
    expect(canTransition('pickup_scheduled', 'in_transit')).toBe(false);
    expect(canTransition('picked_up', 'pickup_scheduled')).toBe(false);
  });
  it('treats completed and cancelled as final and rejects unknown statuses', () => {
    expect(canTransition('completed', 'cancelled')).toBe(false);
    expect(canTransition('cancelled', 'request_submitted')).toBe(false);
    expect(canTransition('bogus', 'completed')).toBe(false);
    expect(isValidStatus('bogus')).toBe(false);
  });
  it('only transitions between known statuses', () => {
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      expect(STATUSES as readonly string[]).toContain(from);
      for (const t of targets) expect(STATUSES as readonly string[]).toContain(t);
    }
  });
});

describe('validation', () => {
  it('accepts real dates only', () => {
    expect(isDate('2028-02-29')).toBe(true);
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('11/07/2026')).toBe(false);
    expect(isDate("2026-01-01' OR '1'='1")).toBe(false);
  });
  it('checks weight and email', () => {
    expect(isWeightKg('12.5')).toBe(true);
    for (const bad of [0, -1, 501, 'heavy', null, true]) expect(isWeightKg(bad)).toBe(false);
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('not-an-email')).toBe(false);
  });
});

describe('password policy', () => {
  it('rejects short, single-class, repetitive and common passwords', () => {
    expect(passwordProblem('Ab1!short')).not.toBeNull();
    expect(passwordProblem('abcdefghijkl')).not.toBeNull();
    expect(passwordProblem('aaaaaaaaaaaaaaaaaaaa')).not.toBeNull();
    expect(passwordProblem('Pettrack12345')).not.toBeNull();
  });
  it('accepts mixed 12-character and long passphrases', () => {
    expect(passwordProblem('Tr1cky-Pa55w')).toBeNull();
    expect(passwordProblem('correct horse battery staple')).toBeNull();
  });
  it('rejects passwords containing the email name or first name', () => {
    expect(passwordProblem('Marisol-Rules-99!', 'marisol@example.test')).not.toBeNull();
    expect(passwordProblem('Jonathan#Rules99', 'x@example.test', 'Jonathan Cruz')).not.toBeNull();
    expect(passwordProblem('Tr1cky-Pa55w-bo', 'bo@example.test')).toBeNull();
  });
});

describe('uploads and exports', () => {
  it('detects the real file type from its first bytes', () => {
    expect(sniffMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe('application/pdf');
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffMime(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // a Windows .exe renamed to .pdf
  });
  it('neutralises spreadsheet formulas and quotes special characters in CSV', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('Dela Cruz, Juan')).toBe('"Dela Cruz, Juan"');
    expect(csvCell('plain')).toBe('plain');
  });
});
