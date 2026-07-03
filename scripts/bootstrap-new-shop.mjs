/**
 * 새 매장(친구·별도 사업장)용 Supabase DB 초기화.
 * schema.sql + 모든 migration_*.sql 을 순서대로 적용합니다.
 *
 * Usage:
 *   1) .env.local 에 DATABASE_URL (Supabase → Database → Connection string URI) 설정
 *   2) npm run db:bootstrap-new-shop
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

/** Fresh DB bootstrap order. clear_all_purchases.sql / schema_inventory.sql 은 제외. */
const SQL_FILES = [
  "supabase/schema.sql",
  "supabase/setup_inventory_items.sql",
  "supabase/migration_purchase_gold.sql",
  "supabase/migration_purchase_audit.sql",
  "supabase/migration_jongro_daily_quotes.sql",
  "supabase/migration_jongro_quote_scope.sql",
  "supabase/migration_daily_purchase_prices.sql",
  "supabase/migration_inventory_sales_columns.sql",
  "supabase/migration_inventory_product_name.sql",
  "supabase/migration_inventory_fulfillment_status.sql",
  "supabase/migration_inventory_received_shipped_notes.sql",
  "supabase/migration_inventory_jongro_quote_override.sql",
  "supabase/migration_inventory_sales_gold_price_per_don.sql",
  "supabase/migration_inventory_deposit_won.sql",
  "supabase/migration_inventory_audit_log.sql",
  "supabase/migration_branch_vault_snapshots.sql",
  "supabase/migration_branch_daily_closings.sql",
  "supabase/migration_branch_daily_closings_vault_misc.sql",
  "supabase/migration_product_labor_fees.sql",
  "supabase/migration_product_labor_fees_vendor.sql",
  "supabase/migration_product_labor_fees_category_weight.sql",
  "supabase/migration_product_labor_fees_client.sql",
  "supabase/migration_product_labor_fees_created_at.sql",
  "supabase/migration_product_labor_fees_image.sql",
  "supabase/migration_as_ledgers.sql",
  "supabase/migration_arrival_sms_log.sql",
  "supabase/migration_arrival_sms_sent_at.sql",
  "supabase/migration_tongsang_daily_entries.sql",
  "supabase/migration_tongsang_captured_pure_don.sql",
  "supabase/migration_tongsang_captured_don_per_karat.sql",
  "supabase/migration_korean_gold_quote_cache.sql",
  "supabase/migration_profiles_email.sql",
  "supabase/migration_knk_dau_to_gita_vendor.sql",
  "supabase/migration_knk_product_code_earring_suffix.sql",
];

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

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readSqlFile(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing SQL file: ${rel}`);
  }
  const buf = fs.readFileSync(file);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return stripBom(buf.slice(2).toString("utf16le"));
  }
  if (buf.length >= 4 && buf[1] === 0x00 && buf[3] === 0x00) {
    return stripBom(buf.toString("utf16le"));
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString("utf8");
  }
  return stripBom(buf.toString("utf8"));
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

function splitStatements(sql) {
  return stripLineComments(sql)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  loadEnvLocal();
  const conn =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.POSTGRES_URL;
  if (!conn) {
    console.error(
      "DATABASE_URL 이 없습니다. Supabase → Project Settings → Database → URI 를 .env.local 에 넣으세요."
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: conn });
  await client.connect();

  try {
    for (const rel of SQL_FILES) {
      console.error(`\n=== ${rel} ===`);
      const sql = readSqlFile(rel);
      await client.query(sql);
      console.error("  OK (whole file)");
    }
  } finally {
    await client.end();
  }

  console.error("\nBootstrap complete. Next:");
  console.error("  1) Supabase → Authentication → Users 에 첫 관리자 계정 추가");
  console.error("  2) 첫 계정은 자동으로 role=admin (profiles 비어 있을 때)");
  console.error("  3) 로그인 후 지점 관리에서 매장 이름 등록");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
