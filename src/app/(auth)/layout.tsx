import { Camera, CheckCircle2, MapPinned, ShieldCheck } from "lucide-react";
import { BrandLink } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

const POINTS = [
  { icon: MapPinned, text: "Cleaners from your own neighbourhood, grouped into short walking routes." },
  { icon: Camera, text: "Before and after photos on every job." },
  { icon: ShieldCheck, text: "Cleaners are paid only after you confirm the result." },
  { icon: CheckCircle2, text: "20% off for seniors and people living with a disability." },
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-secondary to-background">
      <header className="mx-auto flex w-full max-w-6xl items-center px-4 py-4">
        <BrandLink className="text-lg" />
        <ThemeToggle className="ml-auto" />
      </header>
      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 pb-12 lg:grid-cols-2">
        <section className="hidden lg:block" aria-label="About Snowber">
          <h1 className="text-4xl font-bold tracking-tight">Your neighbours clear your snow.</h1>
          <p className="mt-3 max-w-md text-lg text-muted-foreground">
            One account for homeowners, cleaners and the operations controller.
          </p>
          <ul className="mt-8 grid max-w-md gap-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="pt-1.5">{text}</span>
              </li>
            ))}
          </ul>
        </section>
        <div className="mx-auto w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
