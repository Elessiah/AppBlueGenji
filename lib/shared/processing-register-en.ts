/**
 * Record of processing activities — English translation (lot 7b-2, D1) of
 * `processing-register.ts`, whose French text prevails.
 *
 * Same activities, same references (`T01`…), same order, same number of items
 * in every heading (a test checks it), and the same constants for every
 * duration. `REGISTER_UPDATED_AT` is the French register's: a translation is
 * not an update. The CSV export (`/rgpd/registre.csv`) stays French — it is the
 * document handed to the CNIL, in its own model and language.
 */
import { ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS, BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import { SUSPENSION_RETENTION_MONTHS } from "@/lib/shared/account-suspension";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import { REPORT_RETENTION_DAYS_AFTER_RESOLUTION } from "@/lib/shared/content-reports";
import { ASSOCIATION_NAME, ASSOCIATION_SEAT, DATA_CONTACT_NAME } from "@/lib/shared/legal-contact";
import {
  BOT_FEED_EVENT_RETENTION_DAYS,
  BOT_STAFF_LOG_RETENTION_DAYS,
  SUPPORT_TICKET_RETENTION_MONTHS,
  WEB_ACCESS_LOG_RETENTION_DAYS,
} from "@/lib/shared/legal-durations";
import {
  DATA_CONTACT_ROLE_EN,
  REPORT_FORM_NAME_EN,
  WEB_ACCESS_LOG_FIELDS_EN,
  copyrightNoticeElementsTextEn,
  monthsEn,
} from "@/lib/shared/legal-text-en";
import { LOGO_QUARANTINE_MONTHS } from "@/lib/shared/logo-quarantine";
import {
  BOT_ACTIVITY_AUTHOR_RETENTION_DAYS,
  BOT_RELAY_RETENTION_DAYS,
  DISCORD_CODE_VALIDITY_MINUTES,
  DPF_ADEQUACY_DECISION_EN,
  SESSION_RETENTION_DAYS,
  TRANSFER_RECIPIENTS,
  type ProcessingActivity,
  type RegisterController,
  type TransferMechanism,
  type TransferRecipient,
} from "@/lib/shared/processing-register";
import { PUSH_SUBSCRIPTION_RETENTION_DAYS } from "@/lib/shared/push-notifications";
import { SITE_HOST } from "@/lib/shared/site-host";
import {
  SITE_VISIT_DETAIL_RETENTION_DAYS,
  SITE_VISIT_WINDOW_MINUTES,
  SITE_VISITOR_RETENTION_MONTHS,
} from "@/lib/shared/site-visits";

/** `STANDARD_CONTRACTUAL_CLAUSES`. */
export const STANDARD_CONTRACTUAL_CLAUSES_EN =
  "standard contractual clauses of the European Commission (art. 46 GDPR), included in its terms of use";

function joinNamesEn(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** `transferBasis`, in English: same grouping by mechanism, same recipients. */
export function transferBasisEn(recipients: readonly TransferRecipient[]): string {
  const unique = recipients.filter((r, i) => recipients.indexOf(r) === i);
  const named = (mechanism: TransferMechanism) =>
    unique.filter((r) => TRANSFER_RECIPIENTS[r].mechanism === mechanism).map((r) => TRANSFER_RECIPIENTS[r].name);
  const dpf = named("DPF");
  const scc = named("SCC");
  const parts: string[] = [];
  if (dpf.length > 0) parts.push(`${joinNamesEn(dpf)}, certified under the EU-U.S. Data Privacy Framework: ${DPF_ADEQUACY_DECISION_EN}`);
  if (scc.length > 0) parts.push(`${joinNamesEn(scc)}: ${STANDARD_CONTRACTUAL_CLAUSES_EN}`);
  return parts.join("; ");
}

/** `HETZNER_BACKUP_FRAMEWORK`. */
export const HETZNER_BACKUP_FRAMEWORK_EN =
  "Hetzner Online GmbH (Germany), Storage Share service, sub-processor of the association through the site's host, who accepted its data processing agreement (Data Processing Agreement, version 1.2) on October 1, 2026; processing exclusively in the European Union or the European Economic Area";

/** `SPICEWORKS_PROCESSOR_FRAMEWORK`. */
export const SPICEWORKS_PROCESSOR_FRAMEWORK_EN =
  "a processor of the association, under Spiceworks' data processing agreement (Data Processing Agreement)";

/** `SPICEWORKS_SCC_FALLBACK`. */
export const SPICEWORKS_SCC_FALLBACK_EN =
  "as a fallback, standard contractual clauses of the European Commission (art. 46 GDPR) contained in Spiceworks' data processing agreement";

/** `OUTLOOK_MAIL_FRAMEWORK`. */
export const OUTLOOK_MAIL_FRAMEWORK_EN =
  "personal Microsoft account (Outlook.com), governed by the Microsoft Services Agreement and the Microsoft privacy statement, without a processing agreement; storage location not guaranteed by Microsoft; messages not encrypted by the association, readable by Microsoft";

/** `ASSOCIATION_GMAIL_FRAMEWORK`. */
export const ASSOCIATION_GMAIL_FRAMEWORK_EN =
  "the association's Gmail mailbox, hosted by Google; messages not encrypted by the association, readable by Google";

/** `HOST_PROCESSING_AGREEMENT`. */
export const HOST_PROCESSING_AGREEMENT_EN =
  "processing agreement (GDPR, art. 28) drafted, awaiting signature by the association and the host";

/** `RGPD_CONTACT_LINE` (`legal-contact.ts`). */
export const RGPD_CONTACT_LINE_EN = `Requests regarding data: ${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE_EN}, appointed by the association to receive them — email and phone (privacy policy and legal notice of the site) —, or the site's “${REPORT_FORM_NAME_EN}” form (footer), “GDPR” category; the association: email and phone (legal notice of the site)`;

/** `registerController()`, in English. */
export function registerControllerEn(): RegisterController {
  return {
    name: ASSOCIATION_NAME,
    legalForm: "French nonprofit (law of 1901)",
    seat: ASSOCIATION_SEAT,
    contact: RGPD_CONTACT_LINE_EN,
    dataContact: `${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE_EN}, appointed by the association to receive requests regarding data (contact details given with those of the data controller). He is not a data protection officer within the meaning of Article 37 of the GDPR; the association remains the data controller`,
    host: `${SITE_HOST.name} (${SITE_HOST.statusEn.toLowerCase()}), ${SITE_HOST.address} — processor (${HOST_PROCESSING_AGREEMENT_EN}), data hosted in ${SITE_HOST.country} (site and Discord bot on ${SITE_HOST.machineEn})`,
  };
}

const COMMON_SECURITY_EN = [
  "Server access restricted to the technical manager (SSH key authentication, automatic banning of failed attempts)",
  "Encrypted communications (HTTPS)",
  "Role-based administration rights, limited to what each task requires",
];

/** `REGISTER_SCOPE`. */
export const REGISTER_SCOPE_EN =
  "The register describes the processing of personal data by the association's site and Discord bot";

/** `REGISTER_SCOPE_DETAIL`. */
export const REGISTER_SCOPE_DETAIL_EN =
  "It also describes the support portal (Spiceworks), match streaming and the web server's technical logs. Managing memberships of the association is not part of the site: the association keeps it outside the site, and this register does not describe it — for any question about it, use the contact details of the privacy policy.";

/** `PROCESSING_ACTIVITIES`, activity by activity (same `ref`, same order). */
export const PROCESSING_ACTIVITIES_EN: readonly ProcessingActivity[] = [
  {
    ref: "T01",
    name: "Player accounts and profiles",
    purpose: "Allowing players to have an account on the tournament platform",
    subPurposes: [
      "Displaying a public profile (username, avatar, in-game usernames according to visibility settings)",
      "Putting players in touch (adding each other in game, team recruitment)",
      "Exporting one's data and deleting one's account from “My profile” (deletion also from the terms of use acceptance window, without accepting them)",
      "Writing push notifications and the site's Discord direct messages in the account's language (French then English when it cannot be read and for alerts sent to staff by direct message — referees, leadership —, French alone when both do not fit in one message): the language of the site page the last login started from (a login started elsewhere, or a login through the Google, Discord or Blizzard button from a browser that does not tell (too old, or one that strips this information), does not change it; French by default), or the one chosen in “My profile”",
      "Keeping on the account the “Don't show again” choice of the window of urgent recruitment announcements, so that it no longer opens on its own on the player's other devices — a choice that can be undone in “My profile”",
      "Suggesting, once per login with Discord or Blizzard, the verification of the Discord tag to an account that does not have it (a window that verifies nothing on its own), and keeping on the account the “Don't show again” choice of that window",
    ],
    legalBasis:
      "Performance of the service requested by the player (contract) for the account; consent for the optional data the player fills in and chooses to make visible; performance of the service (contract — terms of use, “Match contacts”) for the BattleTag being read, even when hidden, presented in Overwatch tournaments only, for a player presented as a contact of a match, only in its “Contacts” window and its launch window; for a caster and for the assigned referee, also on the match page (record T04); for the assigned referee's, in these windows as on the match page, legitimate interest, with a right to object, until they have accepted version 7 of the terms or a later version (record T04) — when hidden, it is readable nowhere else, referees and administrators included; legitimate interest (knowing who has proven their game identity) for the certification badges on the player page (certified Discord tag, BattleTag taken from a linked Battle.net account), read by any logged-in player even when the tag is hidden, without the tag — right to object through the report form (GDPR category)",
    dataSubjects: ["Players registered on the site"],
    dataCategories: [
      "Site username (since September 30, 2026, never taken from the name of the Google account: neutral username at creation; an earlier Google account may have received that name), avatar (copied to our servers; since the same date, hidden by default when it comes from the login provider)",
      "Overwatch (BattleTag), Marvel Rivals and Discord usernames; certification of the Discord username; whether the BattleTag comes from a linked Battle.net account (player page badge, shown even when the BattleTag is hidden)",
      "Declared adulthood (yes / no / not specified)",
      "Visibility settings, availability for recruitment, roles on the platform",
      "Account language (French or English), reset to French on anonymization; sent to the association's Discord bot (T08) only with the code sent by Discord direct message (login, certification or change of the tag) — the language of the account already linked to that Discord account, French then English when there is none —, which the bot writes in that language without keeping it",
      "“Don't show again” choice on the window of urgent recruitment announcements, made in that window or by unticking the “My profile” box (never chosen / yes / turned back on from “My profile”; a choice made on the browser before logging in, or not saved right away, is carried over to an account that has never chosen, at login or on the next logged-in visit; turning it back on from “My profile” also deletes the bg_recr_off cookie of that browser), reset to “never chosen” on anonymization",
      "“Don't show again” choice on the window suggesting the verification of the Discord tag (date of the choice), erased on anonymization; on the login session, a “window still to be suggested” mark (set at each login with Discord or Blizzard of an account whose Discord tag is not verified and that has not chosen “Don't show again”, cleared at the first answer — on all the account's sessions, including those of another device, for “Don't show again” — or at the first read when there is nothing left to suggest), erased with the session",
      "No real name, no email address, no phone number, no postal address",
    ],
    sensitiveData: "None",
    retention: [
      "Lifetime of the account",
      `On deletion: complete erasure if the account has left no trace (no match played, no registration in a solo tournament, no team owned, no tournament organized), immediate anonymization otherwise — the username is replaced by a borrowed username, and only the anonymized account remains, with its tournament and team history; in both cases, the connection data log (T14) is kept until its legal deadline; the information provided when the account was created (username, provider identifiers) is not kept after deletion, apart from the encrypted backup copies (T09, ${BACKUP_RETENTION_DAYS} days at most) and the record of the deletion in the log that replays it after a restoration (account identifier and creation date, ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} days); the reports sent by the account are detached from it and follow their own period (T11), and a staff member's refereeing actions remain named in the server logs, according to their rotation (T05); the #live announcements of a solo tournament keep the username in the Discord channel until they are deleted on request, and the AutoMod alert for such an announcement when blocked or flagged keeps it in the moderators' alert channel until they delete it or on request (T16)`,
      `Login sessions: ${SESSION_RETENTION_DAYS} days after login`,
    ],
    recipients: [
      "The site's public (only the data the player makes visible)",
      "Parties to the same match: in its “Contacts” window and its launch window, for the BattleTag of any contact presented (player, caster, assigned referee); on the match page as well, for the BattleTag of the assigned referee and the casters only — (BattleTag even when hidden, to add each other in game, in Overwatch tournaments only; durations of record T04)",
      "Logged-in players of the site: certified Discord username, if the player makes it visible; certification badges on the player page (certified Discord tag, “Verified BattleTag” — BattleTag taken from a linked Battle.net account), even when the tag is hidden, without the tag",
      "The association's staff according to their role (administration, refereeing)",
      "The association's Discord bot (T08): the account language, with the code sent by direct message only",
    ],
    transfers: ["None"],
    security: [
      ...COMMON_SECURITY_EN,
      "Session tokens stored as a hash (SHA-256), httpOnly cookie",
      "No password: login delegated to Google, Discord or Blizzard, or one-time code",
    ],
  },
  {
    ref: "T02",
    name: "Authentication",
    purpose: "Logging a player into their account without a password",
    subPurposes: [
      "Login through Google, Discord or Blizzard (OAuth)",
      "Login with a six-digit code sent by the bot by Discord direct message",
      "Linking several means of logging in to the same account",
    ],
    legalBasis: "Performance of the service requested by the player (contract)",
    dataSubjects: ["Players registered on the site"],
    dataCategories: [
      "Opaque Google, Discord and Blizzard technical identifiers",
      "Discord identifier and Discord username (login by code or by button), recorded without being certified — certification, which exposes it, is a separate action (T04)",
      "Way the Discord account was linked (OAuth button or code by direct message)",
      "Login code (kept only as a hash), number of attempts",
      "Language of the account already linked to that Discord account (T01), read so that the bot writes the code in that language",
      "IP address, in memory to limit attempts; that of a successful login is written to the connection data log (T14), for the host's legal obligation only",
    ],
    sensitiveData: "None",
    retention: [
      `Login identifiers: lifetime of the account, or until the provider is unlinked; erased when the account is deleted (only the connection data log, T14, outlives it, apart from the encrypted backup copies, T09, ${BACKUP_RETENTION_DAYS} days at most)`,
      `Login codes: valid ${DISCORD_CODE_VALIDITY_MINUTES} minutes, purged one day after expiry, erased when the account is deleted`,
    ],
    recipients: [
      "Google, Discord and Blizzard, which authenticate the player (controllers of their own processing)",
      "Discord, which delivers the direct message containing the code",
    ],
    transfers: [
      `Possible to the United States, depending on the provider the player chooses to log in with — ${transferBasisEn(["GOOGLE", "DISCORD", "BLIZZARD"])}`,
    ],
    security: [
      ...COMMON_SECURITY_EN,
      "Anti-CSRF token and state sealed on the way out for each OAuth login",
      "Five attempts per code, five codes per quarter of an hour and per account, rate limits per IP address",
      "Only the minimum permissions are requested from providers (neither email address nor server list)",
    ],
  },
  {
    ref: "T03",
    name: "Tournaments, teams and achievements",
    purpose: "Organizing amateur tournaments and keeping their results",
    subPurposes: [
      "Forming teams (members, roles, invitations)",
      "Notifying the owner and managers of a team of a request to join by Discord direct message (without naming the requester, at most one message per player and per team every 24 h)",
      "Registering teams or players, generating brackets, entering and refereeing scores",
      "Publishing results, rankings, statistics and achievements",
      "Letting visitors without an account follow the page of a published tournament (/suivre/tournois/…): bracket, scores, rankings, team names and logos and usernames of the participants (and, in a solo tournament, their avatar unless hidden and their internal account number, for the podium mark), BlueGenji Survival penalties without reason or referee, without replay codes; page excluded from search engines",
    ],
    legalBasis: "Legitimate interest (organizing competitions, sporting memory of the scene)",
    dataSubjects: ["Registered players", "Team members", "Refereeing staff", "Visitors without an account of a tournament's public page"],
    dataCategories: [
      "Team membership and team roles",
      "IP address of a visitor without an account, in memory only, to cap their reads of the public page",
      "Registrations, scores, forfeits, penalties (with reason and referee who imposed it), rankings",
      "Map-by-map detail of a match: score and replay code of each map (optional when the referees enter the map, replay lost; the replay shows the players' identifiers in game, hidden BattleTag included), account that entered it",
    ],
    sensitiveData: "None",
    retention: [
      "Results and achievements: no defined retention period, kept as long as the site exists; anonymized when the account is deleted (borrowed username)",
      "Replay codes: kept with the result they document (a detail that no longer explains it is erased); the link to the account that entered them is erased when the account is deleted, the codes remain (the game is kept by the game's publisher)",
      "Right to object available on request",
      "IP address of a visitor without an account: in memory, for the read cap's window (one minute), never stored",
    ],
    recipients: [
      "The site's public",
      "Refereeing and administration staff",
      "Discord, which delivers the direct message of a request to join",
    ],
    transfers: [`United States: Discord (delivery of direct messages) — ${transferBasisEn(["DISCORD"])}`],
    security: [
      ...COMMON_SECURITY_EN,
      "Changing a score locked as soon as the next round has started",
    ],
  },
  {
    ref: "T04",
    name: "Contacting players during a tournament",
    purpose: "Allowing the organizers to reach a player taking part (rescheduling, settling a dispute, confirming a forfeit), and the parties to a match (members of both teams, signed-up casters) to reach each other to organise it, and signed-in members to know who referees a match",
    subPurposes: [
      "Exposing the certified Discord username to administrators, at any time, and to referees while the player is registered for a tournament that is not over (from the registration phase)",
      "Presenting a player's hidden BattleTag to administrators and referees only in the “Contacts” window of a match in an Overwatch tournament, over the same durations as for both its teams, and, a caster's, from the moment both opponents of the match are known until its end (the launch window, which repeats it at the start of the match, only opens for the teams, the casters and the assigned referee; the match page repeats those of the assigned referee and the casters, to the same readers at the same times as the “Contacts” window) — never anywhere other than these two windows and, for those of the assigned referee and the casters, that page",
      "When a match is launched — and as soon as both its opponents are known, through the “Contacts” button on its card —, presenting to the members of both teams (players, coaches, managers, owners) and to the referees the certified Discord username and, in Overwatch tournaments only, the BattleTag (even when hidden) of one or two members per team (only one in Marvel Rivals tournaments), with their team role, until the end of the match; presenting the same contacts to each registered caster (a match has no maximum number of casters), and each caster's (their BattleTag in Overwatch tournaments only) to both teams and to the other casters of the match, only while the match is being played (from its start — launch window opened or match launched — to its end); the casters' to the referees from the moment both opponents are known until the end of the match; the match page repeats the casters' contacts (certified Discord username and, in Overwatch, BattleTag), to the same readers at the same times as that button",
      "Collecting the “Ready” of each party to a match (teams, each caster for themselves) before it is launched, only in tournaments that have the launch phase (an option of each tournament, off by default)",
      "Inviting, on the page of a tournament that has not finished, a player of an entered team to verify their Discord tag and BattleTag (in Marvel Rivals, their Discord tag only): whoever leads it in matches (owner, manager, captain) if they are missing one, any member if nobody on the team has a contact to show (in Marvel Rivals, if nobody on it has verified their Discord tag, a verified BattleTag not counting) — reading the roster's verifications (tags included, checked as at a match launch), each time the page opens; the result (prompt due or not) is kept in the server's memory at most one minute after its read ends (ten seconds after a read error), never written; only a team-level fact (nobody on it has verified their Discord tag or their BattleTag — in Marvel Rivals, their Discord tag) is told to the invited members, never who verified what; closing remembered for the tab (session storage, value “1” with no identifier); “Don't show again” kept on the account (date of the choice), which silences the invitation on every tournament and in every browser of that account; a “Don't show again” given to the sign-in certification proposal (account) also silences the invitation made to the team leader when Discord is the only thing missing (never when their team has no contact to show)",
      "Sending by Discord direct message and by push the announcement of a match's time (set, changed or removed), the notice that a match leaves their schedule and match reminders 24 h and 10 h before kickoff (the latter — or the announcement of a match scheduled less than 10 h ahead — with the invite link to the check-in Discord server); direct messages only go to accounts with a certified Discord tag (an uncertified tag, even one linked by signing in with Discord, receives none, to avoid spam); the player can turn these direct messages off from “My profile” (notifications), their push notifications keeping their own settings",
      "Alerting the referee role (score conflict, score dispute left too long without a referee, match entering its launch with neither an assigned referee nor self-management — a warning, nothing switches automatically —, report on a player)",
      "Warning the other referees and administrators by push when a staff member who plays in a match (member of one of both teams — still a member, or gone since the match was launched, its first report or, failing these, its creation —, or the player of the entry in a solo tournament) settles its score dispute themselves (“Confirm the result”), corrects its already decided result, imposes their opponent's withdrawal, or pauses the automatic confirmation of a proposed score (“Save”): tournament and round, and — except for a pause — the retained outcome with the team names (none in a solo tournament), without the pseudo of the author or of any player",
      "Sending the referees, about 10 hours ahead, the schedule of upcoming matches (times, tournaments, team names; “a player” in a solo tournament) to the Discord log channel and by push",
      "Notifying a caster, by Discord direct message and by push, that their registration for a match was removed by someone other than themselves — by the staff or automatically (casting requirements no longer met, or they now play in the match) —, with the reason, the match (team names; “a match” in a solo tournament), its tournament and its round, without naming who removed it; the direct message only goes to a certified Discord tag and is turned off, like the other match messages, from “My profile”; the push is only sent if they still hold the streaming permission",
      "Sending by Discord direct message and by push, when the lobby of a match opens (again if it reopens, for instance after a change of time), to those who manage each of its entrants (owners and managers of a team, the player of a solo entry; nobody for a ghost team) the game settings — team on the left (the host) and on the right, first map, first ban, reminder to sort the players by role if the match is cast, assigned referee or self-management — with the team names, the tournament, the round and the link to the match page, without any BattleTag, Discord tag or player username (“you”, “your opponent” in a solo tournament); the direct message only goes to a certified Discord tag and is turned off, like the other match messages, from “My profile”; the push has its own setting",
      "Assigned referee of a match (a staff member who can referee — refereeing permission, certified Discord tag and a BattleTag taken from a linked Battle.net account, a hand-typed BattleTag not being enough —, who takes the match or to whom the staff assigns it; they may also cast it): presenting their username and, in Overwatch tournaments only, their BattleTag (even when hidden), never their Discord tag in that capacity (if they also cast the match, their caster contacts follow the casters' rule), in the match's “Contacts” and launch windows and on the match page, to the members of both its teams and to the referees as soon as both its opponents are known until its end, and to its casters while the match is being played — the username alone, without the BattleTag, as soon as the launch window shows the match; also showing their username alone to any signed-in member, on the card and page of a match, until its score is reported or the tournament ends (visitors without an account only read “Referee assigned”); collecting their “Ready”, expected like those of the teams and casters, which only its parties and the referees read, in the “Contacts” and launch windows",
      "Notifying the assigned referee, by push only (never by direct message), when the refereeing of a match is removed from them by someone other than themselves — removal by the staff, match assigned to another referee or switched to self-management, the referee's objection upheld — or automatically (refereeing requirements no longer met, or they become a player of the match before its launch), with the reason, the match (team names; “a match” in a solo tournament), its tournament and its round, without naming who removed it",
      "Upholding a referee's objection (art. 21, report form, GDPR category): removing them from all their unfinished matches, launched ones included (the staff assigns another referee; their finished matches keep their referee), and closing all refereeing to them — neither taking a match nor being assigned one by the staff — until the staff lifts it, at their request only (same form); the action and its lifting are noted in the staff log on Discord without naming anyone or the matches removed (no line per match), and in the server logs with the author, the referee's account identifier and the number of matches removed",
    ],
    legalBasis:
      "Consent for exposing the certified Discord username to the organizers (certification, a separate action taken by the player from their profile or the window that offers it after logging in through Discord or Blizzard — never acquired by logging in alone — and withdrawable by removing their tag); performance of the service requested by the player (contract — terms of use, “Match contacts” section) for presenting the contacts to the parties to a match in its “Contacts” window and its launch window — and, for the casters' contacts, on the match page — (to both its teams and the referees as soon as both its opponents are known until its end, to its casters while the match is being played, and each caster's — a service they request by signing up for the match — to both its teams and to the other casters of the match while the match is being played and to the referees as soon as both its opponents are known until its end; the launch window, at the start of the match, only opens for both teams, the casters and the assigned referee), hidden BattleTag included in Overwatch tournaments only — referees and administrators have no other access to it, on the same basis —, and collecting the “Ready”; legitimate interest (smooth running of tournaments) for match time notices, the notice that a match leaves their schedule and match reminders sent to players, the lobby settings sent to those who manage the entrants of a match, and the notice of the removal of their registration sent to a caster, with a right to object (art. 21) honoured by a switch in “My profile” that turns off all their match direct messages; performance of the service (contract — terms of use, referees and administrators acting for the association) for referee alerts and the refereeing schedule sent to staff, legitimate interest (smooth running of tournaments) remaining the basis with regard to the players and teams they mention; legitimate interest (impartial refereeing) with regard to the staff member who referees, whose membership of the match's teams is checked at each of these actions and, if they play in the match, the other staff members warned — they may object to it (art. 21) through the report form (GDPR category); legal obligation (GDPR, art. 6.1.c) for keeping their choice about match direct messages (keeping it is what allows their objection to keep being honoured, art. 21 and 12); performance of the service (contract — terms of use, “Match contacts” section, since their version 7: the parties to the match know who referees it and, in Overwatch, can add them in game) for presenting the assigned referee to the parties to the match, in its “Contacts” and launch windows and on the match page, once that referee has accepted version 7 of the terms or a later version — until they accept it, legitimate interest (same aim), and they may object to it (art. 21) through the report form (GDPR category): once upheld, their objection removes them from all their unfinished matches (the staff assigns another referee; their finished matches keep their referee) and stops them taking or being assigned one until it is lifted (at their request only), and still stands once version 7 or a later one is accepted — (they can withdraw from a match at any time, the staff being able to assign that match to them again (unless an objection is upheld), without notice; until they have accepted version 7 or a later one, as the acceptance window covers the tournament pages, they withdraw by asking for it through the report form); performance of the service (the referees acting for the association) for collecting their “Ready”; the notice that their refereeing was removed, sent by push only, falls under push notifications (consent, processing activity T12); legitimate interest (members knowing who referees a match) for showing their username to any signed-in member, with the same right to object and the same effect once upheld; performance of the service requested by the player (contract) for keeping on their account their “Don't show again” choice on the invitation to verify; legal obligation (GDPR, art. 6.1.c) for keeping the date of a referee's upheld objection (keeping it is what allows it to keep being honoured, art. 21 and 12)",
    dataSubjects: [
      "Players taking part in a tournament",
      "Other members of the teams taking part (coaches, managers, owners)",
      "Referees and administrators",
      "Casters registered on a match",
      "Any account holder, for their match direct messages choice",
    ],
    dataCategories: [
      "Discord username and identifier",
      "BattleTag (shown in Overwatch tournaments only; in every game, its presence and that it comes from a linked Battle.net account — a BattleTag typed in by hand is not enough — are checked to cast or referee a match)",
      "Date and opponent of the match",
      "Time at which each party declared itself ready (each caster for themselves), registered casters with the time each one registered, and the stream each one joined (co-cast) or opened separately",
      "Reason for the removal of a caster's registration for a match (removed by the staff, casting requirements no longer met — streaming permission, certified Discord tag, BattleTag taken from a linked Battle.net account —, or they now play in the match)",
      "Assigned referee of a match, time of their “Ready”, self-management of the match, first map set by the staff and maps picked from the round pool (by the staff or, in self-management, by a team of the match); reason for the removal of their refereeing (removed by the staff, match assigned to another referee or switched to self-management, objection upheld, refereeing requirements no longer met, or they become a player of the match before its launch), sent to the referee and kept only in the staff log line on Discord that notes the removal, without naming the referee (processing activity T05)",
      "Team roles and certification status (Discord username; in Overwatch tournaments only, BattleTag taken from a linked Battle.net account) of the contacts presented; team roles of the active members of a match's entrants (choosing the recipients of the lobby settings)",
      "Reason for a report",
      "The player's choice to receive or not the Discord direct messages about their matches",
      "“Don't show again” choice on the window inviting to verify the Discord tag and BattleTag (date of the choice)",
      "A referee's objection upheld by the staff (date), read by the staff allowed to manage tournaments in the “Refereeing” window, where they can lift it",
      "Language of the account already linked to the targeted Discord account (T01), read so that the bot writes the certification or tag change code in that language",
      "Membership of a staff member in the teams of a match they referee — for an imposed withdrawal, in the withdrawn team's opponent only — (current member, or leaving date compared with the launch of the match, its first report or, failing these, its creation), checked at each dispute settled, result corrected, withdrawal imposed or automatic confirmation paused",
    ],
    sensitiveData: "None",
    retention: [
      "Certified username: until it is changed or the account is deleted",
      "Choice of match direct messages: until it is changed; reset to the default when the account is deleted",
      "“Don't show again” choice on the verification invitation: until the account is deleted, erased on anonymisation",
      "Upheld referee objection (date): until the staff lifts it at the referee's request or the account is deleted, erased on anonymisation",
      "Records of reminders, alerts and refereeing schedules sent (match, step and announced time, without the message text): kept with the match, so with no time limit; those of lobby settings sent (match, pairing and entrant): until the lobby reopens (launch cancelled, time changed, rollback), otherwise with the match",
      "“Ready” and casters of a match: kept with the match; the caster of a deleted account is removed from matches that are not over (from all their matches if the account is erased), with the stream they alone held; a caster who leaves a match (of their own accord or removed) likewise takes away the stream they alone held and its link; only the link set in the match's live configuration stays with the match; the link a caster provided (when opening their stream or in that configuration) goes when their account is deleted, played matches included, even from a stream another caster still holds (a member of the organizers states, when setting the link, whether it is the organizers' link — it stays with the match — or their own channel, which goes with their account; a link set in that configuration before the site recorded who provided it has no known author and stays with the match); a caster who no longer meets the conditions of their sign-up (broadcast permission, certified Discord tag, BattleTag taken from a linked Battle.net account) no longer receives the contacts and is no longer shown; the sign-up is erased if this is noticed before the match is launched (reading the contacts), otherwise it stays with the match; a caster whose team joins the match is removed at the latest when it starts",
      "Assigned referee, their “Ready”, self-management, first map and maps picked from the pool: kept with the match; the referee of a deleted account is removed from all their matches, played ones included; a referee who no longer meets the refereeing requirements (permission, certified Discord tag, BattleTag taken from a linked Battle.net account), or who becomes a player of the match before its launch, is no longer shown, and is removed from it if this is found before the match is launched",
    ],
    recipients: [
      "The association's administrators and referees",
      "Staff holding the permission to manage tournaments, in a match's “Refereeing” window, at any time: username of the assigned referee and of the accounts that can referee, upheld referee objections",
      "Members of both teams of the same match and referees, from the moment both its opponents are known to its end, and its registered casters while the match is being played (from its start to its end); each caster's contacts to both teams and to the other casters of the match while the match is being played, and to the referees from the moment both its opponents are known until its end",
      "For the assigned referee of a match (username and, in Overwatch, BattleTag): members of both teams of the match and referees from the moment both its opponents are known until its end, its casters while the match is being played (the username alone as soon as the launch window shows the match); their username alone to any signed-in member, on the match card and page until its score is reported or the tournament ends",
      "Discord, which delivers the messages",
      "The association's staff with access to the Discord log channel (refereeing schedule, actions of a staff member who plays in the match, casters' registrations and removals, match refereeing, without naming casters or referees, processing activity T05)",
      "The push service of the browser of each subscribed recipient (player: match announcements and reminders; owner, manager or player of a solo tournament: lobby settings; caster: start of the match they cast, removal of their registration for a match; assigned referee: removal of their refereeing; referee or administrator: refereeing schedule, dispute settled, result corrected, opponent's withdrawal imposed or automatic confirmation paused by a staff member who plays in the match; processing activity T12), which delivers an encrypted message it cannot read",
    ],
    transfers: [
      `United States: Discord (delivery of direct messages and of the log channel) — ${transferBasisEn(["DISCORD"])}`,
      `United States: push service of the browser of the subscribed recipient (player, owner or manager of a team, caster, referee or administrator), which only receives end-to-end encrypted messages (RFC 8291) — ${transferBasisEn(["GOOGLE", "MOZILLA", "APPLE", "MICROSOFT"])}`,
    ],
    security: [
      ...COMMON_SECURITY_EN,
      "Uncertified username invisible to everyone, administrators included; certified username never shown to a visitor without an account",
      "Match contacts served only to the parties to the match, never in the tournament's public snapshot",
    ],
  },
  {
    ref: "T05",
    name: "Staff activity log on Discord",
    purpose: "Keeping the staff informed of notable events on the platform",
    subPurposes: [
      "New players, tournament registrations and withdrawals, match results, closings",
      "Traceability of refereeing actions (penalties, removal of participants, rollbacks, match times set, changed or removed, and, when their author plays in the match, dispute settled, result corrected, opponent's withdrawal imposed or automatic confirmation paused — these four actions — any withdrawal imposed by the referees that closes a match included, one trace per match closed against a known opponent, whichever team is withdrawn — also leaving, whether or not their author plays, a short trace in the server logs only), for moderation",
      "Refereeing schedule: about 10 hours ahead, the upcoming matches (times, tournaments, team names; “a player” in a solo tournament)",
      "Match casts: a caster's registration for a match and its removal (by themselves, by the staff or automatically, with the reason), without naming the caster or the staff — and without any trace in the server logs",
      "Match refereeing: an assigned referee taking a match, being assigned it by the staff or removed from it (by themselves, by the staff or automatically, with the reason), self-management of a match or of a whole round (one line per round), first map set or cleared, map picked from the round pool or pick cleared — without naming the referee or the staff; a referee's objection upheld or lifted by the staff: a single line, naming no one nor the matches they are removed from (no line per match)",
      "Other staff actions on matches and tournaments: result confirmed or score saved by the referees, forced launch, lobby host set or removed, a match's broadcast settings, putting on air or taking off air, replay link, tournament edited, seeding order, next stage brought forward, ghost teams registered (their number), a tournament's image and broadcast link — the action, the tournament and the match (the tournament alone for a score that pauses the automatic confirmation), without naming its author (“the staff”, or “a caster” for a broadcast action by someone who only holds that permission) or the link set; this line adds nothing to the server logs (a dispute settled or a result corrected keeps there the short named trace described in the first line (traceability of refereeing actions), as does a paused automatic confirmation), except, when it could not be composed, the action and the match or tournament number, without its author",
      "Platform roles: an administrator granting or removing a role (administrator, referee, caster, community manager, recruiter), including on their own account, where they cannot remove their own administration — one line naming no one; in the server logs, its author, the identifier of the account concerned and the roles saved",
    ],
    legalBasis:
      "Legitimate interest (administration and oversight of refereeing and of tournaments, broadcasting included) with regard to the players and teams mentioned, to the casters of the matches (never named) and to the staff member who carried out an action, named in the server logs, as well as to the referee whose objection the staff upholds or lifts, designated in those logs only by their account identifier, and to the account whose platform role an administrator grants or removes, designated in the same way; sending the refereeing schedule to referees and administrators falls under performance of the service (T04)",
    dataSubjects: [
      "Staff",
      "Players and teams taking part in a tournament (referred to by team name, never by their username)",
      "Casters registered for a match (never named)",
      "Assigned referees of matches (never named on Discord)",
      "Accounts whose platform role an administrator grants or removes (designated by their account identifier; named only when an administrator sets their own, as the author of the action)",
    ],
    dataCategories: [
      "On Discord: team names, scores, tournament names, match times and rounds — no player username (“a player”, including in solo tournaments) and no staff member or caster named (“the staff”, “a caster”; reason for a caster's automatic removal — they no longer meet the casting requirements, or they now play in the match; “a staff member who plays in this match”, with the tournament name only, for a dispute settled, a result corrected, a withdrawal imposed or an automatic confirmation paused by them; reason for the removal of a match's assigned referee — removed by the staff, match assigned to another referee or switched to self-management, refereeing requirements no longer met, or they become a player of the match before its launch)",
      "In the server logs: username and identifier of the staff member who carried out a refereeing action, with the action (match number; for a referee who plays in the match, also: tournament, round and, except for a pause, outcome and team names, none in a solo tournament); for a referee's objection upheld or lifted, the referee's account identifier (when upheld, with the number of matches they are removed from); and, when a staff log line could not be composed, the action and the match or tournament number, without its author",
      "In the server logs, for a platform role granted or removed: username and identifier of the administrator who did it, identifier of the account concerned (“their own account” when it is theirs) and roles saved",
    ],
    sensitiveData: "None",
    retention: [
      `Discord messages: kept in a staff-only channel, purged manually by the association and by the bot after ${BOT_STAFF_LOG_RETENTION_DAYS} days (one year), in batches — several nights for a large backlog (processing activity T08)`,
      "Server logs: according to their automatic rotation",
    ],
    recipients: [
      "The association's staff with access to the channel",
      "Discord (hosting of the channel)",
      "Technical manager (server logs)",
    ],
    transfers: [`United States: Discord — ${transferBasisEn(["DISCORD"])}`],
    security: [...COMMON_SECURITY_EN, "Private channel, access restricted by Discord role"],
  },
  {
    ref: "T06",
    name: "Site audience measurement",
    purpose: "Knowing how much the site is visited",
    subPurposes: [
      `Counting visits (24 h, 7 days, 30 days, total) and unique visitors (24 h, 7 days, 30 days, ${SITE_VISITOR_RETENTION_MONTHS} months)`,
    ],
    legalBasis: "Legitimate interest (art. 6.1.f GDPR: knowing how much the site is visited), without a measurement cookie or third-party tracker; right to object (art. 21) applied by the site itself — the browser's Global Privacy Control and Do Not Track signals, or the objection button of the privacy policy (“Audience measurement” section; bg_audience_optout cookie, without identifier): a refused visit is not recorded, as the server reads these signals itself, and is not even sent when the browser exposes them to the page. For visits already recorded, the right is exercised like the other rights: with the person to contact for requests regarding data, through the report form, “GDPR” category, or with the association",
    dataSubjects: ["Visitors of the site"],
    dataCategories: [
      "Hash salted with a server secret (SHA-256), derived from the account or from the IP address and the browser: pseudonymized data — without the secret, it cannot be linked to anyone, but the association, which holds it, can recompute the hash of an account or of an IP address and browser pair",
      "Page viewed (without URL parameters), date",
      "“Logged-in visitor” indicator (yes / no), without the account concerned",
      `Several loads by the same visitor within ${SITE_VISIT_WINDOW_MINUTES} minutes count as a single visit`,
    ],
    sensitiveData: "None",
    retention: [
      `Visit details (hash, page, date) erased after ${SITE_VISIT_DETAIL_RETENTION_DAYS} days, after being added to a daily counter that only keeps the number of visits`,
      `One hash per visitor, without page but with the “logged-in visitor” indicator and the date of the last visit, erased ${SITE_VISITOR_RETENTION_MONTHS} months after that last visit (including after the account is deleted, which does not erase it sooner); hashes prior to this rule are dated from when it was introduced`,
      "IP address, browser and account identifier never recorded as such",
    ],
    recipients: [
      "The association's staff",
      "Any member of a Discord server where the bot is installed, for the totals only (visits and visitors), through the public /stats-site command",
    ],
    transfers: ["None"],
    security: [
      ...COMMON_SECURITY_EN,
      "No measurement cookie — a single session storage value (bg:last-visit-ping), never sent, avoids reporting the same load twice; the salting secret is neither in the database nor in the backups, and without it no visit is counted",
      "Objection read again on the server side (Sec-GPC and DNT headers, objection cookie): a refused visit is neither hashed, nor counted against the rate limit, nor written",
    ],
  },
  {
    ref: "T07",
    name: "Presenting the association and recruiting volunteers",
    purpose: "Presenting the board and the volunteers, and recruiting",
    subPurposes: [
      "“Association” page: board members and volunteers",
      "Recruitment announcements with a Discord contact or a link",
    ],
    legalBasis: "Consent of the volunteers and board members concerned",
    dataSubjects: ["Board members", "Volunteers", "Authors of recruitment announcements"],
    dataCategories: [
      "Last name, first name and username, category or position, date of joining, photo",
      "Discord username and identifier or contact link of an announcement",
    ],
    sensitiveData: "None",
    retention: ["Duration of involvement in the association, or of publication of the announcement"],
    recipients: ["The site's public"],
    transfers: ["None"],
    security: COMMON_SECURITY_EN,
  },
  {
    ref: "T08",
    name: "BlueGenji Discord bot",
    purpose: "Providing the bot's services on partner Discord servers",
    subPurposes: [
      "Relaying announcements between the channels of partner servers, passing on edits and deletions, cooldowns, /stats message counter, dashboard statistics, removal of the copies of an excluded user",
      "Exclusion of a user from the relay by moderation — valid for the whole network of partner servers (community moderation), hence the list of exclusions open to the administrators of each server",
      "Activity statistics (/stats command, which shows each person only their own activity; the bot's dashboard)",
      "Confirming memberships of the association and scheduled reminders on its servers",
      "Delivering the site's messages: codes (written by the bot in the account language the site sends it), match times and reminders, notices of removal from a match (“Match retiré”), the lobby settings of a match sent to those who manage its entrants and the notice sent to a caster whose registration for a match is removed by someone else (these match messages to certified Discord tags only), moderation notices (report naming the person, logo hidden, removed or deleted, avatar hidden, removed or restored, suspension of the account and its lifting), requests to join a team and information about data by direct message, without being kept by the bot; refereeing alerts, reports and the site's activity log (without player usernames) posted in the staff's private log channel, refereeing alerts also sent to the members of the refereeing role of each server that has set one; announcement of the streamed matches posted in the #live channel of the association's server, in one message per evening edited at each match start and end, with an @everyone mention for the official channel or a mention of the StreamViewer role only for any other channel (team names or, in a solo tournament, the players' public BlueGenji username — processing activity T16)",
    ],
    legalBasis: "Legitimate interest (operating, moderating and measuring the relay between partner servers); the site's messages fall under the basis of their original processing",
    dataSubjects: [
      "Discord users of the servers where the bot is installed",
      "Administrators and moderators of these servers",
      "Members of the association whose membership is confirmed by the bot",
    ],
    dataCategories: [
      "Relayed announcements: identifiers of the original message and its author, date, identifiers of the copies and their channels (content copied into partner channels, never recorded in the database)",
      `Scrims and recruitment: author's identifier, game, level or role (chosen from a closed list; free text for announcements prior to this rule, also kept in the daily counts), server, date; beyond ${BOT_ACTIVITY_AUTHOR_RETENTION_DAYS} days, only counts per day, server and level or role`,
      "Public activity feed on the bot's page: time, type of event (relay, scrim, recruitment, login), server name, level or role — without Discord identifier",
      "Exclusions: identifiers of the excluded user and the moderator, date; identifiers and reason posted in the staff's private log channel, reason copied by direct message to the bot's owner, usernames and reason displayed by /ban-list",
      "Configuration: identifiers of servers, channels and roles, invitation, identifier of the administrator who set it",
      "Memberships and scheduled reminders: identifier of the member or role targeted and of the author, message, date of the next sending (for a membership: its expiry date, hence membership status), frequency; membership certificate delivered by direct message without being kept",
      "Site messages: the recipient's Discord ID or username, their BlueGenji username (returned in the delivery report sent back to the site), the message text and, for the code sent by direct message only (login, certification or change of the tag), the language of the site account linked to that Discord account (in which the bot writes the code), sent by the site and delivered without being stored by the bot; the #live announcement, however, stays posted in the channel (processing activity T16)",
      "Technical log (staff's private channel, server logs): name of the servers that add or remove the bot, errors that may quote an identifier; the bot no longer writes a username there of its own accord, messages prior to this rule excepted (the free-text reason for an exclusion or an error delivering a direct message may quote one)",
    ],
    sensitiveData: "None",
    retention: [
      `Tracking of relayed announcements: ${BOT_RELAY_RETENTION_DAYS} days, erased at the first relay after that deadline and at the latest during the night or when the bot restarts; the copies posted in partner channels remain on Discord until they are deleted (by the author within that period, afterwards by the administrators of each server)`,
      `Scrims and recruitment: ${BOT_ACTIVITY_AUTHOR_RETENTION_DAYS} days; then, during the following night (or at a restart), author's identifier erased and rows collapsed into counts per day, server and level or role, kept with no time limit as a history of the bot's activity`,
      "Exclusions: record until the exclusion is lifted; its notice and reason (staff's private log channel, and reason copied by direct message to the bot's owner) are deleted when it is lifted — for an exclusion prior to this rule, only the reason posted in the channel, the rest following the log channel's period",
      "Configuration (relayed channels and their rank filters, invitation and refereeing role with the identifier of who set them, bot administration role, modules): until removed by the administrators, at the latest until the bot leaves the server, which erases it (a departure that occurred while the bot was down, which Discord does not report to it, is caught up at its restart)",
      "Memberships and scheduled reminders: until the reminder's last sending (for a membership, its expiry date) or its deletion, at the latest until the bot leaves the server where they were recorded, which erases them (departure while the bot was down included, caught up at restart)",
      `Activity feed: ${BOT_FEED_EVENT_RETENTION_DAYS} days, deleted during the following night`,
      `Staff's private log channel, and the bot's direct messages to its owner: ${BOT_STAFF_LOG_RETENTION_DAYS} days (one year), then deleted by the nightly cleanup, in batches (several nights for a large backlog), except the reason posted in the channel for an ongoing exclusion — and, for an exclusion imposed from this rule onward, its notice and the copy of its reason by direct message —, deleted when it is lifted`,
      "Server logs: according to their automatic rotation",
      "#live announcements: in the channel as long as it exists, even after the player's account is deleted, and deleted at the request of the team, player or caster concerned (processing activity T16)",
      "AutoMod alert for a blocked or flagged #live announcement: in the moderation alert channel until the moderators delete it, even after the player's account is deleted, and deleted at the request of the team or player concerned (processing activity T16)",
      `Backups: ${BACKUP_RETENTION_DAYS} days at most (processing activity T09)`,
    ],
    recipients: [
      "The association's staff (moderation, administration)",
      "The bot's owner (its technical host), for the reasons for exclusion received by direct message",
      "Excluded user, who receives the reason for their exclusion by direct message when they post an announcement in a relayed channel",
      "Members of the channel where /scrim or /recrute is used (public reply of the command)",
      "Members of the refereeing role of each server that has set one (/set-referee-role), for the site's refereeing alerts",
      "Members of partner servers, who read the relayed announcements",
      "Members of the association's Discord server, who read the announcement of streamed matches in the #live channel (processing activity T16)",
      "Moderators of the association's Discord server, if a Discord AutoMod rule blocks or flags a #live announcement (processing activity T16)",
      "Administrators of any server where the bot is installed (including a server created to invite it there) and holders of the bot administration role (/set-bot-admin), for the network's list of exclusions (/ban-list, reply visible only to the requester) — the exclusion applies to the whole network, each server must know who can no longer post there",
      "Discord (execution platform)",
    ],
    transfers: [`United States: Discord — ${transferBasisEn(["DISCORD"])}`],
    security: COMMON_SECURITY_EN,
  },
  {
    ref: "T09",
    name: "Backups",
    purpose: "Resuming activity after an outage, corruption or a handling error",
    subPurposes: [
      "Twice-weekly archive (Sunday and Tuesday evenings) of the site's and the bot's databases",
      "Hourly copy of uploaded images (avatars, logos, photos)",
      "Log of account deletions, replayed after any restoration",
    ],
    legalBasis: "Legitimate interest (continuity of the service)",
    dataSubjects: ["All the persons of the register's other processing activities"],
    dataCategories: ["Copy of all the data above", "Deletion log: account identifier and creation date, date of deletion"],
    sensitiveData: "None",
    retention: [
      `Archives: ${BACKUP_RETENTION_DAYS} days at most, then permanent deletion`,
      "Images: for as long as they are on the site (removed within the hour following their deletion)",
      `Deletion log: ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} days per entry`,
      `Copy of the bot's database written next to it before a restoration (unencrypted, on the bot's machine): deleted at the next successful restoration, at the latest during the night after it turns ${BACKUP_RETENTION_DAYS} days old`,
    ],
    recipients: [
      `${SITE_HOST.name}, the association's technical manager and the site's host (processor — ${HOST_PROCESSING_AGREEMENT_EN}), sole holder of the decryption keys`,
      `${HETZNER_BACKUP_FRAMEWORK_EN}, which stores the encrypted copies without being able to read them`,
    ],
    transfers: ["None"],
    security: [
      `Encryption on the site's server before any upload (the “age” encryption tool for the archives, an rclone crypt remote for the images, the hidden logos and the log — checked in production on September 30, 2026, maintained for storage with Hetzner): keys held only by the site's host, ${SITE_HOST.name}, and never sent to Hetzner`,
      "Upload encrypted in transit (HTTPS/TLS)",
      "Permanent deletion, without trash or version history at the storage provider",
      "Private key of the archives kept off the server; key of the images and the log on the server only, with a backup copy off the server",
      "Account deletions replayed before any return to service after a restoration",
    ],
  },
  {
    ref: "T10",
    name: "Informing players of policy changes",
    purpose: "Informing each account of a change in the processing of its data",
    subPurposes: [
      "Presenting at the next visit the published changes the account has not yet acknowledged (“I have read this” — no agreement is requested)",
      "Announcing each change once by Discord direct message to reachable accounts that have not acknowledged it on the site, one week after its publication and at most one message per month",
    ],
    legalBasis: "Legal obligation to inform (GDPR, articles 12 to 14)",
    dataSubjects: ["Players registered on the site"],
    dataCategories: [
      "Changes acknowledged by the account, with the date",
      "Discord announcements already sent to the account, with their date",
      "Discord identifier or certified Discord username, to address the announcement",
    ],
    sensitiveData: "None",
    retention: ["Lifetime of the account (erased with it)"],
    recipients: ["The player themselves", "Discord, which delivers the direct message"],
    transfers: [`United States: Discord (delivery of direct messages) — ${transferBasisEn(["DISCORD"])}`],
    security: [...COMMON_SECURITY_EN, "An announcement reserved before sending, so that no account receives it twice"],
  },
  {
    ref: "T11",
    name: "Reports, appeals and moderation of content and accounts",
    purpose: "Receiving and handling the reports sent to the association, including notices of illegal content",
    subPurposes: [
      "Receiving a report from anyone, with or without an account (copyright, moderation, bug, GDPR, host, other)",
      "Notifying the players and team members targeted, and allowing them to contest; allowing the author of a report to contest the decision taken",
      "Hiding a reported team logo or player avatar, then restoring it or permanently deleting it; removing an image outside any report, on a reason entered by moderation",
      "Suspending an account contrary to the terms of use (sessions closed, login refused during the suspension), giving its holder the reasons, then lifting it or letting it expire",
      "Acknowledging receipt of a notice of illegal content, then notifying its author of the decision and the means of redress",
      "Answering requests to exercise rights and requests sent to the hosting provider, including those from authorities",
      "Receiving by email or by phone, through the person to contact for requests regarding data, requests to exercise rights and questions about data processing, and answering them",
      "Receiving the requests sent to the association's own email or phone (published, protected, in the legal notice), and answering them",
      "Alerting administrators on Discord, without naming anyone",
    ],
    legalBasis:
      "Legitimate interest (GDPR, art. 6.1.f) of the association in enforcing its terms of use for the moderation of content and accounts contrary to them — review, hiding, removal of an image, suspension of an account, and keeping the decision while it can be contested; legal obligation (GDPR, art. 6.1.c) for requests to exercise rights (GDPR, art. 12), notices of illegal content, in copyright as in moderation (Regulation (EU) 2022/2065, art. 16), requests sent to the hosting provider (art. 11 and 16) and appeals (art. 20), without an agreement box; consent of the reporter (box when sending) for bug and other reports; by email or by phone as through the form (“GDPR” category), a request to exercise rights or a question about the processing of one's data — which falls under the right of access (GDPR, art. 15) — is based on the same legal obligation",
    dataSubjects: [
      "Reporters, users or not (rights holders, representatives, visitors)",
      "Players and team members targeted by a report",
      "Persons, members or not, who send a request regarding their data by email or by phone",
      "Persons who write to or phone the association",
    ],
    dataCategories: [
      "Category, description, items designated and page the report came from",
      `Reporter's account if logged in; email address they provide; for copyright, ${copyrightNoticeElementsTextEn()}`,
      "Appeals: text, account of their author and optional address",
      "Hidden team logos and player avatars (file kept offline), date of hiding and of the deadline; reason for a removal decided outside a report (sent to the team or the player, not kept by the site)",
      "Account suspensions: account targeted, facts relied on, clause invoked, dates of start, expiry and lifting, moderation member who imposed or lifted it",
      "Requests regarding data received by email or by phone: content of the request and of the reply, sender's email address or number, and often their name",
      "Requests received at the association's email or phone: same data",
    ],
    sensitiveData: "None",
    retention: [
      `Report and appeals: duration of handling, then ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} days after archiving (${LOGO_QUARANTINE_MONTHS} calendar months for a copyright or moderation report sent from an account, its author's period for contesting) — extended as long as a logo or avatar hidden or deleted on the basis of the report can still be contested (${LOGO_QUARANTINE_MONTHS} months at most after the decision)`,
      `Request received by email or by phone: same rule as a GDPR request made through the form — duration of handling, then ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} days after the request is closed (the equivalent of archiving a report), before deletion from the mailbox of the person to contact (email) or from their phone (texts received and sent, voicemail, call log)`,
      `Request received at the association's email or phone: same rule — duration of handling, then ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} days after it is closed, before deletion from the association's mailbox or phone`,
      `Hidden logo or avatar: ${LOGO_QUARANTINE_MONTHS} months at most without a challenge (period for contesting of art. 20.1 of Regulation (EU) 2022/2065, which the association applies), then permanent deletion; if contested, until the decision`,
      `Account suspension: while it runs, then ${SUSPENSION_RETENTION_MONTHS} months after it is lifted or expires (same period for contesting), erased at the first login to the site after that period; erased with the account, or when it is anonymized`,
    ],
    recipients: [
      "The association's administrators",
      "Players and team members targeted: reason and description of the report, never the reporter's identity",
      "Holder of a suspended account: the decision, the facts relied on and the clause invoked, never the name of the moderation member who imposed it",
      "Discord, which delivers the alerts and direct messages (without name, address or description)",
      `${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE_EN}, the person appointed by the association for requests regarding data: requests received by email or by phone`,
      "That person's telephone operator: requests made by phone (call, text, voicemail)",
      `Microsoft, which hosts that person's mailbox (${OUTLOOK_MAIL_FRAMEWORK_EN}): requests received and replies sent by email`,
      "Members of the association's board who check its email and phone",
      `Google (${ASSOCIATION_GMAIL_FRAMEWORK_EN}): requests received and replies sent by the association's email`,
      "Telephone operator of the association's line: requests made to its phone",
    ],
    transfers: [
      `United States: Discord (delivery of alerts and direct messages) — ${transferBasisEn(["DISCORD"])}`,
      `Possible to the United States: Microsoft (Outlook.com mailbox of the person to contact, requests received and replies sent by email) — ${transferBasisEn(["MICROSOFT"])}`,
      `Possible to the United States: Google (the association's Gmail mailbox) — ${transferBasisEn(["GOOGLE"])}`,
    ],
    security: [
      ...COMMON_SECURITY_EN,
      "Handling panel restricted to administrators; a report's page open only to the persons targeted",
      "Sending limits per person and per hour",
      "Hidden logo or avatar moved out of the folder served by the site; preview restricted to administrators",
      "Suspension restricted to the moderation permission, impossible on one's own account or on an administrator's; the staff's Discord log carries neither the player's username nor the reason",
      "Requests received by email or by phone: no measure specific to the association beyond deletion after the retention period; they are protected only by the measures of Microsoft or Google (mailboxes), the telephone operators and the devices that receive them",
    ],
  },
  {
    ref: "T12",
    name: "Push notifications",
    purpose: "Notifying a player on their devices, at their request, of what concerns them on the site",
    subPurposes: [
      "Lobby settings of their matches, for whoever manages an entrant (owner, manager, player of a solo tournament)",
      "Start of their matches (and, for a registered caster, of the match they cast), score to confirm or confirmed automatically without an answer, tournament kickoff, match times (set, changed or removed) and match reminders",
      "Requests to join a team they manage, reports and moderation decisions concerning them, changes to the data policy",
      "Referee alerts, disputes settled, results corrected, opponents' withdrawals imposed or automatic confirmations paused by a staff member who plays in the match, scheduled matches, refereeing schedule and moderation alerts for the staff holding these roles",
      "Removal of their caster registration for a match (by the staff or automatically), with the reason, for the caster who still holds the streaming permission",
      "Removal of their refereeing of a match (by the staff, match assigned to another referee or switched to self-management, or automatically), with the reason, for the assigned referee who still holds the refereeing permission",
    ],
    legalBasis: "Consent (activation on each device, withdrawable at any time, topic by topic)",
    dataSubjects: ["Registered players who turn on notifications on a device"],
    dataCategories: [
      "The device's subscription address, provided by the browser, and its encryption keys",
      "Date of subscription and of the last notification delivered",
      "Notification topics turned off by the account",
      "Account language (T01), in which the notification is written",
    ],
    sensitiveData: "None",
    retention: [
      "Subscription: until it is turned off, revoked by the browser, or the account is deleted",
      `Subscription with no notification delivered: ${PUSH_SUBSCRIPTION_RETENTION_DAYS} days at most`,
      "Topics turned off: lifetime of the account",
    ],
    recipients: [
      "The player themselves",
      "Their browser's push service (Google, Mozilla, Apple or Microsoft), which delivers an encrypted message it cannot read",
    ],
    transfers: [
      `United States: push service of the browser chosen by the player, which only receives end-to-end encrypted messages (RFC 8291) — ${transferBasisEn(["GOOGLE", "MOZILLA", "APPLE", "MICROSOFT"])}`,
    ],
    security: [
      ...COMMON_SECURITY_EN,
      "Content encrypted for the subscribed device only; sendings signed by the site's key (VAPID)",
      "No player username in a notification",
      "Accepted push services limited to those of the browsers on the market",
    ],
  },
  {
    ref: "T13",
    name: "Acceptance of the terms of use",
    purpose: "Keeping proof that the site's terms of use have been accepted, and which version of them",
    subPurposes: [
      "Collecting acceptance when the account is created, when a team is created, when the management of a team is received, in the acceptance window shown to any logged-in account that has not accepted the version in force (since version 6) and at a login started from the login page (click on Google, Discord or Blizzard, or submission of the code received on Discord) within ten minutes of accepting the terms there (an acceptance only kept by the browser is not carried over to an existing account)",
      "Asking for acceptance again when the terms change version",
      "Setting the basis for presenting an assigned referee to the parties to their matches (record T04): legitimate interest until they have accepted version 7 or a later one, the contract afterwards",
    ],
    legalBasis: "Performance of the service requested by the player (contract)",
    dataSubjects: ["Players registered on the site"],
    dataCategories: ["Version accepted, context of the acceptance (account creation, login, team creation or management, acceptance window of a logged-in account), date"],
    sensitiveData: "None",
    retention: [
      "Lifetime of the account",
      "On deletion: complete erasure, whether the account is erased or anonymized — the details of the acceptances as well as the last version accepted and its date",
    ],
    recipients: ["The player themselves, through the export of their data", "The association's technical manager, who administers the database"],
    transfers: ["None"],
    security: COMMON_SECURITY_EN,
  },
  {
    ref: "T14",
    name: "Connection data log",
    purpose:
      "Keeping the data that makes it possible to identify the author of content published by a member (logo, avatar, team name), which the association hosts",
    subPurposes: [
      "Recording each login (IP address, date and time, means of logging in)",
      "Disclosing this data to a judicial authority that requests it, and to it alone",
    ],
    legalBasis:
      "Legal obligation (GDPR, art. 6.1.c) of the hosting provider of content: French Act on Confidence in the Digital Economy (« loi pour la confiance dans l'économie numérique », LCEN), art. 6; Decree No. 2021-1362",
    dataSubjects: ["Players registered on the site"],
    dataCategories: [
      "Internal identifier of the account",
      "IP address of the login, as retained by the site's proxy server",
      "Date and time of the login, means of logging in (Google, Discord, Blizzard or code by direct message)",
      "Neither the source port of the connection, nor a log of the creation or modification of content (only logins are recorded), nor the information provided when the account was created: that leaves with the account (apart from the encrypted backup copies and the deletion log, T09)",
    ],
    sensitiveData: "None",
    retention: [
      `${CONNECTION_LOG_RETENTION_DAYS} days (one year) after each login, then automatic erasure`,
      "Kept until that deadline even after the account is deleted (GDPR, art. 17.3.b)",
    ],
    recipients: [
      "Judicial authorities, upon requisition",
      "The player themselves, through the export of their data, as long as their account exists",
      "The association's technical manager, who administers the database and answers judicial requisitions",
    ],
    transfers: ["None"],
    security: [
      ...COMMON_SECURITY_EN,
      "No screen or route of the site consults this log; it serves no other purpose",
    ],
  },
  {
    ref: "T15",
    name: "Support portal (Spiceworks)",
    purpose:
      "Receiving and handling support and moderation requests that do not concern content on the site (in-match behavior, insults, cheating, dispute on Discord)",
    subPurposes: [
      "Receiving a ticket on the association's support portal, which the site only links to (no data is sent there by the site)",
      "Exchanging with the requester, examining the request and closing it",
    ],
    legalBasis:
      "Legitimate interest (GDPR, art. 6.1.f) of the association in enforcing the rules of its tournaments and its community, and in answering the requests sent to it",
    dataSubjects: ["Requesters (players or not)", "Persons named in a ticket"],
    dataCategories: [
      "Content of the ticket and of the exchanges, any attachments",
      "Contact details the requester provides to receive the reply, usernames mentioned",
    ],
    sensitiveData: "None",
    retention: [
      `Ticket: duration of its handling, then ${monthsEn(SUPPORT_TICKET_RETENTION_MONTHS)} after it is closed, then deletion by the association`,
    ],
    recipients: [
      "Members of the association's staff in charge of support and moderation",
      `Spiceworks, which hosts the portal (${SPICEWORKS_PROCESSOR_FRAMEWORK_EN})`,
    ],
    transfers: [
      `Possible to the United States: Spiceworks — ${transferBasisEn(["SPICEWORKS"])}; ${SPICEWORKS_SCC_FALLBACK_EN}`,
    ],
    security: [
      "Access to the portal restricted to the staff members in charge of support",
      "Deletion of closed tickets at the end of the retention period",
    ],
  },
  {
    ref: "T16",
    name: "Match streaming",
    purpose: "Streaming tournament matches live and keeping the replay",
    subPurposes: [
      "Streaming a match live on the association's channel or that of one or more casters (YouTube, Twitch or Kick): each caster joins a stream of the match (co-cast) or opens their own, with its own link",
      "Publishing the link to its YouTube replay on the match page",
      "Announcing streamed matches in the #live channel of the association's Discord server, in one message per evening (four hours from the first live stream) that lists with their times the matches live, those scheduled until the end of the evening and those finished (“Terminé”, with their score), edited at each match start and end up to four hours after the evening ends (a new message without a mention takes over when it can no longer be edited), with an @everyone mention for the association's official channel and a mention of the StreamViewer role only for any other channel: names of both teams (for a team match, never their players' usernames) or, in a solo tournament, the public BlueGenji username of both players (the username on their page, editable in My profile, with no effect on an evening message that is no longer edited: unless changed, the Discord username or BattleTag taken when the account was created, or even the Google account name for a Google account created before September 30, 2026; never the numeric Discord identifier; “a player” for a deleted account, an entry without an account or a registration made before 16 October 2026), tournament name and stream link",
      "Moderating the association's Discord server: a Discord AutoMod rule that blocks or flags a #live announcement copies its text (including the public username in a solo tournament) to the moderators' alert channel",
    ],
    legalBasis:
      "Legitimate interest (GDPR, art. 6.1.f) of the association in promoting its competitions, the purpose set out in its bylaws, with a right to object (art. 21) open to each player; performance of the service requested by the player (GDPR, art. 6.1.b — terms of use) for their public username in the #live announcement of a solo tournament, which is part of the tournament they register for: not being named in it means not registering (a past announcement is deleted on request); legitimate interest of the association in moderating its Discord server for the AutoMod alert of a blocked or flagged #live announcement, kept in the moderators' alert channel, with a right to object (art. 21): the alert is deleted on request",
    dataSubjects: ["Players of the streamed matches", "Casters"],
    dataCategories: [
      "In-game and site usernames, team names, images of the game, in-game results and performance, as they appear on screen — neither webcam nor voice chat of the players",
      "Voice and username of the casters",
      "Links to the streams of a match (one per stream: the match's, and the one each caster opens separately, optional) and to its replay",
      "Account that provided a stream's link (a caster, or a member of the organizers who says it is their own channel), to remove that link when that account is deleted",
      "Public BlueGenji username of the players of a solo tournament, posted in the #live announcement on Discord",
      "Time, state (scheduled, live, “Terminé”) and score of the matches listed in the evening's #live message, with the team names or public usernames above",
      "Record of a match's Discord announcement: the match, the identifiers of its two entrants (teams or solo entries), the date of the announcement and, where applicable, the fact that the match going live was not announced; ID of the evening's Discord message and its sending state (not its text)",
    ],
    sensitiveData: "None",
    retention: [
      "Live: the stream is not kept by the site, which only keeps the links to the channels; the stream a caster opens separately, and its link, go once no caster holds it any more (only the link set in the match's live configuration stays with the match); the link a caster provided, there or when opening their stream, goes when their account is deleted, played matches included, even from a stream another caster still holds — a member of the organizers states, when setting the link, whether it is the organizers' link (it stays with the match) or their own channel (it goes with their account); a link set before the site recorded who provided it stays with the match (T04)",
      "Replay link: kept with the match, like its results (T03); the video stays on the platform until it is deleted by the channel that published it",
      `Discord announcement: the site only keeps a record of the announcement (the match, the identifiers of its two entrants, its date and, where applicable, the fact that the match going live was not announced — refused by the bot or AutoMod, or evening closed after its message was deleted; the match may have appeared in it before as scheduled —, then kept without a new attempt until the match is deleted) and the ID of the evening's message (without its text, deleted one day after the evening ends), made before sending, removed for a new attempt when the bot or the site's database was unavailable, otherwise deleted with the match; the message is kept in the channel as long as the #live channel exists, even after the player's account is deleted, and deleted at the request of the team, player or caster concerned (“${REPORT_FORM_NAME_EN}” form, “GDPR” category); when a caster's account is deleted, the message of an evening still under way is updated without their channel link if it keeps another link, otherwise, or once the evening has ended, it keeps it`,
      `AutoMod alert (blocked or flagged #live announcement): kept in the server's moderation alert channel until the moderators delete it, and deleted at the request of the team or player concerned (“${REPORT_FORM_NAME_EN}” form, “GDPR” category)`,
      `Right to object: on request (“${REPORT_FORM_NAME_EN}” form, “GDPR” category), the player appears under a neutral name in subsequent streams, the replay link is removed from the site, and a video published by the association's channel is hidden or deleted; the #live announcement of a solo tournament keeps the public username, which falls under performance of the service and not legitimate interest: not being named in it means not registering`,
    ],
    recipients: [
      "Public of the streaming platforms and of the site",
      "Streaming platforms (YouTube, Twitch, Kick), controllers of their own processing, including of their viewers' data; the site only links to the channels and embeds no player, it sends them no data",
      "Members of the association's Discord server, for the announcement posted in the #live channel (team names, or the public BlueGenji username of the players of a solo tournament)",
      "Moderators of the association's Discord server: if a Discord AutoMod rule blocks or flags a #live announcement, its text (including the public username in a solo tournament) may reach the server's moderation alert channel",
      "Discord (hosting of the channel)",
    ],
    transfers: [`United States: Discord (announcement posted in the #live channel, and AutoMod alert for a blocked or flagged announcement) — ${transferBasisEn(["DISCORD"])}`],
    security: [
      ...COMMON_SECURITY_EN,
      "Stream links limited to a list of platforms, no embedded player; no contact data displayed on screen by the site",
      "No webcam or voice chat of the players on screen",
    ],
  },
  {
    ref: "T17",
    name: "Web server access logs",
    purpose: "Ensuring the server's security and diagnosing outages",
    subPurposes: [
      "Recording each request received by the site's proxy server (nginx)",
      "Detecting attacks and abuse, understanding an outage",
    ],
    legalBasis: "Legitimate interest (GDPR, art. 6.1.f): security of the service (art. 32)",
    dataSubjects: ["Visitors of the site"],
    dataCategories: [
      `${WEB_ACCESS_LOG_FIELDS_EN.charAt(0).toUpperCase()}${WEB_ACCESS_LOG_FIELDS_EN.slice(1)} (nginx's default log format)`,
    ],
    sensitiveData: "None",
    retention: [
      `${WEB_ACCESS_LOG_RETENTION_DAYS} days at most, by automatic rotation, then deletion`,
    ],
    recipients: ["The association's technical manager, who is also the site's host"],
    transfers: ["None"],
    security: [
      ...COMMON_SECURITY_EN,
      "Logs readable only by the server's administrator, never exposed by the site",
    ],
  },
];
