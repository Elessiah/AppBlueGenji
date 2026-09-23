import { localUploadUrl } from "./uploads";

/**
 * Logos des engagés d'un tournoi, indexés par `team_id`.
 *
 * Le logo d'une équipe voyageait déjà jusqu'à la page de tournoi — la liste des
 * inscrites le porte (`TournamentSnapshot.registrations[].logoUrl`) — mais
 * aucune vue ne le rendait : ni les cartes de match, ni l'arbre, ni les
 * classements, qui ne connaissent d'un engagé que son identifiant et son nom.
 * Plutôt que d'ajouter une colonne de logo à chaque forme de ligne (match,
 * classement suisse, survie, endurance, phase, aperçu…), la page construit
 * **une** table depuis les inscrites et la pose dans son contexte : un engagé
 * affiché n'importe où dans le plateau est forcément inscrit, et un logo changé
 * se voit partout au même instantané.
 *
 * Seuls les logos **présents** sont retenus : l'absence de clé *est* le « pas de
 * logo », et l'écran retombe alors sur l'initiale du nom. L'URL repasse par
 * `localUploadUrl` bien que le serveur l'ait déjà filtrée à la sortie : le filtre
 * ne coûte rien, et c'est ce qui garantit que `next/image` ne lèvera jamais sur
 * une origine étrangère, quel que soit le chemin par lequel la donnée arrive ici.
 */
export type EntrantLogoMap = Readonly<Record<number, string>>;

export function buildEntrantLogoMap(
  registrations: ReadonlyArray<{ teamId: number; logoUrl: string | null }>,
): EntrantLogoMap {
  const logos: Record<number, string> = {};
  for (const registration of registrations) {
    const url = localUploadUrl(registration.logoUrl);
    if (url !== null) logos[registration.teamId] = url;
  }
  return logos;
}

/**
 * Logo d'un engagé, ou `null` (pas de logo, emplacement vide, engagé inconnu).
 *
 * `teamId` accepte `null` : une case de match encore vide (TBD, exemption) n'a
 * pas d'engagé, et c'est la forme sous laquelle les vues la reçoivent.
 */
export function entrantLogoUrl(logos: EntrantLogoMap, teamId: number | null): string | null {
  if (teamId === null) return null;
  return Object.prototype.hasOwnProperty.call(logos, teamId) ? logos[teamId] : null;
}
