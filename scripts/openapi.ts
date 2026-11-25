// Writes openapi.json from the route definitions (the source of truth), for the SDK and for review.
import { writeFileSync } from "node:fs";
import { createApp } from "../src/server/app";

const app = createApp({ db: () => Promise.reject(new Error("not needed")), defer: () => {}, consoleSecret: "x", log: () => {} });
writeFileSync("openapi.json", JSON.stringify(app.spec(), null, 2) + "\n");
console.log("Wrote openapi.json");
