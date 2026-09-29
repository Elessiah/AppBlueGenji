"use client";

import { useEffect } from "react";
import { FLOATING_BUTTON_SETTLE_MS, PAGE_SCROLLING_ATTRIBUTE } from "@/lib/shared/floating-button-scroll";

/**
 * Pose `data-page-scrolling` sur `<html>` pendant un défilement, pour que les
 * boutons flottants s'estompent (voir `lib/shared/floating-button-scroll.ts`).
 * Un attribut du DOM plutôt qu'un état React : un défilement ne re-rend rien.
 */
export function FloatingScrollWatcher() {
  useEffect(() => {
    const html = document.documentElement;
    let timer: number | undefined;
    const settle = () => html.removeAttribute(PAGE_SCROLLING_ATTRIBUTE);
    const onScroll = () => {
      html.setAttribute(PAGE_SCROLLING_ATTRIBUTE, "true");
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, FLOATING_BUTTON_SETTLE_MS);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
      settle();
    };
  }, []);
  return null;
}
