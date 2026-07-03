/**
 * 기존 DB 데이터 전부 삭제 후 bootstrap-new-shop 재실행.
 * Usage: npm run db:reset-fresh
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { spawnSync } from "node:child_process";

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

function readSql(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

async function main() {
  loadEnvLocal();
  const conn =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL;
  if (!conn) {
    console.error("DATABASE_URL 이 .env.local 에 없습니다.");
    process.exit(1);
  }

  console.error("=== 1/2 DB 초기화 (데이터 전부 삭제) ===");
  const client = new pg.Client({ connectionString: conn });
  await client.connect();
  try {
    await client.query(readSql("supabase/reset_fresh_db.sql"));
    console.error("DB 초기화 완료.");
  } finally {
    await client.end();
  }

  console.error("\n=== 2/2 schema + migration 적용 ===");
  const r = spawnSync(process.execPath, ["scripts/bootstrap-new-shop.mjs"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  process.exit(r.status ?? 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
