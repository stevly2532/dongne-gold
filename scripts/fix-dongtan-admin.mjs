import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
const envPath = path.join(root, "..", ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i === -1) continue;
  const key = line.slice(0, i).trim();
  if (!process.env[key]) process.env[key] = line.slice(i + 1).trim();
}

const branchName = "동탄점";
const adminEmail = "dngbb1221@naver.com";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const userRes = await client.query(
  "select id from auth.users where lower(email) = lower($1) limit 1",
  [adminEmail],
);
if (!userRes.rows.length) {
  console.error("user not found:", adminEmail);
  process.exit(1);
}
const userId = userRes.rows[0].id;

let branchId;
const existing = await client.query(
  "select id from public.branches where name = $1 limit 1",
  [branchName],
);
if (existing.rows.length) {
  branchId = existing.rows[0].id;
} else {
  const renamed = await client.query(
    "update public.branches set name = $1 where name = $2 returning id",
    [branchName, "동네금빵"],
  );
  if (renamed.rows.length) {
    branchId = renamed.rows[0].id;
  } else {
    const ins = await client.query(
      "insert into public.branches (name) values ($1) returning id",
      [branchName],
    );
    branchId = ins.rows[0].id;
  }
}

await client.query(
  `insert into public.profiles (id, role, branch_id, full_name)
   values ($1, 'admin', $2, '관리자')
   on conflict (id) do update set role = 'admin', branch_id = $2, full_name = coalesce(public.profiles.full_name, '관리자')`,
  [userId, branchId],
);

const check = await client.query(
  `select u.email, p.role, p.branch_id, b.name as branch_name, p.full_name
   from auth.users u
   join public.profiles p on p.id = u.id
   join public.branches b on b.id = p.branch_id
   where u.id = $1`,
  [userId],
);
console.error(JSON.stringify(check.rows[0], null, 2));
await client.end();
