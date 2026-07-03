"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import {
  applyTheme,
  isCustomerDisplayPath,
  resolveThemePreference,
  THEME_STORAGE_KEY,
  type Theme,
} from "@/lib/theme";

export type { Theme };

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onCustomerDisplay = isCustomerDisplayPath(pathname ?? "");
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    if (onCustomerDisplay) {
      applyTheme("light");
      return;
    }
    const initial = resolveThemePreference();
    setThemeState(initial);
    applyTheme(initial);
  }, [onCustomerDisplay]);

  const setTheme = useCallback(
    (next: Theme) => {
      if (onCustomerDisplay) return;
      setThemeState(next);
      localStorage.setItem(THEME_STORAGE_KEY, next);
      applyTheme(next);
    },
    [onCustomerDisplay],
  );

  const toggleTheme = useCallback(() => {
    if (onCustomerDisplay) return;
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_STORAGE_KEY, next);
      applyTheme(next);
      return next;
    });
  }, [onCustomerDisplay]);

  const value = useMemo(
    () => ({ theme: onCustomerDisplay ? "light" : theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme, onCustomerDisplay],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
