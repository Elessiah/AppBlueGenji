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
 * Module **pur** : la règle se rejoue sans base, et le client n'y lit que les
 * clés de son « Ne plus voir ».
 */

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
  return reason ? { reason, discordVerified, battletagVerified, battletagRelevant } : null;
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
 * Où certifier. Le tag Discord se certifie dans la section « Discord » de
 * `/profil` (« Certifier mon tag ») ; le BattleTag se vérifie en rattachant
 * Battle.net dans « Applications connectées ». Discord manquant passe devant :
 * c'est par lui que l'organisation joint un joueur.
 */
export function certificationProfileHref(prompt: Pick<CertificationPrompt, "discordVerified">): string {
  return prompt.discordVerified ? "/profil#connexions" : "/profil#discord";
}

/**
 * « Ne plus voir » : valeur « 1 » du stockage local, jamais transmise au
 * serveur. Sans identifiant de personne — un navigateur partagé tait la modale
 * pour tous ses comptes, ce qu'une préférence d'affichage peut se permettre.
 */
export const CERTIFICATION_PROMPT_OFF_KEY = "bg_cert_prompt_off";

/**
 * Modale fermée sans « Ne plus voir » : valeur du stockage de session, effacée
 * à la fermeture de l'onglet — la modale ne se rouvre pas à chaque fiche
 * visitée dans la même session.
 */
export const CERTIFICATION_PROMPT_CLOSED_KEY = "bg_cert_prompt_closed";

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
    // ferme quand même, elle se rouvrira simplement à la prochaine visite.
  }
}

/** La modale doit-elle s'ouvrir d'office ? Ni « Ne plus voir », ni déjà fermée dans cet onglet. */
export function shouldOpenCertificationPrompt(local: StorageLike | null, session: StorageLike | null): boolean {
  return !readFlag(local, CERTIFICATION_PROMPT_OFF_KEY) && !readFlag(session, CERTIFICATION_PROMPT_CLOSED_KEY);
}

/** Retient la fermeture : pour l'onglet, et pour de bon si « Ne plus voir » est cochée. */
export function rememberCertificationPromptClosed(
  local: StorageLike | null,
  session: StorageLike | null,
  neverAgain: boolean,
): void {
  writeFlag(session, CERTIFICATION_PROMPT_CLOSED_KEY);
  if (neverAgain) writeFlag(local, CERTIFICATION_PROMPT_OFF_KEY);
}

/**
 * Où en est l'ouverture d'office d'une invitation due, pas encore décidée :
 * - `SKIP` : « Ne plus voir » ou déjà fermée dans l'onglet — décidé, sans ouvrir ;
 * - `WAIT` : une autre modale est ouverte — deux pièges à focus se
 *   disputeraient Tab et Échap, l'invitation attend sa fermeture ;
 * - `OPEN` : ouvrir.
 */
export type CertificationPromptStep = "SKIP" | "WAIT" | "OPEN";

export function certificationPromptStep(input: { allowed: boolean; otherModalOpen: boolean }): CertificationPromptStep {
  if (!input.allowed) return "SKIP";
  return input.otherModalOpen ? "WAIT" : "OPEN";
}

/**
 * L'invitation telle que la fiche peut encore l'afficher. Le serveur la calcule
 * une fois par connexion du flux, et le client la rejoue d'un instantané à
 * l'autre : un tournoi clos depuis, ou une équipe qui s'est retirée, la
 * rendraient périmée — l'instantané, lui, est à jour.
 */
export function liveCertificationPrompt(
  detail: Pick<TournamentDetail, "certificationPrompt" | "card" | "registrations" | "myTeamId"> | null | undefined,
): CertificationPrompt | null | undefined {
  if (!detail) return undefined;
  const { certificationPrompt, card, registrations, myTeamId } = detail;
  if (certificationPrompt === null || card.state === "FINISHED") return null;
  return registrations.some((row) => row.teamId === myTeamId) ? certificationPrompt : null;
}
