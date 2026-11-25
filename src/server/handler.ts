import { after } from "next/server";
import { createApp } from "./app";
import { getDb } from "./db";
import { sha256 } from "./util";

let app: ReturnType<typeof createApp> | undefined;

/** One Hono app serves /v1/*, /api/* and /openapi.json; Next's `after` runs deferred work. */
export function handle(req: Request) {
  app ??= createApp({
    db: getDb,
    defer: (task) =>
      after(() =>
        task().catch((e) => console.log(JSON.stringify({ level: "error", where: "deferred", error: String(e) }))),
      ),
    allowInsecureWebhooks: process.env.NODE_ENV !== "production" || process.env.ALLOW_INSECURE_WEBHOOKS === "1",
    cronSecret: process.env.CRON_SECRET,
    // Signs console cookies. Derived from the database URL unless set, so there's one less secret to configure.
    consoleSecret: process.env.CONSOLE_SECRET ?? sha256(`console:${process.env.DATABASE_URL ?? "development"}`),
  });
  return app.fetch(req);
}
