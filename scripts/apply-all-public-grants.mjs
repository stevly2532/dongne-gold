import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i === -1) continue;
  const key = line.slice(0, i).trim();
  if (!process.env[key]) process.env[key] = line.slice(i + 1).trim();
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(
  "select tablename from pg_tables where schemaname = 'public' order by tablename",
);

const lines = ["-- Grants for all public tables (run after bootstrap / reset)", ""];
for (const { tablename } of rows) {
  lines.push(
    `grant select, insert, update, delete on table public.${tablename} to authenticated;`,
  );
  lines.push(`grant all on table public.${tablename} to service_role;`);
}
lines.push(
  "grant usage, select on all sequences in schema public to authenticated, service_role;",
);

for (const line of lines) {
  if (!line.startsWith("grant")) continue;
  await client.query(line);
}

fs.writeFileSync(
  path.join(root, "supabase/migration_all_public_grants.sql"),
  `${lines.join("\n")}\n`,
  "utf8",
);

console.error(`Granted ${rows.length} tables.`);
await client.end();
