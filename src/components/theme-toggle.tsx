"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

// Light / dark / system theme. The choice is stored in localStorage and applied by
// adding the `dark` class to <html>. THEME_SCRIPT (in the root layout) applies it
// before the page paints, so there's no white flash on dark mode.

export type ThemeChoice = "light" | "dark" | "system";
const STORAGE_KEY = "snowber-theme";
const ORDER: ThemeChoice[] = ["light", "dark", "system"];
const LABEL: Record<ThemeChoice, string> = { light: "Light", dark: "Dark", system: "System" };

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");var d=t==="dark"||((t===null||t==="system")&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}})()`;

const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Follow the operating system when the choice is "system".
  const media = matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => readChoice() === "system" && apply("system");
  media.addEventListener("change", onSystemChange);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onSystemChange);
  };
}

export function ThemeToggle({ className }: { className?: string }) {
  // "system" on the server; the real choice after hydration (no mismatch warning).
  const choice = useSyncExternalStore(subscribe, readChoice, () => "system" as ThemeChoice);
  const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
  const Icon = choice === "light" ? Sun : choice === "dark" ? Moon : Monitor;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className}
      title={`Theme: ${LABEL[choice]} (switch to ${LABEL[next].toLowerCase()})`}
      aria-label={`Theme: ${LABEL[choice]}. Switch to ${LABEL[next].toLowerCase()}.`}
      onClick={() => {
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // Private browsing: the theme still changes for this page view.
        }
        apply(next);
        listeners.forEach((l) => l());
      }}
    >
      <Icon aria-hidden />
    </Button>
  );
}
