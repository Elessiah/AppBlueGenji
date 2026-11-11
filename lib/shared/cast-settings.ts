/**
 * Réglages du cast d'un match par **son caster** (`docs/features/CAST_SETTINGS.md`).
 *
 * Un caster n'a qu'un bouton sur la carte du match : « Caster ce match », qui
 * devient « Configurer ma diffusion » une fois inscrit. Tout ce que l'ancien
 * bouton « Configurer la diffusion » offrait au porteur de `live` — mode de
 * passage à l'antenne, lien de chaîne, antenne, rediff — se règle désormais là,
 * pour **son** stream ; le staff `tournaments` garde la configuration de la
 * diffusion de l'organisation (`MatchLiveDialog`).
 *
 * Trois règles seulement, et toutes pures : le serveur refuse et l'interface
 * désarme sur les mêmes mots.
 */
import { canConfigureLive, type MatchLiveInput } from "./live-streams";
import { canEditReplay, type MatchReplayInput } from "./match-replay";
import { visibleText } from "./visible-text";

/** Largeur de `bg_match_casters.cast_battletag`, et borne du champ de saisie. */
export const MAX_CAST_BATTLETAG_LENGTH = 64;

/**
 * Le BattleTag qu'un caster donne pour **ce** cast, tel qu'il s'écrit en base.
 *
 * Vide ou blanc = aucun (`null`) : le BattleTag du compte reprend sa place,
 * comme avant ce réglage. Passé par `visibleText` (`UNTRUSTED_NAMES.md`) : une
 * saisie n'entre pas en base avec des signes invisibles ou bidirectionnels, qui
 * la rendraient méconnaissable là où elle s'affiche — fenêtre « Contacts »,
 * page du match. Rien d'autre n'est exigé : un BattleTag n'a pas de forme
 * garantie (régions, chiffres, longueurs), et le champ du profil ne l'exige pas
 * davantage (`normalizeBattletag`).
 *
 * @throws `INVALID_CAST_BATTLETAG` — une saisie qui ne laisse que de l'invisible,
 *   ou plus longue que la colonne : ce qui serait rangé ne serait pas ce qui a
 *   été tapé, et le caster doit le savoir.
 */
export function parseCastBattletagInput(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.length > MAX_CAST_BATTLETAG_LENGTH) throw new Error("INVALID_CAST_BATTLETAG");
  const visible = visibleText(trimmed).trim();
  if (visible === "") throw new Error("INVALID_CAST_BATTLETAG");
  return visible;
}

/** Vrai si cette saisie fait un BattleTag de cast exploitable (ou est vide). */
export function isValidCastBattletag(raw: string | null | undefined): boolean {
  try {
    parseCastBattletagInput(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Le caster peut-il régler le lien de **ce** stream ?
 *
 * Celui qu'il a ouvert, ou celui qu'il partage avec ses co-casters : oui — le
 * lien de ce stream est le leur. Celui du staff (`staff`), jamais : la
 * configuration de la diffusion de l'organisation le pose, et un caster qui a
 * rejoint « le stream du match » n'a pas à réécrire la chaîne de l'organisation.
 */
export function casterStreamEditable(stream: { staff: boolean } | null | undefined): boolean {
  return stream !== null && stream !== undefined && !stream.staff;
}

/**
 * « Configurer ma diffusion » est-elle offerte à ce lecteur ?
 *
 * Il faut qu'il caste le match (`isCaster`) et qu'il y reste quelque chose à
 * régler : la diffusion (`canConfigureLive` — un match dont le score est saisi
 * et qui n'est pas casté n'a plus rien à configurer) ou la rediff
 * (`canEditReplay`), qui n'existe qu'**après** la rencontre. Sans l'une ni
 * l'autre, le pied d'action n'offre rien : le caster d'un match joué sans
 * diffusion ni rediff possible n'a plus de réglage. Un match **pas encore
 * joué** l'offre toujours : « Ne plus caster » y vit.
 *
 * Sans la permission `live` (`canManage`), le serveur refuse tout réglage
 * (`NOT_CASTER`) : la fenêtre n'est offerte que pour ce retrait, donc sur un
 * match pas encore joué seulement.
 */
export function offersCastSettings(
  match: MatchLiveInput & MatchReplayInput & { replayUrl: string | null },
  isCaster: boolean,
  canManage: boolean,
): boolean {
  if (!isCaster) return false;
  if (!canManage) return offersCastRelease(match);
  // Tant que le match n'est pas joué, la fenêtre garde « Ne plus caster » —
  // seule voie de retrait depuis la carte —, même quand plus rien ne s'y règle
  // (score saisi en attente de confirmation, match non casté).
  return match.status !== "COMPLETED" || canConfigureLive(match) || canEditReplay(match, canManage);
}

/**
 * « Ne plus caster » est-il offert dans la fenêtre ?
 *
 * Un match joué est de l'histoire : le serveur refuse d'y retirer une
 * inscription (`MATCH_CAST_CLOSED`), la fenêtre n'en offre donc pas le
 * bouton — elle ne garde alors que la rediff.
 */
export function offersCastRelease(match: Pick<MatchReplayInput, "status">): boolean {
  return match.status !== "COMPLETED";
}
