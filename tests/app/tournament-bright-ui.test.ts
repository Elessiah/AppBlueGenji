import { describe, expect, it } from "@jest/globals";
import { join } from "node:path";
import { contrastRatio } from "@/lib/shared/color-contrast";
import { STATE_META } from "@/app/(secured)/tournois/[id]/_lib/header-meta";
import { phaseStateVariant } from "@/app/(secured)/tournois/[id]/_lib/phases";
import type { PhaseState, TournamentState } from "@/lib/shared/types";
import { globals, ROOT, stripComments } from "./_lib/style-sweep";
import { readSource } from "../helpers/read-source";

/**
 * Pages tournoi en néon froid (`docs/features/TOURNAMENT_LIST_CARDS.md`
 * § Couleurs d'état, `TOURNAMENT_HEADER.md`, `ROUND_MATCH_SECTIONS.md`) : un état
 * prend une variante sémantique, jamais un gris ni le rouge d'antenne, et
 * chaque texte coloré tient 4,5:1 sur le voile de sa propre teinte.
 */

const root = stripComments(globals).match(/(?:^|\})\s*:root\s*\{([^}]*)\}/)![1];
const token = (name: string): string => {
  const value = root.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`))?.[1];
  if (!value) throw new Error(`jeton ${name} introuvable`);
  return value;
};

/** Couleur `hex` posée à `alpha` sur le fond `under` (voile translucide). */
function over(hex: string, alpha: number, under: string): string {
  const channel = (color: string, index: number) => Number.parseInt(color.slice(index, index + 2), 16);
  return `#${[1, 3, 5]
    .map((index) => Math.round(channel(hex, index) * alpha + channel(under, index) * (1 - alpha)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

const SURFACE = "#161a22"; // --cyber-bg-3, le fond le plus clair du site
const tournamentDir = join(ROOT, "app", "(secured)", "tournois");
const LIST_CSS = stripComments(readSource(join(tournamentDir, "tournois.module.css")));
const HEADER_CSS = stripComments(
  readSource(join(tournamentDir, "[id]", "_components", "TournamentHeader.module.css")),
);
const SECTIONS_CSS = stripComments(
  readSource(join(tournamentDir, "[id]", "_components", "RoundMatchSections.module.css")),
);
const MATCH_CSS = stripComments(readSource(join(tournamentDir, "[id]", "_components", "MatchRow.module.css")));
const PAGE_CSS = stripComments(readSource(join(tournamentDir, "[id]", "page.module.css")));

/** Teinte de texte et voile `rgb` d'un tour de `--tone` / `--state-*` / `--section-*`. */
const TONE_TOKENS: Record<string, [text: string, rgbToken: string]> = {
  info: ["--blue-300", "--blue-500"],
  highlight: ["--pink-400", "--pink-400"],
  accent: ["--violet-300", "--violet-400"],
  success: ["--teal-400", "--teal-400"],
};

describe("en-tête de la fiche — tons d'état", () => {
  it("donne à chaque état sa variante sémantique, ni gris ni rouge", () => {
    expect(STATE_META.UPCOMING.tone).toBe("accent");
    expect(STATE_META.REGISTRATION.tone).toBe("highlight");
    expect(STATE_META.RUNNING.tone).toBe("info");
    expect(STATE_META.FINISHED.tone).toBe("success");
    const states: TournamentState[] = ["UPCOMING", "REGISTRATION", "RUNNING", "FINISHED"];
    expect(new Set(states.map((state) => STATE_META[state].tone)).size).toBe(4);
  });

  it("chaque ton a sa classe, au jeton de sa variante, lisible sur son voile", () => {
    for (const [tone, [text, rgbToken]] of Object.entries(TONE_TOKENS)) {
      const name = `state${tone[0].toUpperCase()}${tone.slice(1)}`;
      const block = HEADER_CSS.match(new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(block).toContain(`--state-ink: var(${text})`);
      const fill = Number(block.match(/--state-fill:\s*rgba\([^,]+,\s*([\d.]+)\)/)?.[1]);
      expect(fill).toBeGreaterThan(0);
      expect(contrastRatio(token(text), over(token(rgbToken), fill, SURFACE))).toBeGreaterThanOrEqual(4.5);
    }
    expect(HEADER_CSS).not.toMatch(/stateNeutral|stateMuted|stateGreen|79,\s*224,\s*162/);
  });

  it("habille l'en-tête du dégradé de marque, sans le vert hérité", () => {
    expect(HEADER_CSS).toMatch(/\.header\.header::after\s*\{[^}]*var\(--grad-brand\)/);
    expect(HEADER_CSS).toMatch(/\.title\.title\s*\{[^}]*--title-rgb-b:\s*var\(--violet-400-rgb\)/);
    const header = readSource(join(tournamentDir, "[id]", "_components", "TournamentHeader.tsx"));
    expect(header).not.toMatch(/ds-header green|ds-title green/);
  });
});

describe("frise des phases — variante par état", () => {
  it.each<[PhaseState, boolean, string]>([
    ["RUNNING", true, "info"],
    ["RUNNING", false, "info"],
    ["PENDING", true, "info"],
    ["PENDING", false, "accent"],
    ["FINISHED", false, "success"],
    ["SKIPPED", false, "neutral"],
    ["SKIPPED", true, "neutral"],
  ])("%s (courante : %s) → %s", (state, isCurrent, variant) => {
    expect(phaseStateVariant(state, isCurrent)).toBe(variant);
  });
});

describe("liste /tournois — couleurs d'état", () => {
  const STATES: Array<[card: string, section: string, tone: keyof typeof TONE_TOKENS]> = [
    ["running", "running", "info"],
    ["open", "registration", "highlight"],
    ["soon", "upcoming", "accent"],
    ["done", "finished", "success"],
  ];

  it.each(STATES)("carte %s et section %s partagent la teinte %s", (card, section, tone) => {
    const [text, rgbToken] = TONE_TOKENS[tone];
    const selector = new RegExp(
      `\\.sectionNavLink\\[data-tone="${section}"\\],\\s*\\.section\\[data-tone="${section}"\\],\\s*\\.card\\[data-state="${card}"\\]\\s*\\{([^}]*)\\}`,
    );
    const block = LIST_CSS.match(selector)?.[1] ?? "";
    expect(block).toContain(`--tone: var(${text})`);
    expect(block).toContain(`--tone-rgb: var(${rgbToken}-rgb)`);
    // Ruban : texte de la teinte sur un voile à 10 % de la même teinte.
    expect(contrastRatio(token(text), over(token(rgbToken), 0.1, SURFACE))).toBeGreaterThanOrEqual(4.5);
  });

  it("les rubans lisent la teinte d'état, plus aucun vert ni gris hérité", () => {
    expect(LIST_CSS).toMatch(/\.cardRibbonDone\s*\{[^}]*color:\s*var\(--tone\)/);
    expect(LIST_CSS).not.toMatch(/#4fe0a2|79,\s*224,\s*162|pulseGreen/);
  });

  it("le survol est un halo sans déplacement, réservé au pointeur fin", () => {
    expect(LIST_CSS).not.toMatch(/\.card:hover\s*\{[^}]*translate/);
    expect(LIST_CSS).toMatch(
      /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.card\[data-state\]:hover\s*\{[^}]*box-shadow/,
    );
  });

  it("les points qui pulsent suivent le régime de charge", () => {
    for (const name of ["cardRibbonRunning", "cardRibbonOpen"]) {
      const block = LIST_CSS.match(new RegExp(`\\.${name} \\.dot\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(block).toMatch(/animation:[^;]*infinite/);
      expect(block).toMatch(/animation-play-state:\s*var\(--deco-anim-state\)/);
    }
  });

  it("aucune teinte d'état n'emprunte le rouge d'antenne", () => {
    expect(LIST_CSS).not.toMatch(/--red-live/);
    expect(SECTIONS_CSS).not.toMatch(/--red-live/);
    expect(HEADER_CSS).not.toMatch(/--red-live/);
  });
});

describe("fiche — filets de section, cartes de match, panneaux", () => {
  it.each<[string, keyof typeof TONE_TOKENS]>([
    ["TO_PLAN", "highlight"],
    ["WAITING", "accent"],
    ["LOBBY", "info"],
    ["PLAYING", "info"],
    ["DONE", "success"],
  ])("le filet %s prend la teinte %s", (section, tone) => {
    const [text] = TONE_TOKENS[tone];
    const block = SECTIONS_CSS.match(
      new RegExp(`\\.divider\\[data-section="${section}"\\][^{]*\\{([^}]*)\\}`),
    )?.[1];
    expect(block).toContain(`--section-ink: var(${text})`);
    expect(contrastRatio(token(text), SURFACE)).toBeGreaterThanOrEqual(4.5);
  });

  it("le vainqueur se lit en turquoise sur sa ligne teintée", () => {
    expect(MATCH_CSS).toMatch(/\.winner\s*\{[^}]*var\(--teal-400\) 15%/);
    const line = over(token("--teal-400"), 0.15, token("--cyber-bg-2"));
    expect(contrastRatio(token("--teal-400"), line)).toBeGreaterThanOrEqual(4.5);
  });

  it("la carte de match s'illumine au survol sans bouger ni effacer l'anneau d'ancre", () => {
    const hover = MATCH_CSS.match(
      /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.card:hover:not\(:global\(\.match-anchor-target\)\)\s*\{([^}]*)\}/,
    )?.[1];
    expect(hover).toMatch(/box-shadow/);
    expect(hover).not.toMatch(/transform/);
  });

  it("les titres de panneau en dégradé retombent sur un aplat sous « Contraste renforcé » et à l'impression", () => {
    expect(PAGE_CSS).toMatch(/\.sheet :global\(\.ds-section-title\.green\) h2[^{]*\{[^}]*var\(--grad-brand\)/);
    // Variantes en dégradé seulement : « Zone de danger » garde son rouge.
    expect(PAGE_CSS).toMatch(
      /:global\(:root\[data-a11y~="contrast"\]\) \.sheet :global\(\.ds-section-title\.green\) h2,\s*:global\(:root\[data-a11y~="contrast"\]\) \.sheet :global\(\.ds-section-title\.blue\) h2\s*\{[^}]*color:\s*var\(--ink\)/,
    );
    expect(PAGE_CSS).not.toMatch(/\.sheet :global\(\.ds-section-title\) h2/);
  });

  it("« Contraste renforcé » rend aux liserés translucides leur bordure à jeton", () => {
    expect(PAGE_CSS).toMatch(
      /:global\(:root\[data-a11y~="contrast"\]\) \.sheet :global\(\.ds-block\.ds-block\):not\(\.danger\)\s*\{[^}]*border-color:\s*var\(--line\)/,
    );
    expect(LIST_CSS).toMatch(
      /:global\(:root\[data-a11y~="contrast"\]\) \.sectionNavLink\[data-tone\]\s*\{[^}]*border-color:\s*var\(--line-strong-cy\)/,
    );
    // À l'impression, le repli reprend **les mêmes sélecteurs** que le dégradé :
    // moins spécifique, il perdrait, et le titre (texte transparent, fond non
    // imprimé) sortirait blanc.
    expect(PAGE_CSS).toMatch(
      /@media print\s*\{\s*\.sheet :global\(\.ds-section-title\.green\) h2,\s*\.sheet :global\(\.ds-section-title\.blue\) h2\s*\{[^}]*color:\s*var\(--ink\)/,
    );
    const page = readSource(join(tournamentDir, "[id]", "page.tsx"));
    expect(page).toContain("styles.sheet");
  });
});
