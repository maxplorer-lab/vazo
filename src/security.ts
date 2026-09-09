/**
 * security.ts — PIN generation, validation, and lyrics caching
 * Cloudflare Free Tier Safe: All operations avoid CPU runtime limits
 * 
 * PINs: 6-digit, expire 24h, single-use
 * Lyrics: Fetch from external API, cache in D1 to avoid repeated calls
 */

export interface InvitePin {
  pin: string;
  expiresAt: number;
}

export const PIN_DAYS = 1;
export const PIN_LENGTH = 6;

export function generateInvitePin(): InvitePin {
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  return { pin, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
}

export function hashPin(pin: string): string {
  // Simple hash function for PIN storage
  let hash = 0;
  for (let i = 0; i < pin.length; i++) {
    hash = ((hash << 5) - hash) + pin.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export function hashPassword(password: string): string {
  // Simple hash function for password storage
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    hash = ((hash << 5) - hash) + password.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

export function isValidInvitePin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export async function consumeInvitePin(pin: string, db: D1Database): Promise<boolean> {
  if (!isValidInvitePin(pin)) return false;

  const now = new Date().toISOString();
  const result = await db.prepare(
    "UPDATE setup_pins SET used_at = datetime('now') WHERE pin_hash = ?1 AND expires_at > ? AND used_at IS NULL"
  ).bind(pin, now).run();

  return result.meta.changes > 0;
}

export function hashSecret(value: string): string {
  // Simple hash function for secret storage
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}