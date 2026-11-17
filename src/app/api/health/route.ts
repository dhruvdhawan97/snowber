import { connection } from "next/server";
import { checkDatabase } from "@/lib/dal/health";

// GET /api/health → { ok, database: {...} }. Returns 503 when the database is down,
// so uptime monitors (or a quick browser check) can tell at a glance.
export async function GET() {
  await connection();
  const database = await checkDatabase();
  return Response.json({ ok: database.ok, database }, { status: database.ok ? 200 : 503 });
}
