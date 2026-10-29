/**
 * Invitation à certifier son tag Discord et son BattleTag, sur la fiche d'un
 * tournoi (`docs/features/CERTIFICATION_PROMPT.md`).
 *
 * Un match ne se lance bien que si chaque équipe a **un contact à présenter**
 * (`pickLaunchContacts` : un tag Discord certifié ou un BattleTag vérifié). Une
 * équipe sans rien de vérifié n'expose personne — un tag Discord non certifié
 * ne sort jamais — et l'adversaire comme l'arbitrage restent sans moyen de la
 * joindre. La fiche le dit donc à qui peut y remédier :
 *
 * - à celui qui **mène** une équipe engagée en match (`OWNER`, `MANAGER`,
 *   `CAPITAINE`), dès qu'il lui manque l'une des deux certifications — c'est
 *   lui qu'on cherche à joindre (motif `MANAGER`) ;
 * - à tout **joueur** d'une équipe engagée qui n'a aucun contact à présenter,
 *   s'il lui manque l'une des deux.
 *
 * En Marvel Rivals, le BattleTag (Battle.net, Overwatch) ne sert à rien : seul
 * le tag Discord est demandé.
 *
 * Module **pur** : la règle se rejoue sans base, et le client n'y lit que la
 * clé de fermeture de l'onglet (« Ne plus voir » : sur le compte).
 */

import { CERTIFY_PROFILE_HREF } from "./discord-certify-prompt";
import type { TournamentDetail, TournamentGame } from "./types";

/** Pourquoi la fiche invite ce lecteur à certifier. */
export type CertificationPromptReason = "MANAGER" | "TEAM_WITHOUT_CONTACT";

/** Ce que la modale reçoit : le motif et ce qui manque encore au lecteur. */
export type CertificationPrompt = {
  reason: CertificationPromptReason;
  discordVerified: boolean;
  battletagVerified: boolean;
  /** `false` en Marvel Rivals : la modale ne parle alors que de Discord. */
  battletagRelevant: boolean;
  /**
   * L'équipe a-t-elle un contact à présenter (`teamHasContact`) ? Toujours
   * `false` au motif `TEAM_WITHOUT_CONTACT` ; au motif `MANAGER`, `false` dit
   * au meneur que son équipe est injoignable — le fait le plus urgent.
   */
  teamHasContact: boolean;
};

/** Ce que la règle lit d'un compte : ses deux certifications. */
export type CertificationIdentity = {
  discordVerified: boolean;
  battletagVerified: boolean;
};

/** Le BattleTag compte-t-il pour ce jeu ? Overwatch seulement. */
export function battletagRelevantFor(game: TournamentGame): boolean {
  return game === "OW";
}

/**
 * Invitation due au lecteur, `null` s'il n'y en a pas.
 *
 * Rien pour qui a déjà ce que le jeu demande (les deux certifications en
 * Overwatch, Discord en Marvel Rivals) : il n'a plus de geste à faire. Le
 * motif « manager » passe devant : il vaut quel que soit l'état du roster.
 */
export function certificationPromptFor(input: {
  isManager: boolean;
  viewer: CertificationIdentity;
  teamHasContact: boolean;
  battletagRelevant: boolean;
}): CertificationPrompt | null {
  const { discordVerified, battletagVerified } = input.viewer;
  const { battletagRelevant } = input;
  if (discordVerified && (battletagVerified || !battletagRelevant)) return null;
  let reason: CertificationPromptReason | null = null;
  if (input.isManager) reason = "MANAGER";
  else if (!input.teamHasContact) reason = "TEAM_WITHOUT_CONTACT";
  return reason
    ? { reason, discordVerified, battletagVerified, battletagRelevant, teamHasContact: input.teamHasContact }
    : null;
}

/**
 * Une équipe a-t-elle un contact à présenter ? Au moins un membre certifié
 * d'un côté — Discord seul en Marvel Rivals, où un BattleTag ne sert pas à
 * joindre l'équipe.
 */
export function teamHasContact(members: readonly CertificationIdentity[], battletagRelevant: boolean): boolean {
  return members.some((member) => member.discordVerified || (battletagRelevant && member.battletagVerified));
}

