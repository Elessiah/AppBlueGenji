import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_SEARCH_SHORTCUT_LABEL,
  isSearchShortcut,
  searchShortcutLabel,
} from "@/lib/shared/search-shortcut";

type Modifiers = Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>>;

const key = (k: string, mods: Modifiers = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("searchShortcutLabel", () => {
  it("dit ⌘K sur un clavier Apple", () => {
    expect(searchShortcutLabel("MacIntel")).toBe("⌘K");
    expect(searchShortcutLabel("iPhone")).toBe("⌘K");
    expect(searchShortcutLabel("iPad")).toBe("⌘K");
  });

  it("dit Ctrl+K partout ailleurs, Windows compris", () => {
    expect(searchShortcutLabel("Win32")).toBe("Ctrl+K");
    expect(searchShortcutLabel("Linux x86_64")).toBe("Ctrl+K");
    expect(searchShortcutLabel("")).toBe("Ctrl+K");
  });

  it("rend Ctrl+K avant montage, sans lire la plateforme", () => {
    expect(DEFAULT_SEARCH_SHORTCUT_LABEL).toBe("Ctrl+K");
  });
});

describe("isSearchShortcut", () => {
  it("reconnaît ⌘K et Ctrl+K, quelle que soit la casse", () => {
    expect(isSearchShortcut(key("k", { metaKey: true }))).toBe(true);
    expect(isSearchShortcut(key("k", { ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(key("K", { ctrlKey: true }))).toBe(true);
  });

  it("ignore la lettre seule et les autres lettres", () => {
    expect(isSearchShortcut(key("k"))).toBe(false);
    expect(isSearchShortcut(key("j", { ctrlKey: true }))).toBe(false);
  });

  it("laisse passer les combinaisons avec Alt ou Maj", () => {
    expect(isSearchShortcut(key("k", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(key("k", { metaKey: true, altKey: true }))).toBe(false);
  });
});
