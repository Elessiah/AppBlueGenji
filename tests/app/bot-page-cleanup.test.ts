import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BOT_DOC_SECTIONS } from "@/lib/server/bot-docs";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const page = read("app/bot/page.tsx");
const commands = read("components/bot/BotCommands.tsx");
const servers = read("components/bot/BotServersTable.tsx");
const css = read("app/bot/bot.css");

/**
 * `/bot` portait deux blocs qui **avaient l'air** branchés sans l'être, et une
 * colonne que personne ne pouvait lire.
 *
 * 1. **« Modules »** ne tenait que si le bot exposait
 *    `/internal/servers/:id/modules` ; sinon la section rendait son en-tête
 *    (« 0 INSTALLÉS · 0 ACTIFS ») au-dessus d'une grille vide.
 * 2. **« Slash commands »** listait huit commandes écrites en dur dans
 *    `components/bot/mocks.ts` : une documentation fausse qui a l'air d'une
 *    documentation, et qu'aucun test ne pouvait contredire puisque le bot vit
 *    dans un autre dépôt. Le site sert déjà la vraie doc, lue à chaud, sur
 *    `/bot/docs`.
 * 3. **La colonne « STATUS »** rendait `OK` / `LAG` / `OFF` sans définition nulle
 *    part — « lag » est le vocabulaire du bot, pas celui du lecteur.
 *
 * Ces contrôles sont au niveau source : ce sont des composants serveur de mise
 * en page, et ce qu'on vérifie est justement **l'absence** de quelque chose.
 */
describe("/bot — la section « Modules » est partie", () => {
  it("ne rend plus le composant", () => {
    expect(page).not.toContain("BotModules");
    expect(existsSync(join(ROOT, "components/bot/BotModules.tsx"))).toBe(false);
  });

  it("n'appelle plus l'endpoint du bot qui la remplissait", () => {
    expect(page).not.toContain("fetchBotModules");
    expect(read("lib/server/bot-integration.ts")).not.toContain("fetchBotModules");
  });

  it("emporte ses types plutôt que de les laisser orphelins", () => {
    expect(read("lib/shared/types.ts")).not.toContain("BotModulesPayload");
  });

  it("emporte ses styles — une feuille qui garde des règles orphelines les fait ressusciter", () => {
    expect(css).not.toMatch(/^\.mod-/m);
    expect(css).not.toMatch(/^\.modules \{/m);
  });
});

describe("/bot — les commandes renvoient à leur source", () => {
  it("n'embarque plus de liste écrite en dur", () => {
    expect(existsSync(join(ROOT, "components/bot/mocks.ts"))).toBe(false);
    expect(commands).not.toContain('from "./mocks"');
    // Le « BUILD 4f8a » affiché en en-tête était inventé de bout en bout.
    expect(commands).not.toContain(">DERNIÈRE MAJ");
  });

  it("mène à `/bot/docs`, qui lit le Markdown du bot à chaud", () => {
    expect(commands).toContain("BOT_DOC_SECTIONS");
    expect(commands).toContain("/bot/docs/${section.slug}");
  });

  it("couvre tous les documents du registre, sans seconde liste", () => {
    // Le registre est la source unique : ajouter un doc suffit à l'afficher.
    expect(BOT_DOC_SECTIONS.length).toBeGreaterThan(0);
    for (const section of BOT_DOC_SECTIONS) {
      expect(typeof section.slug).toBe("string");
      expect(section.summary.length).toBeGreaterThan(0);
    }
  });

  it("ne numérote plus une section unique", () => {
    expect(commands).not.toContain("SECTION 0");
  });
});

describe("/bot — l'état d'un serveur se lit en français", () => {
  it("traduit les trois états", () => {
    expect(servers).toContain('ok: "● À jour"');
    expect(servers).toContain('lag: "● Retard"');
    expect(servers).toContain('off: "○ Hors ligne"');
  });

  it("n'affiche plus le vocabulaire du bot", () => {
    expect(servers).not.toContain('"● LAG"');
    expect(servers).not.toContain('"● OK"');
  });

  it("garde les valeurs renvoyées par le bot — c'est la traduction qui manquait", () => {
    expect(servers).toContain('className={"srv-status " + s.status}');
  });

  it("donne à chaque état une définition atteignable", () => {
    expect(servers).toContain("STATUS_HINT");
    expect(servers).toContain("title={STATUS_HINT[s.status]}");
  });

  it("intitule la colonne d'après ce qu'elle décrit", () => {
    expect(servers).toContain(">RELAIS</span>");
    expect(servers).not.toContain(">STATUS</span>");
  });
});

describe("/bot — les pictogrammes restants servent", () => {
  it("ne garde que celui que la page dessine", () => {
    const icon = read("components/bot/Icon.tsx");
    expect(icon).toContain('name: "discord"');
    for (const dead of ["swords", "relay", "chart"]) {
      expect(icon).not.toContain(`"${dead}"`);
    }
  });
});
