"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/action";
import { firstError } from "@/lib/contracts/schemas";
import { resolveDispute } from "@/lib/dal/disputes";
import { requireRole } from "@/lib/dal/session";

// Dispute handling (Member 4): the controller closes a disputed job.

const resolutionSchema = z.object({
  jobId: z.string().trim().min(1).max(64),
  outcome: z.enum(["PAY_CLEANER", "REFUND"]),
});

export async function resolveDisputeAction(jobId: string, outcome: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requireRole("CONTROLLER");
    const parsed = resolutionSchema.safeParse({ jobId, outcome });
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    await resolveDispute(user, parsed.data.jobId, parsed.data.outcome);
    refresh();
    return {
      ok: true,
      message: parsed.data.outcome === "PAY_CLEANER" ? "Dispute closed. The cleaner has been paid." : "Dispute closed. The homeowner has been refunded.",
    };
  });
}
