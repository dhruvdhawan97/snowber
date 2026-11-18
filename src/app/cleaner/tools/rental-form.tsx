"use client";

import { useActionState, useState } from "react";
import { requestRentalAction } from "@/app/actions/rentals";
import { DateTimeField, Field, FormMessage, SubmitButton } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type RentalToolOption = { id: string; name: string; detail: string; fee: string; available: boolean };
export type RentalPreset = { id: string; label: string; startsAt: string; endsAt: string };

/** Ask for a tool. Tapping one of your upcoming shifts fills in its start and end. */
export function RentalForm({
  tools,
  presets,
  defaultStart,
  defaultEnd,
}: {
  tools: RentalToolOption[];
  presets: RentalPreset[];
  defaultStart: string;
  defaultEnd: string;
}) {
  const [state, action] = useActionState(requestRentalAction, null);
  const [toolId, setToolId] = useState(() => tools.find((t) => t.available)?.id ?? "");
  const [range, setRange] = useState({ startsAt: defaultStart, endsAt: defaultEnd, version: 0 });
  const selected = tools.find((t) => t.id === toolId);

  return (
    <form action={action} className="grid gap-4">
      <Field label="Tool" htmlFor="rental-tool">
        <Select name="toolId" value={toolId} onValueChange={setToolId}>
          <SelectTrigger id="rental-tool" className="h-12 w-full">
            <SelectValue placeholder="Choose a tool" />
          </SelectTrigger>
          <SelectContent>
            {tools.map((t) => (
              <SelectItem key={t.id} value={t.id} disabled={!t.available}>
                {t.name} · {t.fee}
                {!t.available && " (out for repair)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {presets.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Cover one of your shifts</p>
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
        <DateTimeField name="startsAt" label="Pick up" defaultValue={range.startsAt} required />
        <DateTimeField name="endsAt" label="Return by" defaultValue={range.endsAt} required hint="Up to 24 hours." />
      </div>

      {selected && (
        <p className="text-sm text-muted-foreground">
          {selected.detail} {selected.fee} comes out of your earnings when the controller approves. Cancel before pickup and
          it&apos;s refunded.
        </p>
      )}
      <FormMessage state={state} />
      <SubmitButton size="xl" className="w-full" disabled={!toolId}>
        Request tool
      </SubmitButton>
    </form>
  );
}
