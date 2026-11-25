import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { Console } from "./console";

export const metadata: Metadata = {
  title: "Console",
  description: "Create API keys, try requests, watch usage, and test webhooks with a built-in inbox. No sign-up.",
};

export default function ConsolePage() {
  return (
    <>
      <SiteHeader current="console" />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6">
        <h1 className="font-serif text-4xl tracking-tight">Console</h1>
        <p className="mt-2 max-w-2xl text-muted">
          No sign-up: this browser has its own console, kept in a signed cookie. Keys and webhooks you create here belong to it.
        </p>
        <Console />
      </main>
    </>
  );
}
