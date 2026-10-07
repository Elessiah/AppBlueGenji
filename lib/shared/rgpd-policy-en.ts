/**
 * English translation (lot 7b-2, D1) of the data table and rights of the
 * privacy policy (`rgpd-policy.ts`), whose French text prevails.
 *
 * Same entries, same order, same legal bases (`LegalBase`, the French key,
 * rendered through `LEGAL_BASE_EN`): a test checks the two lists match entry
 * by entry. Durations are read from the same constants.
 */

import { BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import { DONNEES_PROFIL } from "@/lib/shared/rgpd-policy";
import type { DonneEntry, DroitEntry, LegalBase } from "@/lib/shared/rgpd-policy";

/** The four legal bases (GDPR, art. 6.1), in English. */
export const LEGAL_BASE_EN: Record<LegalBase, string> = {
  "Exécution du contrat": "Performance of a contract",
  Consentement: "Consent",
  "Intérêt légitime": "Legitimate interest",
  "Obligation légale": "Legal obligation",
};

/** French duration -> English, for the profile rows. */
const PROFIL_DUREE_EN: Record<string, string> = {
  "Durée du compte": "Lifetime of the account",
  "Jusqu'au retrait ou au changement du tag, ou durée du compte":
    "Until the tag is removed or changed, or lifetime of the account",
};

/** French scope of an additional legal basis -> English. */
const SCOPE_EN: Record<string, string> = {
  "présentation aux joueurs et au caster de ton match, à son lancement":
    "presentation to the players and caster of your match, at its launch",
};

/** Data and purpose of each `DONNEES_PROFIL` row, same order. */
const PROFIL_TEXT_EN: readonly (readonly [donnee: string, finalite: string])[] = [
  [
    "Site username",
    "Identification on the platform, profile URLs. Never taken from your name: an account created through Discord or Blizzard takes your Discord username or your BattleTag (without its number), an account created through Google gets a neutral username — you change it in My profile. An account created through Google before September 30, 2026 may have received the name of your Google account: if so, replace it in My profile",
  ],
  [
    "Overwatch username",
    "Putting players in touch (adding each other in game) — no statistics. Entered by you, or filled in by Blizzard at each login if you have linked your Battle.net account. When hidden, it remains readable by the players of your matches until the tournament is over, by the caster of your match from its launch to its end if you are one of the contacts presented, and by the referees while you are registered for a tournament that is not over",
  ],
  [
    "Discord username",
    "Discord authentication, bot notifications. Recorded when you log in through Discord, or entered by you (account without Discord linked); without certification, invisible to everyone, administrators included",
  ],
  [
    "Certification of the Discord username",
    "Opens your Discord tag to the organizers so they can reach you: administrators at any time, referees while you are registered for a tournament that is not over (from the opening of registration), players and caster of your match from its launch to its end; other logged-in players only if you tick “Discord tag” (« Tag Discord »). Given only by you, from My profile (one click if your Discord is linked, a code by direct message otherwise) — logging in through Discord does not give it. Withdrawn by removing your tag; lost if your username changes",
  ],
  [
    "Discord ID",
    "Means of logging in (Discord button, or code received by direct message) — stored only if you link Discord. Also used by the bot to write to you by direct message (match reminders, request to join a team you manage). Removable from My profile as long as you have another one left",
  ],
  [
    "Google identifier",
    "Means of logging in (Google button) — opaque technical identifier. No email address is requested or kept, and the name of your Google account is not used. Removable from My profile as long as you have another one left",
  ],
  [
    "Blizzard identifier",
    "Means of logging in (Blizzard button) — opaque technical identifier. Fills in and keeps your BattleTag up to date. Removable from My profile as long as you have another one left",
  ],
  [
    "Marvel Rivals username",
    "Putting players in touch (adding each other in game) — no statistics",
  ],
  [
    "Declared adulthood",
    "Yes, no or not specified, as you choose. Shown on your page only if you tick “Adulthood” (« Majorité ») in My profile",
  ],
  [
    "Avatar",
    "Display on the profile and the brackets. Uploaded by you, or copied to our servers from Google or Discord at login — since September 30, 2026, the copied photo stays hidden until you tick “Avatar” in My profile (a photo copied before that date remains displayed: untick “Avatar” to hide it)",
  ],
];

/**
 * `DONNEES_PROFIL`, entry by entry: the legal bases are taken from the French
 * row itself, so the translation cannot drift from them.
 */
export const DONNEES_PROFIL_EN: DonneEntry[] = DONNEES_PROFIL.map((fr, index) => ({
  donnee: PROFIL_TEXT_EN[index]?.[0] ?? fr.donnee,
  finalite: PROFIL_TEXT_EN[index]?.[1] ?? fr.finalite,
  base: fr.base,
  ...(fr.extraBases && {
    extraBases: fr.extraBases.map((extra) => ({ base: extra.base, scope: SCOPE_EN[extra.scope] ?? extra.scope })),
  }),
  duree: PROFIL_DUREE_EN[fr.duree] ?? fr.duree,
}));

/** `DONNEE_TOURNOIS`. */
export const DONNEE_TOURNOIS_EN: DonneEntry = {
  donnee: "Tournament results",
  finalite: "Competitive history, rankings, achievements",
  base: "Intérêt légitime",
  duree: "No defined period: as long as the site exists; anonymized when the account is deleted (see §03)",
};

/** `DONNEE_SAUVEGARDES`. */
export const DONNEE_SAUVEGARDES_EN: DonneEntry = {
  donnee: "Backup copies",
  finalite:
    "Recovery after an incident (outage, corruption). Encrypted before upload, with keys held only by the association's technical manager (who is also the site's host), then stored with Hetzner, in Germany",
  base: "Intérêt légitime",
  duree: `${BACKUP_RETENTION_DAYS} days at most`,
};

/** `DONNEE_CONNEXIONS`. */
export const DONNEE_CONNEXIONS_EN: DonneEntry = {
  donnee: "Connection data (IP address, date and time, means of logging in)",
  finalite:
    "Obligation of the hosting provider of the content published by members (French Act on Confidence in the Digital Economy, « loi pour la confiance dans l'économie numérique » or LCEN, art. 6; Decree No. 2021-1362): making it possible to identify the author of content, at the request of a judicial authority. No other use",
  base: "Obligation légale",
  duree: `${CONNECTION_LOG_RETENTION_DAYS} days (one year) after each login, including after the account is deleted`,
};

/** `DROITS`, same order. */
export const DROITS_EN: DroitEntry[] = [
  {
    title: "Right of access",
    text: "You can request a copy of all the personal data we hold about you.",
  },
  {
    title: "Right to rectification",
    text: "You can correct or update your data from your profile page or by contacting us.",
  },
  {
    title: "Right to erasure",
    text: "You can request the deletion of your account and your profile data. See above for achievement data, and for connection data, which the law requires to be kept for one year (GDPR, art. 17.3.b).",
  },
  {
    title: "Right to restriction",
    text: "You can request that your data be kept without being otherwise used while we check its accuracy or examine your objection, when its processing is unlawful and you prefer this restriction to its erasure, or when you need it to establish a legal claim although we would no longer have any use for it (art. 18).",
  },
  {
    title: "Right to object",
    text: "You can object to the processing of your data based on legitimate interest (tournament history).",
  },
  {
    title: "Right to data portability",
    text: "You can request an export of your data in a machine-readable format (JSON).",
  },
  {
    title: "Right to withdraw consent",
    text: "You can withdraw your consent at any time without affecting the lawfulness of prior processing.",
  },
  {
    title: "Instructions after your death",
    text: "You can set instructions on the retention, erasure and disclosure of your data after your death (art. 85 of the French Data Protection Act). Instructions specific to this site are sent to the association by the same means as other requests.",
  },
];
