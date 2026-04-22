"use client";

import { useEffect, ReactNode } from "react";
import { useSetPalette } from "@/lib/palette-context";

export function PageWithPalette({
  palette,
  children,
}: {
  palette: "blue" | "gold";
  children: ReactNode;
}) {
  const setPalette = useSetPalette();
  useEffect(() => {
    setPalette(palette);
  }, [palette, setPalette]);
  return <>{children}</>;
}
