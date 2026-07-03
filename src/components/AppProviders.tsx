"use client";

import { createContext, useContext, useMemo } from "react";
import type { Branch, Profile } from "@/types/db";

export type AppBootstrap = {
  profile: Profile;
  branches: Branch[];
};

const AppBootstrapContext = createContext<AppBootstrap | null>(null);

export function AppProviders({
  bootstrap,
  children,
}: {
  bootstrap: AppBootstrap;
  children: React.ReactNode;
}) {
  const value = useMemo(() => bootstrap, [bootstrap]);
  return (
    <AppBootstrapContext.Provider value={value}>
      {children}
    </AppBootstrapContext.Provider>
  );
}

export function useAppBootstrap(): AppBootstrap {
  const v = useContext(AppBootstrapContext);
  if (!v) throw new Error("useAppBootstrap must be used within AppProviders");
  return v;
}

