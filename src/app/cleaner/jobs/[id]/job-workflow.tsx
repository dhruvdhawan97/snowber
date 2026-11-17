"use client";

import { Check, CheckCircle2, Navigation, Play } from "lucide-react";
import { completeJobAction, startJobAction } from "@/app/actions/cleaner";
import { ActionButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import type { JobStatus } from "@/lib/contracts/domain";
import { MAX_PHOTOS_PER_KIND } from "@/lib/photo-rules";
import { cn } from "@/lib/utils";
import { PhotoCapture } from "./photo-capture";

type Step = { key: string; title: string; hint: string; done: boolean };

/**
 * Guided, glove-friendly flow for one job: go to the house → before photo → start →
 * after photo → done. The next action sits in a sticky bar at the bottom of the
 * screen, within thumb reach; the server enforces the same order.
 */
export function JobWorkflow({
  jobId,
  status,
  beforeCount,
  afterCount,
  mapsUrl,
}: {
  jobId: string;
  status: JobStatus;
  beforeCount: number;
  afterCount: number;
  mapsUrl: string;
}) {
  const started = status !== "ASSIGNED";
  const finished = status !== "ASSIGNED" && status !== "IN_PROGRESS";
  const steps: Step[] = [
    { key: "go", title: "Go to the house", hint: "Open the address in your maps app.", done: beforeCount > 0 || started },
    { key: "before", title: "Take a before photo", hint: "Show the whole driveway before you clear it.", done: beforeCount > 0 },
    { key: "start", title: "Start clearing", hint: "The homeowner is told you've started.", done: started },
    { key: "after", title: "Take an after photo", hint: "Same angle as the before photo, if you can.", done: afterCount > 0 },
    { key: "done", title: "Mark the job done", hint: "The homeowner checks the photos and confirms.", done: finished },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <div className="grid gap-4">
      <ol className="grid gap-0" aria-label="Job steps">
        {steps.map((step, i) => (
          <li key={step.key} className="relative flex gap-3 pb-4 last:pb-0">
            {i < steps.length - 1 && (
              <span aria-hidden className={cn("absolute top-9 left-[17px] h-[calc(100%-2rem)] w-0.5", step.done ? "bg-primary" : "bg-border")} />
            )}
            <span
              className={cn(
                "relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold",
                step.done ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground",
                i === current && "border-primary text-primary ring-4 ring-primary/20",
              )}
            >
              {step.done ? <Check className="size-5" aria-hidden /> : i + 1}
            </span>
            <div className="pt-1">
              <p className={cn("font-medium", !step.done && i !== current && "text-muted-foreground")}>
                {step.title}
                {i === current && <span className="sr-only"> (next step)</span>}
              </p>
              <p className="text-sm text-muted-foreground">{step.hint}</p>
            </div>
          </li>
        ))}
      </ol>

      {!finished && (
        <div className="sticky bottom-0 z-10 -mx-4 grid gap-2 border-t bg-background/95 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          {status === "ASSIGNED" && beforeCount === 0 && (
            <>
              <PhotoCapture jobId={jobId} kind="BEFORE" label="Take before photo" />
              <Button asChild size="xl" variant="outline" className="w-full">
                <a href={mapsUrl} target="_blank" rel="noreferrer">
                  <Navigation aria-hidden /> Directions
                </a>
              </Button>
            </>
          )}
          {status === "ASSIGNED" && beforeCount > 0 && (
            <>
              <ActionButton action={startJobAction.bind(null, jobId)} size="xl" className="w-full">
                <Play aria-hidden /> Start clearing
              </ActionButton>
              {beforeCount < MAX_PHOTOS_PER_KIND && (
                <PhotoCapture jobId={jobId} kind="BEFORE" label="Add another before photo" variant="outline" />
              )}
            </>
          )}
          {status === "IN_PROGRESS" && afterCount === 0 && <PhotoCapture jobId={jobId} kind="AFTER" label="Take after photo" />}
          {status === "IN_PROGRESS" && afterCount > 0 && (
            <>
              <ActionButton
                action={completeJobAction.bind(null, jobId)}
                size="xl"
                variant="success"
                className="w-full"
                confirm={{
                  title: "Mark this job done?",
                  description: "The homeowner gets your photos and confirms. You can't add photos after this.",
                  confirmLabel: "Yes, it's done",
                }}
              >
                <CheckCircle2 aria-hidden /> Mark job done
              </ActionButton>
              {afterCount < MAX_PHOTOS_PER_KIND && (
                <PhotoCapture jobId={jobId} kind="AFTER" label="Add another after photo" variant="outline" />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
