import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamCard } from "@/app/(secured)/equipes/cards/TeamCard";
import { FinishedCard } from "@/app/(secured)/tournois/cards/FinishedCard";
import {
  RANKING_PLACEMENT_ONLY_HINT,
  RANKING_POINTS_HINT,
  RANKING_UNRANKED_HINT,
  RANKING_UNRANKED_SHORT,
} from "@/lib/shared/ranking";
import type { TeamListItem } from "@/lib/shared/types";
import { tournamentCard } from "../helpers/tournament-card";

/**
 * Une carte dont le lien est une plaque transparente posée par-dessus tout son
 * contenu (`.cardOverlay`) ne peut porter aucune information en `title` : la
 * souris n'atteint jamais l'enfant qui le porte, l'infobulle native ne se
 * déclenche plus. Deux cartes en souffraient — le nom complet du vainqueur
 * (tronqué en ellipse) et la légende du total de points d'une équipe.
 */

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Retire les commentaires : ils citent des sélecteurs et du code en prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

function team(overrides: Partial<TeamListItem> = {}): TeamListItem {
  return {
    id: 12,
    name: "Dragon Squad",
    tag: null,
    logoUrl: null,
    membersCount: 5,
    createdAt: "2026-01-15T10:00:00.000Z",
    rank: 4,
    points: 521,
    wins: 6,
    losses: 3,
    form: ["w", "l", "w"],
    games: ["OW"],
    rosterPreview: [{ userId: 1, pseudo: "Kite", avatarUrl: null }],
    region: "FR",
    isGhost: false,
    ...overrides,
  };
}

describe("FinishedCard — nom du vainqueur tronqué", () => {
  const longName = "Les Invincibles du Dimanche Soir Qui Ne Perdent Jamais Rien";

  it("ne confie plus le nom complet à un `title` inatteignable", () => {
    const markup = renderToStaticMarkup(
      <FinishedCard
        t={tournamentCard({ state: "FINISHED", champion: { teamId: 4, name: longName } })}
      />,
    );
    expect(markup).not.toContain(`title="${longName}"`);
    // Le nom entier reste dans le DOM : c'est lui que la carte déplie.
    expect(markup).toContain(longName);
  });

  it("déplie le nom au survol de la carte et au focus de son lien", () => {
    const css = stripComments(read("app/(secured)/tournois/tournois.module.css"));
    const rule = css.match(
      /\.card:hover \.cardChampion,\s*\.card:focus-within \.cardChampion\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/white-space:\s*normal/);
  });
});

describe("TeamCard — légende du total de points", () => {
  it("ne porte plus la légende en `title`", () => {
    const markup = renderToStaticMarkup(<TeamCard team={team()} />);
    expect(markup).not.toMatch(/title="[^"]*Base 500/);
    expect(markup).not.toMatch(/title="Points de classement/);
  });

  it("donne la légende complète aux lecteurs d'écran", () => {
    const markup = renderToStaticMarkup(<TeamCard team={team()} />);
    expect(markup).toContain(`<span class="sr-only">${escapeHtml(RANKING_POINTS_HINT)}</span>`);
  });

  it("affiche « Aucun match » sous le total d'une équipe non classée", () => {
    const markup = renderToStaticMarkup(
      <TeamCard team={team({ wins: 0, losses: 0, points: 500, form: [] })} />,
    );
    expect(markup).toContain(RANKING_UNRANKED_SHORT);
    expect(markup).toContain(escapeHtml(RANKING_UNRANKED_HINT));
  });

  it("garde la nuance « classements de tournoi » d'une équipe sans match à cote bougée", () => {
    const markup = renderToStaticMarkup(
      <TeamCard team={team({ wins: 0, losses: 0, points: 486, form: [] })} />,
    );
    expect(markup).toContain(RANKING_UNRANKED_SHORT);
    expect(markup).toContain(escapeHtml(RANKING_PLACEMENT_ONLY_HINT));
  });

  it("n'affiche pas « Aucun match » pour une équipe qui a joué", () => {
    const markup = renderToStaticMarkup(<TeamCard team={team()} />);
    expect(markup).not.toContain(RANKING_UNRANKED_SHORT);
  });
});

describe("TeamCard — sens de lecture de la barre de forme", () => {
  it("l'écrit au-dessus de la barre plutôt qu'en `title`", () => {
    const markup = renderToStaticMarkup(<TeamCard team={team()} />);
    expect(markup).not.toMatch(/title="[^"]*derniers matchs/);
    expect(markup).toContain("récent → ancien");
  });

  it("le donne aussi aux lecteurs d'écran, avant les résultats", () => {
    const markup = renderToStaticMarkup(<TeamCard team={team()} />);
    expect(markup).toContain(
      'aria-label="3 derniers matchs, du plus récent au plus ancien : victoire, défaite, victoire"',
    );
  });

  it("ne rend rien pour une équipe sans match", () => {
    const markup = renderToStaticMarkup(<TeamCard team={team({ form: [] })} />);
    expect(markup).not.toContain("récent → ancien");
    expect(markup).not.toContain('role="img"');
  });
});

describe("/tournois — section « Terminés »", () => {
  it("rend ses cartes comme items de la grille, sans enveloppe", () => {
    const source = stripComments(read("app/(secured)/tournois/page.tsx"));
    // Une enveloppe empilait toutes les cartes dans une seule cellule, et
    // `.card { height: 100% }` étirait chacune à la hauteur de la pile.
    expect(source).not.toMatch(/<div>\s*\{filteredBuckets\.finished/);
    // `stripComments` laisse `{}` à la place du commentaire JSX qui précède.
    expect(source).toMatch(/title="TERMINÉS"[\s\S]*?>\s*(?:\{\}\s*)?\{filteredBuckets\.finished/);
  });
});

describe("RollbackRoundDialog — repli du nom d'équipe", () => {
  it("passe par `teamLabel` plutôt qu'un repli recopié à la main", () => {
    const source = stripComments(
      read("app/(secured)/tournois/[id]/_components/RollbackRoundDialog.tsx"),
    );
    expect(source).toContain('from "@/lib/shared/match-card-viewer"');
    expect(source).toMatch(/teamLabel\(match\.team1Name, match\.team1Placeholder, "À venir"\)/);
    expect(source).toMatch(/teamLabel\(match\.team2Name, match\.team2Placeholder, "À venir"\)/);
    expect(source).not.toMatch(/team[12]Name \?\? match\.team[12]Placeholder/);
  });
});

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;");
}
