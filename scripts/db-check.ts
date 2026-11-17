// npm run db:check — shows which database .env points at and whether it's ready.
// Useful when two Snowber copies share one PostgreSQL server.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error("✗ DATABASE_URL is not set. Copy .env.example to .env first.");
    process.exit(1);
  }
  const url = new URL(raw);
  console.log(`Database:  ${decodeURIComponent(url.pathname.slice(1))}`);
  console.log(`Server:    ${url.hostname}:${url.port || 5432}`);
  console.log(`User:      ${decodeURIComponent(url.username)}`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: raw }) });
  try {
    const started = performance.now();
    const [info] = await prisma.$queryRaw<{ version: string }[]>`SELECT current_setting('server_version') AS version`;
    console.log(`✓ Connected in ${Math.round(performance.now() - started)} ms (PostgreSQL ${info.version})`);

    const migrations = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
      SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at`.catch(() => null);
    if (!migrations) {
      console.log("✗ No migrations applied yet. Run: npm run db:deploy");
    } else {
      const failed = migrations.filter((m) => !m.finished_at);
      console.log(`✓ ${migrations.length - failed.length} migration(s) applied, latest: ${migrations.at(-1)?.migration_name}`);
      if (failed.length) console.log(`✗ Failed migration(s): ${failed.map((m) => m.migration_name).join(", ")}`);
      const users = await prisma.user.count();
      console.log(users > 0 ? `✓ ${users} users in the database` : "! The database is empty. Run: npm run db:seed");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ Could not connect: ${message.split("\n").filter(Boolean).pop()}`);
    console.error("  Is PostgreSQL running, and do the user, password and database in DATABASE_URL exist?");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
