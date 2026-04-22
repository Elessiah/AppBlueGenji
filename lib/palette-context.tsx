"use client";

import { createContext, useContext, useState, ReactNode } from "react";

type Palette = "blue" | "gold";

interface PaletteContextType {
  palette: Palette;
  setPalette: (p: Palette) => void;
}

const PaletteContext = createContext<PaletteContextType | null>(null);

export function PaletteProvider({ children }: { children: ReactNode }) {
  const [palette, setPalette] = useState<Palette>("blue");
  return (
    <PaletteContext.Provider value={{ palette, setPalette }}>
      {children}
    </PaletteContext.Provider>
  );
}

export function usePalette() {
  const ctx = useContext(PaletteContext);
  return ctx?.palette ?? "blue";
}

export function useSetPalette() {
  const ctx = useContext(PaletteContext);
  return ctx?.setPalette ?? (() => {});
}
