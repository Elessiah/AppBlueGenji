import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LOCALES } from "@/lib/shared/locales";
import { MESSAGE_NAMESPACES, pickMessages } from "@/lib/shared/i18n-messages";
import { messagesFor } from "@/lib/server/i18n-messages";

/**
 * Parité des messages (`docs/features/I18N.md` § Garde-fous) : une clé ou un
 * argument présent dans une langue et absent de l'autre est une phrase qui
 * s'affiche en clé brute, ou une valeur qui disparaît.
 */
const MESSAGES_DIR = join(process.cwd(), "messages");

type Tree = { [key: string]: string | Tree };

function readNamespace(locale: string, namespace: string): Tree {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, locale, `${namespace}.json`), "utf8")) as Tree;
}

/** Chaque feuille, par son chemin pointé (`languageSwitcher.label`). */
function leaves(tree: Tree, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") for (const [k, v] of leaves(value, path)) out.set(k, v);
    else out.set(path, value);
  }
  return out;
}

/** Arguments ICU (`{count, plural, …}`, `{name}`) et balises riches (`<strong>`) d'un message. */
function placeholders(message: string): string[] {
  const args = [...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => `{${m[1]}}`);
  const tags = [...message.matchAll(/<([A-Za-z][\w-]*)>/g)].map((m) => `<${m[1]}>`);
  return [...new Set([...args, ...tags])].sort((a, b) => a.localeCompare(b));
}

describe("messages — fichiers et espaces de noms", () => {
  it("chaque langue a exactement un fichier par espace de noms déclaré", () => {
    for (const locale of LOCALES) {
      const files = readdirSync(join(MESSAGES_DIR, locale)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
      expect(files.sort((a, b) => a.localeCompare(b))).toEqual([...MESSAGE_NAMESPACES].sort((a, b) => a.localeCompare(b)));
    }
  });

  it("le catalogue serveur sert les fichiers tels qu'ils sont écrits", () => {
    for (const locale of LOCALES) {
      for (const namespace of MESSAGE_NAMESPACES) {
        expect(messagesFor(locale)[namespace]).toEqual(readNamespace(locale, namespace));
      }
    }
  });
});

describe.each(MESSAGE_NAMESPACES.map((namespace) => [namespace]))("parité fr/en — %s", (namespace) => {
  const fr = leaves(readNamespace("fr", namespace));
  const en = leaves(readNamespace("en", namespace));

  it("mêmes clés dans les deux langues", () => {
    expect([...en.keys()].sort((a, b) => a.localeCompare(b))).toEqual([...fr.keys()].sort((a, b) => a.localeCompare(b)));
  });

  it("toute valeur est une phrase non vide", () => {
    for (const value of [...fr.values(), ...en.values()]) {
      expect(typeof value).toBe("string");
      expect((value as string).trim()).not.toBe("");
    }
  });

  it("mêmes arguments ICU et mêmes balises dans les deux langues", () => {
    for (const [key, value] of fr) {
      expect({ key, args: placeholders(String(en.get(key) ?? "")) }).toEqual({ key, args: placeholders(String(value)) });
    }
  });
});

describe("pickMessages — découpage par sous-arbre client", () => {
  it("ne garde que les espaces demandés", () => {
    expect(Object.keys(pickMessages(messagesFor("en"), ["common"]))).toEqual(["common"]);
    expect(pickMessages(messagesFor("en"), [])).toEqual({});
  });
});
