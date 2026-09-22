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

  it("ne laisse pas la feuille de route demander de la reconstruire", () => {
    // Une case à cocher qui demande l'appel sortant qu'on vient de retirer le
    // fait revenir : elle est barrée, et la décision nommée.
    const roadmap = read("docs/features/BOT_FEATURES_NEEDED.md");
    expect(roadmap).not.toMatch(/^ *- \[ \] `fetchBotModules/m);
    expect(roadmap).not.toContain("[components/bot/mocks.ts](components/bot/mocks.ts)");
    // Et pas davantage les endpoints que cet appel consommait : une section
    // lue de haut en bas ferait construire au bot ce que le site ne lit plus.
    expect(roadmap).not.toMatch(/^- \[ \] \*\*`GET  \/internal\/servers\/:id\/modules`/m);
    expect(roadmap).not.toMatch(/^- \[ \] \*\*`PUT  \/internal\/servers\/:id\/modules/m);
    expect(roadmap).toContain("Section abandonnée côté site");
    expect(roadmap).not.toContain("mod-foot`)");
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

  it("garde le rôle `list` qu'une liste sans puces perd sous Safari", () => {
    expect(commands).toContain('className="bot-docs-list" role="list"');
    expect(css).toContain("list-style: none;");
  });

  it("n'annonce que ce qu'elle tient : le contenu, pas la liste", () => {
    // Les titres et résumés viennent de `BOT_DOC_SECTIONS`, registre de CE
    // dépôt (c'est lui qui borne les fichiers lisibles) : seul le corps des
    // pages est relu chez le bot. Promettre une « mise à jour continue » de la
    // liste serait la même fausse promesse en plus discret.
    expect(commands).not.toContain("MISE À JOUR CONTINUE");
    expect(commands).toContain("CONTENU RELU DANS LE DÉPÔT DU BOT");
  });
});

describe("/bot — l'état d'un serveur se lit en français", () => {
  // La traduction elle-même est vérifiée sur le module pur
  // (`tests/lib/shared/bot-relay-status.test.ts`) : ici on ne contrôle que ce
  // qui ne peut se lire que dans le balisage.
  it("passe par le module pur plutôt que par une table locale", () => {
    expect(servers).toContain("resolveBotRelayState");
    expect(servers).not.toMatch(/"● (OK|LAG)"/);
    expect(servers).not.toContain('"○ OFF"');
  });

  it("colore d'après le registre, jamais d'après la chaîne reçue", () => {
    expect(servers).toContain('className={"srv-status " + relay.tone}');
    expect(servers).not.toContain('"srv-status " + s.status');
  });

  it("donne à chaque état une définition atteignable au doigt comme au clavier", () => {
    expect(servers).toContain("title={relay.hint}");
    expect(servers).toContain("aria-label={botRelayAccessibleLabel(relay)}");
  });

  it("intitule la colonne d'après ce qu'elle décrit, sans homonyme", () => {
    expect(servers).toContain(">ÉTAT DU RELAIS</span>");
    expect(servers).not.toContain(">STATUS</span>");
    // « RELAIS 30J » compte, « ÉTAT DU RELAIS » qualifie : deux en-têtes
    // homonymes se reliraient l'un pour l'autre.
    expect(servers).not.toMatch(/>RELAIS<\/span>/);
  });

  it("expose autant de cellules que l'en-tête a de colonnes", () => {
    // Un `aria-hidden` posé sur une cellule décale tout le tableau pour qui le
    // parcourt au lecteur d'écran.
    const headers = servers.match(/role="columnheader"/g) ?? [];
    const cells = servers.match(/role="cell"/g) ?? [];
    expect(headers).toHaveLength(6);
    expect(cells).toHaveLength(6);
    expect(servers).not.toMatch(/role="cell"[^>]*aria-hidden/);
    expect(servers).not.toMatch(/aria-hidden[^>]*role="cell"/);
  });

  it("a une couleur pour l'état qu'elle ne connaît pas", () => {
    expect(css).toContain(".srv-status.unknown");
  });

  it("tient le libellé le plus long sur une ligne", () => {
    // « ÉTAT DU RELAIS » et « ● Hors ligne » ne tenaient pas dans les 70px
    // d'origine : l'en-tête passait sur deux lignes et la rangée avec lui.
    expect(css).toContain("grid-template-columns: 28px 1fr 80px 80px 115px 60px;");
    expect(css).toMatch(/\.srv-status \{[^}]*white-space: nowrap;/);
  });

  it("ne fait confiance à aucun champ de la charge du bot", () => {
    // `fetchBotServers` fait un simple `as` : un champ manquant doit donner une
    // cellule fade, jamais un `TypeError` qui rendrait toute la page en 500.
    expect(servers).toContain("(s.memberCount ?? 0).toLocaleString");
    expect(servers).toContain("Array.isArray(s.sparkline)");
    expect(servers).not.toContain("s.sparkline.map");
    expect(servers).not.toContain("Math.max(...s.sparkline");
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
