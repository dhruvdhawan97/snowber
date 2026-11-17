import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/page";
import { Trash2 } from "lucide-react";
import { ActionButton } from "@/components/forms";
import { Stars } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/dal/session";
import { decideDiscountAction, removeUserAction, restoreUserAction } from "@/app/actions/controller";
import { listUsers } from "@/lib/dal/users";
import { DISCOUNT_LABEL } from "@/lib/pricing";
import { AddPersonForm, RoleSelect } from "./user-forms";

export const metadata: Metadata = { title: "Users" };

export default function UsersPage() {
  return (
    <>
      <PageHeader
        title="Users"
        description="People can sign up themselves, or you can add them here. Removing someone signs them out and blocks sign-in, but keeps their history."
      />
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <Users />
      </Suspense>
    </>
  );
}

async function Users() {
  const me = await requireRole("CONTROLLER");
  const users = await listUsers(me);
  const active = users.filter((u) => !u.deactivatedAt);
  const removed = users.filter((u) => u.deactivatedAt);
  const pendingDiscounts = active.filter((u) => u.discountStatus === "PENDING");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
      <div className="grid min-w-0 gap-6">
        {pendingDiscounts.length > 0 && (
          <Card className="border-warning/60">
            <CardHeader>
              <CardTitle>Discount requests ({pendingDiscounts.length})</CardTitle>
              <CardDescription>Approved homeowners get 20% off new bookings.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {pendingDiscounts.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                  <div className="mr-auto">
                    <p className="font-medium">{u.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {u.discountProgram ? DISCOUNT_LABEL[u.discountProgram] : ""} · {u.email}
                    </p>
                  </div>
                  <ActionButton size="sm" action={decideDiscountAction.bind(null, u.id, true)}>
                    Approve
                  </ActionButton>
                  <ActionButton size="sm" variant="outline" action={decideDiscountAction.bind(null, u.id, false)}>
                    Decline
                  </ActionButton>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>People ({active.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Rating</TableHead>
                  <TableHead className="hidden md:table-cell">Activity</TableHead>
                  <TableHead className="hidden sm:table-cell sm:w-44">Role</TableHead>
                  <TableHead className="w-10 sm:w-24">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <p className="font-medium">{u.name}</p>
                      <p className="break-all text-xs text-muted-foreground">{u.email}</p>
                      {u.discountStatus === "APPROVED" && u.discountProgram && (
                        <Badge variant="secondary" className="mt-1">
                          {DISCOUNT_LABEL[u.discountProgram]}
                        </Badge>
                      )}
                      {/* On phones the role picker sits under the name instead of in its own column. */}
                      <div className="mt-2 sm:hidden">
                        {u.id === me.id ? <span className="text-sm">Controller (you)</span> : <RoleSelect userId={u.id} role={u.role} />}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Stars rating={u.rating?.average} count={u.rating?.count} />
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {u.role === "CLEANER"
                        ? `${u._count.jobsAsCleaner} jobs${u.ownsBlower ? " · owns blower" : ""}`
                        : u.role === "HOMEOWNER"
                          ? `${u._count.properties} properties · ${u._count.jobsAsHomeowner} bookings`
                          : "—"}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {u.id === me.id ? <span className="text-sm">Controller (you)</span> : <RoleSelect userId={u.id} role={u.role} />}
                    </TableCell>
                    <TableCell>
                      {u.id !== me.id && (
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          aria-label={`Remove ${u.name}`}
                          action={removeUserAction.bind(null, u.id)}
                          confirm={{
                            title: `Remove ${u.name}?`,
                            description:
                              "They'll be signed out and won't be able to sign in. Their past jobs, reviews and earnings stay. You can restore them later.",
                            confirmLabel: "Remove",
                            destructive: true,
                          }}
                        >
                          <Trash2 aria-hidden />
                          <span className="hidden sm:inline">Remove</span>
                        </ActionButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {removed.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Removed ({removed.length})</CardTitle>
              <CardDescription>These people can&apos;t sign in.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {removed.map((u) => (
                <div key={u.id} className="flex items-center gap-3 rounded-lg border p-3 text-muted-foreground">
                  <div className="mr-auto">
                    <p className="font-medium text-foreground">{u.name}</p>
                    <p className="text-xs">{u.email}</p>
                  </div>
                  <ActionButton size="sm" variant="outline" action={restoreUserAction.bind(null, u.id)}>
                    Restore
                  </ActionButton>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Add a person</CardTitle>
          <CardDescription>Create an account for a homeowner, cleaner or another controller.</CardDescription>
        </CardHeader>
        <CardContent>
          <AddPersonForm />
        </CardContent>
      </Card>
    </div>
  );
}
