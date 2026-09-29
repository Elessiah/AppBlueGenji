/**
 * Trames du flux d'un tournoi, en clair ou compressées (`./sse-gzip`).
 *
 * Tout ce qui part sur le flux passe par ici, pour qu'un abonné ne reçoive
 * jamais un mélange des deux encodages : l'en-tête gzip est écrit une fois, à
 * l'ouverture, et chaque trame suivante doit alors être un morceau *deflate*.
 *
 * Le morceau lourd — l'instantané — n'est comprimé **qu'une fois par version**
 * (mémoïsé sur la trame elle-même, qui vit le temps du cache) et partagé par la
 * trame diffusée à la salle et par la trame de connexion de chaque lecteur.
 * Seules la tête et la queue, quelques centaines d'octets, sont comprimées par
 * trame.
 */
import type { TournamentSnapshotFrame } from "./tournaments/snapshot";
import { concatBytes, deflateSegment } from "./sse-gzip";

/** Encodage d'une connexion : ce qu'elle a annoncé dans `Content-Encoding`. */
export type StreamEncoding = "identity" | "gzip";

const encoder = new TextEncoder();

const deflatedSnapshots = new WeakMap<TournamentSnapshotFrame, Uint8Array>();
const deflatedFrames = new WeakMap<TournamentSnapshotFrame, Uint8Array>();

/** L'instantané seul, comprimé une fois par version. */
function deflatedSnapshotJson(frame: TournamentSnapshotFrame): Uint8Array {
  let deflated = deflatedSnapshots.get(frame);
  if (!deflated) {
    deflated = deflateSegment(frame.snapshotJson);
    deflatedSnapshots.set(frame, deflated);
  }
  return deflated;
}

/** Tête et queue de la trame, autour de la vue `snapshotJson`. */
function frameEdges(frame: TournamentSnapshotFrame): { head: Uint8Array; tail: Uint8Array } {
  const start = frame.snapshotJson.byteOffset - frame.frame.byteOffset;
  const end = start + frame.snapshotJson.byteLength;
  return { head: frame.frame.subarray(0, start), tail: frame.frame.subarray(end) };
}

/** Trame diffusée à la salle, dans l'encodage de l'abonné. */
export function snapshotFrameBytes(
  frame: TournamentSnapshotFrame,
  encoding: StreamEncoding,
): Uint8Array {
  if (encoding === "identity") return frame.frame;

  let deflated = deflatedFrames.get(frame);
  if (!deflated) {
    const { head, tail } = frameEdges(frame);
    deflated = concatBytes([
      deflateSegment(head),
      deflatedSnapshotJson(frame),
      deflateSegment(tail),
    ]);
    deflatedFrames.set(frame, deflated);
  }
  return deflated;
}

/**
 * Trame de connexion : l'enveloppe propre au lecteur (`type`, palier, contexte)
 * puis l'instantané.
 *
 * Avec la trame de l'instantané en main, rien n'est resérialisé : l'enveloppe
 * est refermée autour des octets déjà encodés — et déjà comprimés. Sans elle
 * (instantané qui ne vient pas du cache), on retombe sur `JSON.stringify`.
 *
 * `envelope` ne doit pas contenir de clé `snapshot` : elle est ajoutée ici, en
 * dernier.
 */
export function connectedFrameBytes(
  envelope: Record<string, unknown>,
  snapshot: unknown,
  frame: TournamentSnapshotFrame | null,
  encoding: StreamEncoding,
): Uint8Array {
  const envelopeJson = JSON.stringify(envelope);
  const head = encoder.encode(
    `data: ${envelopeJson.length > 2 ? `${envelopeJson.slice(0, -1)},` : "{"}"snapshot":`,
  );
  const tail = encoder.encode("}\n\n");

  if (frame === null) {
    const plain = concatBytes([head, encoder.encode(JSON.stringify(snapshot)), tail]);
    return encoding === "identity" ? plain : deflateSegment(plain);
  }
  if (encoding === "identity") return concatBytes([head, frame.snapshotJson, tail]);
  return concatBytes([deflateSegment(head), deflatedSnapshotJson(frame), deflateSegment(tail)]);
}

const PING = encoder.encode(": ping\n\n");
let deflatedPing: Uint8Array | null = null;

/** Battement de cœur (commentaire SSE), dans l'encodage de la connexion. */
export function pingFrameBytes(encoding: StreamEncoding): Uint8Array {
  if (encoding === "identity") return PING;
  deflatedPing ??= deflateSegment(PING);
  return deflatedPing;
}
