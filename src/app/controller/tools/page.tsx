import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertTriangle, Phone } from "lucide-react";
import { approveRentalAction, cancelRentalAction, rejectRentalAction, returnRentalAction } from "@/app/actions/rentals";
import { ActionButton } from "@/components/forms";
import { EmptyState, PageHeader, PageSkeleton, Stat } from "@/components/page";
import { RentalBadge } from "@/components/rental-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TOOL_TYPE_LABEL } from "@/lib/contracts/domain";
import { listRentalsForController } from "@/lib/dal/rentals";
import { requireRole } from "@/lib/dal/session";
import { listToolLibrary } from "@/lib/dal/tools";
import { firstName, formatDateTime, formatMoney, formatRange } from "@/lib/format";
import { ToolForm, ToolStatusSelect } from "./tool-form";

// Member 4: the tool library. Stock, rental requests, check-out and check-in.

export const metadata: Metadata = { title: "Tool library" };

export default function ToolsPage() {
  return (
    <>
      <PageHeader
        title="Tool library"
        description="Snow blowers, shovels and spreaders cleaners can rent. Approving a request reserves the tool and charges its fee to the cleaner's earnings; cancelling before pickup refunds it."
      />
      <Suspense fallback={<PageSkeleton rows={3} />}>
        <Library />
      </Suspense>
    </>
  );
}

