"use client";

import { useState } from "react";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <path d="M19 13h26v36l-4.33-3-4.34 3-4.33-3-4.33 3-4.34-3L19 49z" fill="var(--surface)" />
      <path d="M25 23h14M25 30h14M25 37h8" stroke="var(--accent)" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

export function ThemeToggle() {
  // The icon follows the .dark class through CSS, so nothing here depends on state at render.
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("tillread-api:theme", next ? "dark" : "light");
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="grid size-9 place-items-center rounded-full border border-line text-muted transition hover:border-line-strong hover:text-ink"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <g className="hidden dark:inline">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </g>
        <path className="dark:hidden" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
    </button>
  );
}

export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {}
      }}
      className={`rounded-md px-2 py-1 text-xs font-medium transition ${className}`}
      aria-live="polite"
    >
      {done ? "Copied" : label}
    </button>
  );
}
