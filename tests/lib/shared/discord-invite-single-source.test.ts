import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "@jest/globals";
import { DEFAULT_CONTACT } from "@/lib/shared/contact";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import { ORGANIZATION_DISCORD_URL } from "@/lib/shared/structured-data";

/**
 * L'invitation ne se recopie pas.
 *
 * Trois adresses différentes ont cohabité dans le dépôt, et personne ne s'en
 * est aperçu : une invitation périmée **fonctionne**: elle mène quelque part,
 * aucune page ne rend d'erreur, aucun test unitaire ne peut la contredire. Il
 * n'y a qu'un contrôle capable de voir cette panne-là — compter les endroits où
 * l'adresse est écrite en dur, et exiger qu'il n'y en ait qu'un.
 *
 * Le jour où une quatrième apparaît, elle tombe ici plutôt qu'en production.
 */

const ROOT = join(__dirname, "..", "..", "..");
const SCANNED = ["app", "components", "lib", "middleware.ts", "next.config.ts"];
const SOURCE_EXT = /\.(ts|tsx)$/;
/** Le seul fichier autorisé à écrire l'adresse. */
const SOURCE_OF_TRUTH = join("lib", "shared", "discord.ts");
const INVITE_LITERAL = /discord\.gg\//;

function* sourceFiles(entry: string): Generator<string> {
  const absolute = join(ROOT, entry);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    return;
  }

  if (stats.isFile()) {
    if (SOURCE_EXT.test(absolute)) yield absolute;
    return;
  }

  for (const child of readdirSync(absolute)) {
    if (child === "node_modules" || child.startsWith(".")) continue;
    yield* sourceFiles(join(entry, child));
  }
}

describe("invitation Discord : une seule source", () => {
  it("n'est écrite en dur que dans lib/shared/discord.ts", () => {
    const offenders: string[] = [];

    for (const entry of SCANNED) {
      for (const file of sourceFiles(entry)) {
        const path = relative(ROOT, file);
        // `relative` et `join` emploient tous deux le séparateur de la
        // plateforme : la comparaison est juste sous Windows comme sous POSIX.
        if (path === SOURCE_OF_TRUTH) continue;
        if (INVITE_LITERAL.test(readFileSync(file, "utf8"))) offenders.push(path);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("est celle que les autres constantes réexportent", () => {
    // Le `sameAs` du JSON-LD et le secours de la page contact sont les deux
    // endroits où l'adresse survit sous un autre nom : ils doivent suivre.
    expect(ORGANIZATION_DISCORD_URL).toBe(DISCORD_INVITE_URL);
    expect(DEFAULT_CONTACT.discordUrl).toBe(DISCORD_INVITE_URL);
  });
});
