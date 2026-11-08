// Pure business rules shared by the data layer and the unit tests (no Firebase imports here).

export const STATUSES = [
  'request_submitted', 'request_confirmed', 'documents_pending', 'documents_under_review',
  'corrections_required', 'documents_verified', 'pickup_scheduled', 'picked_up', 'in_transit',
  'arrived', 'released', 'completed', 'cancelled',
] as const;

/** Allowed manual transitions performed by staff/admin. Mirrors the map in firestore.rules. */
export const TRANSITIONS: Record<string, string[]> = {
  request_submitted: ['request_confirmed', 'cancelled'],
  request_confirmed: ['documents_pending', 'documents_under_review', 'cancelled'],
  documents_pending: ['documents_under_review', 'cancelled'],
  documents_under_review: ['corrections_required', 'documents_verified'],
  corrections_required: ['documents_under_review', 'cancelled'],
  documents_verified: ['pickup_scheduled'],
  pickup_scheduled: ['picked_up'],
  picked_up: ['in_transit'],
  in_transit: ['arrived'],
  arrived: ['released'],
  released: ['completed'],
};

export const canTransition = (from: string, to: string) => (TRANSITIONS[from] ?? []).includes(to);
export const isValidStatus = (s: string) => (STATUSES as readonly string[]).includes(s);

export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const isWeightKg = (v: unknown) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean' || Array.isArray(v)) return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 500;
};

const COMMON = ['password1234', 'passw0rd1234', '123456789012', 'qwertyuiop12', 'letmein12345', 'welcome12345', 'administrator', 'pettrack12345', 'iloveyou1234', 'changeme1234'];

/** Returns a readable problem with the password, or null when it is acceptable. */
export function passwordProblem(password: string, email = '', name = ''): string | null {
  const chars = Array.from(password);
  if (chars.length < 12 || chars.length > 200) return 'Use a password between 12 and 200 characters.';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((r) => r.test(password)).length;
  if (chars.length < 16 && classes < 3) return 'Passwords under 16 characters must mix at least three of: lowercase, uppercase, numbers, symbols.';
  if (new Set(chars).size < 5) return 'That password is too repetitive.';
  const lower = password.toLowerCase();
  if (COMMON.includes(lower)) return 'That password is too common.';
  const local = (email.split('@')[0] ?? '').toLowerCase();
  if (local.length >= 4 && lower.includes(local)) return 'The password must not contain your email name.';
  const first = (name.trim().split(/\s+/)[0] ?? '').toLowerCase();
  if (first.length >= 4 && lower.includes(first)) return 'The password must not contain your name.';
  return null;
}

/** Neutralise spreadsheet formulas in CSV cells (CSV injection). */
export function csvCell(value: unknown): string {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 190;

/** Largest document file kept inside a Firestore document (free Spark plan has no Cloud Storage). */
export const MAX_DOCUMENT_BYTES = 650 * 1024;
export const DOCUMENT_TYPES: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

/** Check the real file signature instead of trusting the file name or browser-supplied type. */
export function sniffMime(bytes: Uint8Array): string | null {
  const startsWith = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  return null;
}
