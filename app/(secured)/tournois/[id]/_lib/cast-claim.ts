/**
 * Choix offerts à l'inscription d'un caster (`CastClaimDialog`), décidés hors
 * du composant : rejoindre un des streams du match (co-cast) ou ouvrir le
 * sien. Pur, pour être testé sans rendu.
 */
import type { MatchLiveTrigger } from "@/lib/shared/live-streams";
import type { BracketMatch } from "@/lib/shared/types";

export type CastClaimChoice =
  | { kind: "JOIN"; streamId: number; liveUrl: string | null; casterPseudos: string[] }
  | { kind: "SEPARATE" };

/**
 * Corps de `POST /api/matches/[id]/caster` : le stream choisi, et les réglages
 * du même geste (`docs/features/CAST_SETTINGS.md`).
 *
 * `liveUrl` est **obligatoire** quand le caster ouvre son propre stream : un
 * stream sans lien n'apparaissait sur aucune vue et n'annonçait rien.
 */
export type CastClaimBody = ({ streamId: number } | { liveUrl: string }) & {
  /** Mode d'antenne du match, posé du même geste (stream propre seulement). */
  trigger?: MatchLiveTrigger;
  /** BattleTag donné pour ce cast ; `null` = celui du compte. */
  battletag?: string | null;
  /** Le lien posé est celui de l'organisation (permission `tournaments` seule). */
  organisationLink?: boolean;
};

/** Ce que la fenêtre d'inscription a saisi, avant d'en faire un corps. */
export type CastClaimInput = {
  /** Lien de sa chaîne (stream propre). */
  url: string;
  /** BattleTag de ce cast, vide = celui du compte. */
  battletag: string;
  /** Mode d'antenne choisi (stream propre) ; absent quand il n'est pas le sien à changer. */
  trigger?: MatchLiveTrigger;
  /** Case « lien de l'organisation » (permission `tournaments`). */
  organisationLink: boolean;
};

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

/**
 * Le corps envoyé.
 *
 * Le BattleTag du cast suit les deux choix : il parle du caster, non de son
 * stream — un co-caster paraît lui aussi dans les contacts. Le mode d'antenne
 * et l'origine du lien ne suivent que le stream qu'il ouvre : rejoindre un
 * stream ne pose aucun lien, et le mode du match est alors déjà celui de qui
 * l'a configuré.
 */
export function castClaimBody(choice: CastClaimChoice, input: CastClaimInput): CastClaimBody {
  const battletag = input.battletag.trim() === "" ? null : input.battletag.trim();
  if (choice.kind === "JOIN") return { streamId: choice.streamId, battletag };
  return {
    liveUrl: input.url.trim(),
    battletag,
    ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
    ...(input.organisationLink ? { organisationLink: true } : {}),
  };
}
