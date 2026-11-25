"use client";

import { useEffect, useRef, useState } from "react";

// Scalar renders the reference from /openapi.json, so the docs always match the deployed routes.
const SCALAR = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.76.4/dist/browser/standalone.js";

declare global {
  interface Window {
    Scalar?: { createApiReference: (el: HTMLElement, config: Record<string, unknown>) => { destroy?: () => void } };
  }
}

export function ApiReference() {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let instance: { destroy?: () => void } | undefined;
    const mount = () => {
      if (!ref.current || !window.Scalar) return;
      instance = window.Scalar.createApiReference(ref.current, {
        url: "/openapi.json",
        darkMode: document.documentElement.classList.contains("dark"),
        hideDownloadButton: false,
        hideClientButton: true,
        withDefaultFonts: false,
        servers: [{ url: window.location.origin, description: "This site" }],
        authentication: { preferredSecurityScheme: "bearerAuth" },
        defaultHttpClient: { targetKey: "shell", clientKey: "curl" },
        customCss: `.scalar-app { --scalar-font: var(--font-geist-sans), system-ui, sans-serif; --scalar-font-code: var(--font-geist-mono), monospace; --scalar-color-accent: var(--accent); }`,
      });
    };
    if (window.Scalar) mount();
    else {
      const s = document.createElement("script");
      s.src = SCALAR;
      s.async = true;
      s.onload = mount;
      s.onerror = () => setFailed(true);
      document.head.appendChild(s);
    }
    return () => instance?.destroy?.();
  }, []);
  return (
    <>
      {failed && (
        <p className="mx-auto max-w-3xl px-4 py-10 text-muted">
          The interactive reference couldn&apos;t load. The raw spec is at{" "}
          <a className="underline" href="/openapi.json">
            /openapi.json
          </a>
          .
        </p>
      )}
      <div ref={ref} className="min-h-[80vh]" />
    </>
  );
}
