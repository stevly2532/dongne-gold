"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  branchLabelForId,
  branchSelectRowsForShop,
  branchesForShopSelect,
  firstShopSelectableBranchId,
} from "@/lib/branchLabels";
import {
  formatWonInputDisplay,
  parseWonDigitsToNumber,
  sanitizeWonInputDigits,
} from "@/lib/format";
import { HelpTooltip } from "@/components/HelpTooltip";
import { useAppBootstrap } from "@/components/AppProviders";
import { LaborFeeEditDialog } from "@/components/LaborFeeEditDialog";
import { RegistrationPageHeader } from "@/components/RegistrationPageHeader";
import {
  fetchLaborFeeImageUrl,
  invalidateLaborFeeImageUrl,
  setCachedLaborFeeImageUrl,
} from "@/lib/laborFeeImageUrl";
import type { Branch, ProductLaborFee, Profile } from "@/types/db";

/** 순금 탭 — 중량(g) 숨김 */
const VENDOR_PURE = "순금";
/** CP 탭 — 제품을 하나씩 직접 등록 */
const VENDOR_CP = "CP";
/** 합금 탭 안 회사별 vendor (DB product_labor_fees.vendor 값과 동일) */
const ALLOY_VENDORS = [
  "케이앤케이",
  "금실",
  "에이블",
  "골드샤인",
  "오름",
  "기타",
] as const;

type LaborFeeGroup = "pure" | "alloy" | "cp";

const LABOR_FEE_GROUPS: ReadonlyArray<{
  id: LaborFeeGroup;
  label: string;
}> = [
  { id: "pure", label: "순금" },
  { id: "alloy", label: "합금" },
  { id: "cp", label: "CP" },
];

function isAlloyVendor(v: string): v is (typeof ALLOY_VENDORS)[number] {
  return (ALLOY_VENDORS as readonly string[]).includes(v);
}

function groupForVendor(v: string): LaborFeeGroup {
  if (v === VENDOR_PURE) return "pure";
  if (v === VENDOR_CP) return "cp";
  return "alloy";
}

function resolveVendor(group: LaborFeeGroup, alloyVendor: string): string {
  if (group === "pure") return VENDOR_PURE;
  if (group === "cp") return VENDOR_CP;
  return alloyVendor;
}

/** 제품 검색: 중량(g) 부분 일치 — 3.5 · 3.5g · 3,5 등 */
function matchesLaborProductWeightSearch(
  query: string,
  weightG: number | null | undefined,
): boolean {
  if (weightG == null || !Number.isFinite(Number(weightG))) return false;
  const q = query.trim().toLowerCase().replace(/g$/, "").replace(/,/g, ".");
  if (!q || !/^[\d.]+$/.test(q)) return false;
  const w = Number(weightG);
  const forms = [String(w), w.toFixed(4).replace(/\.?0+$/, "")];
  return forms.some((s) => s.includes(q));
}

function matchesLaborProductSearch(
  query: string,
  r: {
    product_code?: string | null;
    product_name?: string | null;
    client_name?: string | null;
    weight_g?: number | null;
  },
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const codeStr = (r.product_code ?? "").toLowerCase();
  const nameStr = (r.product_name ?? "").toLowerCase();
  const clientStr = (r.client_name ?? "").toLowerCase();
  return (
    codeStr.includes(q) ||
    nameStr.includes(q) ||
    clientStr.includes(q) ||
    matchesLaborProductWeightSearch(query, r.weight_g)
  );
}

function formatLaborWeightGDisplay(weightG: number | null | undefined): string {
  if (weightG == null || !Number.isFinite(Number(weightG))) return "";
  const w = Number(weightG);
  return `${w.toFixed(4).replace(/\.?0+$/, "")}g`;
}

const laborTabActive = "toss-btn-primary toss-btn-sm shrink-0";
const laborTabIdle = "toss-btn-secondary toss-btn-sm shrink-0";
const laborTabActiveSm =
  "toss-btn-primary toss-btn-sm shrink-0 px-2.5 text-xs";
const laborTabIdleSm =
  "toss-btn-secondary toss-btn-sm shrink-0 px-2.5 text-xs";
const laborTableHead =
  "bg-[#f2f4f6] text-[11px] font-semibold text-[#8b95a1] dark:bg-[var(--surface-subtle)] dark:text-[var(--muted)]";
const laborRowHighlight =
  "bg-[color-mix(in_srgb,var(--primary)_12%,var(--card))] ring-2 ring-inset ring-[color-mix(in_srgb,var(--primary)_38%,transparent)]";
const laborFocusRing =
  "hover:ring-2 hover:ring-[color-mix(in_srgb,var(--primary)_35%,transparent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_35%,transparent)]";

const SETUP_BASE =
  "supabase/migration_product_labor_fees.sql \uC744 SQL Editor\uC5D0\uC11C \uC2E4\uD589\uD55C \uB4A4 API \uC2A4\uD0A4\uB9C8\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.";
const SETUP_VENDOR =
  "\uD68C\uC0AC\uBCC4 \uAD00\uB9AC\uB97C \uC704\uD574 supabase/migration_product_labor_fees_vendor.sql \uB3C4 SQL Editor\uC5D0\uC11C \uC2E4\uD589\uD55C \uB4A4 API \uC2A4\uD0A4\uB9C8\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.";
const SETUP_CATEGORY =
  "supabase/migration_product_labor_fees_category_weight.sql \uB3C4 SQL Editor\uC5D0\uC11C \uC2E4\uD589\uD55C \uB4A4 API \uC2A4\uD0A4\uB9C8\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.";
const SETUP_IMAGE =
  "\uC0AC\uC9C4 \uAE30\uB2A5\uC740 supabase/migration_product_labor_fees_image.sql \uC744 SQL Editor\uC5D0\uC11C \uC2E4\uD589\uD55C \uB4A4 API \uC2A4\uD0A4\uB9C8\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.";
const SETUP_CREATED_AT =
  "\uB4F1\uB85D \uC2DC\uAC04 \uC21C \uC815\uB82C\uC744 \uC704\uD574 supabase/migration_product_labor_fees_created_at.sql \uC744 SQL Editor\uC5D0\uC11C \uC2E4\uD589\uD55C \uB4A4 API \uC2A4\uD0A4\uB9C8\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.";
const SETUP_CLIENT =
  "\uAC70\uB798\uCC98 \uC785\uB825\uC744 \uC704\uD574 supabase/migration_product_labor_fees_client.sql \uC744 SQL Editor\uC5D0\uC11C \uC2E4\uD589\uD55C \uB4A4 API \uC2A4\uD0A4\uB9C8\uB97C \uC0C8\uB85C\uACE0\uCE68\uD558\uC138\uC694.";

