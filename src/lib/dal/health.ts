import "server-only";
import { prisma } from "@/lib/prisma";

export type DatabaseHealth =
  | { ok: true; database: string; latencyMs: number; serverVersion: string; latestMigration: string | null }
  | { ok: false; error: string };

/** Pings PostgreSQL and reports which database the app is actually connected to. */
export async function checkDatabase(): Promise<DatabaseHealth> {
  const started = performance.now();
  try {
    const [info] = await prisma.$queryRaw<{ database: string; version: string }[]>`
      SELECT current_database() AS database, current_setting('server_version') AS version`;
    const latencyMs = Math.round(performance.now() - started);
    const migrations = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY finished_at DESC LIMIT 1`.catch(() => []);
    return {
      ok: true,
      database: info.database,
      latencyMs,
      serverVersion: info.version,
      latestMigration: migrations[0]?.migration_name ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Keep only the useful last line (e.g. "Can't reach database server at localhost:5432").
    return { ok: false, error: message.split("\n").filter(Boolean).pop() ?? "Unknown database error" };
  }
}
