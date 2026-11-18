import { describe, expect, it } from "vitest";
import { PLACEHOLDER_CRON_SECRET, cronSecretConfigured, isAuthorizedCronRequest } from "@/lib/cron-auth";

const SECRET = "a-long-random-cron-secret";

describe("cron endpoint secret", () => {
  it("is off until a real secret is set", () => {
    expect(cronSecretConfigured(undefined)).toBe(false);
    expect(cronSecretConfigured("")).toBe(false);
    expect(cronSecretConfigured("short")).toBe(false);
    expect(cronSecretConfigured(PLACEHOLDER_CRON_SECRET)).toBe(false);
    expect(cronSecretConfigured(SECRET)).toBe(true);
  });

  it("accepts only the matching bearer token", () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedCronRequest(`bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(null, SECRET)).toBe(false);
  });

  it("never accepts the placeholder, even when the caller sends it", () => {
    expect(isAuthorizedCronRequest(`Bearer ${PLACEHOLDER_CRON_SECRET}`, PLACEHOLDER_CRON_SECRET)).toBe(false);
  });
});
