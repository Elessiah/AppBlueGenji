import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EntrantProvider } from "@/app/(secured)/tournois/[id]/_lib/entrant-link";
import { EntrantLogo, EntrantName } from "@/app/(secured)/tournois/[id]/_components/EntrantName";
import { MatchRow } from "@/app/(secured)/tournois/[id]/_components/MatchRow";
import { ToastProvider } from "@/components/ui/toast";
import { buildEntrantLogoMap } from "@/lib/shared/entrant-logos";
import type { BracketMatch } from "@/lib/shared/types";

/**
 * Logos des engagés sur la page d'un tournoi.
 *
 * Le logo voyageait jusqu'à la page (`registrations[].logoUrl`) sans qu'aucune
 * vue le rende. Ces cas tiennent les trois moitiés du geste : le logo est rendu
 * quand il existe, l'initiale le remplace quand il n'existe pas (jamais un
 * fichier de repli), et une case vide garde sa place sans rien dessiner.
 */

const LOGO = "/api/uploads/teams/dragon.webp";

function withEntrants(children: ReactNode, soloUserIds: Record<number, number> = {}) {
  const logos = buildEntrantLogoMap([
    { teamId: 1, logoUrl: LOGO },
    { teamId: 2, logoUrl: null },
  ]);
  return renderToStaticMarkup(
    <EntrantProvider participantType="TEAM" soloUserIds={soloUserIds} logos={logos}>
      {children}
    </EntrantProvider>,
  );
}

function imgTags(markup: string): string[] {
  return markup.match(/<img\b[^>]*>/g) ?? [];
}

describe("EntrantLogo", () => {
  it("rend le logo de l'engagé, décoratif", () => {
    const html = withEntrants(<EntrantLogo teamId={1} name="Dragon Squad" />);
    const [img] = imgTags(html);

    expect(img).toBeDefined();
    expect(img).toContain('alt=""');
    expect(img).toContain(encodeURIComponent(LOGO));
    expect(html).toContain('aria-hidden="true"');
  });

  it("retombe sur l'initiale sans logo, sans aucune image", () => {
    const html = withEntrants(<EntrantLogo teamId={2} name="ember core" />);

    expect(imgTags(html)).toHaveLength(0);
    expect(html).toContain(">E</span>");
  });

  it("rend une initiale lisible pour un engagé inconnu au nom vide", () => {
    const html = withEntrants(<EntrantLogo teamId={99} name="" />);

    expect(imgTags(html)).toHaveLength(0);
    expect(html).toContain(">?</span>");
  });

  it("réserve la place d'une case vide sans rien dessiner", () => {
    const html = withEntrants(<EntrantLogo teamId={null} name="TBD" />);

    expect(imgTags(html)).toHaveLength(0);
    expect(html).not.toContain("TBD");
    expect(html).toContain('aria-hidden="true"');
  });

  it("préfère un logo fourni par l'appelant (équipe pas encore inscrite)", () => {
    const html = withEntrants(
      <EntrantLogo teamId={50} name="Fantôme" logoUrl="/api/uploads/teams/ghost.webp" />,
    );

    expect(imgTags(html)[0]).toContain(encodeURIComponent("/api/uploads/teams/ghost.webp"));
  });

  it("respecte un `null` explicite plutôt que le logo du contexte", () => {
    const html = withEntrants(<EntrantLogo teamId={1} name="Dragon" logoUrl={null} />);

    expect(imgTags(html)).toHaveLength(0);
    expect(html).toContain(">D</span>");
  });

  it("dimensionne la case d'après la taille demandée", () => {
    expect(withEntrants(<EntrantLogo teamId={1} name="Dragon" size={20} />)).toContain("--size:20px");
    expect(withEntrants(<EntrantLogo teamId={1} name="Dragon" />)).toContain("--size:16px");
  });

  it("ne rend rien de cassé hors de la page (contexte par défaut)", () => {
    const html = renderToStaticMarkup(<EntrantLogo teamId={1} name="Dragon" />);

    expect(imgTags(html)).toHaveLength(0);
    expect(html).toContain(">D</span>");
  });
});

describe("EntrantName", () => {
  it("précède le nom cliquable de son emblème", () => {
    const html = withEntrants(<EntrantName teamId={1} name="Dragon Squad" />);

    expect(html.indexOf("<img")).toBeGreaterThan(-1);
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf('href="/equipes/1"'));
    expect(html).toContain(">Dragon Squad</a>");
  });

  it("mène au profil du joueur derrière une entrée solo", () => {
    const html = withEntrants(<EntrantName teamId={2} name="Kite" />, { 2: 40 });

    expect(html).toContain('href="/joueurs/40"');
  });

  it("rend une case vide en texte simple, sans lien", () => {
    const html = withEntrants(<EntrantName teamId={null} name="BYE" />);

    expect(html).not.toContain("<a");
    expect(html).toContain(">BYE</span>");
  });

  it("affiche le contenu fourni à la place du nom", () => {
    const html = withEntrants(
      <EntrantName teamId={1} name="Dragon Squad">
        <strong>Dragon Squad</strong>
      </EntrantName>,
    );

    expect(html).toContain("<strong>Dragon Squad</strong></a>");
  });

  it("porte la classe du nom sur le lien, et celle du conteneur sur le conteneur", () => {
    const html = withEntrants(
      <EntrantName teamId={1} name="Dragon" className="wrap" textClassName="txt" truncate />,
    );

    expect(html).toMatch(/<span class="[^"]*\bwrap\b[^"]*">/);
    expect(html).toMatch(/<a class="entity-link [^"]*\btxt\b/);
  });
});

