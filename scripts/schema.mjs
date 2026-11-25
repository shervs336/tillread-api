// db/schema.sql is the source (paste it into the Supabase SQL editor). This copies it into a TS
// module so the server bundle can create the same tables in PGlite without reading files at runtime.
import { readFileSync, writeFileSync } from "node:fs";

const sql = readFileSync("db/schema.sql", "utf8");
writeFileSync("src/server/schema-sql.ts", `// Generated from db/schema.sql by scripts/schema.mjs. Don't edit.\nexport const SCHEMA_SQL = ${JSON.stringify(sql)};\n`);
console.log("Wrote src/server/schema-sql.ts");
