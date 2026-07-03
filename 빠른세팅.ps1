# gold-ledger 독립 매장 — 빠른 세팅 (GitHub·Supabase·Vercel 전부 새로)
# Cursor 터미널에서:  .\빠른세팅.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "=== gold-ledger 빠른 세팅 ===" -ForegroundColor Cyan
Write-Host "폴더: $PSScriptRoot"
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js가 없습니다. https://nodejs.org LTS 설치 후 다시 실행하세요." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path ".env.local")) {
  Copy-Item "env.local.example.txt" ".env.local" -ErrorAction SilentlyContinue
  if (-not (Test-Path ".env.local")) {
    @"
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
DATABASE_URL=
"@ | Set-Content ".env.local" -Encoding UTF8
  }
}

$envContent = Get-Content ".env.local" -Raw
if ($envContent -match "NEXT_PUBLIC_SUPABASE_URL=\s*$" -or $envContent -notmatch "NEXT_PUBLIC_SUPABASE_URL=https://") {
  Write-Host "[1/4] .env.local 에 Supabase 키 3개를 먼저 넣으세요:" -ForegroundColor Yellow
  Write-Host "  - Project URL  (Settings → API)"
  Write-Host "  - anon key     (Settings → API)"
  Write-Host "  - DATABASE_URL (Settings → Database → URI, pooler 6543)"
  Write-Host ""
  Write-Host "  파일: $PSScriptRoot\.env.local"
  Write-Host ""
  Write-Host "Supabase 새 프로젝트: https://supabase.com/dashboard/new" -ForegroundColor Green
  notepad ".env.local"
  Write-Host "메모장에 붙여넣고 저장한 뒤, 이 스크립트를 다시 실행하세요."
  exit 0
}

Write-Host "[1/4] npm install ..." -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[2/4] DB bootstrap (schema + migration) ..." -ForegroundColor Cyan
npm run db:bootstrap-new-shop
if ($LASTEXITCODE -ne 0) {
  Write-Host "DB 실패 — Supabase SQL Editor에서 supabase/schema.sql 부터 수동 실행하세요." -ForegroundColor Red
  exit $LASTEXITCODE
}

Write-Host "[3/4] npm run build ..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[4/4] Git + Vercel (선택) ..." -ForegroundColor Cyan
if (-not (Test-Path ".git")) {
  git init
  git add .
  git commit -m "Initial standalone gold-ledger"
  git branch -M main
  Write-Host ""
  Write-Host "GitHub에서 New repository 만든 뒤:" -ForegroundColor Yellow
  Write-Host '  git remote add origin https://github.com/본인아이디/저장소.git'
  Write-Host "  git push -u origin main"
  Write-Host ""
}

if (Get-Command vercel -ErrorAction SilentlyContinue) {
  Write-Host "Vercel 배포: npx vercel --prod" -ForegroundColor Green
  Write-Host "(환경변수 NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 설정 필요)"
} else {
  Write-Host "Vercel: https://vercel.com → Import GitHub repo → 환경변수 2개 → Deploy" -ForegroundColor Green
}

Write-Host ""
Write-Host "완료. npm run dev 로 로컬 확인 → 배포 URL에서 회원가입 (첫 계정=관리자)" -ForegroundColor Green
