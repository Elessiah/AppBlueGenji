import { describe, expect, it, jest } from "@jest/globals";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EntityLink, PlayerLink, TeamLink } from "@/components/entity-link";
import {
  PlayerPodiumName,
  PodiumTiersOff,
  PodiumTiersOffWhen,
  PodiumTiersProvider,
  TeamPodiumName,
} from "@/components/podium-tiers";
import { EntrantLink, EntrantProvider } from "@/app/(secured)/tournois/[id]/_lib/entrant-link";
import { buildPodiumTiers } from "@/lib/shared/podium-tiers";
import { readSource } from "../helpers/read-source";

/**
 * La marche du podium suit l'équipe partout où son nom passe par les liens
 * d'entité, et ses membres en portent la version adoucie (PODIUM_TIERS.md).
 */

// Équipes 10, 20, 30 sur le podium ; 40 hors podium. Joueur 1 dans 10 et 30
// (la plus haute l'emporte), joueur 2 dans 30, joueur 3 dans 40.
const TIERS = buildPodiumTiers(
  [10, 20, 30, 40],
  [
    { userId: 1, teamId: 30 },
    { userId: 1, teamId: 10 },
    { userId: 2, teamId: 30 },
    { userId: 3, teamId: 40 },
  ],
);

function render(node: ReactNode, tiers = TIERS): string {
  return renderToStaticMarkup(<PodiumTiersProvider tiers={tiers}>{node}</PodiumTiersProvider>);
}

describe("TeamLink — marche de l'équipe", () => {
  it("pose la classe de chaque place, en gardant le texte, le lien et les classes de l'appelant", () => {
    expect(render(<TeamLink teamId={10}>Alpha</TeamLink>)).toBe(
      '<a class="entity-link" data-podium="podium-tier" href="/equipes/10"><span class="podium-tier podium-tier-1">Alpha</span></a>',
    );
    expect(render(<TeamLink teamId={20} className="mine">Beta</TeamLink>)).toBe(
      '<a class="entity-link mine" data-podium="podium-tier" href="/equipes/20"><span class="podium-tier podium-tier-2">Beta</span></a>',
    );
    expect(render(<TeamLink teamId={30}>Gamma</TeamLink>)).toContain("podium-tier podium-tier-3");
  });

  it("laisse intacte une équipe hors podium, et tout lien hors fournisseur", () => {
    expect(render(<TeamLink teamId={40}>Delta</TeamLink>)).toBe('<a class="entity-link" href="/equipes/40">Delta</a>');
    expect(renderToStaticMarkup(<TeamLink teamId={10}>Alpha</TeamLink>)).toBe(
      '<a class="entity-link" href="/equipes/10">Alpha</a>',
    );
  });

  it("préfère la marche imposée par l'appelant (onglet par jeu de /classement), `null` n'en pose aucune", () => {
    expect(render(<TeamLink teamId={40} podiumTier={2}>Delta</TeamLink>)).toContain("podium-tier-2");
    expect(render(<TeamLink teamId={10} podiumTier={null}>Alpha</TeamLink>)).toBe(
      '<a class="entity-link" href="/equipes/10">Alpha</a>',
    );
  });
});

describe("marche peinte dans le lien, jamais sur le lien", () => {
  // Une classe d'appelant qui pose un `background` (pastille `.badge`, `.pill`,
  // classe de module) effacerait le dégradé peint dans le texte transparent :
  // la marche vit sur un `<span>` intérieur, la classe de l'appelant sur le lien.
  it("garde la pastille de l'appelant sur le lien et la marche sur le nom", () => {
    expect(render(<TeamLink teamId={10} className="badge">Alpha</TeamLink>)).toBe(
      '<a class="entity-link badge" data-podium="podium-tier" href="/equipes/10"><span class="podium-tier podium-tier-1">Alpha</span></a>',
    );
    expect(render(<PlayerLink userId={1} className="pill pill-accent">Joueur</PlayerLink>)).toBe(
      '<a class="entity-link pill pill-accent" data-podium="podium-member" href="/joueurs/1"><span class="podium-member podium-member-1">Joueur</span></a>',
    );
  });

  it("tronque par `truncate` (`.entity-truncate`), repère de la marche posé pour la feuille", () => {
    expect(render(<TeamLink teamId={10} truncate>Alpha</TeamLink>)).toBe(
      '<a class="entity-link entity-truncate" data-podium="podium-tier" href="/equipes/10"><span class="podium-tier podium-tier-1">Alpha</span></a>',
    );
    expect(render(<TeamLink teamId={40} truncate className="x">Delta</TeamLink>)).toBe(
      '<a class="entity-link entity-truncate x" href="/equipes/40">Delta</a>',
    );
  });

  it("tire le repère `data-podium` de la famille de la marche (équipe, membre)", () => {
    expect(render(<EntityLink href="/x" podium={{ tier: 2, kind: "team" }}>N</EntityLink>)).toBe(
      '<a class="entity-link" data-podium="podium-tier" href="/x"><span class="podium-tier podium-tier-2">N</span></a>',
    );
    expect(render(<EntityLink href="/x" podium={{ tier: 1, kind: "member" }}>N</EntityLink>)).toContain('data-podium="podium-member"');
  });

  it("un compte supprimé (`podiumTier={null}`) ne peint rien dans sa pastille", () => {
    expect(render(<TeamLink teamId={10} className="badge" podiumTier={null}>Alpha</TeamLink>)).toBe(
      '<a class="entity-link badge" href="/equipes/10">Alpha</a>',
    );
  });

  it("n'ajoute aucun élément hors podium", () => {
    expect(render(<TeamLink teamId={40} className="badge">Delta</TeamLink>)).toBe(
      '<a class="entity-link badge" href="/equipes/40">Delta</a>',
    );
  });
});

