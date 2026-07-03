# gold-ledger — 최대 자동 세팅 (키 3개만 붙여넣으면 됨)
# Cursor 터미널:  .\나대신해줘.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

Refresh-Path

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  gold-ledger 자동 세팅" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js 설치 중..." -ForegroundColor Yellow
  winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  Refresh-Path
}

Write-Host "[준비] npm install 확인..." -ForegroundColor Gray
if (-not (Test-Path "node_modules")) { npm install }

# --- Supabase 키 입력 (유일하게 사람이 할 일) ---
Write-Host ""
Write-Host ">>> 지금 Supabase 페이지가 열립니다 <<<" -ForegroundColor Yellow
Write-Host "    1) 로그인 (없으면 가입 — 무료)"
Write-Host "    2) New project 클릭"
Write-Host "    3) 이름 아무거나, 비밀번호 적어두기, Region: Northeast Asia (Seoul)"
Write-Host "    4) Create project (1~2분 대기)"
Write-Host "    5) 왼쪽 Settings -> API 에서 URL, anon key 복사"
Write-Host "    6) Settings -> Database -> Connection string -> URI 복사"
Write-Host ""
Start-Process "https://supabase.com/dashboard/new?projectName=gold-ledger"

Start-Sleep -Seconds 2

$url = Read-Host "① Project URL 붙여넣기 (https://xxxx.supabase.co)"
$anon = Read-Host "② anon public key 붙여넣기 (eyJ...)"
$db = Read-Host "③ DATABASE_URL 붙여넣기 (postgresql://postgres...)"

if ($url -notmatch "supabase\.co") { Write-Host "URL 형식이 이상합니다." -ForegroundColor Red; exit 1 }
if ($anon.Length -lt 20) { Write-Host "anon key가 너무 짧습니다." -ForegroundColor Red; exit 1 }
if ($db -notmatch "postgresql") { Write-Host "DATABASE_URL 형식이 이상합니다." -ForegroundColor Red; exit 1 }

@"
NEXT_PUBLIC_SUPABASE_URL=$url
NEXT_PUBLIC_SUPABASE_ANON_KEY=$anon
DATABASE_URL=$db
"@ | Set-Content ".env.local" -Encoding UTF8 -NoNewline
Add-Content ".env.local" ""

Write-Host ""
Write-Host "[1/3] DB 만들기 (schema + migration)..." -ForegroundColor Cyan
npm run db:bootstrap-new-shop
if ($LASTEXITCODE -ne 0) { Write-Host "DB 실패 — 키/비밀번호 다시 확인하세요." -ForegroundColor Red; exit 1 }

Write-Host "[2/3] 빌드 확인..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "[3/3] Git 준비..." -ForegroundColor Cyan
if (-not (Test-Path ".git")) {
  git init
  git add .
  git commit -m "Initial standalone gold-ledger"
  git branch -M main
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  로컬 DB + 빌드 완료!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "로컬 확인:  npm run dev  ->  http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "--- 배포 (마지막 2분) ---" -ForegroundColor Yellow
Write-Host "GitHub 새 repo 페이지를 엽니다..."
Start-Process "https://github.com/new?name=gold-ledger&visibility=private"
Write-Host ""
Write-Host "GitHub에서 Create repository 한 뒤, 아래 한 줄만 실행 (URL은 본인 repo로):" -ForegroundColor Yellow
Write-Host '  git remote add origin https://github.com/본인아이디/gold-ledger.git' -ForegroundColor White
Write-Host '  git push -u origin main' -ForegroundColor White
Write-Host ""
Write-Host "Vercel 배포 페이지를 엽니다..."
Start-Process "https://vercel.com/new"
Write-Host "  -> Import GitHub repo -> Environment Variables 2개 추가:" -ForegroundColor Yellow
Write-Host "     NEXT_PUBLIC_SUPABASE_URL = (위에서 쓴 URL)"
Write-Host "     NEXT_PUBLIC_SUPABASE_ANON_KEY = (위에서 쓴 anon key)"
Write-Host "  -> Deploy"
Write-Host ""
Write-Host "배포 URL에서 회원가입 = 첫 계정이 관리자입니다." -ForegroundColor Green
