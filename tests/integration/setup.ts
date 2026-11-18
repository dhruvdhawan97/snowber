// Runs before every integration test file, before any app module is imported.
// The tests wipe the database, so they only run against a database whose name
// contains "test", given explicitly in TEST_DATABASE_URL (never DATABASE_URL).
// Create it once and apply the migrations:
//
//   createdb snowber_test
//   DATABASE_URL=postgresql://…/snowber_test npx prisma migrate deploy

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error("Set TEST_DATABASE_URL to a throwaway PostgreSQL database (e.g. …/snowber_test) to run integration tests.");
}
const databaseName = new URL(url).pathname.replace(/^\//, "");
if (!/test/i.test(databaseName)) {
  throw new Error(`Refusing to run integration tests against "${databaseName}": the database name must contain "test".`);
}

process.env.DATABASE_URL = url;
// Simulated payments, local photo storage and a known cron secret.
process.env.STRIPE_SECRET_KEY = "";
process.env.STORAGE_DRIVER = "local";
process.env.CRON_SECRET = "integration-test-cron-secret";
process.env.BETTER_AUTH_SECRET ??= "integration-test-auth-secret-0123456789";

export {};
