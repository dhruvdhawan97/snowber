import Link from "next/link";
import { Suspense } from "react";
import { Camera, MapPinned, Users } from "lucide-react";
import { BrandLink } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/dal/session";

// Public landing page: prerendered at build time. Only the header buttons depend on
// the visitor (signed in or not), so they stream in behind <Suspense>.

const FEATURES = [
  {
    icon: Users,
    title: "Neighbors, not strangers",
    text: "Cleaners live within walking distance and post the hours they can work. Ratings go both ways.",
  },
  {
    icon: MapPinned,
    title: "Batched like a storm needs",
    text: "Pick the time windows that suit you. The controller groups nearby houses into short walking routes.",
  },
  {
    icon: Camera,
    title: "Photo proof, every time",
    text: "Before and after photos are required. You confirm the result, then your cleaner gets paid.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-4">
        <BrandLink className="text-lg" />
        <nav className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Suspense fallback={<GuestButtons />}>
            <HeaderButtons />
          </Suspense>
        </nav>
      </header>

      <main className="flex-1">
        <section className="bg-gradient-to-b from-secondary to-background">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 md:grid-cols-2 md:py-24">
            <div className="flex flex-col justify-center gap-5">
              <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Your neighbors clear your snow.</h1>
              <p className="text-lg text-muted-foreground">
                Book a driveway and sidewalk clearing for the morning after a storm. A cleaner from your neighborhood
                does it, sends before-and-after photos, and is paid when you confirm.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/sign-up?role=homeowner">I need snow cleared</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/sign-up?role=cleaner">I want to earn clearing snow</Link>
                </Button>
              </div>
            </div>
            <div className="grid gap-3 self-center rounded-2xl border bg-card p-6 shadow-sm">
              <p className="text-sm font-medium text-muted-foreground">Storm morning, Maple Hollow</p>
              {[
                ["6:00–8:00 a.m.", "14 driveways · 5 cleaners", "bg-primary"],
                ["8:00–10:00 a.m.", "11 driveways · 4 cleaners", "bg-sky-500"],
                ["10:00 a.m.–12:00 p.m.", "6 driveways · 3 cleaners", "bg-sky-300"],
              ].map(([time, detail, color]) => (
                <div key={time} className="flex items-center gap-3 rounded-lg border p-3">
                  <span className={`size-3 rounded-full ${color}`} aria-hidden />
                  <div>
                    <p className="font-medium">{time}</p>
                    <p className="text-sm text-muted-foreground">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-6 px-4 py-14 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border bg-card p-6">
              <Icon className="size-6 text-primary" aria-hidden />
              <h2 className="mt-3 font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        Snowber · ECE1724 course project, University of Toronto
      </footer>
    </div>
  );
}

function GuestButtons() {
  return (
    <>
      <Button asChild variant="ghost">
        <Link href="/sign-in">Sign in</Link>
      </Button>
      {/* The hero already has sign-up buttons; hide this one where space is tight. */}
      <Button asChild className="hidden sm:inline-flex">
        <Link href="/sign-up">Get started</Link>
      </Button>
    </>
  );
}

/** Signed-in visitors (e.g. after clicking the logo) get a way back to their app. */
async function HeaderButtons() {
  const user = await getCurrentUser();
  if (!user) return <GuestButtons />;
  return (
    <Button asChild>
      <Link href="/dashboard">Open my dashboard</Link>
    </Button>
  );
}
