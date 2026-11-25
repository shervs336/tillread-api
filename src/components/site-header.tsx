import Link from "next/link";
import { Logo, ThemeToggle } from "./ui";

export const GITHUB = "https://github.com/shervs336/tillread-api";

export function SiteHeader({ current }: { current?: "docs" | "console" }) {
  const link = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 transition ${active ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}
    >
      {label}
    </Link>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Logo className="size-6" />
          Tillread <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] font-medium text-accent">API</span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          {link("/docs", "Docs", current === "docs")}
          {link("/console", "Console", current === "console")}
          <a href={GITHUB} className="hidden rounded-md px-3 py-1.5 text-muted transition hover:text-ink sm:block">
            GitHub
          </a>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
