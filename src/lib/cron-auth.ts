import { createHash, timingSafeEqual } from "node:crypto";

// Shared-secret check for scheduled calls (POST /api/cron/*). The caller sends
// `Authorization: Bearer <CRON_SECRET>`. Comparing SHA-256 digests keeps the
// comparison constant-time whatever the header's length.

/** The placeholder from .env.example is never accepted as a real secret. */
export const PLACEHOLDER_CRON_SECRET = "replace-me";

export function cronSecretConfigured(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= 8 && secret !== PLACEHOLDER_CRON_SECRET;
}

export function isAuthorizedCronRequest(authorization: string | null, secret: string | undefined): boolean {
  if (!cronSecretConfigured(secret) || !authorization) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(match[1]), digest(secret));
}
