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
 * - au **manager** (`OWNER` / `MANAGER`) d'une équipe engagée, dès qu'il lui
 *   manque l'une des deux certifications — c'est lui qu'on cherche à joindre ;
 * - à tout **joueur** d'une équipe engagée qui n'a aucun contact à présenter,
 *   s'il lui manque l'une des deux.
 *
 * Module **pur** : la règle se rejoue sans base, et le client n'y lit que les
 * clés de son « Ne plus voir ».
 */

/** Pourquoi la fiche invite ce lecteur à certifier. */
export type CertificationPromptReason = "MANAGER" | "TEAM_WITHOUT_CONTACT";

/** Ce que la modale reçoit : le motif et ce qui manque encore au lecteur. */
export type CertificationPrompt = {
  reason: CertificationPromptReason;
  discordVerified: boolean;
  battletagVerified: boolean;
};

/** Ce que la règle lit d'un compte : ses deux certifications. */
export type CertificationIdentity = {
  discordVerified: boolean;
  battletagVerified: boolean;
};

/**
 * Invitation due au lecteur, `null` s'il n'y en a pas.
 *
 * Rien pour qui a déjà les deux certifications : il n'a plus de geste à faire.
 * Le motif « manager » passe devant : il vaut quel que soit l'état du roster.
 */
export function certificationPromptFor(input: {
  isManager: boolean;
  viewer: CertificationIdentity;
  teamHasContact: boolean;
}): CertificationPrompt | null {
  const { discordVerified, battletagVerified } = input.viewer;
  if (discordVerified && battletagVerified) return null;
  let reason: CertificationPromptReason | null = null;
  if (input.isManager) reason = "MANAGER";
  else if (!input.teamHasContact) reason = "TEAM_WITHOUT_CONTACT";
  return reason ? { reason, discordVerified, battletagVerified } : null;
}

/** Une équipe a-t-elle un contact à présenter ? Au moins un membre certifié d'un côté. */
export function teamHasContact(members: readonly CertificationIdentity[]): boolean {
  return members.some((member) => member.discordVerified || member.battletagVerified);
}

/** Où certifier : la section « Applications connectées » de `/profil`. */
export const CERTIFICATION_PROFILE_HREF = "/profil#connexions";

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
