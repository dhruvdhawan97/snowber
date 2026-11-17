import Link from "next/link";
import { Snowflake } from "lucide-react";
import { cn } from "@/lib/utils";

/** The Snowber logo. Always links to the home page, on every screen. */
export function BrandLink({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <Link href="/" aria-label="Snowber home" className={cn("flex items-center gap-2 font-semibold text-primary", className)}>
      <Snowflake className="size-5" aria-hidden />
      <span>Snowber</span>
      {children}
    </Link>
  );
}
