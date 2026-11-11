import type { MatchLaunchInfo } from "@/lib/shared/match-launch";
import frLaunchModal from "@/messages/fr/launchModal.json";
import enLaunchModal from "@/messages/en/launchModal.json";
import { useShellText } from "@/components/i18n/shell-text";
import { scopedText, type Leaves, type ScopedText } from "@/lib/shared/scoped-text";

/**
 * Textes de la fenêtre de lancement d'un match (espace `launchModal`).
 *
 * La fenêtre est montée par la mise en page racine pour tout compte connecté,
 * mais chargée à la demande (`MatchLaunchCenterLazy`) : ses **deux** langues
 * voyagent avec son morceau, importées ici. Rangées dans la coquille, elles
 * pesaient sur le premier chargement de **chaque** page (français dans le
 * paquet, anglais sérialisé sous `/en`), visiteur anonyme compris.
 */
export type LaunchMessages = typeof frLaunchModal;
export type LaunchKey = Leaves<LaunchMessages>;
export type LaunchText = ScopedText<LaunchKey>;

export const FR_LAUNCH_TEXT: LaunchText = scopedText("fr", frLaunchModal);
const EN_LAUNCH_TEXT: LaunchText = scopedText("en", enLaunchModal);

/** Textes de la fenêtre, dans la langue de la page (celle de la coquille). */
export function useLaunchText(): LaunchText {
  return useShellText().locale === "en" ? EN_LAUNCH_TEXT : FR_LAUNCH_TEXT;
}

/**
 * Note des contacts tus des engagées : elle ne renvoie à l'action « Contacts »
 * que si celle-ci lui ouvre déjà quelque chose (`viewer.earlyContacts` : joueur
 * du match, ou arbitre même inscrit comme caster) — jamais au seul caster
 * avant le départ.
 */
export function launchSidesLaterText(text: LaunchText, viewer: Pick<MatchLaunchInfo["viewer"], "earlyContacts">): string {
  return text.t(viewer.earlyContacts ? "contactsAtLaunch" : "contactsAtLaunchForCaster");
}

/**
 * Note des contacts tus d'un caster, dans la modale de lancement. À l'arbitre
 * désigné du match — qu'il le caste aussi ou non —, l'action « Contacts » de la
 * carte ouvre déjà ceux des casters quand elle lui ouvre le match
 * (`viewer.earlyContacts`, `casterContactsRole` au serveur) : la note y renvoie,
 * en bref (celle des engagées, juste au-dessus, dit déjà où la trouver). Un
 * arbitre désigné éligible ne joue pas le match et tient la permission
 * `tournaments` : `earlyContacts` n'est qu'un filet. À tout autre lecteur,
 * `undefined` : la fiche garde
 * sa note par défaut (« au lancement »), les co-casters et les équipes
 * attendant le départ.
 */
export function launchCastersLaterText(
  text: LaunchText,
  viewer: Pick<MatchLaunchInfo["viewer"], "isReferee" | "earlyContacts">,
): string | undefined {
  return viewer.isReferee && viewer.earlyContacts ? text.t("casterContactsAtLaunchOrNow") : undefined;
}

/**
 * Note des contacts tus de l'arbitre désigné, sur la page du match. Un arbitre
 * qui caste aussi le match suit la règle des casters : ses contacts attendent
 * le départ, pour tout lecteur (« au départ du match »). Sinon, au lecteur dont
 * l'action « Contacts » ouvre déjà les contacts (`viewer.earlyContacts`), la note
 * y renvoie, comme celle des engagées (`launchSidesLaterText`) ; au caster seul,
 * « au départ du match ».
 */
export function refereeLaterText(
  text: LaunchText,
  launch: {
    viewer: Pick<MatchLaunchInfo["viewer"], "earlyContacts">;
    casters: readonly Pick<MatchLaunchInfo["casters"][number], "userId">[];
    referee: Pick<NonNullable<MatchLaunchInfo["referee"]>, "userId"> | null;
  },
): string {
  const refereeId = launch.referee?.userId;
  const refereeCasts = refereeId !== undefined && launch.casters.some((caster) => caster.userId === refereeId);
  return !refereeCasts && launch.viewer.earlyContacts ? text.t("contactsAtLaunch") : text.t("contacts.casterLater");
}
