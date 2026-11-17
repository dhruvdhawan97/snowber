import type { NextRequest } from "next/server";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/config";
import { contentTypeForKey, getStorage, localSigningSecret, storageDriverName, verifyLocalUrl, type LocalMethod } from "@/lib/storage";

// Stands in for an S3 bucket when STORAGE_DRIVER="local": the browser PUTs uploads
// and GETs photos here with the signed URLs from src/lib/storage.ts. Requests
// without a valid, unexpired signature are rejected. Disabled with the s3 driver.

async function authorize(request: NextRequest, ctx: RouteContext<"/api/storage/[...key]">, method: LocalMethod) {
  if (storageDriverName() !== "local") return { error: new Response("Not found", { status: 404 }) };
  const key = (await ctx.params).key.join("/");
  const check = verifyLocalUrl(
    { method, key, params: request.nextUrl.searchParams, contentType: request.headers.get("content-type") },
    localSigningSecret(),
  );
  if (!check.ok) {
    return { error: new Response(check.reason === "expired" ? "Link expired" : "Forbidden", { status: 403 }) };
  }
  return { key };
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/storage/[...key]">) {
  const auth = await authorize(request, ctx, "GET");
  if ("error" in auth) return auth.error;
  const storage = getStorage();
  if (!(await storage.head(auth.key))) return new Response("Not found", { status: 404 });
  const body = await storage.get(auth.key);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": contentTypeForKey(auth.key),
      "Content-Length": String(body.length),
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function PUT(request: NextRequest, ctx: RouteContext<"/api/storage/[...key]">) {
  const auth = await authorize(request, ctx, "PUT");
  if ("error" in auth) return auth.error;
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType)) {
    return new Response("Unsupported file type", { status: 415 });
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) return new Response("File too large", { status: 413 });
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length === 0) return new Response("Empty upload", { status: 400 });
  if (body.length > MAX_UPLOAD_BYTES) return new Response("File too large", { status: 413 });
  await getStorage().put(auth.key, body, contentType);
  return new Response(null, { status: 200 });
}
