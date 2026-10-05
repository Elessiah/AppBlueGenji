import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { seedingReorderNeedsConfirmation } from "@/lib/shared/seeding";
import { scoreCorrectionNeedsConfirmation } from "@/app/(secured)/tournois/[id]/_lib/score-form";
import type { MatchStatus } from "@/lib/shared/types";

/**
 * Confirmations des gestes du staff qui défont quelque chose
 * (docs/features/ADMIN_CONFIRMATIONS.md) : la règle pure décide **quand** on
 * demande, la source dit que le geste attend la réponse. Les panneaux n'ont pas
 * de banc de rendu interactif : le câblage se lit dans la source, comme pour
 * les flèches du seeding.
 */
const ROOT = join(__dirname, "..", "..");
const read = (path: string) =>
  readFileSync(join(ROOT, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

const PANEL = read("app/(secured)/tournois/[id]/_components/RegistrationsPanel.tsx");
const SCORE = read("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
const SEEDING_SERVICE = read("lib/server/tournaments/seeding.ts");

describe("seedingReorderNeedsConfirmation", () => {
  it("demande au premier réordonnancement d'un tournoi seedé par le classement", () => {
    expect(seedingReorderNeedsConfirmation("RANKING")).toBe(true);
  });

  it("ne redemande pas une fois l'ordre manuel, ni sur l'ordre d'inscription", () => {
    expect(seedingReorderNeedsConfirmation("MANUAL")).toBe(false);
    expect(seedingReorderNeedsConfirmation("REGISTRATION")).toBe(false);
  });
});

describe("Seeding — la modale dit ce qui se passe réellement", () => {
  it("le serveur refuse tout réordonnancement dès qu'un match existe : aucun horaire en jeu", () => {
    expect(SEEDING_SERVICE).toMatch(/if \(matchRows\.length > 0\) throw new Error\("SEEDING_LOCKED_STARTED"\)/);
    expect(SEEDING_SERVICE).not.toMatch(/DELETE FROM bg_matches/);
  });

  it("une flèche n'écrit pas tant que la confirmation est due", () => {
    const move = /const move = async[\s\S]*?\n {2}\};/.exec(PANEL)?.[0] ?? "";
    expect(move).toMatch(/if \(!manualConfirmed && seedingReorderNeedsConfirmation\(source\)\) \{\s*setConfirmingMove\(\{ teamId, direction \}\);\s*return;/);
    expect(move).toMatch(/await performMove\(teamId, direction\)/);
  });

  it("annuler referme sans rien écrire ; confirmer joue le geste mis en attente, une seule fois", () => {
    expect(PANEL).toMatch(/onClose=\{\(\) => setConfirmingMove\(null\)\}/);
    expect(PANEL).toMatch(/await performMove\(confirmingMove\.teamId, confirmingMove\.direction\)/);
    expect(PANEL).toMatch(/if \(done\) setManualConfirmed\(true\)/);
  });

  it("nomme la perte : le classement ne rangera plus la liste, sans retour", () => {
    expect(PANEL).toContain(`title="Fixer l'ordre de départ à la main ?"`);
    expect(PANEL).toContain("définitivement, par un ordre fixé par le staff");
    expect(PANEL).toContain("Aucun match n&apos;existe encore");
  });

  it("un refus du serveur laisse la modale ouverte (applyOrder rend false)", () => {
    expect(PANEL).toMatch(/showError\(mapError\(\(e as Error\)\.message\)\);\s*return false;/);
    expect(PANEL).toMatch(/onChanged\(\);\s*return true;/);
  });
});

describe("scoreCorrectionNeedsConfirmation", () => {
  it("demande sur un match déjà tranché", () => {
    expect(scoreCorrectionNeedsConfirmation({ status: "COMPLETED" })).toBe(true);
  });

  it("laisse partir un premier résultat sans question", () => {
    const open: MatchStatus[] = ["PENDING", "READY", "AWAITING_CONFIRMATION"];
    for (const status of open) expect(scoreCorrectionNeedsConfirmation({ status })).toBe(false);
  });
});

describe("Correction d'un résultat — câblage", () => {
  it("aucune écriture n'échappe à la règle : Enregistrer comme Valider passent par run", () => {
    expect(SCORE).toMatch(/onClick=\{\(\) => void run\("save"\)\}/);
    expect(SCORE).toMatch(/void run\("resolve"\)/);
    expect(SCORE.match(/form\.submit\(/g)).toHaveLength(1);
    const run = /const run = async[\s\S]*?\n {2}\};/.exec(SCORE)?.[0] ?? "";
    expect(run).toMatch(/if \(scoreCorrectionNeedsConfirmation\(match\)\) \{\s*setConfirmingCorrection\(action\);\s*return;/);
  });

  it("annuler referme la seule confirmation ; confirmer écrit le geste demandé", () => {
    expect(SCORE).toMatch(/onClose=\{\(\) => setConfirmingCorrection\(null\)\}/);
    expect(SCORE).toMatch(/onConfirm=\{\(\) => perform\(confirmingCorrection\)\}/);
    expect(SCORE).toContain("son horaire conservé");
  });
});
