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
 *
 * Seul le stream du staff se rejoint sans caster (« le stream du match ») : le
 * stream d'un caster que la lecture tait (inscription retirée d'office au
 * lancement, `casterWithdrawn`) n'est pas offert — ce serait rejoindre sa
 * chaîne personnelle en la croyant celle du match.
 */
export function castClaimChoices(match: Pick<BracketMatch, "streams" | "casters">): CastClaimChoice[] {
  const joins: CastClaimChoice[] = match.streams.flatMap((stream): CastClaimChoice[] => {
    const casterPseudos = match.casters
      .filter((caster) => caster.streamId === stream.id)
      .map((caster) => caster.pseudo);
    if (casterPseudos.length === 0 && !stream.staff) return [];
    return [{ kind: "JOIN", streamId: stream.id, liveUrl: stream.liveUrl, casterPseudos }];
  });
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
