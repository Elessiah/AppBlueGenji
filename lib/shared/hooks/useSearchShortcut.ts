"use client";

import { useEffect, useState, type RefObject } from "react";
import {
  DEFAULT_SEARCH_SHORTCUT_LABEL,
  searchShortcutLabel,
  shouldHandleSearchShortcut,
} from "@/lib/shared/search-shortcut";

/**
 * Branche ⌘K / Ctrl+K sur un champ de recherche et rend le libellé à afficher,
 * lu sur la plateforme une fois monté (« Ctrl+K » au rendu serveur).
 */
export function useSearchShortcut(inputRef: RefObject<HTMLInputElement | null>): string {
  const [label, setLabel] = useState(DEFAULT_SEARCH_SHORTCUT_LABEL);

  useEffect(() => {
    setLabel(searchShortcutLabel(navigator.platform || navigator.userAgent));
    const handleKeyDown = (event: KeyboardEvent) => {
      const modalOpen = document.querySelector('[aria-modal="true"]') !== null;
      if (!shouldHandleSearchShortcut(event, modalOpen)) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inputRef]);

  return label;
}
