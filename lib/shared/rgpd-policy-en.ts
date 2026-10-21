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
import {
  AUTOMOD_ALERT_SCOPE,
  DATA_NOTICE_DM_SCOPE,
  DONNEES_PROFIL,
  BATTLETAG_MATCH_SCOPE,
  VERIFIED_BADGE_SCOPE,
  LIVE_PSEUDO_SCOPE,
  MATCH_CONTACTS_SCOPE,
  MATCH_TIME_DM_SCOPE,
  MODERATION_DM_SCOPE,
} from "@/lib/shared/rgpd-policy";
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
  [MATCH_CONTACTS_SCOPE]:
    "presentation, in the match's “Contacts” window and its launch window, to the members of both its teams and to the referees as soon as both its opponents are known, and to its caster while the match is being played (the launch window, at the start of the match, only opens for both teams and the caster); the caster's contacts to both teams and to the referees while the match is being played (terms of use, “Match contacts”)",
  [BATTLETAG_MATCH_SCOPE]:
    "reading, even when hidden, only in the “Contacts” window of a match where you are presented as a contact and in its launch window: by both its teams and the referees as soon as both its opponents are known, by its caster while the match is being played (the launch window, at the start of the match, only opens for both teams and the caster) — referees and administrators have no other access to it (terms of use, “Match contacts”)",
  [VERIFIED_BADGE_SCOPE]:
    "certification badge on your player page, read by any logged-in player even when the tag is hidden (without the tag) — objection through the report form, GDPR category",
  [MATCH_TIME_DM_SCOPE]: "match time notices, reminders and match removal notices by direct message",
  [MODERATION_DM_SCOPE]: "suspension or moderation notices by direct message",
  [DATA_NOTICE_DM_SCOPE]: "information about your data by direct message",
  [LIVE_PSEUDO_SCOPE]: "#live announcement of a solo tournament, kept in the Discord channel until deleted on request",
  [AUTOMOD_ALERT_SCOPE]:
    "AutoMod alert for such an announcement when blocked or flagged, kept in the moderators' alert channel until they delete it or on request",
};

/** Data and purpose of each `DONNEES_PROFIL` row, same order. */
const PROFIL_TEXT_EN: readonly (readonly [donnee: string, finalite: string])[] = [
  [
    "Site username",
    "Identification on the platform, profile URLs. Never taken from your name: an account created through Discord or Blizzard takes your Discord username or your BattleTag (without its number), an account created through Google gets a neutral username — you change it in My profile. An account created through Google before September 30, 2026 may have received the name of your Google account: if so, replace it in My profile",
  ],
  [
    "Overwatch username",
    "Putting players in touch (adding each other in game) — no statistics. Entered by you, or filled in by Blizzard at each login if you have linked your Battle.net account. When hidden, it is readable by no one — referees and administrators included — except in the “Contacts” window of a match where you are one of the contacts presented and in its launch window: by the members of both its teams and the referees from the moment both its opponents are known to its end, by its caster only while the match is being played (from its start to its end) (the launch window, at the start of the match, only opens for both teams and the caster); if you cast a match, by both its teams and the referees while the match is being played; when presented as a match contact, it is shown with your team role and whether it comes from a linked Battle.net account. Visible or hidden, your player page shows any logged-in player who opens it a “Verified BattleTag” badge if it comes from a linked Battle.net account — never revealing a hidden BattleTag; you can object to it through the report form (GDPR category)",
  ],
  [
    "Discord username",
    "Discord authentication, bot codes by direct message (login, linking, certification), bot notifications (certified tag only). Recorded when you log in through Discord, or entered by you (account without Discord linked); without certification, invisible to everyone, administrators included",
  ],
  [
    "Certification of the Discord username",
    "Opens your Discord tag to the organizers so they can reach you: administrators at any time, referees while you are registered for a tournament that is not over (from the opening of registration), members of both teams of your match from the moment both its opponents are known to its end, its caster only while the match is being played (and, if you cast a match, both its teams and the referees while the match is being played); other logged-in players only if you tick “Discord tag” (« Tag Discord »). Whether your tag is certified (✅ badge, without the tag) can be read on your player page by any logged-in player. Without the certification, the bot sends you no match direct message. Given only by you, from My profile (one click if your Discord is linked, a code by direct message otherwise) — logging in through Discord does not give it. Withdrawn by removing your tag; lost if your username changes",
  ],
  [
    "Discord ID",
    "Means of logging in (Discord button, or code received by direct message) — stored only if you link Discord. Also used by the bot to write to you by direct message (match times, reminders and removal — only if your tag is certified —, request to join a team you manage, suspension or moderation notices, information about your data). Removable from My profile as long as you have another one left",
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
  [
    "Account language",
    "French or English: the language of push notifications. That of the site page your last login started from (except as detailed in the Push notifications section), or the one you choose in My profile; French by default, reset to French if the account is anonymized",
  ],
  [
    "Match direct messages choice",
    "Ticked by default: the bot writes to you privately about the time, reminders and removal of your matches, if your Discord tag is certified; unticked in My profile (your objection), it no longer does. Kept in your legitimate interest: that is what allows your objection to be honoured. Included in the export of your data, reset to the default if the account is anonymized",
  ],
  [
    "Recruitment “Don't show again” choice",
    "No by default: the window of urgent recruitment announcements opens on its own. “Don't show again” in that window: it no longer opens on its own on your other devices (a choice made on this browser before logging in, or not saved right away, is carried over to the account at login or on your next visit while logged in). Can be undone in My profile: the account then records that the window was turned back on and the bg_recr_off cookie of that browser is deleted; from then on, no cookie is carried over to the account any more (a new “Don't show again” made while logged in, or the My profile box, puts it back). Included in the export of your data, reset to the default if the account is anonymized",
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
    text: "You can request the deletion of your account and your profile data, or do it yourself in My profile — or, without accepting the terms of use, from the window that asks you to accept them. See above for achievement data, and for connection data, which the law requires to be kept for one year (GDPR, art. 17.3.b). The #live announcements of a solo tournament that posted your username stay in the Discord channel until they are deleted, on a separate request (“Report a problem”, GDPR category), as does the moderation alert for such an announcement blocked or flagged by AutoMod.",
  },
  {
    title: "Right to restriction",
    text: "You can request that your data be kept without being otherwise used while we check its accuracy or examine your objection, when its processing is unlawful and you prefer this restriction to its erasure, or when you need it for the establishment, exercise or defense of legal claims although we would no longer have any use for it (art. 18).",
  },
  {
    title: "Right to object",
    text: "You can object to the processing of your data based on legitimate interest (tournament history, match time notices, reminders and match removal notices by direct message — these messages are turned off directly with the “Discord direct messages about my matches” box in My profile — and the certification badges on your player page, certified Discord tag and “Verified BattleTag”, through the report form, GDPR category). The username posted in the #live announcement of a solo tournament is not part of it: it falls under performance of the service you register for — not being named in it means not registering; a past announcement is deleted on request. The AutoMod alert for such an announcement when blocked or flagged, kept to moderate the Discord server (legitimate interest), is deleted on request: that is how you object to it.",
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
