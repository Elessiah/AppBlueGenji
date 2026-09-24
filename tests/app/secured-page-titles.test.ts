import { describe, expect, it } from "@jest/globals";
import type { Metadata } from "next";
import { resolveTitle } from "next/dist/lib/metadata/resolvers/resolve-title";
import { metadata as tournamentsMetadata } from "@/app/(secured)/tournois/layout";
import { metadata as createTournamentMetadata } from "@/app/(secured)/tournois/creer/layout";
import { metadata as teamsMetadata } from "@/app/(secured)/equipes/layout";
import { metadata as createTeamMetadata } from "@/app/(secured)/equipes/creer/layout";
import { metadata as playersMetadata } from "@/app/(secured)/joueurs/layout";
import { metadata as profileMetadata } from "@/app/(secured)/profil/layout";
import { SITE_TITLE_TEMPLATE, segmentTitle } from "@/lib/shared/page-metadata";
import { SITE_NAME } from "@/lib/shared/share-metadata";
import { readSource } from "../helpers/read-source";

/**
 * Rejoue la résolution de Next le long d'une chaîne de mises en page : chaque
 * segment reçoit le gabarit **du titre résolu** de son parent. C'est ce détail
 * qui fait perdre le nom du site aux sous-pages d'une mise en page titrée d'une
 * simple chaîne — un test qui ne regarderait que la valeur déclarée ne le
 * verrait pas.
 */
function resolveChain(...chain: Metadata["title"][]): string {
  let template: string | null = null;
  let resolved = "";
  for (const title of chain) {
    // Un segment sans titre ne touche à rien : il garde celui du parent.
    if (title === undefined) continue;
    const next = resolveTitle(title, template);
    resolved = next.absolute;
    template = next.template;
  }
  return resolved;
}

/**
 * Le titre de la mise en page racine. Elle n'est pas importée — elle charge les
 * polices par `next/font/local`, que Jest ne sait pas exécuter — : sa
 * déclaration est vérifiée sur la source, plus bas.
 */
const root: Metadata["title"] = { default: SITE_NAME, template: SITE_TITLE_TEMPLATE };

describe("titres des espaces connectés (WCAG 2.4.2)", () => {
  it.each<[string, Metadata, string]>([
    ["/tournois", tournamentsMetadata, "Tournois"],
    ["/equipes", teamsMetadata, "Équipes"],
    ["/joueurs", playersMetadata, "Joueurs"],
    ["/profil", profileMetadata, "Mon profil"],
  ])("%s s'intitule « %s · BlueGenji Esport »", (_path, metadata, title) => {
    expect(resolveChain(root, metadata.title)).toBe(`${title} · ${SITE_NAME}`);
  });

  it("garde le nom du site sur les formulaires de création, sous-pages des listes", () => {
    expect(resolveChain(root, tournamentsMetadata.title, createTournamentMetadata.title)).toBe(
      `Créer un tournoi · ${SITE_NAME}`,
    );
    expect(resolveChain(root, teamsMetadata.title, createTeamMetadata.title)).toBe(
      `Créer une équipe · ${SITE_NAME}`,
    );
  });

  it("garde le repli de la fiche d'un tournoi sous le gabarit du site", () => {
    // `app/(secured)/tournois/[id]/layout.tsx` rend `{ title: "Tournoi" }`
    // quand le tournoi est illisible.
    expect(resolveChain(root, tournamentsMetadata.title, "Tournoi")).toBe(`Tournoi · ${SITE_NAME}`);
  });

  it("donne son titre de liste à une fiche qui n'en déclare pas", () => {
    expect(resolveChain(root, teamsMetadata.title, undefined)).toBe(`Équipes · ${SITE_NAME}`);
  });

  it("ne déclare qu'un titre : l'URL canonique de la liste ne doit pas descendre sur les fiches", () => {
    for (const metadata of [tournamentsMetadata, teamsMetadata, playersMetadata, profileMetadata]) {
      expect(Object.keys(metadata)).toEqual(["title"]);
    }
  });
});

describe("segmentTitle", () => {
  it("nomme la page et repose le gabarit du site pour les suivantes", () => {
    expect(segmentTitle("Tournois")).toEqual({ default: "Tournois", template: SITE_TITLE_TEMPLATE });
  });

  it("partage son gabarit avec la mise en page racine", () => {
    expect(readSource("app/layout.tsx")).toContain(
      "title: { default: SITE_NAME, template: SITE_TITLE_TEMPLATE },",
    );
  });

  it("corrige ce qu'une chaîne perdait : le gabarit des sous-pages", () => {
    // Le défaut que `segmentTitle` existe pour éviter.
    expect(resolveChain(root, "Tournois", "Créer un tournoi")).toBe("Créer un tournoi");
    expect(resolveChain(root, segmentTitle("Tournois"), "Créer un tournoi")).toBe(
      `Créer un tournoi · ${SITE_NAME}`,
    );
  });
});
