"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { createToolAction, setToolStatusAction } from "@/app/actions/rentals";
import { Field, FormMessage, SubmitButton } from "@/components/forms";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TOOL_STATUSES, TOOL_STATUS_LABEL, TOOL_TYPES, TOOL_TYPE_LABEL, type ToolStatus, type ToolType } from "@/lib/contracts/domain";

/** Suggested fee per rental when a type is picked; the controller can change it. */
const DEFAULT_FEE: Record<ToolType, string> = {
  SHOVEL: "3",
  SNOW_BLOWER: "15",
  SALT_SPREADER: "5",
  ICE_CHOPPER: "4",
};

export function ToolForm() {
  const [state, action] = useActionState(createToolAction, null);
  const [fee, setFee] = useState(DEFAULT_FEE.SNOW_BLOWER);
  return (
    <form action={action} className="grid gap-4">
      <Field label="Name" htmlFor="tool-name" hint="Something people can find on the shelf, e.g. Snow blower C">
        <Input id="tool-name" name="name" required minLength={2} maxLength={80} />
      </Field>
      <Field label="Type" htmlFor="tool-type">
        <Select
          name="type"
          defaultValue="SNOW_BLOWER"
          onValueChange={(value) => setFee(DEFAULT_FEE[value as ToolType] ?? fee)}
        >
          <SelectTrigger id="tool-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TOOL_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {TOOL_TYPE_LABEL[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Fee per rental ($)" htmlFor="tool-fee" hint="Charged to the cleaner's earnings when you approve a rental.">
        <Input
          id="tool-fee"
          name="feeDollars"
          type="number"
          inputMode="decimal"
          min={0}
          max={500}
          step="0.5"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          required
        />
      </Field>
      <Field label="Notes (optional)" htmlFor="tool-notes">
        <Textarea id="tool-notes" name="notes" maxLength={300} rows={2} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton>Add tool</SubmitButton>
    </form>
  );
}

/** In service / out for repair / retired, changed in place. */
export function ToolStatusSelect({ toolId, status, label }: { toolId: string; status: ToolStatus; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Select
      value={status}
      disabled={pending}
      onValueChange={(value) =>
        startTransition(async () => {
          const result = await setToolStatusAction(toolId, value);
          if (result.ok) toast.success(result.message);
          else toast.error(result.error);
        })
      }
    >
      <SelectTrigger aria-label={`Status of ${label}`} className="w-full min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TOOL_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {TOOL_STATUS_LABEL[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
