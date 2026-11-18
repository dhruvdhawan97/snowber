import { RENTAL_STATUS_LABEL, type RentalStatus } from "@/lib/contracts/domain";
import { RENTAL_PHASE_LABEL, type RentalPhase } from "@/lib/contracts/rental-states";
import { Badge } from "./ui/badge";

const PHASE_VARIANT: Record<RentalPhase, "info" | "warning" | "success" | "destructive" | "muted" | "secondary"> = {
  PENDING: "warning",
  EXPIRED: "muted",
  UPCOMING: "info",
  OUT: "success",
  OVERDUE: "destructive",
  CLOSED: "muted",
};

/** Where a rental stands now; closed rentals show their final status (returned, declined, cancelled). */
export function RentalBadge({ phase, status, className }: { phase: RentalPhase; status: RentalStatus; className?: string }) {
  if (phase === "CLOSED") {
    return (
      <Badge variant={status === "RETURNED" ? "secondary" : "muted"} className={className}>
        {status === "REJECTED" ? "Declined" : RENTAL_STATUS_LABEL[status]}
      </Badge>
    );
  }
  return (
    <Badge variant={PHASE_VARIANT[phase]} className={className}>
      {RENTAL_PHASE_LABEL[phase]}
    </Badge>
  );
}
