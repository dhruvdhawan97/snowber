import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { THEME_SCRIPT } from "@/components/theme-toggle";
import { Toaster } from "@/components/ui/misc";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Snowber — neighbors clearing neighborhood snow", template: "%s · Snowber" },
  description: "Book a neighbor to clear your driveway and sidewalk after a snowfall, with photo proof.",
};

export const viewport: Viewport = {
  themeColor: "#1f4f8f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: THEME_SCRIPT adds the "dark" class before React loads.
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
