/**
 * Événements de la proposition de certification du tag Discord, dans un module
 * **sans import** : le relais de la mise en page racine
 * (`DiscordCertifyPromptLazy`, sur chaque page) n'emporte pas la logique de
 * `discord-certify-prompt.ts` ni `discord-identity.ts` pour deux noms.
 */

/**
 * Événement de fenêtre qui ouvre le dialogue de certification quand la
 * proposition est acceptée **depuis** `/profil` (aucune navigation à faire).
 */
export const CERTIFY_DIALOG_EVENT = "bg:certify-dialog";

/**
 * Événement de fenêtre émis quand le tag vient d'être certifié — d'un clic par
 * la proposition, ou par le dialogue de `/profil` (`detail.fromProfile`). La
 * proposition se close pour la session ; `/profil`, s'il est ouvert, relit son
 * état Discord, sauf pour son propre événement (il le tient déjà à jour).
 */
export const DISCORD_CERTIFIED_EVENT = "bg:discord-certified";


/**
 * Délai pendant lequel une demande d'ouverture du dialogue de certification
 * vaut : le temps d'une navigation vers `/profil`.
 */
export const CERTIFY_DIALOG_REQUEST_TTL_MS = 60_000;

/** Demande posée par une page du site, en mémoire de cette page seulement. */
let certifyDialogRequestedAt: number | null = null;

/**
 * Une page du site (fenêtre de la connexion, invitation de la fiche tournoi)
 * mène à `/profil?certifier=discord` : le dialogue s'y ouvrira. Gardée en
 * mémoire de la page — jamais dans l'adresse ni le stockage —, si bien qu'un
 * lien venu d'un autre site, ou ouvert dans un nouvel onglet, mène au profil
 * sans ouvrir le dialogue.
 */
export function requestCertifyDialog(now: number = Date.now()): void {
  certifyDialogRequestedAt = now;
}

/** La demande en cours, consommée : `true` une fois, dans le délai. */
export function takeCertifyDialogRequest(now: number = Date.now()): boolean {
  const at = certifyDialogRequestedAt;
  certifyDialogRequestedAt = null;
  return at !== null && now - at >= 0 && now - at <= CERTIFY_DIALOG_REQUEST_TTL_MS;
}
