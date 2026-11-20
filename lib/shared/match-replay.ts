/**
 * Rediffusion d'un match terminé.
 *
 * Une fois une rencontre jouée, le staff de diffusion (permission `live` : admin,
 * arbitre, caster — la seule `live` pour son propre cast, voir
 * {@link mayEditReplay}) y pose le lien YouTube de sa rediff. Le match
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
 * Le lien rendu ne garde que la vidéo et son instant de départ (`v`, `t`) :
 * tout autre paramètre et le fragment tombent — l'identifiant de partage `si`
 * du bouton « Partager » de YouTube (lié au compte qui partage) ou un texte
 * libre ajouté au lien ne s'affichent ni ne partent au journal d'arbitrage.
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

  const video =
    platform === "youtu.be"
      ? segments.length === 1 && isVideoId(segments[0])
      : (segments.length === 1 && segments[0] === "watch" && isVideoId(url.searchParams.get("v"))) ||
        (segments.length === 2 && segments[0] === "live" && isVideoId(segments[1]));
  return video ? videoOnly(url) : null;
}

/** Instant de départ YouTube : secondes (`42`, `120s`) ou `1h2m3s`. */
const START_TIME = /^(?:\d{1,6}s?|(?:\d{1,3}h)?(?:\d{1,4}m)?(?:\d{1,6}s)?)$/;

/** Le lien sans rien d'autre que la vidéo (`v`) et son départ (`t`, s'il est lisible), sans fragment. */
function videoOnly(url: URL): string {
  const video = url.searchParams.get("v");
  const start = url.searchParams.get("t");
  const kept = new URLSearchParams();
  if (video !== null) kept.set("v", video);
  if (start && START_TIME.test(start)) kept.set("t", start);
  url.search = kept.toString();
  url.hash = "";
  return url.toString();
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

/**
 * Ce match offre-t-il la rediff à un lecteur admis (`canManage`, déduit de
 * {@link mayEditReplay}) ? Sur un match joué, ou pour retirer un lien stocké.
 * Logique pure, hors du composant du bandeau.
 */
export function canEditReplay(match: MatchReplayInput & { replayUrl: string | null }, canManage: boolean): boolean {
  return canManage && (canHaveReplay(match) || match.replayUrl !== null);
}

/**
 * Miroir **unique** de la route `PUT /api/admin/matches/[id]/replay` : il faut
 * `live` (`canManage`), et la seule `live` ne règle que la rediff de **son**
 * cast (`NOT_MATCH_CASTER`), le staff `tournaments` (`canSchedule`) toutes.
 * Chaque entrée du client s'en déduit, jamais plus large : la fenêtre de
 * diffusion telle quelle, la carte sans le caster (`viewerUserId: null` et
 * `canSchedule` exigé — le caster a sa fenêtre).
 */
export function mayEditReplay(
  match: { casters: readonly { userId: number }[] },
  controls: { canManage: boolean; canSchedule: boolean; viewerUserId: number | null },
): boolean {
  if (!controls.canManage) return false;
  return controls.canSchedule || match.casters.some((caster) => caster.userId === controls.viewerUserId);
}
