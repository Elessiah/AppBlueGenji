"use client";

import type { ChangeEventHandler } from "react";
import s from "./annuaire.module.css";

type AnnuaireSearchFieldProps = {
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder: string;
  shortcut?: string;
};

export function AnnuaireSearchField({
  value,
  onChange,
  placeholder,
  shortcut = "⌘K",
}: AnnuaireSearchFieldProps) {
  return (
    <div className={s.search}>
      <span className={s.searchIcon}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </span>
      <input placeholder={placeholder} value={value} onChange={onChange} />
      <span className={s.searchKbd}>{shortcut}</span>
    </div>
  );
}
