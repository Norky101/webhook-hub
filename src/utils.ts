/** Generate a unique event ID (evt_ prefix for readability) */
export function generateEventId(): string {
  return `evt_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Current time in ISO 8601 format */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Compute HMAC-SHA256 signature.
 * Used by multiple providers for webhook verification.
 * Think of it as a tamper-proof seal — the sender signs with a secret,
 * and we verify using the same secret.
 */
export async function hmacSHA256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compare two strings in constant time.
 * Prevents timing attacks — like checking a password one letter at a time
 * would leak which letters are correct. This checks all at once.
 */
export function timeSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < aBuf.length; i++) {
    result |= aBuf[i] ^ bBuf[i];
  }
  return result === 0;
}
