// npm run db:slots — adds open time slots for the next 7 days without wiping anything.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { addTestSlots } from "./test-slots";

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const controller = await prisma.user.findFirst({ where: { role: "CONTROLLER" }, select: { id: true } });
    const created = await addTestSlots(prisma, controller?.id ?? null, process.env.NEXT_PUBLIC_APP_TIMEZONE || "America/Toronto");
    console.log(created ? `✓ Added ${created} open time slot(s).` : "✓ Test slots already exist — nothing to add.");
  } finally {
    await prisma.$disconnect();
  }
}

main();
