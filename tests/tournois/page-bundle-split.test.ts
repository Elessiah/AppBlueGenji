import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LAZY_RELOAD_COOLDOWN_MS,
  isChunkLoadError,
  orReload,
  reloadAfterChunkError,
  type LazyReloadEnv,
} from "@/app/(secured)/tournois/[id]/_lib/lazy-component";

/**
 * Découpage du paquet de la fiche tournoi. La panne est muette : un `import`
 * statique réintroduit à côté du `dynamic()` ne casse rien, il ramène seulement
 * le composant dans le paquet de chaque spectateur — seul `next build` le voit.
 */

const PAGE_DIR = "app/(secured)/tournois/[id]";
const page = readFileSync(join(process.cwd(), PAGE_DIR, "page.tsx"), "utf8");

const LAZY = [
  "SurvivalView",
  "SwissView",
  "EnduranceView",
  "BracketPreview",
  "PhaseStandingsBlock",
  "EntrantContactsPanel",
  "AdminScoreDialog",
  "PlayerScoreDialog",
  "GhostRegistrationDialog",
  "MatchLiveDialog",
  "MatchScheduleDialog",
  "MatchReplayDialog",
  "IssueReportDialog",
  "DeleteTournamentDialog",
  "RollbackRoundDialog",
  "EndurancePenaltyDialog",
  "AdvanceTournamentDialog",
  "TournamentImageDialog",
  "ConfirmActionDialog",
] as const;

describe("paquet de la fiche tournoi", () => {
  it.each(LAZY.map((name) => [name]))("%s est chargé à la demande", (name) => {
    expect(page).toContain(
      `const ${name} = dynamic(() => orReload(import("./_components/${name}").then((m) => m.${name})), { ssr: false });`,
    );
    expect(page).not.toMatch(new RegExp(`^import[^;]*\\b${name}\\b[^;]*from`, "m"));
    expect(page).toContain(`<${name}`);
  });

  it("désigne des modules qui existent et exportent le composant nommé", () => {
    for (const name of LAZY) {
      const file = join(process.cwd(), PAGE_DIR, "_components", `${name}.tsx`);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf8")).toMatch(new RegExp(`export (function|const) ${name}\\b`));
    }
  });

  it("n'importe aucun dialogue de façon statique", () => {
    const staticDialogs = page.match(/^import \{[^}]*Dialog\b[^}]*\} from "\.\/_components\/[^"]+";$/gm);
    expect(staticDialogs).toBeNull();
  });
});

describe("filet d'un chargement à la demande (orReload)", () => {
  const chunkError = () => Object.assign(new Error("Loading chunk 42 failed."), { name: "ChunkLoadError" });

  const makeEnv = (stamp: string | null, now = 1_000_000, modal = false) => {
    const state = { stamp, reloads: 0, modal, writable: true, pending: [] as Array<() => void> };
    const env: LazyReloadEnv = {
      now: () => now,
      safeNow: () => !state.modal,
      whenSafe: (callback) => {
        state.pending.push(callback);
      },
      readStamp: () => state.stamp,
      writeStamp: (value) => {
        state.stamp = value;
        return state.writable;
      },
      reload: () => {
        state.reloads += 1;
      },
    };
    return { env, state };
  };

  it("rend le composant chargé sans rien recharger", async () => {
    const { env, state } = makeEnv(null);
    const Comp = () => null;
    await expect(orReload(Promise.resolve(Comp), env)).resolves.toBe(Comp);
    expect(state.reloads).toBe(0);
  });

  it("recharge la page sur un fichier disparu et rend un composant vide", async () => {
    const { env, state } = makeEnv(null);
    const Loaded = await orReload(Promise.reject(chunkError()), env);
    expect(state.reloads).toBe(1);
    expect(state.stamp).toBe("1000000");
    expect((Loaded as () => null)()).toBeNull();
  });

  it("attend qu'il soit sûr de recharger (modale ouverte, hors ligne)", async () => {
    const { env, state } = makeEnv(null, 1_000_000, true);
    const Loaded = await orReload(Promise.reject(chunkError()), env);
    expect(state.reloads).toBe(0);
    expect(state.stamp).toBeNull();
    expect((Loaded as () => null)()).toBeNull();
    expect(state.pending).toHaveLength(1);
    state.modal = false;
    state.pending[0]();
    expect(state.reloads).toBe(1);
  });

  it("ne recharge pas deux fois dans la minute", () => {
    const { env, state } = makeEnv(String(1_000_000 - LAZY_RELOAD_COOLDOWN_MS + 1));
    expect(reloadAfterChunkError(env)).toBe(false);
    expect(state.reloads).toBe(0);
  });

  it("recharge de nouveau une fois la minute écoulée ou sur une marque illisible", () => {
    expect(reloadAfterChunkError(makeEnv(String(1_000_000 - LAZY_RELOAD_COOLDOWN_MS)).env)).toBe(true);
    expect(reloadAfterChunkError(makeEnv("n'importe quoi").env)).toBe(true);
  });

  it("ne recharge pas quand la marque ne peut pas être écrite (pas de boucle)", () => {
    const { env, state } = makeEnv(null);
    state.writable = false;
    expect(reloadAfterChunkError(env)).toBe(false);
    expect(state.reloads).toBe(0);
  });

  it("laisse remonter une erreur qui n'est pas un fichier manquant", async () => {
    const { env, state } = makeEnv(null);
    const bug = new TypeError("x is not a function");
    await expect(orReload(Promise.reject(bug), env)).rejects.toBe(bug);
    expect(state.reloads).toBe(0);
  });

  it.each<[string, boolean]>([
    ["Loading chunk 123 failed.", true],
    ["Loading CSS chunk 7 failed.", true],
    ["Failed to fetch dynamically imported module: https://x/a.js", true],
    ["error loading dynamically imported module", true],
    ["Importing a module script failed.", true],
    ["x is not a function", false],
  ])("reconnaît « %s » : %s", (message, expected) => {
    expect(isChunkLoadError(new Error(message))).toBe(expected);
  });

  it("reconnaît une ChunkLoadError par son nom, et rien qui ne soit une Error", () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError("Loading chunk 1 failed")).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it("ne fait rien hors navigateur", async () => {
    expect(reloadAfterChunkError(null)).toBe(false);
    const Loaded = await orReload(Promise.reject(chunkError()), null);
    expect((Loaded as () => null)()).toBeNull();
  });
});
