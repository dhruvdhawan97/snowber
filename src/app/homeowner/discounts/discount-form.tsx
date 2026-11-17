"use client";

import { useActionState, useState } from "react";
import { requestDiscountAction } from "@/app/actions/homeowner";
import { FormMessage, SubmitButton } from "@/components/forms";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const PROGRAMS = [
  { value: "SENIOR", title: "Senior discount", text: "For homeowners aged 65 or older." },
  { value: "ACCESSIBILITY", title: "Accessibility discount", text: "For homeowners living with a disability that makes clearing snow hard or unsafe." },
] as const;

export function DiscountForm({ current }: { current: "SENIOR" | "ACCESSIBILITY" | null }) {
  const [state, action] = useActionState(requestDiscountAction, null);
  const [program, setProgram] = useState<string>(current ?? "SENIOR");

  return (
    <form action={action} className="grid gap-4">
      <fieldset className="grid gap-3">
        <legend className="mb-1 font-medium">Which applies to you?</legend>
        {PROGRAMS.map((p) => (
          <label
            key={p.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-4",
              program === p.value ? "border-primary bg-primary/5 ring-2 ring-primary/25" : "hover:bg-accent",
            )}
          >
            <input
              type="radio"
              name="program"
              value={p.value}
              className="mt-1 size-4 accent-primary"
              checked={program === p.value}
              onChange={() => setProgram(p.value)}
            />
            <span>
              <span className="block font-medium">{p.title}</span>
              <span className="text-sm text-muted-foreground">{p.text}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex items-start gap-3">
        <Checkbox id="attest" name="attest" required className="mt-0.5" />
        <Label htmlFor="attest" className="font-normal leading-snug">
          I confirm this applies to me.
        </Label>
      </div>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton>{current ? "Update request" : "Apply for discount"}</SubmitButton>
        {current && (
          <SubmitButton type="submit" name="program" value="NONE" variant="outline" formNoValidate>
            Remove my discount
          </SubmitButton>
        )}
      </div>
    </form>
  );
}
