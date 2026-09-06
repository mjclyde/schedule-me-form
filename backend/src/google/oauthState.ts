import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed, expiring `state` values for the Google OAuth redirect.
 *
 * `/GoogleAuth/Redirect` cannot be authenticated — Google calls it, not the
 * user — so the person the flow belongs to has to travel through `state`. An
 * unsigned state would let anyone bind a Google account to any person id by
 * hand-crafting the callback URL, so it is HMAC-signed and short-lived.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  personId: string;
  /** Expiry, epoch millis. */
  exp: number;
}

export function signState(
  personId: string,
  secret: string,
  options: { ttlMs?: number; now?: number } = {},
): string {
  if (!secret) {
    throw new Error("Cannot sign OAuth state without a secret");
  }
  const now = options.now ?? Date.now();
  const payload: StatePayload = {
    personId,
    exp: now + (options.ttlMs ?? DEFAULT_TTL_MS),
  };
  const body = encode(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

/**
 * @returns the person id the state was issued for, or null if the state is
 *   malformed, expired, or not signed by us.
 */
export function verifyState(
  state: string,
  secret: string,
  options: { now?: number } = {},
): string | null {
  if (!secret || !state) {
    return null;
  }
  const [body, signature] = state.split(".");
  if (!body || !signature || !matches(sign(body, secret), signature)) {
    return null;
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const now = options.now ?? Date.now();
  if (!payload?.personId || !payload.exp || payload.exp < now) {
    return null;
  }
  return payload.personId;
}

function sign(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** Constant-time compare, tolerating length mismatches. */
function matches(expected: string, actual: string) {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
