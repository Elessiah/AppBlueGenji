/**
 * Compression d'un flux SSE **sans tampon**, encodée une fois pour tous.
 *
 * # Pourquoi compresser nous-mêmes
 *
 * La route du flux pose `Cache-Control: no-transform`, et à raison : la
 * compression d'un serveur ou d'un mandataire met en tampon, si bien qu'une
 * trame restait retenue jusqu'à ce que le tampon se remplisse — le direct
 * cessait d'en être un. Le flux partait donc **en clair**, alors que
 * l'instantané d'un tournoi est du JSON très répétitif : 238 Ko pour une double
 * élimination à 128 équipes, ~14 Ko une fois compressé. Et c'est ce poids
 * brut que le budget de sortie d'une salle convertit en attente
 * (`lib/server/tournament-broadcast.ts`) : sur un gros plateau, joueurs et
 * arbitres ne recevaient plus qu'une mise à jour par minute.
 *
 * # Comment, sans comprimer une fois par abonné
 *
 * Un flux gzip, c'est un en-tête de dix octets suivi d'un flux *deflate*. Un
 * morceau compressé **seul** — flux *deflate* brut neuf, terminé par un vidage
 * synchrone (`Z_SYNC_FLUSH`) et non par un bloc final — se recolle n'importe où
 * dans un autre flux *deflate* :
 *
 * - il ne renvoie à aucun octet qui le précède (son dictionnaire est vide) ;
 * - le vidage synchrone le termine par un bloc vide aligné sur l'octet, donc le
 *   morceau suivant commence sur une frontière d'octet, comme l'exige le format ;
 * - aucun bloc n'y porte le drapeau « dernier bloc », le flux reste ouvert.
 *
 * Chaque trame est donc compressée **une fois**, et les mêmes octets partent à
 * tous les abonnés qui acceptent gzip, chacun derrière son propre en-tête. On
 * perd le dictionnaire partagé d'une trame à l'autre — quelques pour cent —
 * mais le coût CPU ne dépend plus du nombre de spectateurs, ce qui est tout
 * l'objet de la salle de diffusion. Le vidage synchrone garantit, lui, que le
 * navigateur décode chaque trame dès son arrivée.
 *
 * # Ce qu'on ne fait pas
 *
 * Le flux n'est jamais clos par le serveur dans le cas nominal : c'est le
 * client qui s'en va. Le bloc de fin gzip (CRC32 et longueur) n'est donc pas
 * écrite ; les rares fermetures côté serveur (tournoi supprimé, client bloqué)
 * sont de toute façon lues par `EventSource` comme une coupure, ce qui est le
 * comportement voulu.
 */
import { constants, deflateRawSync } from "node:zlib";

/**
 * En-tête gzip minimal (RFC 1952) : magie, méthode *deflate*, aucun drapeau,
 * date nulle, aucune indication de niveau, système « inconnu ».
 */
export const GZIP_STREAM_HEADER = Uint8Array.from([
  0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff,
]);

/**
 * Compresse un morceau de façon **autonome et recollable** (voir l'en-tête du
 * module). Le niveau par défaut de zlib (6) : le niveau maximal ne gagne que
 * quelques pour cent sur ce JSON, pour un temps sensiblement plus long.
 */
export function deflateSegment(bytes: Uint8Array): Uint8Array {
  return deflateRawSync(bytes, { finishFlush: constants.Z_SYNC_FLUSH });
}

/** Colle des morceaux déjà encodés en un seul tampon. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.byteLength;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/**
 * Le client accepte-t-il gzip ? Lecture de `Accept-Encoding` selon RFC 9110 :
 * `gzip` (ou `x-gzip`, ou `*`) avec une qualité non nulle. Un `gzip;q=0`
 * explicite est un refus, et l'emporte sur un `*` accepté.
 *
 * Tous les navigateurs l'envoient d'eux-mêmes pour `EventSource` ; un client
 * qui ne l'envoie pas (outil en ligne de commande, test) reçoit le flux en
 * clair.
 */
export function acceptsGzip(header: string | null | undefined): boolean {
  if (!header) return false;
  let gzip: boolean | null = null;
  let wildcard: boolean | null = null;
  for (const entry of header.split(",")) {
    const [rawName, ...params] = entry.split(";");
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    const accepted = codingQuality(params) > 0;
    if (name === "gzip" || name === "x-gzip") gzip = accepted;
    else if (name === "*") wildcard = accepted;
  }
  return gzip ?? wildcard ?? false;
}

/**
 * Qualité d'un codage d'après ses paramètres : 1 par défaut, le dernier `q`
 * l'emportant, et une valeur illisible valant refus.
 */
function codingQuality(params: string[]): number {
  let quality = 1;
  for (const param of params) {
    const [key, value] = param.split("=");
    if (key?.trim().toLowerCase() === "q") {
      const parsed = Number(value?.trim());
      quality = Number.isFinite(parsed) ? parsed : 0;
    }
  }
  return quality;
}
