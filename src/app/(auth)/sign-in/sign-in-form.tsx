"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Home, Loader2, MapPinned, Shovel } from "lucide-react";
import { Field, useIsClient } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Alert, AlertDescription } from "@/components/ui/misc";
import { authClient } from "@/lib/auth-client";
import { DEMO_LOGINS_ENABLED } from "@/lib/config";

// Seeded demo accounts (see prisma/seed.ts). The quick-fill buttons are the
// development "role switcher"; set NEXT_PUBLIC_DEMO_LOGINS=false to hide them.
const DEMO_ACCOUNTS = [
  { icon: Home, role: "Homeowner", name: "Olivia", email: "olivia.home@snowber.test", blurb: "Start here: a saved home, nothing booked yet" },
  { icon: Home, role: "Homeowner", name: "Grace", email: "grace.home@snowber.test", blurb: "A job to confirm and a booking for tomorrow" },
  { icon: Shovel, role: "Cleaner", name: "Ava", email: "ava.cleaner@snowber.test", blurb: "Assigned stops, before/after photos, earnings" },
  { icon: Shovel, role: "Cleaner", name: "Ben", email: "ben.cleaner@snowber.test", blurb: "A job in progress with the before photo taken" },
  { icon: MapPinned, role: "Controller", name: "Morgan", email: "controller@snowber.test", blurb: "Dispatch, time slots, discounts and disputes", wide: true },
];
const DEMO_PASSWORD = "snowber-demo";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [demoEmail, setDemoEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Until React hydrates, a click would trigger a plain HTML form submit; keep the button disabled.
  const hydrated = useIsClient();

  const signIn = (creds: { email: string; password: string }) =>
    startTransition(async () => {
      setError(null);
      setDemoEmail(creds.password === DEMO_PASSWORD ? creds.email : null);
      const { error } = await authClient.signIn.email(creds);
      if (error) {
        setError(error.message ?? "Those details don't match an account.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Welcome back</CardTitle>
        <CardDescription>Sign in to book a clearing, see your route or run dispatch.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            signIn({ email, password });
          }}
        >
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <PasswordInput
              id="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" size="lg" disabled={pending || !hydrated}>
            {pending && !demoEmail && <Loader2 className="animate-spin" aria-hidden />}
            Sign in
          </Button>
        </form>

        {DEMO_LOGINS_ENABLED && (
          <div className="mt-6">
            <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or try a demo account
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {DEMO_ACCOUNTS.map(({ icon: Icon, wide, ...account }) => (
                <button
                  key={account.email}
                  type="button"
                  disabled={pending || !hydrated}
                  onClick={() => signIn({ email: account.email, password: DEMO_PASSWORD })}
                  className={`flex items-start gap-3 rounded-lg border${wide ? " sm:col-span-2" : ""} bg-background p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent disabled:opacity-60`}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    {pending && demoEmail === account.email ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Icon className="size-4" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {account.role} · {account.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">{account.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">All demo accounts use the password &ldquo;{DEMO_PASSWORD}&rdquo;.</p>
          </div>
        )}
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        New here?&nbsp;
        <Link href="/sign-up" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </CardFooter>
    </Card>
  );
}