const IMAGE_BUCKET = "labor-fee-images";
/** 원본 화질 유지를 위해 클라이언트 측 상한을 50MB까지 풀어둔다.
 * (실제로는 Supabase Storage 버킷의 file size limit 가 더 작으면 거기서 제한됨) */
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_MB = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));
/** Storage signed URL 유효 시간(초). private 버킷·한글 경로에서도 표시 가능 */
const IMAGE_SIGNED_TTL_SEC = 60 * 60 * 24;

/** \uACF5\uC784\uD45C \uAE30\uBCF8 \uD488\uBAA9 (\uB0B4\uBD80 \uC800\uC7A5\uC6A9, \uD654\uBA74\uC5D0\uB294 \uB178\uCD9C \uC548 \uB428) */
const EXCEL_IMPORT_KIND = "gold_14k";

/** Blob → 클립보드 이미지 (브라우저는 png/jpeg 위주 지원) */
async function blobToPng(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("이미지를 처리하지 못했습니다."));
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (b) =>
            b
              ? resolve(b)
              : reject(new Error("이미지를 처리하지 못했습니다.")),
          "image/png",
        );
      };
      img.onerror = () => reject(new Error("이미지를 처리하지 못했습니다."));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function copyBlobToClipboard(blob: Blob): Promise<void> {
  if (!navigator.clipboard?.write) {
    throw new Error("이 브라우저에서는 사진 복사를 지원하지 않습니다.");
  }
  const clipBlob =
    blob.type === "image/png" || blob.type === "image/jpeg"
      ? blob
      : await blobToPng(blob);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ [clipBlob.type]: clipBlob }),
    ]);
  } catch {
    const png = clipBlob.type === "image/png" ? clipBlob : await blobToPng(clipBlob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  }
}

function isDuplicateKeyError(msg: string) {
  const m = msg.toLowerCase();
  return m.includes("duplicate key") || m.includes("unique constraint");
}

function missingTable(msg: string) {
  const m = msg.toLowerCase();
  // 제약조건 이름에 product_labor_fees 가 들어가도 테이블 미설치가 아님
  if (isDuplicateKeyError(msg)) return false;
  return (
    (m.includes("relation") && m.includes("product_labor_fees") && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes("product_labor_fees")) ||
    (m.includes("schema cache") && m.includes("product_labor_fees"))
  );
}

/** DB 오류를 화면용 한국어 메시지로 변환 */
function laborFeeErrorMessage(msg: string): string {
  if (isDuplicateKeyError(msg)) {
    return "\uC774 \uB9E4\uC7A5\u00B7\uD68C\uC0AC\uC5D0 \uAC19\uC740 \uC81C\uD488\uBA85(\uBAA8\uB378\uBA85)\uC774 \uC774\uBBF8 \uC788\uC2B5\uB2C8\uB2E4. \uB2E4\uB978 \uC774\uB984\uC73C\uB85C \uB4F1\uB85D\uD558\uAC70\uB098 \uAE30\uC874 \uD56D\uBAA9\uC744 \uC218\uC815\uD558\uC138\uC694.";
  }
  const hint = dbSetupHint(msg);
  return hint ?? msg;
}

function missingVendorColumn(msg: string) {
  const m = msg.toLowerCase();
  return m.includes("vendor") && (m.includes("column") || m.includes("schema cache"));
}

function missingCategoryColumn(msg: string) {
  const m = msg.toLowerCase();
  return m.includes("category") && (m.includes("column") || m.includes("schema cache"));
}

function missingImageColumn(msg: string) {
  const m = msg.toLowerCase();
  return m.includes("image_path") && (m.includes("column") || m.includes("schema cache"));
}

function missingImageBucket(msg: string) {
  const m = msg.toLowerCase();
  return m.includes("bucket") && m.includes("not found");
}

function missingCreatedAtColumn(msg: string) {
  const m = msg.toLowerCase();
  return m.includes("created_at") && (m.includes("column") || m.includes("schema cache"));
}

function missingClientColumn(msg: string) {
  const m = msg.toLowerCase();
  return m.includes("client_name") && (m.includes("column") || m.includes("schema cache"));
}

function dbSetupHint(msg: string): string | null {
  if (missingClientColumn(msg)) return `${msg} \u2014 ${SETUP_CLIENT}`;
  if (missingCreatedAtColumn(msg)) return `${msg} \u2014 ${SETUP_CREATED_AT}`;
  if (missingImageColumn(msg) || missingImageBucket(msg)) return `${msg} \u2014 ${SETUP_IMAGE}`;
  if (missingCategoryColumn(msg)) return `${msg} \u2014 ${SETUP_CATEGORY}`;
  if (missingVendorColumn(msg)) return `${msg} \u2014 ${SETUP_VENDOR}`;
  if (missingTable(msg)) return `${msg} \u2014 ${SETUP_BASE}`;
  return null;
}