/**
 * Où certifier. Le tag Discord : le lien de la proposition de la connexion
 * (`CERTIFY_PROFILE_HREF`, `DISCORD_CERTIFY_PROMPT.md`), qui ouvre d'emblée le
 * dialogue de certification de `/profil` ; le BattleTag se vérifie en
 * rattachant Battle.net dans « Applications connectées ». Discord manquant
 * passe devant : c'est par lui que l'organisation joint un joueur.
 */
export function certificationProfileHref(prompt: Pick<CertificationPrompt, "discordVerified">): string {
  return prompt.discordVerified ? "/profil#connexions" : CERTIFY_PROFILE_HREF;
}

/**
 * Ancienne clé du « Ne plus voir » (stockage local, commune à tous les comptes
 * du navigateur) : ce choix vit désormais sur le compte
 * (`POST /api/profile/certification-prompt`). Plus jamais lue ; effacée là où
 * elle traîne encore (`forgetLegacyCertificationPromptOff`).
 */
export const LEGACY_CERTIFICATION_PROMPT_OFF_KEY = "bg_cert_prompt_off";

/**
 * Modale fermée sans « Ne plus voir » : valeur du stockage de session, effacée
 * à la fermeture de l'onglet — la modale ne se rouvre pas à chaque fiche
 * visitée dans la même session.
 */
export const CERTIFICATION_PROMPT_CLOSED_KEY = "bg_cert_prompt_closed";

/** Où le client garde ses choix « Ne plus voir » : `POST` de la route du compte. */
export const CERTIFICATION_PROMPT_OFF_PATH = "/api/profile/certification-prompt";

/** Stockage du navigateur tel que la décision le lit ; `null` s'il est inaccessible. */
type StorageLike = Pick<Storage, "getItem" | "setItem">;

function readFlag(storage: StorageLike | null, key: string): boolean {
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(storage: StorageLike | null, key: string): void {
  try {
    storage?.setItem(key, "1");
  } catch {
    // Stockage bloqué (navigation privée, données refusées) : la modale se
    // ferme quand même, elle se rouvrira simplement à la prochaine fiche.
  }
}

/** La modale doit-elle s'ouvrir d'office ? Pas déjà fermée dans cet onglet (« Ne plus voir » : le serveur la tait). */
export function shouldOpenCertificationPrompt(session: StorageLike | null): boolean {
  return !readFlag(session, CERTIFICATION_PROMPT_CLOSED_KEY);
}

/** Retient la fermeture pour l'onglet. */
export function rememberCertificationPromptClosed(session: StorageLike | null): void {
  writeFlag(session, CERTIFICATION_PROMPT_CLOSED_KEY);
}

/** Efface l'ancienne clé du « Ne plus voir » d'un navigateur (sans effet si elle n'y est pas). */
export function forgetLegacyCertificationPromptOff(local: Pick<Storage, "removeItem"> | null): void {
  try {
    local?.removeItem(LEGACY_CERTIFICATION_PROMPT_OFF_KEY);
  } catch {
    // Stockage bloqué : rien à effacer qu'on puisse atteindre.
  }
}

/**
 * L'invitation telle que la fiche peut encore l'afficher. Le serveur la calcule
 * une fois par connexion du flux, et le client la rejoue d'un instantané à
 * l'autre : un tournoi clos depuis, ou une équipe qui s'est retirée, la
 * rendraient périmée — l'instantané, lui, est à jour.
 */
export function liveCertificationPrompt(
  detail: Pick<TournamentDetail, "certificationPrompt" | "card" | "registrations" | "myTeamId"> | null | undefined,
  tournamentId: number,
): CertificationPrompt | null | undefined {
  // Fiche réutilisée d'un tournoi à l'autre : rien de décidé tant que le
  // détail lu est celui du tournoi précédent.
  if (detail?.card.id !== tournamentId) return undefined;
  const { certificationPrompt, card, registrations, myTeamId } = detail;
  if (certificationPrompt === null || card.state === "FINISHED") return null;
  return registrations.some((row) => row.teamId === myTeamId) ? certificationPrompt : null;
}
