# 독립 매장 세팅 (친구용) — **아무것도 겹치면 안 됨**

이 문서는 **전달받은 독립 복사본**(`README_STANDALONE.md` 참고) 기준입니다.

원본 운영자의 GitHub · Supabase · Vercel · 로그인 · 데이터와 **연결되면 안 됩니다.**  
**Clone, Fork, Collaborator, 같은 DB, 같은 배포 URL — 전부 금지.**

---

## 원칙

```
[원본 운영자]  자기 GitHub + 자기 Supabase + 자기 Vercel  (건드리지 않음)
[당신]         새 GitHub + 새 Supabase + 새 Vercel        (전부 새로)
```

코드 **기능**만 같고, **인프라·계정·저장소·이력은 0% 공유.**

---

## 절대 하지 말 것

| 금지 | 이유 |
|------|------|
| 원본 GitHub에서 clone / fork | 저장소·이력·권한이 연결됨 |
| 원본 Supabase URL·API 키 | 데이터가 같은 DB |
| 원본 Vercel URL·`.vercel` 폴더 | 같은 사이트에 배포됨 |
| 원본 `.env.local` 복사 | 키·DB가 겹침 |
| 원본 계정으로 로그인 테스트 | — |

**전달받은 ZIP/폴더만** 사용하세요.

---

## 사전 준비

| 항목 | 비고 |
|------|------|
| **본인** GitHub 계정 | 새 저장소 생성용 |
| **본인** Supabase | 새 프로젝트 |
| **본인** Vercel | 새 프로젝트 |
| Node.js 20+ | |
| Cursor Pro | Agent로 단계 실행 가능 |

---

## 1단계 — 복사본 열기

1. 전달받은 `gold-ledger-standalone-*` 폴더를 PC에 풀기
2. **Cursor → Open Folder** 로 그 폴더만 열기
3. 터미널:

```powershell
cd 경로\gold-ledger-standalone-...
npm install
```

> Agent 예시: *「`docs/SETUP_NEW_SHOP.md` 따라 완전 새 인스턴스 세팅해줘. 원본 GitHub/Supabase/Vercel 은 절대 쓰지 마」*

---

## 2단계 — 본인 GitHub (새 저장소)

원본 repo 와 **무관한** 새 저장소입니다.

1. GitHub → **New repository** (예: `my-gold-ledger`, Private 권장)
2. 로컬에서 **새 git 이력** 시작:

```powershell
git init
git add .
git commit -m "Initial standalone gold-ledger"
git branch -M main
git remote add origin https://github.com/본인아이디/my-gold-ledger.git
git push -u origin main
```

`.git` 이 이미 있으면 `git remote -v` 로 **원본 URL이 아닌지** 확인하세요. 원본이면 `.git` 삭제 후 위를 다시 실행.

---

## 3단계 — 본인 Supabase (새 프로젝트)

1. [supabase.com](https://supabase.com) → **New project**
2. 리전: **Northeast Asia (Seoul)** 권장

**Project Settings → API**

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (Git·공유 금지)

**Project Settings → Database → URI** → `DATABASE_URL` (bootstrap용)

---

## 4단계 — `.env.local` (본인 키만)

```env
NEXT_PUBLIC_SUPABASE_URL=https://본인프로젝트.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=본인anon키
SUPABASE_SERVICE_ROLE_KEY=본인service_role
DATABASE_URL=postgresql://postgres.본인:비밀번호@...pooler.supabase.com:6543/postgres
```

선택 (나중에):

```env
KOREAN_GOLD_SYNC_SECRET=본인이_새로_만든_랜덤문자열
KOREAN_GOLD_INGEST_URL=https://본인사이트.vercel.app/api/korean-gold-prices/ingest
```

---

## 5단계 — DB 스키마 (빈 DB)

```powershell
npm run db:bootstrap-new-shop
```

`Bootstrap complete` 확인.

---

## 6단계 — 첫 관리자

1. Supabase → **Authentication → Users → Add user** (본인 이메일)
2. 첫 사용자 = 자동 `admin`
3. **Providers → Email** → 가입 허용 **끄기** 권장

```powershell
npm run dev
```

`http://localhost:3000` 로그인 → **지점 관리**에서 매장 이름 등록

---

## 7단계 — 본인 Vercel (새 프로젝트)

1. [vercel.com](https://vercel.com) → **New Project**
2. **2단계에서 만든 본인 GitHub repo** 연결 (원본 repo 아님)
3. Environment Variables:

| 이름 | 값 |
|------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | 본인 Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 본인 anon |
| `SUPABASE_SERVICE_ROLE_KEY` | 본인 service role |

4. Deploy → `https://본인-프로젝트.vercel.app`

Vercel이 **새 projectId** 를 만듭니다. 원본 `.vercel` 은 없어야 정상입니다.

---

## 8단계 — 한국금시세 자동 갱신 (선택)

원본과 **완전 별도**로 설정합니다.

1. Vercel: `KOREAN_GOLD_SYNC_SECRET`, (workflow용) 본인 배포 URL
2. GitHub **본인 repo** → Settings → Secrets:
   - `KOREAN_GOLD_SYNC_SECRET`
   - `KOREAN_GOLD_INGEST_URL` = `https://본인사이트.vercel.app/api/korean-gold-prices/ingest`
3. `.github/workflows/sync-korean-gold-quotes.yml` 은 복사본에 이미 secret 참조로 되어 있음

안 해도 앱은 됩니다. 시세는 수동 입력·`public/korean-gold-quote-fallback.json` 으로도 가능.

---

## 9단계 — 직원

1. Supabase Users에 직원 추가
2. 앱 **직원 관리**에서 `staff` + 지점 지정

---

## 분리 확인

| 항목 | 당신 | 원본 운영자 |
|------|------|-------------|
| GitHub repo URL | 본인 것 | 다름 |
| Supabase project ref | 본인 것 | 다름 |
| Vercel URL | 본인 것 | 다름 |
| 로그인 계정 | 본인 DB | 다름 |

하나라도 같으면 **설정 오류**입니다. 처음부터 다시 하세요.

---

## 기능 업데이트 (선택)

원본 운영자가 **새 ZIP(export)** 을 줄 수 있습니다.  
그때는 diff 보고 필요한 파일·`migration_*.sql` 만 반영하세요.  
**원본 Git remote 를 추가하지 마세요.**

---

## Cursor Pro 팁

- `@docs/SETUP_NEW_SHOP.md` 멘션 후 단계 번호로 지시
- API 키는 채팅에 붙이지 말고 변수 이름만
- `git remote -v` / Supabase URL 로 겹침 여부 먼저 확인 시키기

---

## 문제 해결

| 증상 | 조치 |
|------|------|
| 원본 매장 데이터가 보임 | Supabase URL·키가 원본 것 — `.env` 전부 교체 |
| Vercel이 원본 사이트에 배포됨 | 잘못된 repo 연결 또는 `.vercel` 복사 — 프로젝트 재생성 |
| `relation "profiles" does not exist` | `npm run db:bootstrap-new-shop` |
| PGRST204 | Supabase API → Reload schema |