function match(overrides: Partial<BracketMatch> = {}): BracketMatch {
  return {
    id: 10,
    tournamentId: 3,
    bracket: "UPPER",
    roundNumber: 1,
    matchNumber: 1,
    status: "READY",
    team1Id: 1,
    team2Id: 2,
    team1Name: "Dragon Squad",
    team2Name: "Ember Core",
    team1Placeholder: null,
    team2Placeholder: null,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    loserTeamId: null,
    forfeitTeamId: null,
    doubleForfeit: false,
    nextWinnerMatchId: null,
    nextWinnerSlot: null,
    nextLoserMatchId: null,
    nextLoserSlot: null,
    scoreDeadlineAt: null,
    updatedAt: "2026-09-01T18:00:00.000Z",
    phaseId: 0,
    phasePosition: null,
    startAt: null,
    liveTrigger: null,
    liveUrl: null,
    liveStartedAt: null,
    replayUrl: null,
    ...overrides,
  };
}

function renderMatch(value: BracketMatch) {
  // Le bandeau de diffusion de la carte notifie par toast : il lui faut son fournisseur.
  return withEntrants(
    <ToastProvider>
      <MatchRow
        match={value}
        reportable={false}
        adminResolvable={false}
        onScoreChange={() => {}}
        myScore=""
        opponentScore=""
        onSubmit={async () => {}}
        onOpenAdminModal={() => {}}
        allMatches={[value]}
        roundNumber={value.roundNumber}
        format="SINGLE"
      />
    </ToastProvider>,
  );
}

describe("MatchRow — logos des deux engagés", () => {
  it("rend le logo d'un côté et l'initiale de l'autre", () => {
    const html = renderMatch(match());

    expect(imgTags(html)).toHaveLength(1);
    expect(html).toContain(">E</span>");
    expect(html).toContain('href="/equipes/1"');
    expect(html).toContain('href="/equipes/2"');
  });

  it("garde l'emblème d'une case vide pour aligner les deux noms", () => {
    const html = renderMatch(match({ team2Id: null, team2Name: null }));

    // Deux emblèmes : celui de l'engagé, et la case réservée du « BYE ».
    expect(html.match(/--size:16px/g)).toHaveLength(2);
    expect(html).toContain(">BYE</span>");
  });
});

/**
 * Le passage par `EntrantName` est ce qui fait apparaître le logo : une vue qui
 * reviendrait à `EntrantLink` seul afficherait de nouveau un nom sans emblème,
 * sans qu'aucun rendu ne casse.
 */
describe("vues du tournoi — le nom d'un engagé porte son emblème", () => {
  const ROOT = join(__dirname, "..", "..");
  const TOURNAMENT = join(ROOT, "app", "(secured)", "tournois", "[id]");
  const COMPONENTS = join(TOURNAMENT, "_components");

  it("aucune vue ne rend un engagé par EntrantLink seul", () => {
    const offenders = readdirSync(COMPONENTS).filter((file) => {
      if (!file.endsWith(".tsx") || file === "EntrantName.tsx") return false;
      return readFileSync(join(COMPONENTS, file), "utf8").includes("<EntrantLink");
    });

    expect(offenders).toEqual([]);
  });

  it("construit la table des logos depuis les inscrites et la pose dans le contexte", () => {
    const page = readFileSync(join(TOURNAMENT, "page.tsx"), "utf8");

    expect(page).toContain("buildEntrantLogoMap(detail?.registrations ?? [])");
    expect(page).toContain("logos={entrantLogos}");
  });
});

describe("emblème — alignement et cas limites", () => {
  const ROOT = join(__dirname, "..", "..");
  const COMPONENTS = join(ROOT, "app", "(secured)", "tournois", "[id]", "_components");
  const read = (file: string) => readFileSync(join(COMPONENTS, file), "utf8");
  const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "");

  it("aligne le conteneur sur la ligne de base du nom, l'emblème à part", () => {
    // À côté d'un seed ou d'un « Vainqueur : », c'est la première ligne du nom
    // qui fait foi, même quand il passe à la ligne ; une image n'a pas de ligne
    // de base, l'emblème se centre donc seul.
    const css = stripComments(read("EntrantName.module.css"));
    const label = css.slice(css.indexOf(".label {"));

    expect(label.slice(0, label.indexOf("}"))).toContain("align-items: baseline");
    // Dans une phrase, le nom se pose sur la ligne de base du texte voisin.
    expect(label.slice(0, label.indexOf("}"))).not.toContain("vertical-align");
    expect(css).toMatch(/\.label > \.logo \{\s*align-self: center;/);
  });

  it("garde le seed de l'aperçu sur la première ligne du nom", () => {
    expect(read("BracketPreview.tsx")).toContain('alignItems: "baseline", gap: 8');
  });

  it("ne réserve pas de case blanche devant le libellé d'un côté vide du dialogue de score", () => {
    expect(stripComments(read("AdminScoreDialog.tsx"))).toContain(
      "{teamId !== null && <EntrantLogo teamId={teamId}",
    );
  });
});

