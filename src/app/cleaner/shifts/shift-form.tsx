"use client";

import { useActionState, useState } from "react";
import { createShiftAction } from "@/app/actions/cleaner";
import { DateTimeField, FormMessage, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";

export type ShiftPreset = { id: string; label: string; startsAt: string; endsAt: string };

/** Post availability. Tapping a time slot preset fills in its start and end. */
export function ShiftForm({ defaultStart, defaultEnd, presets }: { defaultStart: string; defaultEnd: string; presets: ShiftPreset[] }) {
  const [state, action] = useActionState(createShiftAction, null);
  const [range, setRange] = useState({ startsAt: defaultStart, endsAt: defaultEnd, version: 0 });

  return (
    <form action={action} className="grid gap-4">
      {presets.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Cover a time slot</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="secondary"
                size="sm"
                className="h-auto min-h-8 max-w-full shrink py-1.5 text-left whitespace-normal"
                onClick={() => setRange((r) => ({ startsAt: p.startsAt, endsAt: p.endsAt, version: r.version + 1 }))}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      {/* The key remounts the fields so a preset replaces whatever was typed. */}
      <div key={range.version} className="grid gap-4">
        <DateTimeField name="startsAt" label="From" defaultValue={range.startsAt} required />
        <DateTimeField name="endsAt" label="Until" defaultValue={range.endsAt} required hint="Up to 12 hours. Shifts can't overlap." />
      </div>
      <FormMessage state={state} />
      <SubmitButton size="xl" className="w-full">
        Post shift
      </SubmitButton>
    </form>
  );
}
