"use client";

import { useRef, type ChangeEventHandler } from "react";
import { useSearchShortcut } from "@/lib/shared/hooks/useSearchShortcut";
import { SEARCH_ARIA_KEYSHORTCUTS } from "@/lib/shared/search-shortcut";
import s from "./annuaire.module.css";

type AnnuaireSearchFieldProps = {
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder: string;
  /** Nom accessible du champ — le placeholder n'en est pas un. */
  label: string;
};

export function AnnuaireSearchField({ value, onChange, placeholder, label }: Readonly<AnnuaireSearchFieldProps>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const shortcutLabel = useSearchShortcut(inputRef);
  return (
    <div className={s.search}>
      <span className={s.searchIcon}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </span>
      <input
        ref={inputRef}
        aria-label={label}
        aria-keyshortcuts={SEARCH_ARIA_KEYSHORTCUTS}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      <span className={s.searchKbd} aria-hidden="true">
        {shortcutLabel}
      </span>
    </div>
  );
}