describe("PlayerLink — marche adoucie du membre", () => {
  it("donne au membre la plus haute marche de ses équipes, en version adoucie", () => {
    expect(render(<PlayerLink userId={1}>Joueur</PlayerLink>)).toBe(
      '<a class="entity-link" data-podium="podium-member" href="/joueurs/1"><span class="podium-member podium-member-1">Joueur</span></a>',
    );
    expect(render(<PlayerLink userId={2}>Autre</PlayerLink>)).toContain("podium-member podium-member-3");
  });

  it("laisse intact un joueur d'une équipe hors podium, et un visiteur anonyme (aucun membre remis)", () => {
    expect(render(<PlayerLink userId={3}>Joueur</PlayerLink>)).toBe('<a class="entity-link" href="/joueurs/3">Joueur</a>');
    const anonymous = { teams: TIERS.teams, members: {} };
    expect(render(<PlayerLink userId={1}>Joueur</PlayerLink>, anonymous)).not.toContain("podium");
  });
});

describe("EntrantLink — engagé de tournoi", () => {
  function entrant(teamId: number, soloUserIds: Record<number, number> = {}) {
    return render(
      <EntrantProvider participantType={Object.keys(soloUserIds).length > 0 ? "SOLO" : "TEAM"} soloUserIds={soloUserIds} logos={{}}>
        <EntrantLink teamId={teamId}>Nom</EntrantLink>
      </EntrantProvider>,
    );
  }

  it("porte la marche de l'équipe engagée", () => {
    expect(entrant(20)).toBe('<a class="entity-link" data-podium="podium-tier" href="/equipes/20"><span class="podium-tier podium-tier-2">Nom</span></a>');
    expect(entrant(40)).toBe('<a class="entity-link" href="/equipes/40">Nom</a>');
  });

  it("entrée solo (jamais classée) : la marche adoucie de son joueur, jamais celle d'une équipe", () => {
    // L'entrée solo 10 porte le même identifiant qu'une équipe du podium : seule
    // compte la marche du joueur 2 (membre de la 3e).
    expect(entrant(10, { 10: 2 })).toBe('<a class="entity-link" data-podium="podium-member" href="/joueurs/2"><span class="podium-member podium-member-3">Nom</span></a>');
    expect(entrant(55, { 55: 3 })).toBe('<a class="entity-link" href="/joueurs/3">Nom</a>');
  });
});

describe("noms non cliquables et écrans d'administration", () => {
  it("habille un titre d'équipe ou de joueur, sans rien ajouter hors podium", () => {
    expect(render(<TeamPodiumName teamId={10}>Alpha</TeamPodiumName>)).toBe('<span class="podium-tier podium-tier-1">Alpha</span>');
    expect(render(<TeamPodiumName teamId={40}>Delta</TeamPodiumName>)).toBe("Delta");
    expect(render(<PlayerPodiumName userId={2}>Autre</PlayerPodiumName>)).toBe(
      '<span class="podium-member podium-member-3">Autre</span>',
    );
  });

  it("reste sobre sous `PodiumTiersOff`", () => {
    const markup = render(
      <PodiumTiersOff>
        <TeamLink teamId={10}>Alpha</TeamLink>
        <PlayerLink userId={1}>Joueur</PlayerLink>
      </PodiumTiersOff>,
    );
    expect(markup).not.toContain("podium");
  });

  it("n'éteint sous `PodiumTiersOffWhen` que si la condition le demande", () => {
    const link = <TeamLink teamId={10}>Alpha</TeamLink>;
    expect(render(<PodiumTiersOffWhen off>{link}</PodiumTiersOffWhen>)).not.toContain("podium");
    expect(render(<PodiumTiersOffWhen off={false}>{link}</PodiumTiersOffWhen>)).toContain("podium-tier-1");
  });

  it("pose `PodiumTiersOff` sur le panneau des signalements et les contacts d'arbitrage", () => {
    expect(readSource("app/(secured)/admin/signalements/layout.tsx")).toContain("<PodiumTiersOff>");
    expect(readSource("app/(secured)/tournois/[id]/_components/EntrantContactsPanel.tsx")).toContain("<PodiumTiersOff>");
  });
});
