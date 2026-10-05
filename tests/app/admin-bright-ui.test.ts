import { describe, expect, it } from "@jest/globals";
import { join, relative } from "node:path";
import { contrastRatio } from "@/lib/shared/color-contrast";
import { REPORT_STATUS_PILL, reportStatTone, type ReportSummaryKey } from "@/lib/shared/content-reports";
import { BUREAU_COLORS } from "@/lib/shared/bureau";
import { FORM_SECTION_TONE, sectionEyebrow } from "@/app/(secured)/tournois/_lib/form-styles";
import { globals, ROOT, stripComments, walk } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

/**
 * Lot « Administration et signalements » de LANDING_ANIMATIONS.md, et la règle
 * « ambre = avertissement uniquement » (DESIGN_SYSTEM.md § Ambre).
 */

const root = stripComments(globals).match(/(?:^|\})\s*:root\s*\{([^}]*)\}/)![1];
const hex = (name: string) => root.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))![1];
const triplet = (name: string) =>
  root
    .match(new RegExp(`${name}:\\s*(\\d+),\\s*(\\d+),\\s*(\\d+);`))!
    .slice(1, 4)
    .map(Number);

function blend(base: string, tint: number[], alpha: number): string {
  const rgb = [1, 3, 5].map((i) => Number.parseInt(base.slice(i, i + 2), 16));
  const mixed = rgb.map((c, i) => Math.round(c * (1 - alpha) + tint[i] * alpha));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const AMBER = /--amber\b|--amber-rgb|245,\s*165,\s*36|\bAMBER\b/;
const LEGACY_ORANGE = /--accent-orange|--orange-rgb|255,\s*157,\s*46|#ff9d2e/i;

/**
 * Seuls fichiers où l'ambre a droit de cité, chacun pour un avertissement.
 * Un nouveau fichier qui le prend échoue ici : soit c'est un avertissement et
 * il s'ajoute à la liste avec sa raison, soit il prend un néon froid.
 */
const AMBER_WARNINGS: Record<string, string> = {
  "app/(secured)/admin/signalements/reports.module.css": "à traiter / contestés non nuls, quarantaine, masquer",
  "app/(secured)/equipes/[id]/team.module.css": "bandeau de modération",
  "app/(secured)/joueurs/[id]/player.module.css": "bandeau de modération",
  "app/(secured)/profil/ConnectedAppsSection.tsx": "refus de détacher la dernière connexion",
  "app/(secured)/signalements/[id]/concerned.module.css": "alerte à la personne visée",
  "app/(secured)/tournois/[id]/_components/EnduranceNextRoundPanel.module.css": "avertissement de manche",
  "app/(secured)/tournois/[id]/_components/EnduranceView.module.css": "pénalité d'endurance",
  "app/(secured)/tournois/[id]/_components/EnduranceView.tsx": "pénalité, « Abandonner »",
  "app/(secured)/tournois/[id]/_components/EntrantContactsPanel.module.css": "engagé injoignable",
  "app/(secured)/tournois/[id]/_components/GhostRegistrationDialog.module.css": "dépassement de places",
  "app/(secured)/tournois/[id]/_components/MatchCardActions.module.css": "geste à risque",
  "app/(secured)/tournois/[id]/_components/MatchLaunchStrip.module.css": "match à planifier",
  "app/(secured)/tournois/[id]/_components/MatchLiveStrip.module.css": "diffusion manquante",
  "app/(secured)/tournois/[id]/_components/MatchReplayDialog.tsx": "rejeu impossible",
  "app/(secured)/tournois/[id]/_components/MatchRow.module.css": "forfait",
  "app/(secured)/tournois/[id]/_components/MatchScheduleDialog.tsx": "avertissement d'horaire",
  "app/(secured)/tournois/[id]/_components/RegistrationsPanel.module.css": "avertissement d'inscription",
  "app/(secured)/tournois/[id]/_components/RemoveEntrantDialog.tsx": "retrait d'un engagé",
  "app/(secured)/tournois/[id]/_components/RollbackRoundDialog.tsx": "retour en arrière",
  "app/(secured)/tournois/[id]/_components/RoundColumns.tsx": "« Abandonner », forfait",
  "app/(secured)/tournois/[id]/_components/ScoreDialog.module.css": "désaccord, forfait",
  "app/(secured)/tournois/[id]/_components/SurvivalView.tsx": "forfait, zone d'élimination",
  "app/(secured)/tournois/[id]/_components/SwissView.tsx": "forfait",
  "app/(secured)/tournois/[id]/_components/TournamentImageDialog.tsx": "avertissement d'image",
  "app/(secured)/tournois/[id]/modifier/page.tsx": "tournoi terminé / champs verrouillés",
  "app/(secured)/tournois/[id]/page.module.css": "retour en arrière",
  "app/(secured)/tournois/_components/RefereeSchedulingField.tsx": "planification arbitre",
  "app/(secured)/tournois/tournois.module.css": "« Complet », clôture proche",
  "components/arena-nav.module.css": "lien de modération (décision attendue)",
  // Pages publiques, triées au lot « Nettoyage ».
  "app/bot/bot.css": "relais en retard, latence élevée",
  "app/connexion/_components/OAuthButtons.tsx": "navigateur qui bloque la connexion",
  "app/recrutement/page.module.css": "« Prioritaire », compteur proche de la limite",
  // Bouton « Signaler un problème » des pieds de page, repassé à l'ambre.
  "components/cyber/landing/PublicFooter.module.css":
    "signaler un problème = avertissement / appel à l'attention, décision utilisateur 2026-10-05",
  "components/legal/SiteFooterBar.module.css":
    "signaler un problème = avertissement / appel à l'attention, décision utilisateur 2026-10-05",
};

function sources(): string[] {
  return ["app", "components", "lib"]
    .flatMap((dir) => [".css", ".tsx", ".ts"].flatMap((suffix) => walk(join(ROOT, dir), suffix)))
    .map((path) => relative(ROOT, path).split("\\").join("/"))
    .filter((path) => path !== "app/globals.css");
}

describe("ambre = avertissement uniquement", () => {
  const files = sources();

  it("aucun fichier hors de la liste des avertissements ne prend l'ambre", () => {
    const offenders = files.filter((file) => !(file in AMBER_WARNINGS) && AMBER.test(readSource(file)));
    expect(offenders).toEqual([]);
  });

  it("la liste ne garde aucun fichier qui n'en a plus besoin", () => {
    const stale = Object.keys(AMBER_WARNINGS).filter((file) => !AMBER.test(readSource(file)));
    expect(stale).toEqual([]);
  });

  it("l'orange hérité a disparu des écrans (seul globals.css le déclare encore)", () => {
    expect(files.filter((file) => LEGACY_ORANGE.test(readSource(file)))).toEqual([]);
  });

  it("la palette du bureau n'a plus de teinte chaude", () => {
    for (const color of BUREAU_COLORS) {
      const [r, , b] = color.match(/\d+/g)!.map(Number);
      expect(b).toBeGreaterThanOrEqual(r * 0.6);
    }
  });

  it("les marques informatives des classements ne prennent plus l'ambre", () => {
    const columns = readSource("app/(secured)/tournois/[id]/_components/RoundColumns.tsx");
    const badge = columns.slice(columns.indexOf("function RoundBadge"), columns.indexOf("export function ChampionBanner"));
    expect(badge).toContain("--pink-400");
    expect(badge).not.toMatch(AMBER);
    expect(readSource("app/(secured)/tournois/[id]/_lib/bracket-sections.ts")).not.toMatch(AMBER);
    expect(readSource("components/client-power-badge.module.css")).not.toMatch(AMBER);
  });
});

describe("signalements — vue d'ensemble", () => {
  const keys: ReportSummaryKey[] = ["open", "inProgress", "contested", "archived"];

  it("« à traiter » et « contestés » non nuls passent en avertissement", () => {
    expect(reportStatTone("open", 1)).toBe("warning");
    expect(reportStatTone("contested", 3)).toBe("warning");
  });

  it("à zéro, ou pour un compteur qui n'attend rien, la teinte reste froide", () => {
    expect(reportStatTone("open", 0)).toBe("info");
    expect(reportStatTone("contested", 0)).toBe("highlight");
    expect(reportStatTone("inProgress", 12)).toBe("accent");
    expect(reportStatTone("archived", 40)).toBe("info");
  });

  it("chaque teinte a sa règle dans la feuille, et chaque chiffre est lisible (AA)", () => {
    const css = readSource("app/(secured)/admin/signalements/reports.module.css");
    const surface = hex("--cyber-bg-1");
    const tones = new Set(keys.flatMap((key) => [reportStatTone(key, 0), reportStatTone(key, 1)]));
    const ink: Record<string, [string, string]> = {
      info: ["--blue-300", "--blue-500-rgb"],
      accent: ["--violet-300", "--violet-400-rgb"],
      highlight: ["--pink-400", "--pink-400-rgb"],
      warning: ["--amber", "--amber-rgb"],
    };
    for (const tone of tones) {
      if (tone !== "info") expect(css).toContain(`.stat[data-tone="${tone}"]`);
      const [text, tint] = ink[tone];
      expect(contrastRatio(hex(text), blend(surface, triplet(tint), 0.12))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("l'état d'un signalement reprend la variante de la page de la personne visée", () => {
    const pill = readSource("app/(secured)/admin/signalements/_components/StatusPill.tsx");
    expect(pill).toContain("cy-tag-${REPORT_STATUS_PILL[status]}");
    expect(Object.values(REPORT_STATUS_PILL)).not.toContain("warning");
  });
});

describe("formulaire de tournoi — sections teintées", () => {
  it("chaque section a son néon froid, lisible sur la carte", () => {
    const tokens = Object.values(FORM_SECTION_TONE).map((value) => value.match(/var\((--[\w-]+)\)/)![1]);
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const token of tokens) {
      expect(token).not.toMatch(/amber|orange|result-loss|red-live/);
      expect(contrastRatio(hex(token), hex("--cyber-bg-3"))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("le titre garde sa marge et prend la teinte", () => {
    expect(sectionEyebrow("format")).toEqual({ margin: "0 0 16px", color: "var(--violet-300)" });
  });
});
