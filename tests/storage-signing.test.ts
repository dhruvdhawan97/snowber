import { describe, expect, it } from "vitest";
import { isSafeKey, signLocalUrl, verifyLocalUrl } from "@/lib/storage";

const SECRET = "test-secret";
const KEY = "jobs/job_1/before/3f0f4529-original.jpg";
const NOW = 1_800_000_000;

function parse(url: string) {
  const [pathPart, query] = url.split("?");
  return { key: pathPart.replace(/^\/api\/storage\//, ""), params: new URLSearchParams(query) };
}

describe("local signed URLs", () => {
  const put = parse(signLocalUrl({ method: "PUT", key: KEY, expires: NOW + 300, contentType: "image/jpeg" }, SECRET));
  const get = parse(signLocalUrl({ method: "GET", key: KEY, expires: NOW + 300, contentType: "" }, SECRET));

  it("accepts a valid upload and download", () => {
    expect(verifyLocalUrl({ method: "PUT", ...put, contentType: "image/jpeg" }, SECRET, NOW)).toEqual({ ok: true });
    expect(verifyLocalUrl({ method: "GET", ...get, contentType: null }, SECRET, NOW)).toEqual({ ok: true });
  });

  it("rejects expired links", () => {
    expect(verifyLocalUrl({ method: "GET", ...get, contentType: null }, SECRET, NOW + 301)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a different method, key, type or secret", () => {
    expect(verifyLocalUrl({ method: "PUT", ...get, contentType: "image/jpeg" }, SECRET, NOW).ok).toBe(false);
    expect(verifyLocalUrl({ method: "GET", ...get, key: "jobs/job_2/before/x.jpg", contentType: null }, SECRET, NOW).ok).toBe(false);
    expect(verifyLocalUrl({ method: "PUT", ...put, contentType: "image/png" }, SECRET, NOW).ok).toBe(false);
    expect(verifyLocalUrl({ method: "GET", ...get, contentType: null }, "other-secret", NOW).ok).toBe(false);
  });

  it("rejects a tampered expiry", () => {
    const params = new URLSearchParams(get.params);
    params.set("exp", String(NOW + 99_999));
    expect(verifyLocalUrl({ method: "GET", key: get.key, params, contentType: null }, SECRET, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });
});

describe("storage keys", () => {
  it("allows app-generated keys only", () => {
    expect(isSafeKey(KEY)).toBe(true);
    expect(isSafeKey("../etc/passwd")).toBe(false);
    expect(isSafeKey("jobs/../../secret")).toBe(false);
    expect(isSafeKey("/absolute/path")).toBe(false);
    expect(isSafeKey("jobs/a b/c.jpg")).toBe(false);
  });
});
