/**
 * One-off: apply Toss design tokens across page components.
 * Run: node scripts/apply-toss-ui.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..", "src");

const REPLACEMENTS = [
  [
    /rounded-xl border border-stone-200 bg-white shadow-sm/g,
    "toss-card",
  ],
  [
    /rounded-xl border border-stone-200 bg-white/g,
    "toss-card",
  ],
  [
    /rounded-lg border border-stone-200 bg-white shadow-sm/g,
    "toss-card-sm",
  ],
  [
    /rounded-lg border border-stone-200 bg-white/g,
    "toss-card-sm",
  ],
  [
    /border border-stone-200 bg-white\/90 backdrop-blur/g,
    "toss-nav",
  ],
  [
    /bg-stone-50\/40/g,
    "bg-gray-100/70 dark:bg-gray-800/35",
  ],
  [
    /bg-stone-50\/70/g,
    "bg-gray-100/80 dark:bg-gray-800/50",
  ],
  [
    /bg-stone-50\/80/g,
    "bg-gray-100/80 dark:bg-gray-800/40",
  ],
  [
    /bg-stone-50(?![\/\w])/g,
    "bg-gray-50 dark:bg-gray-800/60",
  ],
  [
    /border-stone-200/g,
    "border-[var(--border)]",
  ],
  [
    /border-stone-100/g,
    "border-[var(--border)]",
  ],
  [
    /border-stone-300/g,
    "border-[var(--border)]",
  ],
  [
    /text-stone-900/g,
    "text-[var(--foreground)]",
  ],
  [
    /text-stone-800/g,
    "text-[var(--foreground)]",
  ],
  [
    /text-stone-700/g,
    "text-[var(--foreground)]",
  ],
  [
    /text-stone-600/g,
    "text-[var(--muted)]",
  ],
  [
    /text-stone-500/g,
    "text-[var(--muted)]",
  ],
  [
    /text-stone-400/g,
    "text-[var(--muted)]",
  ],
  [
    /bg-white(?![\/\w-])/g,
    "bg-[var(--card)]",
  ],
  [
    /text-2xl font-bold tabular-nums tracking-tight text-amber-950 lg:text-\[28px\]/g,
    "toss-stat-lg gold-accent",
  ],
  [
    /text-2xl font-bold tabular-nums/g,
    "toss-stat tabular-nums",
  ],
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(tsx|ts|css)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const skip = new Set([
  path.normalize(path.join(ROOT, "app", "globals.css")),
  path.normalize(path.join(ROOT, "components", "AppNav.tsx")),
  path.normalize(path.join(ROOT, "components", "PurchaseLedgersChrome.tsx")),
  path.normalize(path.join(ROOT, "app", "login", "LoginForm.tsx")),
]);

let changed = 0;
for (const file of walk(ROOT)) {
  if (skip.has(path.normalize(file))) continue;
  let src = fs.readFileSync(file, "utf8");
  const before = src;
  for (const [re, rep] of REPLACEMENTS) {
    src = src.replace(re, rep);
  }
  if (src !== before) {
    fs.writeFileSync(file, src);
    changed++;
    console.log("updated", path.relative(ROOT, file));
  }
}
console.log(`Done. ${changed} files updated.`);
