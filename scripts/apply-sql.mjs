import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnvLocal() {
  const p = path.join(root, ".env.local");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function stripLineComments(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith("--");
    })
    .join("\n");
}

/** Naive split: OK for our migrations (no semicolons inside string literals). */
function splitStatements(sql) {
  return stripLineComments(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const rel = process.argv[2];
  if (!rel) {
    console.error("Usage: node scripts/apply-sql.mjs <path-to.sql>");
    process.exit(1);
  }

  loadEnvLocal();
  const conn =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL;
  if (!conn) {
    console.error(
      "Missing DATABASE_URL (or SUPABASE_DB_URL). Add the Postgres connection URI from Supabase → Project Settings → Database to .env.local."
    );
    process.exit(1);
  }

  const file = path.isAbsolute(rel) ? rel : path.join(root, rel);
  if (!fs.existsSync(file)) {
    console.error("File not found:", file);
    process.exit(1);
  }

  const sql = fs.readFileSync(file, "utf8");
  const statements = splitStatements(sql);
  const client = new pg.Client({ connectionString: conn });

  await client.connect();
  try {
    for (let i = 0; i < statements.length; i++) {
      const st = statements[i];
      await client.query(st);
      console.error(`OK ${i + 1}/${statements.length}`);
    }
  } finally {
    await client.end();
  }
  console.error("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
