import { cronSecretConfigured, isAuthorizedCronRequest } from "@/lib/cron-auth";
import { autoConfirmStale } from "@/lib/dal/jobs";

// POST /api/cron/auto-confirm (Member 4): confirms finished jobs the homeowner hasn't
// answered within AUTO_CONFIRM_HOURS, which pays their cleaners. Call it from any
// scheduler (system cron, DigitalOcean / GitHub scheduled job) every 15 minutes:
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/auto-confirm
//
// The same sweep also runs whenever a homeowner or controller opens their overview,
// so the app stays correct without a scheduler; the scheduler makes it timely.

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!cronSecretConfigured(secret)) {
    return Response.json({ ok: false, error: "Set CRON_SECRET to enable this endpoint." }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), secret)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const confirmed = await autoConfirmStale();
  return Response.json({ ok: true, confirmed });
}
