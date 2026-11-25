import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { ApiReference } from "./reference";

export const metadata: Metadata = {
  title: "API reference",
  description: "Every endpoint, with request and response schemas, errors, rate limits, idempotency and webhook signing. Try requests in the page.",
};

export default function DocsPage() {
  return (
    <>
      <SiteHeader current="docs" />
      <main>
        <h1 className="sr-only">Tillread API reference</h1>
        <ApiReference />
      </main>
    </>
  );
}
