import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Object storage for job photos, behind one interface so the rest of the app never
// talks to a storage vendor directly. Browsers upload and download with short-lived
// presigned URLs; the database only ever stores object keys.
//
// • local – default. Files live under ./.storage and are served by
//           src/app/api/storage/[...key]/route.ts, which checks an HMAC signature
//           and expiry on every request (same contract as an S3 presigned URL).
// • s3    – AWS S3 or any S3-compatible bucket (Cloudflare R2, DigitalOcean Spaces,
//           MinIO). The bucket needs a CORS rule allowing PUT from the app's origin.
//
// No `server-only` import: the seed script and unit tests use this module too.

export interface StorageDriver {
  readonly name: "local" | "s3";
  /** URL the browser can PUT the file to, with this exact Content-Type. */
  presignPut(key: string, contentType: string, expiresInSeconds: number): Promise<string>;
  /** URL the browser can GET the file from. */
  presignGet(key: string, expiresInSeconds: number): Promise<string>;
  head(key: string): Promise<{ size: number; contentType: string | null } | null>;
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/;

/** Keys are app-generated, but they end up in file paths and URLs, so they are checked everywhere. */
export function isSafeKey(key: string): boolean {
  return key.length <= 300 && KEY_PATTERN.test(key) && !key.split("/").some((part) => part === "." || part === "..");
}

function assertSafeKey(key: string): void {
  if (!isSafeKey(key)) throw new Error(`Unsafe storage key: ${key}`);
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function contentTypeForKey(key: string): string {
  return CONTENT_TYPE_BY_EXT[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}

// ───────────────────────── Local driver ─────────────────────────

export type LocalMethod = "GET" | "PUT";

export type LocalSignatureInput = {
  method: LocalMethod;
  key: string;
  /** Unix time in seconds. */
  expires: number;
  /** Required for PUT; empty for GET. */
  contentType: string;
};

export function localSignature(input: LocalSignatureInput, secret: string): string {
  return createHmac("sha256", secret)
    .update([input.method, input.key, String(input.expires), input.contentType].join("\n"))
    .digest("base64url");
}

/** Builds the query string for a local signed URL. */
export function signLocalUrl(input: LocalSignatureInput, secret: string): string {
  const params = new URLSearchParams({ m: input.method, exp: String(input.expires), sig: localSignature(input, secret) });
  if (input.contentType) params.set("ct", input.contentType);
  return `/api/storage/${input.key}?${params.toString()}`;
}

export type LocalVerifyResult = { ok: true } | { ok: false; reason: "expired" | "bad-signature" | "bad-key" };

/** Checks a request against the signature in its query string. */
export function verifyLocalUrl(
  request: { method: LocalMethod; key: string; params: URLSearchParams; contentType: string | null },
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): LocalVerifyResult {
  if (!isSafeKey(request.key)) return { ok: false, reason: "bad-key" };
  const expires = Number(request.params.get("exp"));
  const sig = request.params.get("sig") ?? "";
  if (request.params.get("m") !== request.method) return { ok: false, reason: "bad-signature" };
  if (!Number.isInteger(expires)) return { ok: false, reason: "bad-signature" };
  const signedType = request.params.get("ct") ?? "";
  // A PUT must send the same Content-Type that was signed.
  if (request.method === "PUT" && (request.contentType ?? "").split(";")[0].trim() !== signedType) {
    return { ok: false, reason: "bad-signature" };
  }
  const expected = localSignature({ method: request.method, key: request.key, expires, contentType: signedType }, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad-signature" };
  if (expires < nowSeconds) return { ok: false, reason: "expired" };
  return { ok: true };
}

export function localSigningSecret(): string {
  const secret = process.env.STORAGE_SIGNING_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Set STORAGE_SIGNING_SECRET or BETTER_AUTH_SECRET to sign local storage URLs.");
  return secret;
}

export const LOCAL_STORAGE_ROOT = path.join(process.cwd(), ".storage");

function localPath(key: string): string {
  assertSafeKey(key);
  const full = path.resolve(LOCAL_STORAGE_ROOT, key);
  if (!full.startsWith(LOCAL_STORAGE_ROOT + path.sep)) throw new Error(`Unsafe storage key: ${key}`);
  return full;
}

const isMissing = (error: unknown) => (error as { code?: string } | null)?.code === "ENOENT";

export function createLocalDriver(secret = localSigningSecret()): StorageDriver {
  const expiry = (seconds: number) => Math.floor(Date.now() / 1000) + seconds;
  return {
    name: "local",
    async presignPut(key, contentType, expiresInSeconds) {
      assertSafeKey(key);
      return signLocalUrl({ method: "PUT", key, expires: expiry(expiresInSeconds), contentType }, secret);
    },
    async presignGet(key, expiresInSeconds) {
      assertSafeKey(key);
      return signLocalUrl({ method: "GET", key, expires: expiry(expiresInSeconds), contentType: "" }, secret);
    },
    async head(key) {
      try {
        const info = await stat(localPath(key));
        return { size: info.size, contentType: contentTypeForKey(key) };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async get(key) {
      return readFile(localPath(key));
    },
    async put(key, body) {
      const file = localPath(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    },
    async remove(key) {
      await rm(localPath(key), { force: true });
    },
  };
}

// ───────────────────────── S3 driver ─────────────────────────

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (STORAGE_DRIVER="s3").`);
  return value;
}

export function createS3Driver(): StorageDriver {
  const bucket = requiredEnv("S3_BUCKET");
  const client = new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"), secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY") },
    // Otherwise presigned PUT URLs embed a CRC32 of an empty body, and the bucket
    // rejects the browser's real upload with BadDigest.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return {
    name: "s3",
    async presignPut(key, contentType, expiresInSeconds) {
      assertSafeKey(key);
      return getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
        expiresIn: expiresInSeconds,
        // The upload must use the Content-Type the server approved.
        signableHeaders: new Set(["content-type"]),
      });
    },
    async presignGet(key, expiresInSeconds) {
      assertSafeKey(key);
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresInSeconds });
    },
    async head(key) {
      try {
        const info = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: info.ContentLength ?? 0, contentType: info.ContentType ?? null };
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || (error as { name?: string }).name === "NotFound") return null;
        throw error;
      }
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body) throw new Error(`Empty object: ${key}`);
      return Buffer.from(await result.Body.transformToByteArray());
    },
    async put(key, body, contentType) {
      assertSafeKey(key);
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

// ───────────────────────── Selection ─────────────────────────

export function storageDriverName(): "local" | "s3" {
  return process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";
}

const globalForStorage = globalThis as unknown as { __snowberStorage?: StorageDriver };

export function getStorage(): StorageDriver {
  globalForStorage.__snowberStorage ??= storageDriverName() === "s3" ? createS3Driver() : createLocalDriver();
  return globalForStorage.__snowberStorage;
}
