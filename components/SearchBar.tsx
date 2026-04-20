"use client";

import { KeyboardEvent } from "react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  placeholder?: string;
  rgb?: string;
}

export function SearchBar({
  value,
  onChange,
  onSearch,
  placeholder = "Rechercher…",
  rgb = "89, 212, 255",
}: SearchBarProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") onSearch();
  };

  return (
    <div
      className="searchbar"
      style={{ "--search-color": rgb } as React.CSSProperties}
    >
      <input
        className="searchbar-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
      />
      <button type="button" className="searchbar-btn" onClick={onSearch}>
        Rechercher
      </button>
    </div>
  );
}
