/**
 * Choix offerts à l'inscription d'un caster (`CastClaimDialog`), décidés hors
 * du composant : rejoindre un des streams du match (co-cast) ou ouvrir le
 * sien. Pur, pour être testé sans rendu.
 */
import type { BracketMatch } from "@/lib/shared/types";

export type CastClaimChoice =
  | { kind: "JOIN"; streamId: number; liveUrl: string | null; casterPseudos: string[] }
  | { kind: "SEPARATE" };

/** Corps de `POST /api/matches/[id]/caster`. */
export type CastClaimBody = { streamId: number } | { liveUrl: string | null };

/**
 * Les streams du match, dans leur ordre (le premier lien en tête des vues
 * compactes), chacun avec ses casters, puis « ouvrir mon propre stream ».
 */
export function castClaimChoices(match: Pick<BracketMatch, "streams" | "casters">): CastClaimChoice[] {
  const joins: CastClaimChoice[] = match.streams.map((stream) => ({
    kind: "JOIN",
    streamId: stream.id,
    liveUrl: stream.liveUrl,
    casterPseudos: match.casters.filter((caster) => caster.streamId === stream.id).map((caster) => caster.pseudo),
  }));
  return [...joins, { kind: "SEPARATE" }];
}

/** Clé stable d'un choix (valeur du bouton radio). */
export function castClaimChoiceKey(choice: CastClaimChoice): string {
  return choice.kind === "JOIN" ? `join-${choice.streamId}` : "separate";
}

/** Le corps envoyé : un lien vide ouvre un stream sans lien. */
export function castClaimBody(choice: CastClaimChoice, rawUrl: string): CastClaimBody {
  if (choice.kind === "JOIN") return { streamId: choice.streamId };
  const url = rawUrl.trim();
  return { liveUrl: url === "" ? null : url };
}
