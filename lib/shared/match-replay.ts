/**
 * Rediffusion d'un match terminé.
 *
 * Une fois une rencontre jouée, le staff de diffusion (permission `live` :
 * admin, arbitre, caster) y pose le lien YouTube de sa rediff. Le match
 * l'annonce alors à tout le monde par un bandeau « Rediff disponible » sous sa
 * carte — c'est la seule façon, pour un spectateur arrivé après coup, de savoir
 * qu'une rencontre se revoit.
 *
 * Deux choses distinctes de la diffusion en direct (`lib/shared/live-streams.ts`),
 * et c'est pourquoi le lien a sa propre colonne :
 * - le **moment** : le direct vit avant et pendant la rencontre et s'éteint au
 *   premier score saisi ; la rediff n'existe qu'**après** ;
 * - la **plateforme** : une chaîne Twitch ou Kick ne garde pas ses vidéos, seul
 *   YouTube est accepté ici — un lien de chaîne en direct n'est pas une rediff.
 *
 * Comme l'état de diffusion, la visibilité de la rediff est **dérivée** : le
 * lien reste en base, mais il ne s'affiche que sur une rencontre réellement
 * jouée. Un retour en arrière qui rouvre le match le fait donc disparaître sans
 * écriture, et le rejouer le fait revenir.
 *
 * Module pur : le serveur y valide ce qu'il écrit, l'interface ce qu'elle
 * affiche et borne, et les deux ne peuvent pas diverger.
 */
import { normalizeStreamUrl, streamPlatform } from "./live-streams";
import { isMatchPlayed } from "./match-outcome";
import type { MatchStatus } from "./types";

/**
 * Valide et normalise un lien de rediff YouTube.
 *
 * S'appuie sur la normalisation des liens de diffusion (schéma `https` forcé,
 * hôte en minuscules, identifiants et port refusés, sous-domaines fermés) puis
 * n'y garde que YouTube. Exige en plus que le lien **désigne une vidéo** :
 * `youtu.be/<id>`, `youtube.com/watch?v=<id>` ou `youtube.com/live/<id>` — la
 * page d'accueil d'une chaîne ne mène à aucune rediff, et le bandeau promettrait
 * alors ce que le lien ne tient pas.
 *
 * Renvoie `null` sur toute entrée inexploitable, jamais d'exception.
 */
export function normalizeReplayUrl(input: unknown): string | null {
  const normalized = normalizeStreamUrl(input);
  if (normalized === null) return null;

  const platform = streamPlatform(normalized);
  if (platform !== "youtube.com" && platform !== "youtu.be") return null;

  const url = new URL(normalized);
  const segments = url.pathname.split("/").filter(Boolean);

  if (platform === "youtu.be") {
    return segments.length === 1 && isVideoId(segments[0]) ? normalized : null;
  }
  if (segments.length === 1 && segments[0] === "watch") {
    return isVideoId(url.searchParams.get("v")) ? normalized : null;
  }
  if (segments.length === 2 && segments[0] === "live") {
    return isVideoId(segments[1]) ? normalized : null;
  }
  return null;
}

/**
 * Identifiant de vidéo YouTube : onze caractères de l'alphabet base64 « url ».
 * Le format n'est pas documenté comme figé, d'où une borne un peu plus large
 * plutôt qu'une égalité stricte à onze.
 */
function isVideoId(value: string | null): boolean {
  return value !== null && /^[A-Za-z0-9_-]{6,32}$/.test(value);
}

/** Vrai si `input` est un lien de rediff exploitable. */
export function isValidReplayUrl(input: unknown): boolean {
  return normalizeReplayUrl(input) !== null;
}

/** Vue minimale d'un match pour la rediff, commune aux lignes SQL et à `BracketMatch`. */
export type MatchReplayInput = {
  status: MatchStatus;
  team1Id: number | null;
  team2Id: number | null;
  forfeitTeamId: number | null;
  doubleForfeit?: boolean;
};

/**
 * Ce match peut-il porter une rediff ?
 *
 * Il faut une rencontre **réellement disputée** : terminée, entre deux
 * engagées, et pas tranchée par forfait. Une exemption, un match fantôme ou un
 * forfait n'ont rien filmé — un bandeau « Rediff disponible » y annoncerait une
 * rencontre qui n'a pas eu lieu.
 */
export function canHaveReplay(match: MatchReplayInput): boolean {
  return (
    isMatchPlayed(match) &&
    match.team1Id !== null &&
    match.team2Id !== null &&
    match.forfeitTeamId === null &&
    match.doubleForfeit !== true
  );
}

/**
 * Lien de rediff à **afficher** pour ce match, ou `null`.
 *
 * Le lien stocké ne suffit pas : il faut aussi que le match puisse en porter un
 * au moment de la lecture (voir {@link canHaveReplay}). Le lien est revalidé au
 * passage — une ligne éditée à la main en base ne doit pas devenir un `href`.
 */
export function visibleReplayUrl(
  match: MatchReplayInput & { replayUrl: string | null },
): string | null {
  if (!canHaveReplay(match)) return null;
  return normalizeReplayUrl(match.replayUrl);
}
