# 친구에게 넘기기 (운영자용) — **완전 분리**

친구 매장은 **처음부터 새로** 시작합니다. GitHub·Supabase·Vercel·데이터·배포 URL **어느 것도 당신 것과 겹치면 안 됩니다.**

---

## 당신이 할 일 (한 번)

### 1. 독립 복사본 만들기

프로젝트 루트에서:

```powershell
npm run export:independent-copy
```

`../gold-ledger-standalone-YYYY-MM-DD` 폴더(와 ZIP)가 생깁니다.

포함 **안 됨**: `.git`, `.vercel`, `.env*`, `node_modules`, 당신 Vercel URL 하드코딩(치환됨)

### 2. 친구에게 전달

- ZIP 또는 폴더 (카톡·USB·클라우드 등 **아무거나 OK**)
- **GitHub 초대·Fork·clone 링크는 보내지 마세요**

### 3. 절대 공유하지 말 것

| 항목 |
|------|
| 당신 `.env.local` / Supabase 키 |
| 당신 Vercel 프로젝트 |
| 당신 Supabase 프로젝트 |
| 당신 GitHub 저장소 write 권한 |
| `gold-ledger-a9z6.vercel.app` 로그인 |

---

## 친구가 할 일

`README_STANDALONE.md` → `docs/SETUP_NEW_SHOP.md` (Cursor Pro로 Agent 시키면 됨)

요약:

1. 복사본 폴더를 Cursor로 열기
2. **본인** Supabase 새 프로젝트
3. **본인** GitHub에 **새 빈 저장소** → `git init` → push
4. **본인** Vercel 새 프로젝트 연결
5. `npm run db:bootstrap-new-shop` → 로그인 → 지점 등록

---

## 나중에 기능만 전달하고 싶을 때

같은 방식으로 **새 export ZIP**을 다시 만들어 주면 됩니다.  
친구는 자기 repo에 수동으로 merge 하거나, 필요한 `supabase/migration_*.sql` 만 실행합니다.

**같은 GitHub remote를 쓰는 `git pull` 방식은 쓰지 않습니다.**

---

## 분리 체크리스트 (전달 전)

- [ ] export 스크립트로 만든 폴더만 전달했는가
- [ ] `.env.local` 이 들어있지 않은가
- [ ] `.vercel` 이 없는가
- [ ] 친구에게 원본 GitHub URL을 주지 않았는가
