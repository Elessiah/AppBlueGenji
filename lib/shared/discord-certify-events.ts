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

