"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchLaborFeeImageUrl,
  getCachedLaborFeeImageUrl,
} from "@/lib/laborFeeImageUrl";

/** 화면에 보일 때만 signed URL을 받아온다. 캐시·동시 요청 제한은 laborFeeImageUrl에서 처리. */
export function useLaborFeeImageUrl(
  supabase: SupabaseClient,
  imagePath: string | null | undefined,
) {
  const path = imagePath?.trim() || null;
  const rootRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(() =>
    path ? getCachedLaborFeeImageUrl(path) : null,
  );
  const [loading, setLoading] = useState(
    () => Boolean(path && !getCachedLaborFeeImageUrl(path)),
  );

  useEffect(() => {
    if (!path) {
      setUrl(null);
      setLoading(false);
      return;
    }

    const applyCached = () => {
      const cached = getCachedLaborFeeImageUrl(path);
      if (!cached) return false;
      setUrl(cached);
      setLoading(false);
      return true;
    };

    if (applyCached()) return;

    setUrl(null);
    setLoading(true);

    let cancelled = false;
    let observer: IntersectionObserver | null = null;

    const load = () => {
      if (applyCached()) return;
      void fetchLaborFeeImageUrl(supabase, path).then((signed) => {
        if (cancelled) return;
        setUrl(signed);
        setLoading(false);
      });
    };

    const pollId = window.setInterval(() => {
      if (cancelled) return;
      if (applyCached()) window.clearInterval(pollId);
    }, 80);

    const rafId = requestAnimationFrame(() => {
      const el = rootRef.current;
      if (!el || cancelled) return;

      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const nearViewport =
        rect.bottom >= -280 && rect.top <= vh + 280;

      if (nearViewport) {
        load();
        return;
      }

      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            observer?.disconnect();
            load();
          }
        },
        { rootMargin: "280px", threshold: 0.01 },
      );
      observer.observe(el);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      window.clearInterval(pollId);
      observer?.disconnect();
    };
  }, [supabase, path]);

  return { url, loading, rootRef };
}