/** 붙여넣기 이벤트에서 이미지 파일을 추출 (Ctrl+V로 붙여넣었을 때 사용) */
function imageFileFromPasteEvent(e: React.ClipboardEvent): File | null {
  const items = e.clipboardData?.items;
  if (!items) return null;
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/**
 * 비동기 Clipboard API로 클립보드의 이미지를 읽는다.
 * 사용자 제스처(버튼 클릭) 안에서 호출해야 하며 HTTPS/localhost에서만 동작.
 */
async function imageFileFromClipboard(): Promise<File | null> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith("image/")) {
          const blob = await item.getType(type);
          const ext = type.split("/")[1]?.toLowerCase() || "png";
          return new File([blob], `clipboard-${Date.now()}.${ext}`, { type });
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export default function LaborFeesPage() {
  const supabase = useMemo(() => createClient(), []);
  const boot = useAppBootstrap();
  const [profile, setProfile] = useState<Profile | null>(boot.profile);
  const [branches, setBranches] = useState<Branch[]>(boot.branches);
  const [branchId, setBranchId] = useState("");
  const [group, setGroup] = useState<LaborFeeGroup>("pure");
  const [alloyVendor, setAlloyVendor] = useState<string>(ALLOY_VENDORS[0]);
  const vendor = useMemo(
    () => resolveVendor(group, alloyVendor),
    [group, alloyVendor],
  );
  const [rows, setRows] = useState<ProductLaborFee[]>([]);
  /** 제품명 검색용: 현재 매장의 모든 회사(vendor) 제품 (회사 탭 안 옮겨도 찾을 수 있게) */
  const [allBranchRows, setAllBranchRows] = useState<ProductLaborFee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<ProductLaborFee | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  /** 제품 검색(등록과 별도) — 매장 전체 vendor 통합 검색 */
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  /** 거래처(회사 이름) 자유 입력 */
  const [client, setClient] = useState("");
  const [labor, setLabor] = useState("");
  const [weightG, setWeightG] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  /** 검색 결과로 이동한 행을 잠깐 강조 표시 (Ctrl+F 처럼) */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** 회사 전환 후 목록이 로드되면 그 행으로 스크롤하기 위한 대기 id */
  const pendingScrollIdRef = useRef<string | null>(null);
  const [imageBusyId, setImageBusyId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewImagePath, setPreviewImagePath] = useState<string | null>(null);
  const [previewProductCode, setPreviewProductCode] = useState<string | null>(
    null,
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [addPhoto, setAddPhoto] = useState<File | null>(null);
  const [addPhotoUrl, setAddPhotoUrl] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const addPhotoInputRef = useRef<HTMLInputElement>(null);
  const imageTargetRowRef = useRef<ProductLaborFee | null>(null);

  useEffect(() => {
    return () => {
      if (addPhotoUrl) URL.revokeObjectURL(addPhotoUrl);
    };
  }, [addPhotoUrl]);

  const isAdmin = profile?.role === "admin";
  const branchRows = useMemo(() => branchSelectRowsForShop(branches), [branches]);
  const branch =
    profile?.role === "staff" && profile.branch_id ? profile.branch_id : branchId;
  // 순금은 중량 단위로 다루지 않으므로 입력·표에서 중량을 숨긴다.
  const hideWeight = group === "pure";

  /**
   * 제품 검색 자동완성 후보.
   * 현재 매장의 모든 vendor 제품을 부분 일치로 찾는다.
   * 클릭하면 해당 탭·회사로 전환 후 목록에서 행으로 스크롤한다.
   */
  const productSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) return [];
    const matched = allBranchRows.filter((r) =>
      matchesLaborProductSearch(searchQuery, r),
    );
    // 현재 보고 있는 회사(vendor)의 제품을 위로 올려준다.
    matched.sort((a, b) => {
      const av = a.vendor === vendor ? 0 : 1;
      const bv = b.vendor === vendor ? 0 : 1;
      if (av !== bv) return av - bv;
      return (a.product_code ?? "").localeCompare(b.product_code ?? "");
    });
    return matched.slice(0, 12);
  }, [searchQuery, allBranchRows, vendor]);

  /** 검색어가 있으면 아래 목록·사진 표도 같은 조건으로 걸러진다 */
  const displayRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    return rows.filter((r) => matchesLaborProductSearch(searchQuery, r));
  }, [rows, searchQuery]);

  /** 입력한 제품명과 정확히 같은(대소문자 무시) 기존 제품이 있으면 그 행 — 중복 경고용 */
  const exactExistingProduct = useMemo(() => {
    const q = code.trim().toLowerCase();
    if (q.length === 0) return null;
    return rows.find((r) => (r.product_code ?? "").toLowerCase() === q) ?? null;
  }, [code, rows]);

  useEffect(() => {
    setProfile(boot.profile);
    setBranches(boot.branches);
    const def = firstShopSelectableBranchId(branchesForShopSelect(boot.branches));
    if (boot.profile?.role === "staff" && boot.profile.branch_id) {
      setBranchId(boot.profile.branch_id);
    } else if (def) setBranchId((c) => c || def);
  }, [boot]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, [supabase]);

  const load = useCallback(async () => {
    if (!branch) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    // 최신 등록 행이 위로 오도록 created_at 내림차순. 동일 시각은 product_code 로 보조 정렬.
    let { data, error: e } = await supabase
      .from("product_labor_fees")
      .select("*")
      .eq("branch_id", branch)
      .eq("vendor", vendor)
      .order("created_at", { ascending: false })
      .order("product_code");
    // created_at 컬럼 마이그레이션 전 환경에서는 updated_at 으로 폴백한다.
    if (e && missingCreatedAtColumn(e.message)) {
      const fallback = await supabase
        .from("product_labor_fees")
        .select("*")
        .eq("branch_id", branch)
        .eq("vendor", vendor)
        .order("updated_at", { ascending: false })
        .order("product_code");
      data = fallback.data;
      e = fallback.error;
    }
    setLoading(false);
    if (e) {
      setRows([]);
      setError(laborFeeErrorMessage(e.message));
      return;
    }
    setRows((data ?? []) as ProductLaborFee[]);
  }, [supabase, branch, vendor]);

  useEffect(() => {
    void load();
  }, [load]);

  const openProductPhoto = useCallback(
    async (row: ProductLaborFee) => {
      const path = row.image_path?.trim();
      if (!path) return;
      setPreviewLoading(true);
      setPreviewImagePath(path);
      setPreviewProductCode(row.product_code);
      setPreviewUrl(null);
      setError(null);
      try {
        const url = await fetchLaborFeeImageUrl(supabase, path);
        if (!url) {
          setPreviewImagePath(null);
          setPreviewProductCode(null);
          setError("사진을 불러오지 못했습니다.");
          return;
        }
        setPreviewUrl(url);
      } finally {
        setPreviewLoading(false);
      }
    },
    [supabase],
  );

  function closeProductPhoto() {
    setPreviewUrl(null);
    setPreviewImagePath(null);
    setPreviewProductCode(null);
    setPreviewLoading(false);
  }

  /** 제품명 검색용: 현재 매장의 전 회사(vendor) 제품을 한 번에 가져온다. */
  const loadAllBranchRows = useCallback(async () => {
    if (!branch) {
      setAllBranchRows([]);
      return;
    }
    const { data, error: e } = await supabase
      .from("product_labor_fees")
      .select("*")
      .eq("branch_id", branch)
      .order("product_code");
    if (e) {
      setAllBranchRows([]);
      return;
    }
    setAllBranchRows((data ?? []) as ProductLaborFee[]);
  }, [supabase, branch]);

  // rows 가 바뀔 때(추가·삭제·회사 전환 후 재조회 포함)마다 검색용 전체 목록도 갱신.
  useEffect(() => {
    void loadAllBranchRows();
  }, [loadAllBranchRows, rows]);

  /**
   * 기존 자료 거래처 자동 채움:
   * 거래처가 비어 있는 기존 행을, 그 행이 속한 회사(vendor) 이름으로 자동 채워 저장한다.
   * (회사 탭으로 나뉘어 있던 기준을 거래처 칸에 그대로 반영) — 한 번 채우면 다시 실행되지 않는다.
   * 이미 입력된 거래처는 절대 덮어쓰지 않으며, vendor 가 빈 행은 건너뛴다.
   */
  const clientBackfillRunningRef = useRef(false);
  useEffect(() => {
    if (allBranchRows.length === 0) return;
    if (clientBackfillRunningRef.current) return;
    const targets = allBranchRows.filter(
      (r) =>
        r.vendor != null &&
        String(r.vendor).trim().length > 0 &&
        !(r.client_name != null && String(r.client_name).trim().length > 0),
    );
    if (targets.length === 0) return;
    clientBackfillRunningRef.current = true;
    void (async () => {
      const chunkSize = 25;
      let failed = false;
      for (let i = 0; i < targets.length && !failed; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        const results = await Promise.all(
          chunk.map((r) =>
            supabase
              .from("product_labor_fees")
              .update({ client_name: r.vendor })
              .eq("id", r.id),
          ),
        );
        for (const res of results) {
          if (res.error) {
            failed = true;
            // 컬럼이 아직 없으면(마이그레이션 미실행) 안내만 하고 중단
            if (missingClientColumn(res.error.message)) {
              setError(laborFeeErrorMessage(res.error.message));
            }
            break;
          }
        }
      }
      if (!failed) {
        await load();
        await loadAllBranchRows();
      }
      clientBackfillRunningRef.current = false;
    })();
  }, [allBranchRows, supabase, load, loadAllBranchRows]);

  /** 표에서 해당 행으로 부드럽게 스크롤 */
  const scrollToRow = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-labor-row="${id}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  // 회사 전환 등으로 목록이 바뀐 뒤, 대기 중인 대상 행이 보이면 스크롤한다.
  useEffect(() => {
    const id = pendingScrollIdRef.current;
    if (!id) return;
    if (!rows.some((r) => r.id === id)) return;
    pendingScrollIdRef.current = null;
    scrollToRow(id);
  }, [rows, scrollToRow]);

  /**
   * 검색 결과(제품)로 바로 이동 — Ctrl+F 처럼.
   * 다른 회사 제품이면 그 회사 탭으로 전환 후, 목록이 로드되면 해당 행으로 스크롤·강조.
   */
  const jumpToProduct = useCallback(
    (s: ProductLaborFee) => {
      setSearchFocused(false);
      setSearchQuery("");
      setHighlightId(s.id);
      const targetVendor = s.vendor?.trim() || vendor;
      const g = groupForVendor(targetVendor);
      const needsTabSwitch = targetVendor !== vendor;
      setGroup(g);
      if (g === "alloy" && isAlloyVendor(targetVendor)) {
        setAlloyVendor(targetVendor);
      }
      if (needsTabSwitch) {
        pendingScrollIdRef.current = s.id;
      } else {
        scrollToRow(s.id);
      }
      window.setTimeout(
        () => setHighlightId((cur) => (cur === s.id ? null : cur)),
        2400,
      );
    },
    [vendor, scrollToRow],
  );

  function pickAddPhoto(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("\uC774\uBBF8\uC9C0 \uD30C\uC77C\uB9CC \uC5C5\uB85C\uB4DC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`\uC0AC\uC9C4\uC740 ${MAX_IMAGE_MB}MB \uC774\uD558\uB85C \uC62C\uB824\uC8FC\uC138\uC694.`);
      return;
    }
    setError(null);
    if (addPhotoUrl) URL.revokeObjectURL(addPhotoUrl);
    setAddPhoto(file);
    setAddPhotoUrl(URL.createObjectURL(file));
  }

  function clearAddPhoto() {
    if (addPhotoUrl) URL.revokeObjectURL(addPhotoUrl);
    setAddPhoto(null);
    setAddPhotoUrl(null);
    if (addPhotoInputRef.current) addPhotoInputRef.current.value = "";
  }

  /** 추가 폼에서 Ctrl+V 로 이미지를 붙여넣었을 때 처리 */
  function handleAddPasteEvent(e: React.ClipboardEvent) {
    const file = imageFileFromPasteEvent(e);
    if (!file) return;
    e.preventDefault();
    pickAddPhoto(file);
  }

  /** 추가 폼의 "클립보드에서 붙여넣기" 버튼을 눌렀을 때 처리 */
  async function pasteImageIntoAddForm() {
    const file = await imageFileFromClipboard();
    if (!file) {
      setError(
        "\uD074\uB9BD\uBCF4\uB4DC\uC5D0 \uC774\uBBF8\uC9C0\uAC00 \uC5C6\uAC70\uB098 \uC77D\uAE30 \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC0AC\uC9C4\uC744 \uBCF5\uC0AC\ud55C \ud6c4 \ub2e4\uC2DC \uC2DC\uB3C4\ud558\uC138\uC694.",
      );
      return;
    }
    pickAddPhoto(file);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!branch) return setError("\uB9E4\uC7A5\uC744 \uC120\uD0DD\uD558\uC138\uC694.");
    if (!vendor) return setError("\uD68C\uC0AC\uB97C \uC120\uD0DD\uD558\uC138\uC694.");
    const c = code.trim();
    if (!c) return setError("\uC81C\uD488\uCF54\uB4DC\uB97C \uC785\uB825\uD558\uC138\uC694.");
    const won = parseWonDigitsToNumber(labor);
    if (won == null || won < 0) return setError("\uACF5\uC784(\uC6D0)\uC744 \uC785\uB825\uD558\uC138\uC694.");
    const wg = weightG.trim() ? parseFloat(weightG.replace(",", ".")) : null;
    if (wg != null && !Number.isFinite(wg))
      return setError("\uC911\uB7C9\uC740 \uC22B\uC790\uB85C \uC785\uB825\uD558\uC138\uC694.");
    setAdding(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: inserted, error: ie } = await supabase
      .from("product_labor_fees")
      .insert({
        branch_id: branch,
        vendor,
        kind: EXCEL_IMPORT_KIND,
        category: "",
        product_code: c,
        product_name: null,
        client_name: client.trim() || null,
        labor_fee_won: Math.round(won),
        weight_g: wg,
        note: note.trim() || null,
        sort_order: rows.length,
        updated_by: user?.id ?? null,
      })
      .select()
      .single();
    if (ie) {
      setAdding(false);
      setError(laborFeeErrorMessage(ie.message));
      return;
    }

    // \uC0AC\uC9C4\uC744 \uACE0\ub978 \uACBD\uC6B0 \uC2A4\ud1A0\ub9AC\uC9C0 \uC5C5\ub85c\ub4DC \ud6c4 image_path \uB300\uC785
    const newRow = inserted as ProductLaborFee | null;
    if (newRow && addPhoto) {
      try {
        const ext = addPhoto.name.includes(".")
          ? addPhoto.name.split(".").pop()!.toLowerCase()
          : "jpg";
        const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : "jpg";
        // \uD55C\uAE00 \ub4F1 \ube44ASCII \uBB38\uC790\uAC00 \uB4E4\uC5B4\uAC04 \uACBD\uC6B0 Supabase Storage \uACBD\ub85c\uAC00 \uAC70\ubD80\ub420 \uC218 \uC788\uC73C\ubBC0\ub85c \uC548\uC804\ud55c \uC139\uADF8\uBA3C\ud2B8\ub9CC \uC0AC\uC6A9
        const vendorSeg = (newRow.vendor || "_").replace(/[^A-Za-z0-9_-]/g, "_");
        const filename = `${newRow.id}/${Date.now()}.${safeExt}`;
        const path = `${newRow.branch_id}/${vendorSeg}/${filename}`;
        const { error: ue } = await supabase.storage
          .from(IMAGE_BUCKET)
          .upload(path, addPhoto, {
            contentType: addPhoto.type || undefined,
            upsert: false,
          });
        if (!ue) {
          const { error: dbe } = await supabase
            .from("product_labor_fees")
            .update({
              image_path: path,
              updated_at: new Date().toISOString(),
              updated_by: user?.id ?? null,
            })
            .eq("id", newRow.id);
          if (dbe) {
            await supabase.storage.from(IMAGE_BUCKET).remove([path]).catch(() => {});
            setError(dbe.message);
          } else {
            const { data: signed } = await supabase.storage
              .from(IMAGE_BUCKET)
              .createSignedUrl(path, IMAGE_SIGNED_TTL_SEC);
            if (signed?.signedUrl) {
              setCachedLaborFeeImageUrl(path, signed.signedUrl);
              setRows((prev) =>
                prev.map((r) =>
                  r.id === newRow.id ? { ...r, image_path: path } : r,
                ),
              );
            }
          }
        } else {
          setError(laborFeeErrorMessage(ue.message));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "\uC0AC\uC9C4 \uC5C5\uB85C\uB4DC \uC2E4\uD328");
      }
    }

    setAdding(false);
    setCode("");
    setClient("");
    setLabor("");
    setWeightG("");
    setNote("");
    clearAddPhoto();
    setMsg("\uCD94\uAC00\uD588\uC2B5\uB2C8\uB2E4.");
    await load();
  }

  async function handleCopyImage(imagePath: string | null | undefined) {
    if (!imagePath?.trim()) {
      setError("복사할 사진이 없습니다.");
      return;
    }
    setError(null);
    try {
      const { data, error } = await supabase.storage
        .from(IMAGE_BUCKET)
        .download(imagePath);
      if (error || !data) {
        throw new Error(error?.message ?? "사진을 불러오지 못했습니다.");
      }
      await copyBlobToClipboard(data);
      setMsg("사진을 클립보드에 복사했습니다.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "사진을 복사하지 못했습니다.",
      );
    }
  }

  async function del(row: ProductLaborFee) {
    if (!confirm("\uC0AD\uC81C\uD560\uAE4C\uC694?")) return;
    const { error: de } = await supabase.from("product_labor_fees").delete().eq("id", row.id);
    if (de) {
      setError(de.message);
      return;
    }
    if (row.image_path) {
      await supabase.storage.from(IMAGE_BUCKET).remove([row.image_path]).catch(() => {});
    }
    await load();
  }

  function openImagePicker(row: ProductLaborFee) {
    imageTargetRowRef.current = row;
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
      imageInputRef.current.click();
    }
  }

  async function uploadImageForRow(row: ProductLaborFee, file: File) {
    if (!file.type.startsWith("image/")) {
      setError("\uC774\uBBF8\uC9C0 \uD30C\uC77C\uB9CC \uC5C5\uB85C\uB4DC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`\uC0AC\uC9C4\uC740 ${MAX_IMAGE_MB}MB \uC774\uD558\uB85C \uC62C\uB824\uC8FC\uC138\uC694.`);
      return;
    }
    setImageBusyId(row.id);
    setError(null);
    try {
      const ext =
        file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "jpg";
      const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : "jpg";
      const vendorSeg = (row.vendor || "_").replace(/[^A-Za-z0-9_-]/g, "_");
      const filename = `${row.id}/${Date.now()}.${safeExt}`;
      const path = `${row.branch_id}/${vendorSeg}/${filename}`;
      const { error: ue } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, file, {
          contentType: file.type || undefined,
          upsert: false,
        });
      if (ue) {
        setError(laborFeeErrorMessage(ue.message));
        return;
      }
      const prevPath = row.image_path ?? null;
      const { data: { user } } = await supabase.auth.getUser();
      const { error: dbe } = await supabase
        .from("product_labor_fees")
        .update({
          image_path: path,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", row.id);
      if (dbe) {
        await supabase.storage.from(IMAGE_BUCKET).remove([path]).catch(() => {});
        setError(laborFeeErrorMessage(dbe.message));
        return;
      }
      if (prevPath && prevPath !== path) {
        await supabase.storage.from(IMAGE_BUCKET).remove([prevPath]).catch(() => {});
      }
      const { data: signed } = await supabase.storage
        .from(IMAGE_BUCKET)
        .createSignedUrl(path, IMAGE_SIGNED_TTL_SEC);
      if (signed?.signedUrl) {
        setCachedLaborFeeImageUrl(path, signed.signedUrl);
        if (prevPath) invalidateLaborFeeImageUrl(prevPath);
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, image_path: path } : r)),
        );
      }
      setMsg("\uC0AC\uC9C4\uC744 \uC5C5\uB85C\uB4DC\uD588\uC2B5\uB2C8\uB2E4.");
      await load();
    } finally {
      setImageBusyId(null);
    }
  }

  async function handleImageSelected(file: File) {
    const row = imageTargetRowRef.current;
    imageTargetRowRef.current = null;
    if (!row) return;
    await uploadImageForRow(row, file);
  }

  /** 행의 사진 셀에서 Ctrl+V 로 클립보드 이미지를 붙여넣었을 때 처리 */
  function handleRowPasteEvent(e: React.ClipboardEvent, row: ProductLaborFee) {
    const file = imageFileFromPasteEvent(e);
    if (!file) return;
    e.preventDefault();
    void uploadImageForRow(row, file);
  }

  /** 행의 "클립보드에서 붙여넣기" 버튼을 눌렀을 때 처리 */
  async function pasteImageForRow(row: ProductLaborFee) {
    const file = await imageFileFromClipboard();
    if (!file) {
      setError(
        "\uD074\uB9BD\uBCF4\uB4DC\uC5D0 \uC774\uBBF8\uC9C0\uAC00 \uC5C6\uAC70\uB098 \uC77D\uAE30 \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC0AC\uC9C4\uC744 \uBCF5\uC0AC\ud55C \ud6c4 \ub2e4\uC2DC \uC2DC\uB3C4\ud558\uC138\uC694.",
      );
      return;
    }
    await uploadImageForRow(row, file);
  }

  async function removeImage(row: ProductLaborFee) {
    if (!row.image_path) return;
    if (!confirm("\uC0AC\uC9C4\uC744 \uC0AD\uC81C\uD560\uAE4C\uC694?")) return;
    setImageBusyId(row.id);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error: dbe } = await supabase
        .from("product_labor_fees")
        .update({
          image_path: null,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", row.id);
      if (dbe) {
        setError(dbe.message);
        return;
      }
      await supabase.storage.from(IMAGE_BUCKET).remove([row.image_path]).catch(() => {});
      invalidateLaborFeeImageUrl(row.image_path);
      setMsg("\uC0AC\uC9C4\uC744 \uC0AD\uC81C\uD588\uC2B5\uB2C8\uB2E4.");
      await load();
    } finally {
      setImageBusyId(null);
    }
  }

  const laborLabel = "toss-form-label";
  const laborInput =
    "toss-input h-9 w-full px-2 text-sm text-[var(--foreground)]";
  const laborInputNum = `${laborInput} tabular-nums text-right`;
  const laborSelect = "toss-input h-9 min-w-[8rem] px-2 text-sm";
  const laborReadOnly =
    "toss-input flex h-9 items-center bg-[var(--surface-subtle)] px-2 text-sm font-medium text-[var(--foreground)]";
  const laborSummary =
    "flex h-9 shrink-0 items-center whitespace-nowrap text-xs text-[var(--muted)]";

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-3 sm:px-4 lg:px-5">
      <RegistrationPageHeader
        title="공임 관리"
        description={
          <>
            <span className="font-semibold text-[#191f28] dark:text-[var(--foreground)]">
              순금 · 합금 · CP
            </span>
            별 제품 공임·중량을 등록·수정합니다.
          </>
        }
      />

      {error ? (
        <div className="toss-alert-error rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}
      {msg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {msg}
        </div>
      ) : null}

      {/* \uC785\uB825/\uC5C5\uB85C\uB4DC \uCE74\uB4DC */}
      <section className="relative flex min-h-0 min-w-0 flex-col purchase-ledger-work-card p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-[var(--border)] pb-3">
          <div className="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
            <nav
              className="flex shrink-0 flex-wrap gap-1.5"
              role="tablist"
              aria-label="공임 구분"
            >
              {LABOR_FEE_GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  role="tab"
                  aria-selected={group === g.id}
                  onClick={() => setGroup(g.id)}
                  className={group === g.id ? laborTabActive : laborTabIdle}
                >
                  {g.label}
                </button>
              ))}
            </nav>
            <p className={laborSummary}>
              {group === "alloy" ? "합금 · " : null}
              <span className="font-semibold text-[var(--foreground)]">{vendor}</span>
              {" \u00B7 "}
              <span className="font-semibold text-[var(--primary)]">
                {loading ? "\u2026" : `${rows.length}`}
              </span>
              {"\uAC74"}
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <label className={laborLabel} htmlFor="labor-branch">
              {"\uB9E4\uC7A5"}
            </label>
            {isAdmin ? (
              <select
                id="labor-branch"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className={laborSelect}
              >
                <option value="">{"\uB9E4\uC7A5"}</option>
                {branchRows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className={laborReadOnly}>
                {branchLabelForId(branches, branch)}
              </p>
            )}
          </div>
        </div>

        {group === "alloy" ? (
          <div className="mt-3 space-y-2 border-b border-[var(--border)] pb-3">
            <nav
              className="flex flex-wrap gap-1"
              role="tablist"
              aria-label="합금 회사"
            >
              {ALLOY_VENDORS.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={alloyVendor === v}
                  onClick={() => setAlloyVendor(v)}
                  className={
                    alloyVendor === v ? laborTabActiveSm : laborTabIdleSm
                  }
                >
                  {v}
                </button>
              ))}
            </nav>
          </div>
        ) : null}

        <div className="relative mt-3 max-w-md border-b border-[var(--border)] pb-3">
          <div className="flex items-center gap-1.5">
            <label htmlFor="labor-search" className={laborLabel}>
              제품 검색
            </label>
            <HelpTooltip label="제품 검색 도움말">
              매장 전체(순금·합금·CP) 검색 · 중량은 3.5 · 3.5g 형식 · 아래 목록·사진도
              함께 걸러짐 · 다른 회사는 목록 클릭 시 이동
            </HelpTooltip>
          </div>
          <input
            id="labor-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => window.setTimeout(() => setSearchFocused(false), 150)}
            placeholder="제품명 · 거래처 · 모델번호 · 중량(g)"
            className={`${laborInput} mt-1 w-full`}
            autoComplete="off"
          />
          {searchFocused && productSuggestions.length > 0 ? (
            <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto toss-card-sm py-1 shadow-lg">
              <li className="px-3 pb-1 pt-0.5 text-[10px] font-medium text-[var(--muted)]">
                클릭하면 해당 제품으로 바로 이동
              </li>
              {productSuggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => jumpToProduct(s)}
                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm hover:bg-[var(--surface-subtle)]"
                  >
                    <span className="shrink-0 rounded bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--muted)]">
                      {s.vendor}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium text-[var(--foreground)]">
                      {s.product_code}
                    </span>
                    {formatLaborWeightGDisplay(s.weight_g) ? (
                      <span className="shrink-0 tabular-nums text-[11px] text-[var(--muted)]">
                        {formatLaborWeightGDisplay(s.weight_g)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <p className={`mt-3 ${laborLabel}`}>공임 등록</p>
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => void add(e)}
          onPaste={handleAddPasteEvent}
        >
          <input
            ref={addPhotoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickAddPhoto(f);
            }}
          />
          <div className="flex flex-col gap-1">
            <span className={laborLabel}>{"\uC0AC\uC9C4"}</span>
            <div className="flex h-9 items-center gap-1">
              {addPhotoUrl ? (
                <div className="group/photo relative h-9 w-9 shrink-0">
                  <button
                    type="button"
                    onClick={() => addPhotoInputRef.current?.click()}
                    className={`block h-9 w-9 overflow-hidden rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--card)] outline-none ${laborFocusRing}`}
                    title={"\uC0AC\uC9C4 \uBC14\uAFB8\uAE30"}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={addPhotoUrl}
                      alt={"\uC0AC\uC9C4 \uBBF8\uB9AC\uBCF4\uAE30"}
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={clearAddPhoto}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--card)] text-[9px] text-[var(--muted)] shadow-sm hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                    title={"\uC0AC\uC9C4 \uC81C\uAC70"}
                    aria-label={"\uC0AC\uC9C4 \uC81C\uAC70"}
                  >
                    {"\u2715"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => addPhotoInputRef.current?.click()}
                  onPaste={handleAddPasteEvent}
                  className="toss-btn-secondary toss-btn-sm h-9 w-9 shrink-0 p-0 text-base leading-none"
                  title={"\uC0AC\uC9C4 \uC120\uD0DD \uB610\uB294 Ctrl+V \uBD99\uC5EC\uB123\uAE30"}
                  aria-label={"\uC0AC\uC9C4 \uC120\uD0DD"}
                >
                  +
                </button>
              )}
              <button
                type="button"
                onClick={() => void pasteImageIntoAddForm()}
                className="toss-btn-secondary toss-btn-sm h-9 shrink-0 px-2.5"
                title={"\ud074\ub9bd\ubcf4\ub4dc \uC774\ubbf8\uc9c0 \ubd99\uc5ec\ub123\uae30 (Ctrl+V)"}
              >
                {"\ubd99\uc5ec\ub123\uae30"}
              </button>
            </div>
          </div>
          <label className="flex w-[120px] flex-col gap-1">
            <span className={laborLabel}>{"\uAC70\uB798\uCC98"}</span>
            <input
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder={"\uD68C\uC0AC \uC774\uB984"}
              className={laborInput}
              autoComplete="off"
            />
          </label>
          <div className="relative flex w-[220px] flex-col gap-1">
            <label htmlFor="labor-code" className={laborLabel}>
              {"\uC81C\uD488\uBA85"}
            </label>
            <input
              id="labor-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={"\uC81C\uD488\uBA85 / \uBAA8\uB378\uBC88\uD638"}
              className={laborInput}
              autoComplete="off"
              required
            />
            {exactExistingProduct ? (
              <button
                type="button"
                onClick={() => setEditingRow(exactExistingProduct)}
                className="text-left text-[11px] font-medium text-[var(--primary)] hover:underline"
              >
                {"\u26A0\uFE0F \uC774\uBBF8 \ub4F1\ub85D\ub41C \uC81C\ud488\uC785\ub2C8\ub2E4 \u2014 \ud074\ub9AD\ud574 \uC218\uC815"}
              </button>
            ) : null}
          </div>
          <label className="flex w-[120px] flex-col gap-1">
            <span className={laborLabel}>{"\uACF5\uC784(\uC6D0)"}</span>
            <input
              inputMode="numeric"
              value={formatWonInputDisplay(labor)}
              onChange={(e) => setLabor(sanitizeWonInputDigits(e.target.value))}
              placeholder={"0"}
              className={laborInputNum}
              required
            />
          </label>
          {hideWeight ? null : (
            <label className="flex w-[80px] flex-col gap-1">
              <span className={laborLabel}>{"\uC911\uB7C9(g)"}</span>
              <input
                value={weightG}
                onChange={(e) => setWeightG(e.target.value)}
                placeholder={"0.0"}
                className={laborInputNum}
                inputMode="decimal"
              />
            </label>
          )}
          <label className="flex w-[96px] flex-col gap-1">
            <span className={laborLabel}>{"\uBE44\uACE0"}</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={"\uC120\uD0DD"}
              className={laborInput}
            />
          </label>
          <button
            type="submit"
            disabled={adding || !branch}
            className="toss-btn-primary toss-btn-sm disabled:opacity-50"
          >
            {adding ? "\uCD94\uAC00 \uC911\u2026" : "\uCD94\uAC00"}
          </button>
        </form>
      </section>

      {loading ? (
        <p className="py-10 text-center text-sm text-[var(--muted)]">
          {"\uBD88\uB7EC\uC624\uB294 \uC911\u2026"}
        </p>
      ) : displayRows.length === 0 ? (
        <div className="purchase-ledger-work-card py-12 text-center">
          <p className="text-sm font-medium text-[var(--foreground)]">
            {searchQuery.trim()
              ? `“${searchQuery.trim()}” 검색 결과가 없습니다`
              : "등록된 공임이 없습니다"}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {searchQuery.trim()
              ? "다른 회사 탭이거나 매장 전체 목록에서 찾아보세요."
              : "위에 직접 입력해 추가하세요."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {searchQuery.trim() ? (
            <p className="lg:col-span-2 text-xs text-[var(--muted)]">
              검색 “{searchQuery.trim()}” — {displayRows.length}건
            </p>
          ) : null}
          {(() => {
            const half = Math.ceil(displayRows.length / 2);
            const columns = [
              displayRows.slice(0, half),
              displayRows.slice(half),
            ];
            return columns.map((colRows, ci) => (
              <section
                key={ci}
                className="overflow-x-auto overflow-y-visible purchase-ledger-work-card"
              >
                <table className="w-full table-fixed text-center text-[13px]">
                  {/* 모든 컬럼에 비례감 있는 고정 폭을 부여한다. table-fixed 가 합계와 실제 표 폭이 다르면 비율대로 늘리거나 줄여 한 컬럼만 비대해지는 일이 없음. */}
                  <colgroup>
                    <col className="w-[52px]" />
                    <col className="w-[88px]" />
                    <col className="w-[132px]" />
                    <col className="w-[88px]" />
                    {hideWeight ? null : <col className="w-[60px]" />}
                    <col className="w-[56px]" />
                    <col className="w-[96px]" />
                  </colgroup>
                  <thead className={laborTableHead}>
                    <tr>
                      <th className="px-1.5 py-2 align-middle">{"\uC0AC\uC9C4"}</th>
                      <th className="px-2 py-2 align-middle">{"\uAC70\uB798\uCC98"}</th>
                      <th className="px-2 py-2 align-middle">{"\uC81C\uD488\uBA85"}</th>
                      <th className="px-1.5 py-2 align-middle">{"\uACF5\uC784"}</th>
                      {hideWeight ? null : (
                        <th className="px-1.5 py-2 align-middle">{"\uC911\uB7C9(g)"}</th>
                      )}
                      <th className="px-1.5 py-2 align-middle">{"\uBE44\uACE0"}</th>
                      <th className="px-1.5 py-2 align-middle">{"\uAD00\uB9AC"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {colRows.map((row) => {
                      const laborDisplay =
                        row.labor_fee_won != null &&
                        Number.isFinite(Number(row.labor_fee_won))
                          ? Number(row.labor_fee_won).toLocaleString("ko-KR")
                          : "—";
                      const weightDisplay =
                        row.weight_g != null &&
                        Number.isFinite(Number(row.weight_g))
                          ? String(Number(row.weight_g))
                          : "—";
                      return (
                        <tr
                          key={row.id}
                          data-labor-row={row.id}
                          className={`group transition-colors hover:bg-gray-100/80 dark:hover:bg-gray-800/40 ${
                            highlightId === row.id ? laborRowHighlight : ""
                          }`}
                        >
                          <td className="overflow-visible px-1 py-2 align-middle">
                            <LaborPhotoCell
                              row={row}
                              busy={imageBusyId === row.id}
                              onUpload={() => openImagePicker(row)}
                              onPasteEvent={(e) => handleRowPasteEvent(e, row)}
                              onPasteFromClipboard={() =>
                                void pasteImageForRow(row)
                              }
                              onRemove={() => void removeImage(row)}
                            />
                          </td>
                          <td className="px-2 py-2 text-center align-middle text-[12.5px] font-medium text-[var(--foreground)]">
                            <span
                              className="block truncate text-center"
                              title={row.client_name ?? ""}
                            >
                              {row.client_name?.trim() ? row.client_name : "—"}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center align-middle text-[12.5px] font-semibold tabular-nums text-[var(--foreground)]">
                            {row.image_path?.trim() ? (
                              <button
                                type="button"
                                onClick={() => void openProductPhoto(row)}
                                className={`mx-auto block max-w-full truncate text-[12.5px] font-semibold text-[var(--foreground)] underline-offset-2 hover:underline ${laborFocusRing} rounded-sm`}
                                title={`${row.product_code} — 사진 보기`}
                              >
                                {row.product_code}
                              </button>
                            ) : (
                              <span
                                className="block truncate"
                                title={row.product_code}
                              >
                                {row.product_code}
                              </span>
                            )}
                          </td>
                          <td className="px-1 py-2 text-center align-middle tabular-nums text-[var(--foreground)]">
                            {laborDisplay}
                          </td>
                          {hideWeight ? null : (
                            <td className="px-1 py-2 text-center align-middle tabular-nums text-[var(--foreground)]">
                              {weightDisplay}
                            </td>
                          )}
                          <td className="px-1.5 py-2 text-center align-middle text-[12px] text-[var(--muted)]">
                            <span
                              className="block truncate text-center"
                              title={row.note ?? ""}
                            >
                              {row.note?.trim() ? row.note : "—"}
                            </span>
                          </td>
                          <td className="px-1.5 py-2 align-middle">
                            <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => setEditingRow(row)}
                                className="toss-btn-primary rounded-md px-2 py-1.5 text-[12px] disabled:opacity-50"
                              >
                                {"\uC218\uC815"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void del(row)}
                                className="toss-btn-secondary rounded-md px-2 py-1.5 text-[12px]"
                              >
                                {"\uC0AD\uC81C"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            ));
          })()}
        </div>
      )}

      <LaborFeeEditDialog
        supabase={supabase}
        item={editingRow}
        open={editingRow !== null}
        onClose={() => setEditingRow(null)}
        onSaved={() => {
          setMsg("\uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.");
          void load();
        }}
        userId={currentUserId}
      />


      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleImageSelected(f);
        }}
      />

      {previewLoading || previewUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-busy={previewLoading}
          onClick={closeProductPhoto}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-stone-900/80 p-6 backdrop-blur-sm"
        >
          {previewProductCode ? (
            <p
              className="max-w-[90vw] truncate text-sm font-semibold text-white/90"
              onClick={(e) => e.stopPropagation()}
            >
              {previewProductCode}
            </p>
          ) : null}
          {previewLoading ? (
            <p
              className="text-sm text-white/80"
              onClick={(e) => e.stopPropagation()}
            >
              사진 불러오는 중…
            </p>
          ) : previewUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={previewUrl}
              alt={previewProductCode ?? "제품 사진"}
              className="max-h-[80vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
          <div
            className="absolute right-5 top-5 flex gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {!previewLoading && previewUrl ? (
              <button
                type="button"
                onClick={() => void handleCopyImage(previewImagePath)}
                className="rounded-full bg-white/90 px-3 py-1.5 text-sm font-semibold text-[var(--foreground)] shadow hover:bg-[var(--card)]"
              >
                사진 복사
              </button>
            ) : null}
            <button
              type="button"
              onClick={closeProductPhoto}
              className="rounded-full bg-white/90 px-3 py-1.5 text-sm font-semibold text-[var(--foreground)] shadow hover:bg-[var(--card)]"
            >
              {"\uB2EB\uAE30"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 목록에는 이미지를 로드하지 않음 — 제품명 클릭 시에만 모달에서 1건 로드 */
function LaborPhotoCell({
  row,
  busy,
  onUpload,
  onPasteEvent,
  onPasteFromClipboard,
  onRemove,
}: {
  row: ProductLaborFee;
  busy: boolean;
  onUpload: () => void;
  onPasteEvent: (e: React.ClipboardEvent) => void;
  onPasteFromClipboard: () => void;
  onRemove: () => void;
}) {
  const hasPath = Boolean(row.image_path?.trim());

  if (busy) {
    return (
      <span className="text-[11px] text-[var(--muted)]" aria-label="사진 처리 중">
        …
      </span>
    );
  }

  if (hasPath) {
    return (
      <div className="group/photo mx-auto flex flex-col items-center gap-0.5">
        <span
          className="text-[11px] font-medium text-[var(--muted)]"
          title="제품명을 클릭하면 사진을 볼 수 있습니다"
        >
          있음
        </span>
        <div className="hidden items-center gap-0.5 group-hover/photo:flex">
          <button
            type="button"
            onClick={onUpload}
            className="rounded px-1 py-0.5 text-[10px] font-semibold text-[var(--muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]"
            title="사진 바꾸기"
          >
            바꿈
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-1 py-0.5 text-[10px] font-semibold text-[var(--muted)] hover:bg-red-50 hover:text-red-600"
            title="사진 삭제"
          >
            삭제
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group/photo relative mx-auto flex flex-col items-center">
      <button
        type="button"
        onClick={onUpload}
        onPaste={onPasteEvent}
        className={`toss-btn-secondary flex h-9 w-9 flex-col items-center justify-center gap-0 p-0 text-[10px] font-semibold leading-none ${laborFocusRing}`}
        title="사진 선택 또는 Ctrl+V 붙여넣기"
      >
        <span aria-hidden className="text-base leading-none">
          +
        </span>
      </button>
      <button
        type="button"
        onClick={onPasteFromClipboard}
        className="mt-0.5 hidden text-[9px] font-semibold text-[var(--muted)] hover:text-[var(--foreground)] group-hover/photo:inline"
        title="클립보드 이미지 붙여넣기"
      >
        붙
      </button>
    </div>
  );
}
