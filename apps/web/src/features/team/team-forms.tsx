"use client";

import { useActionState } from "react";
import { Loader2, Power, UserPlus } from "lucide-react";
import { FormField } from "@/components/patterns/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { fieldError, SubmitButton } from "@/features/clients/form-bits";
import type { ActionResult } from "@/lib/action-result";
import { addStaffAction, changeRoleAction, setStatusAction } from "./actions";

export interface RoleOption {
  value: string;
  label: string;
}

export function AddStaffForm({ roles }: { roles: RoleOption[] }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(addStaffAction, null);
  const v = state && !state.ok ? state.values : undefined;
  const val = (k: string) => (typeof v?.[k] === "string" ? (v[k] as string) : "");
  return (
    <form action={action} className="grid gap-4" key={state?.ok ? state.message : "add"}>
      <FormField label="Name" error={fieldError(state, "name")}>
        {(p) => <Input {...p} name="name" autoComplete="off" defaultValue={val("name")} placeholder="Jo Smith" />}
      </FormField>
      <FormField label="Email" error={fieldError(state, "email")}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="off" defaultValue={val("email")} placeholder="jo@clinic.com" />}
      </FormField>
      <FormField label="Role" error={fieldError(state, "role")}>
        {(p) => (
          <Select {...p} name="role" defaultValue={val("role") || "csr"}>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {state && !state.ok && !state.field && <Alert variant="error">{state.error}</Alert>}
      {state?.ok && <Alert variant="success">{state.message}</Alert>}
      <div>
        <SubmitButton pendingText="Adding…">
          <UserPlus aria-hidden /> Add to team
        </SubmitButton>
      </div>
    </form>
  );
}

export function RoleSelect({ staffUserId, current, roles, disabled }: { staffUserId: string; current: string; roles: RoleOption[]; disabled?: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(changeRoleAction.bind(null, staffUserId), null);
  return (
    <form action={action} className="grid gap-1">
      <div className="flex items-center gap-2">
        <Select
          name="role"
          defaultValue={current}
          disabled={disabled || pending}
          aria-label="Role"
          className="h-9 min-w-40"
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        >
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      {state && !state.ok && <p className="text-caption text-destructive">{state.error}</p>}
    </form>
  );
}

export function StatusButton({ staffUserId, disabled, active }: { staffUserId: string; disabled?: boolean; active: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(() => setStatusAction(staffUserId, active ? "disabled" : "active"), null);
  return (
    <form action={action} className="grid justify-items-end gap-1">
      <Button type="submit" size="sm" variant="outline" disabled={disabled || pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Power aria-hidden />}
        {active ? "Turn off access" : "Turn on access"}
      </Button>
      {state && !state.ok && <p className="text-caption text-destructive">{state.error}</p>}
    </form>
  );
}
