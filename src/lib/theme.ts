export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "goldLedger_theme";

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return null;
}

export function resolveThemePreference(): Theme {
  const stored = readStoredTheme();
  if (stored) return stored;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

export function isCustomerDisplayPath(pathname: string): boolean {
  return (
    pathname === "/customer-display" ||
    pathname.startsWith("/customer-display/")
  );
}