async function Library() {
  const user = await requireRole("CONTROLLER");
  const [tools, { requests, active, closed }] = await Promise.all([listToolLibrary(user), listRentalsForController(user)]);
  const inService = tools.filter((t) => t.status === "AVAILABLE").length;
  const out = active.filter((r) => r.phase === "OUT").length;
  const overdue = active.filter((r) => r.phase === "OVERDUE").length;
  const pending = requests.filter((r) => r.phase === "PENDING").length;

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="In service" value={inService} hint={`${tools.length} tool${tools.length === 1 ? "" : "s"} in total`} />
        <Stat label="Checked out" value={out} />
        <Stat label="Requests" value={pending} hint={pending > 0 ? "Waiting for you" : undefined} />
        <Stat label="Overdue" value={overdue} hint={overdue > 0 ? "Follow up with the cleaner" : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="grid min-w-0 content-start gap-6">
          {requests.length > 0 && (
            <Card className="border-warning/60">
              <CardHeader>
                <CardTitle>Requests ({requests.length})</CardTitle>
                <CardDescription>A tool can only be reserved once for any stretch of time.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {requests.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                    <div className="mr-auto grid min-w-0 gap-0.5">
                      <p className="font-medium">
                        {r.tool.name} <span className="font-normal text-muted-foreground">· {formatMoney(r.feeCents)}</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {r.cleaner.name} · {formatRange(r.startsAt, r.endsAt)}
                      </p>
                      {r.clash && (
                        <p className="flex items-center gap-1.5 text-sm text-destructive">
                          <AlertTriangle className="size-4 shrink-0" aria-hidden />
                          Already reserved by {firstName(r.clash.cleaner.name)}, {formatRange(r.clash.startsAt, r.clash.endsAt)}
                        </p>
                      )}
                      {r.tool.status !== "AVAILABLE" && <p className="text-sm text-destructive">This tool is out of service.</p>}
                    </div>
                    {r.phase === "EXPIRED" && <Badge variant="muted">Expired</Badge>}
                    <ActionButton size="sm" disabled={!r.canApprove || r.clash !== null} action={approveRentalAction.bind(null, r.id)}>
                      Approve
                    </ActionButton>
                    <ActionButton size="sm" variant="outline" action={rejectRentalAction.bind(null, r.id)}>
                      Decline
                    </ActionButton>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Reserved and checked out ({active.length})</CardTitle>
              <CardDescription>Check a tool in when it comes back. Overdue tools are listed first.</CardDescription>
            </CardHeader>
            <CardContent>
              {active.length === 0 ? (
                <EmptyState title="Nothing reserved">Approved rentals show up here until the tool is checked back in.</EmptyState>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tool</TableHead>
                      <TableHead>Cleaner</TableHead>
                      <TableHead className="hidden md:table-cell">When</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {active.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <p className="font-medium">{r.tool.name}</p>
                          <p className="text-xs text-muted-foreground md:hidden">{formatRange(r.startsAt, r.endsAt)}</p>
                        </TableCell>
                        <TableCell>
                          <p>{r.cleaner.name}</p>
                          {r.phase === "OVERDUE" && r.cleaner.phone && (
                            <a href={`tel:${r.cleaner.phone}`} className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline">
                              <Phone className="size-3" aria-hidden /> {r.cleaner.phone}
                            </a>
                          )}
                        </TableCell>
                        <TableCell className="hidden text-sm md:table-cell">{formatRange(r.startsAt, r.endsAt)}</TableCell>
                        <TableCell>
                          <RentalBadge phase={r.phase} status={r.status} />
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {r.canReturn && (
                            <ActionButton size="sm" variant="outline" action={returnRentalAction.bind(null, r.id)}>
                              Check in
                            </ActionButton>
                          )}
                          {r.canCancel && (
                            <ActionButton
                              size="sm"
                              variant="ghost"
                              action={cancelRentalAction.bind(null, r.id)}
                              confirm={{
                                title: `Cancel ${firstName(r.cleaner.name)}'s reservation?`,
                                description: `${r.tool.name} becomes free again and ${formatMoney(r.feeCents)} is refunded to ${firstName(r.cleaner.name)}.`,
                                confirmLabel: "Cancel reservation",
                                destructive: true,
                              }}
                            >
                              Cancel
                            </ActionButton>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tools ({tools.length})</CardTitle>
              <CardDescription>A tool with open reservations can&apos;t go out for repair until they are checked in or cancelled.</CardDescription>
            </CardHeader>
            <CardContent>
              {tools.length === 0 ? (
                <EmptyState title="No tools yet">Add the library&apos;s first tool with the form.</EmptyState>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tool</TableHead>
                      <TableHead>Fee</TableHead>
                      <TableHead className="hidden md:table-cell">Now</TableHead>
                      <TableHead className="w-44">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tools.map((tool) => (
                      <TableRow key={tool.id} className={tool.status === "RETIRED" ? "text-muted-foreground" : undefined}>
                        <TableCell className="max-w-64">
                          <p className="font-medium">{tool.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {TOOL_TYPE_LABEL[tool.type]}
                            {tool.pendingCount > 0 && ` · ${tool.pendingCount} request${tool.pendingCount === 1 ? "" : "s"}`}
                          </p>
                          {tool.notes && <p className="mt-0.5 truncate text-xs text-muted-foreground">{tool.notes}</p>}
                        </TableCell>
                        <TableCell className="tabular-nums">{formatMoney(tool.feeCents)}</TableCell>
                        <TableCell className="hidden text-sm md:table-cell">
                          {tool.current ? (
                            <span className={tool.current.endsAt < new Date() ? "text-destructive" : undefined}>
                              With {firstName(tool.current.cleaner.name)} until {formatDateTime(tool.current.endsAt)}
                            </span>
                          ) : tool.next ? (
                            <span className="text-muted-foreground">
                              Free · next {firstName(tool.next.cleaner.name)}, {formatDateTime(tool.next.startsAt)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">{tool.status === "AVAILABLE" ? "Free" : "—"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ToolStatusSelect toolId={tool.id} status={tool.status} label={tool.name} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {closed.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Past week</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {closed.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <span>
                        <span className="font-medium">{r.tool.name}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {r.cleaner.name} · {formatRange(r.startsAt, r.endsAt)}
                        </span>
                      </span>
                      <RentalBadge phase="CLOSED" status={r.status} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Add a tool</CardTitle>
            <CardDescription>Cleaners can request it right away.</CardDescription>
          </CardHeader>
          <CardContent>
            <ToolForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
