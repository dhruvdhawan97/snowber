"use client";

import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { createAccountAction, setRoleAction } from "@/app/actions/controller";
import { Field, FormMessage, SubmitButton } from "@/components/forms";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/contracts/domain";

/** Add a homeowner, cleaner or controller with a temporary password. */
export function AddPersonForm() {
  const [state, action] = useActionState(createAccountAction, null);
  return (
    <form action={action} className="grid gap-4">
      <Field label="Role" htmlFor="new-role">
        <Select name="role" defaultValue="HOMEOWNER">
          <SelectTrigger id="new-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Name" htmlFor="new-name">
        <Input id="new-name" name="name" required minLength={2} />
      </Field>
      <Field label="Email" htmlFor="new-email">
        <Input id="new-email" name="email" type="email" required />
      </Field>
      <Field
        label="Temporary password"
        htmlFor="new-password"
        hint="At least 8 characters. Share it with them privately."
      >
        <PasswordInput
          id="new-password"
          name="password"
          minLength={8}
          required
          autoComplete="new-password"
        />
      </Field>
      <FormMessage state={state} />
      <SubmitButton>Add person</SubmitButton>
    </form>
  );
}

export function RoleSelect({ userId, role }: { userId: string; role: Role }) {
  const [pending, startTransition] = useTransition();
  return (
    <Select
      value={role}
      disabled={pending}
      onValueChange={(value) =>
        startTransition(async () => {
          const result = await setRoleAction(userId, value);
          if (!result.ok) toast.error(result.error);
          else toast.success(result.message ?? "Role updated.");
        })
      }
    >
      <SelectTrigger size="sm" aria-label="Role">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {ROLE_LABEL[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
