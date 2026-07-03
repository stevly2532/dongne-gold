/**
 * 친구에게 넘길 **완전 독립** 소스 복사본 생성.
 * - .git / .vercel / .env / node_modules 제거
 * - 당신 GitHub·Vercel URL 하드코딩 제거·치환
 * - 출력 폴더는 새 git 이력으로 시작 (친구 전용 저장소)
 *
 * Usage: npm run export:independent-copy
 *        node scripts/export-independent-copy.mjs [출력폴더경로]
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const SKIP_DIRS = new Set([
  ".git",
  ".vercel",
  ".next",
  "node_modules",
  "out",
  "coverage",
  ".cursor",
  "agent-transcripts",
  "_export-test",
]);

const SKIP_FILES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
]);

function defaultOutDir() {
  const stamp = new Date().toISOString().slice(0, 10);
  return path.join(root, "..", `gold-ledger-standalone-${stamp}`);
}

function shouldSkip(rel, outDirAbs) {
  const parts = rel.split(/[/\\]/);
  if (parts.some((p) => SKIP_DIRS.has(p))) return true;
  const base = parts[parts.length - 1];
  if (SKIP_FILES.has(base)) return true;
  if (base.startsWith(".env.")) return true;
  if (outDirAbs && path.resolve(root, rel) === outDirAbs) return true;
  if (outDirAbs && path.resolve(root, rel).startsWith(outDirAbs + path.sep)) return true;
  return false;
}

function copyTree(src, dest, rel, outDirAbs) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const ent of entries) {
    const name = ent.name;
    const relPath = rel ? `${rel}/${name}` : name;
    if (shouldSkip(relPath, outDirAbs)) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    if (ent.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyTree(from, to, relPath, outDirAbs);
    } else if (ent.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
}

/** 독립 인스턴스에 남으면 안 되는 문자열 치환 */
function patchFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) return;
  let text = fs.readFileSync(filePath, "utf8");
  let changed = false;
  for (const [from, to] of replacements) {
    if (text.includes(from)) {
      text = text.split(from).join(to);
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(filePath, text, "utf8");
}

function patchAll(out) {
  const ingestPlaceholder =
    "https://YOUR-SITE.vercel.app/api/korean-gold-prices/ingest";
  const sitePlaceholder = "https://YOUR-SITE.vercel.app";

  const files = [
    ".github/workflows/sync-korean-gold-quotes.yml",
    "scripts/push-korean-gold-quote-ingest.mjs",
    "scripts/korean-gold-background-sync.mjs",
    "scripts/local-korean-gold-proxy.mjs",
    "src/lib/goldgoldKgsQuotes.ts",
    "src/lib/koreanGoldQuotePublicSources.ts",
    "cloudflare/korean-gold-proxy/src/worker.js",
  ];

  const urlPatches = [
    ["https://gold-ledger-a9z6.vercel.app", sitePlaceholder],
    [
      "https://raw.githubusercontent.com/dngb1283-hub/gold-ledger/master/public/korean-gold-quote-fallback.json",
      `${sitePlaceholder}/korean-gold-quote-fallback.json`,
    ],
    ["dngb1283-hub/gold-ledger", "YOUR-GITHUB-USER/YOUR-REPO"],
    ["prj_Daz65Csc93hXyA0ZNbGdSly8TBEb", "YOUR_VERCEL_PROJECT_ID"],
  ];

  for (const rel of files) {
    patchFile(path.join(out, rel), urlPatches);
  }

  const workflow = path.join(out, ".github/workflows/sync-korean-gold-quotes.yml");
  if (fs.existsSync(workflow)) {
    let w = fs.readFileSync(workflow, "utf8");
    w = w.replace(
      /KOREAN_GOLD_INGEST_URL:\s*https:\/\/[^\s]+/,
      "KOREAN_GOLD_INGEST_URL: ${{ secrets.KOREAN_GOLD_INGEST_URL }}",
    );
    fs.writeFileSync(workflow, w, "utf8");
  }

  for (const rel of [
    "scripts/push-korean-gold-quote-ingest.mjs",
    "scripts/korean-gold-background-sync.mjs",
  ]) {
    const p = path.join(out, rel);
    if (!fs.existsSync(p)) continue;
    let t = fs.readFileSync(p, "utf8");
    t = t.replace(
      /const DEFAULT_INGEST_URL\s*=\s*[\s\S]*?;\s*\n/,
      "",
    );
    t = t.replace(
      /process\.env\.KOREAN_GOLD_INGEST_URL \|\| DEFAULT_INGEST_URL/,
      "process.env.KOREAN_GOLD_INGEST_URL?.trim()",
    );
    if (!t.includes("KOREAN_GOLD_INGEST_URL 필요")) {
      t = t.replace(
        /if \(!secret\?\.trim\(\)\) \{/,
        `const ingestUrl = process.env.KOREAN_GOLD_INGEST_URL?.trim();\n  if (!ingestUrl) {\n    console.error("KOREAN_GOLD_INGEST_URL 필요");\n    process.exit(1);\n  }\n  if (!secret?.trim()) {`,
      );
      t = t.replace(
        /const ingestUrl = process\.env\.KOREAN_GOLD_INGEST_URL\?\.trim\(\);\s*\n\s*if \(!secret/,
        `const ingestUrl = process.env.KOREAN_GOLD_INGEST_URL?.trim();\n  if (!ingestUrl) {\n    console.error("KOREAN_GOLD_INGEST_URL 필요");\n    process.exit(1);\n  }\n  if (!secret`,
      );
    }
    fs.writeFileSync(p, t, "utf8");
  }

  const agents = path.join(out, "AGENTS.md");
  if (fs.existsSync(agents)) {
    fs.writeFileSync(
      agents,
      `# gold-ledger (독립 매장 인스턴스)

이 복사본은 **다른 사업장 전용**입니다. 원본 운영자의 GitHub·Supabase·Vercel 과 **연결되지 않습니다**.

## 시작

1. \`docs/SETUP_NEW_SHOP.md\` 를 처음부터 끝까지 따르세요.
2. Cursor Agent: *「SETUP_NEW_SHOP.md 따라 완전 새로 세팅해줘」*

## 스택

Next.js 16 · Supabase · Vercel · Tailwind v4

## 로컬

\`\`\`powershell
npm install
npm run dev
\`\`\`

## DB 초기화

\`\`\`powershell
npm run db:bootstrap-new-shop
\`\`\`

프로덕션 URL·Supabase projectId 는 **본인 Vercel/Supabase 대시보드**에서 확인하세요.
`,
      "utf8",
    );
  }

  patchFile(path.join(out, "docs/SETUP_NEW_SHOP.md"), [
    [
      "저장소 URL: `https://github.com/dngb1283-hub/gold-ledger`",
      "저장소: **본인 GitHub 계정**에 새로 만든 저장소만 사용",
    ],
  ]);
}

function writeStandaloneReadme(out) {
  const p = path.join(out, "README_STANDALONE.md");
  fs.writeFileSync(
    p,
    `# 동네금빵 — 독립 매장용 복사본

이 폴더는 **한 번만 전달받은 소스**입니다. 원본 운영자와 Git·DB·배포가 **전혀 겹치지 않습니다**.

## 바로 할 일

1. Cursor로 이 폴더 열기
2. \`docs/SETUP_NEW_SHOP.md\` 실행
3. 끝나면 **본인 GitHub**에 새 저장소 만들고 \`git init\` → push

## 절대 하지 말 것

- 원본 GitHub clone / fork / collaborator 참여
- 원본 Supabase·Vercel URL·API 키 사용
- \`.vercel\` 폴더를 원본에서 복사

자세한 내용: \`docs/SETUP_NEW_SHOP.md\`
`,
    "utf8",
  );
}

function tryZip(outDir) {
  const zipPath = `${outDir}.zip`;
  try {
    if (process.platform === "win32") {
      execSync(
        `powershell -NoProfile -Command "Compress-Archive -Path '${outDir.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force"`,
        { stdio: "inherit" },
      );
      console.error(`ZIP: ${zipPath}`);
    }
  } catch {
    console.error("(ZIP 생략 — 폴더만 사용)");
  }
}

async function main() {
  const outDir = path.resolve(process.argv[2] || defaultOutDir());
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  console.error(`Copying → ${outDir}`);
  copyTree(root, outDir, "", outDir);
  patchAll(outDir);
  writeStandaloneReadme(outDir);

  console.error("\n완료. 친구에게 전달:");
  console.error(`  폴더: ${outDir}`);
  console.error("  또는 ZIP (생성된 경우)");
  console.error("\n친구는 README_STANDALONE.md → docs/SETUP_NEW_SHOP.md 순서로 진행");
  console.error("당신 repo URL·키·.vercel 은 포함되지 않았는지 확인 후 전달하세요.");

  tryZip(outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
