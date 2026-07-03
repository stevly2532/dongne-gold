/**
 * GitHub Actions: fallback JSON 갱신 후 변경분만 커밋·푸시 → Vercel 재배포.
 * Supabase Secrets 없이 고객화면 시세 자동 갱신.
 */

import { execSync } from "node:child_process";

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

try {
  runCapture("git diff --quiet public/korean-gold-quote-fallback.json");
  console.log("[commit-quote-fallback] no change — skip commit");
} catch {
  run("git add public/korean-gold-quote-fallback.json");
  const quoteAt = runCapture(
    "node -e \"const j=require('./public/korean-gold-quote-fallback.json');process.stdout.write(j.quoteAt||'')\"",
  );
  const pure = runCapture(
    "node -e \"const j=require('./public/korean-gold-quote-fallback.json');process.stdout.write(String(j.rows?.pure?.sell??''))\"",
  );
  const msg = `chore: 고객화면 시세 갱신 ${quoteAt} 순금 ${pure}`;
  run(`git commit -m "${msg.replace(/"/g, '\\"')}"`);
  run("git push");
  console.log("[commit-quote-fallback] pushed", quoteAt);
}
