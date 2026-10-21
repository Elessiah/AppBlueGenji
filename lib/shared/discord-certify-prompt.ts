/**
 * Fenêtre « Certifier ton tag Discord » proposée à la connexion
 * (`docs/features/DISCORD_CERTIFY_PROMPT.md`).
 *
 * Elle **propose**, elle ne certifie pas : la certification reste un geste
 * spécifique (RGPD, art. 4.11 et 7.4), « Plus tard » et « Ne plus voir » ne
 * coûtent rien, et se connecter ne certifie jamais. Module **pur** : les
 * portes qui la déclenchent, le parcours offert et la réponse du lecteur se
 * testent sans base.
 */
import type { ConnectionLogEvent } from "./connection-logs";
import { isCertifiableDiscordHandle } from "./discord-identity";
import { DISCORD_CERTIFIED_EVENT } from "./discord-certify-events";

/**
 * Portes d'entrée après lesquelles la fenêtre est proposée (décision du
 * 2026-10-21) : Discord — bouton OAuth ou code en message privé — et Blizzard
 * (Battle.net). Pas Google, ni One Tap (porte Google elle aussi).
 */
export const CERTIFY_PROMPT_DOORS: readonly ConnectionLogEvent[] = [
  "LOGIN_DISCORD",
  "LOGIN_DISCORD_CODE",
  "LOGIN_BLIZZARD",
];

/** La session ouverte par cette porte doit-elle proposer la certification ? */
export function certifyPromptDoor(event: ConnectionLogEvent): boolean {
  return CERTIFY_PROMPT_DOORS.includes(event);
}

/** Ce que le compte sait du tag, lu avec la session. */
export type CertifyPromptAccount = {
  discordId: string | null;
  discordPseudo: string | null;
  /** `bg_users.discord_pseudo_from_discord` : le pseudo a été nommé par Discord. */
  pseudoFromDiscord: boolean;
};

/**
 * Le parcours offert par le bouton principal :
 *
 * - `ONE_CLICK` — mêmes conditions que `certifyLinkedDiscordTag` : Discord
 *   rattaché, pseudo nommé par Discord et certifiable. Le clic certifie sur
 *   place, le tag montré servant de garde ;
 * - `DIALOG` — tout autre compte (le plus souvent une connexion Blizzard sans
 *   Discord rattaché) : le bouton mène au dialogue de certification de
 *   `/profil` (code en message privé, ou passage par Discord), sans rien en
 *   recopier.
 */
export type CertifyPrompt =
  | { mode: "ONE_CLICK"; tag: string }
  /** `hasTag: false` : aucun tag enregistré (souvent Blizzard seul) — la fenêtre propose de l'**ajouter**. */
  | { mode: "DIALOG"; hasTag: boolean };

export function certifyPromptFor(account: CertifyPromptAccount): CertifyPrompt {
  const tag = account.discordPseudo?.trim() ?? "";
  if (account.discordId && account.pseudoFromDiscord && isCertifiableDiscordHandle(tag)) {
    return { mode: "ONE_CLICK", tag };
  }
  return { mode: "DIALOG", hasTag: tag !== "" };
}

/** Réponses du lecteur : la fenêtre se ferme pour la session, ou pour le compte. */
export const CERTIFY_PROMPT_ACTIONS = ["LATER", "NEVER"] as const;
export type CertifyPromptAction = (typeof CERTIFY_PROMPT_ACTIONS)[number];

export function parseCertifyPromptAction(value: unknown): CertifyPromptAction | null {
  return typeof value === "string" && (CERTIFY_PROMPT_ACTIONS as readonly string[]).includes(value)
    ? (value as CertifyPromptAction)
    : null;
}

/**
 * Paramètre de `/profil` qui ouvre le dialogue de certification à l'arrivée
 * (parcours `DIALOG`). Retiré de l'adresse dès qu'il est lu.
 */
export const CERTIFY_QUERY_PARAM = "certifier";
export const CERTIFY_QUERY_VALUE = "discord";
export const CERTIFY_PROFILE_HREF = `/profil?${CERTIFY_QUERY_PARAM}=${CERTIFY_QUERY_VALUE}`;

/** L'événement émis par le dialogue de `/profil`. */
export function certifiedFromProfileEvent(): CustomEvent<{ fromProfile: true }> {
  return new CustomEvent(DISCORD_CERTIFIED_EVENT, { detail: { fromProfile: true } });
}

/** {@link DISCORD_CERTIFIED_EVENT} vient-il du dialogue de `/profil` ? */
export function certifiedFromProfile(event: Event): boolean {
  return (event as CustomEvent<{ fromProfile?: unknown } | null>).detail?.fromProfile === true;
}

/** L'adresse demande-t-elle d'ouvrir le dialogue de certification ? */
export function wantsCertifyDialog(search: string | null | undefined): boolean {
  if (!search) return false;
  return new URLSearchParams(search).get(CERTIFY_QUERY_PARAM) === CERTIFY_QUERY_VALUE;
}
