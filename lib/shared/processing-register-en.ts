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
export const RGPD_CONTACT_LINE_EN = `Requests regarding data: ${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE_EN}, appointed by the association to receive them — email and phone (privacy policy and legal notice of the site) —, or the site's “${REPORT_FORM_NAME_EN}” form (footer), “GDPR” category (« RGPD »); the association: email and phone (legal notice of the site)`;

/** `registerController()`, in English. */
export function registerControllerEn(): RegisterController {
  return {
    name: ASSOCIATION_NAME,
    legalForm: "French nonprofit (law of 1901)",
    seat: ASSOCIATION_SEAT,
    contact: RGPD_CONTACT_LINE_EN,
    dataContact: `${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE_EN}, appointed by the association to receive requests regarding data (contact details given with those of the data controller). He is not a data protection officer within the meaning of Article 37 of the GDPR; the association remains the data controller`,
    host: `${SITE_HOST.name} (private individual, volunteer of the association), ${SITE_HOST.address} — processor (${HOST_PROCESSING_AGREEMENT_EN}), data hosted in ${SITE_HOST.country} (site and Discord bot on ${SITE_HOST.machineEn})`,
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
      "Exporting one's data and deleting one's account from “My profile”",
    ],
    legalBasis:
      "Performance of the service requested by the player (contract) for the account; consent for the optional data the player fills in and chooses to make visible",
    dataSubjects: ["Players registered on the site"],
    dataCategories: [
      "Site username (since September 30, 2026, never taken from the name of the Google account: neutral username at creation; an earlier Google account may have received that name), avatar (copied to our servers; since the same date, hidden by default when it comes from the login provider)",
      "Overwatch (BattleTag), Marvel Rivals and Discord usernames; certification of the Discord username",
      "Declared adulthood (yes / no / not specified)",
      "Visibility settings, availability for recruitment, roles on the platform",
      "No real name, no email address, no phone number, no postal address",
    ],
    sensitiveData: "None",
    retention: [
      "Lifetime of the account",
      `On deletion: complete erasure if the account has left no trace (no match played, no registration in a solo tournament, no team owned, no tournament organized), immediate anonymization otherwise — the username is replaced by a borrowed username, and only the anonymized account remains, with its tournament and team history; in both cases, the connection data log (T14) is kept until its legal deadline; the information provided when the account was created (username, provider identifiers) is not kept after deletion, apart from the encrypted backup copies (T09, ${BACKUP_RETENTION_DAYS} days at most) and the record of the deletion in the log that replays it after a restoration (account identifier and creation date, ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} days); the reports sent by the account are detached from it and follow their own period (T11), and a staff member's refereeing actions remain named in the server logs, according to their rotation (T05)`,
      `Login sessions: ${SESSION_RETENTION_DAYS} days after login`,
    ],
    recipients: [
      "The site's public (only the data the player makes visible)",
      "Players of the same match, until the tournament is over (BattleTag even when hidden, to add each other in game)",
      "Logged-in players of the site: certified Discord username, if the player makes it visible",
      "The association's staff according to their role (administration, refereeing)",
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
    ],
    legalBasis: "Legitimate interest (organizing competitions, sporting memory of the scene)",
    dataSubjects: ["Registered players", "Team members", "Refereeing staff"],
    dataCategories: [
      "Team membership and team roles",
      "Registrations, scores, forfeits, penalties (with reason and referee who imposed it), rankings",
      "Map-by-map detail of a match: score and replay code of each map (the replay shows the players' identifiers in game, hidden BattleTag included), account that entered it",
    ],
    sensitiveData: "None",
    retention: [
      "Results and achievements: no defined retention period, kept as long as the site exists; anonymized when the account is deleted (borrowed username)",
      "Replay codes: kept with the result they document (a detail that no longer explains it is erased); the link to the account that entered them is erased when the account is deleted, the codes remain (the game is kept by the game's publisher)",
      "Right to object available on request",
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
    purpose: "Allowing the organizers to reach a player taking part (rescheduling, settling a dispute, confirming a forfeit)",
    subPurposes: [
      "Exposing the certified Discord username to administrators, at any time, and to referees while the player is registered for a tournament that is not over (from the registration phase)",
      "Opening a player's hidden BattleTag to administrators and referees, while they are registered for a tournament that is not over",
      "When a match is launched, presenting to the players of both teams and to the registered caster the certified Discord username and the BattleTag of one or two players per team, and those of the caster, until the end of the match",
      "Collecting the “Ready” of each party to a match (teams, caster) before it is launched",
      "Sending match reminders by Discord direct message (one week, 24 h and 1 h before)",
      "Alerting the referee role (score conflict, expired postponement, report on a player)",
    ],
    legalBasis:
      "Consent for exposing the certified Discord username to the organizers (certification, a separate action taken by the player from their profile — never acquired by logging in alone — and withdrawable by removing their tag); performance of the service requested by the player (contract — terms of use) for presenting the contacts to the parties to a match at its launch and collecting the “Ready”; legitimate interest (smooth running of tournaments) for match reminders and refereeing alerts",
    dataSubjects: ["Players taking part in a tournament", "Referees", "Casters registered on a match"],
    dataCategories: [
      "Discord username and identifier",
      "BattleTag",
      "Date and opponent of the match",
      "Time at which each party declared itself ready, registered caster",
      "Reason for a report",
    ],
    sensitiveData: "None",
    retention: [
      "Certified username: until it is changed or the account is deleted",
      "Records of reminders and alerts sent (match and step, without content): kept with the match, so with no time limit",
      "“Ready” and caster of a match: kept with the match; the caster of a deleted account is removed from matches not yet played",
    ],
    recipients: [
      "The association's administrators and referees",
      "Players and caster of the same match, from its launch to its end",
      "Discord, which delivers the messages",
    ],
    transfers: [`United States: Discord (delivery of direct messages) — ${transferBasisEn(["DISCORD"])}`],
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
      "Traceability of refereeing actions (penalties, removal of participants, rollbacks), for moderation",
    ],
    legalBasis: "Legitimate interest (administration and oversight of refereeing)",
    dataSubjects: ["Staff"],
    dataCategories: [
      "On Discord: team names, scores, tournament names — no player username (“a player”, including in solo tournaments) and no staff member named (“the staff”)",
      "In the server logs: username and identifier of the staff member who carried out a refereeing action",
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
    legalBasis: "Legitimate interest (art. 6.1.f GDPR: knowing how much the site is visited), without a measurement cookie or third-party tracker; right to object (art. 21) applied by the site itself — the browser's Global Privacy Control and Do Not Track signals, or the objection button of the privacy policy (“Audience measurement” section; bg_audience_optout cookie, without identifier): a refused visit is not recorded, as the server reads these signals itself, and is not even sent when the browser exposes them to the page. For visits already recorded, the right is exercised like the other rights: with the person to contact for requests regarding data, through the report form, “GDPR” category (« RGPD »), or with the association",
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
      "Delivering messages written by the site: codes, reminders, moderation notices (report naming the person, logo hidden, removed or deleted), requests to join a team and information about data by direct message, without being kept by the bot; refereeing alerts, reports and the site's activity log (without player usernames) posted in the staff's private log channel, refereeing alerts also sent to the members of the refereeing role of each server that has set one",
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
      `Backups: ${BACKUP_RETENTION_DAYS} days at most (processing activity T09)`,
    ],
    recipients: [
      "The association's staff (moderation, administration)",
      "The bot's owner (its technical host), for the reasons for exclusion received by direct message",
      "Excluded user, who receives the reason for their exclusion by direct message when they post an announcement in a relayed channel",
      "Members of the channel where /scrim or /recrute is used (public reply of the command)",
      "Members of the refereeing role of each server that has set one (/set-referee-role), for the site's refereeing alerts",
      "Members of partner servers, who read the relayed announcements",
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
      "Weekly archive of the site's and the bot's databases",
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
      "Answering requests to exercise rights and requests sent to the host, including those from authorities",
      "Receiving by email or by phone, through the person to contact for requests regarding data, requests to exercise rights and questions about data processing, and answering them",
      "Receiving the requests sent to the association's own email or phone (published, protected, in the legal notice), and answering them",
      "Alerting administrators on Discord, without personal data",
    ],
    legalBasis:
      "Legitimate interest (GDPR, art. 6.1.f) of the association in enforcing its terms of use for the moderation of content and accounts contrary to them — review, hiding, removal of an image, suspension of an account, and keeping the decision while it can be contested; legal obligation (GDPR, art. 6.1.c) for requests to exercise rights (GDPR, art. 12), notices of illegal content, in copyright as in moderation (Regulation (EU) 2022/2065, art. 16), requests sent to the host (art. 11 and 16) and appeals (art. 20), without an agreement box; consent of the reporter (box when sending) for bug and other reports; by email or by phone as through the form (“GDPR” category, « RGPD »), a request to exercise rights or a question about the processing of one's data — which falls under the right of access (GDPR, art. 15) — is based on the same legal obligation",
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
      "Start of their matches, score to confirm, tournament kick-off, match reminders",
      "Requests to join a team they manage, reports and moderation decisions concerning them, changes to the data policy",
      "Refereeing and moderation alerts for the staff holding these roles",
    ],
    legalBasis: "Consent (activation on each device, withdrawable at any time, topic by topic)",
    dataSubjects: ["Registered players who turn on notifications on a device"],
    dataCategories: [
      "The device's subscription address, provided by the browser, and its encryption keys",
      "Date of subscription and of the last notification delivered",
      "Notification topics turned off by the account",
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
      "Collecting acceptance when the account is created, when a team is created and when the management of a team is received",
      "Asking for acceptance again when the terms change version",
    ],
    legalBasis: "Performance of the service requested by the player (contract)",
    dataSubjects: ["Players registered on the site"],
    dataCategories: ["Version accepted, context of the acceptance (account creation, login, team creation or management), date"],
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
      "Judicial authorities, upon request",
      "The player themselves, through the export of their data, as long as their account exists",
      "The association's technical manager, who administers the database and answers requests",
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
      "Streaming a match live on the association's channel or a caster's (YouTube, Twitch or Kick)",
      "Publishing the link to its YouTube replay on the match page",
    ],
    legalBasis:
      "Legitimate interest (GDPR, art. 6.1.f) of the association in promoting its competitions, the purpose set out in its bylaws; right to object (art. 21) open to each player",
    dataSubjects: ["Players of the streamed matches", "Casters"],
    dataCategories: [
      "In-game and site usernames, team names, images of the game, in-game results and performance, as they appear on screen — neither webcam nor voice chat of the players",
      "Voice and username of the casters",
      "Link to the stream and replay of a match",
    ],
    sensitiveData: "None",
    retention: [
      "Live: nothing kept by the site, which only keeps the link to the channel",
      "Replay link: kept with the match, like its results (T03); the video stays on the platform until it is deleted by the channel that published it",
      `Right to object: on request (“${REPORT_FORM_NAME_EN}” form, “GDPR” category (« RGPD »)), the player appears under a neutral name in subsequent streams, the replay link is removed from the site, and a video published by the association's channel is hidden or deleted`,
    ],
    recipients: [
      "Public of the streaming platforms and of the site",
      "Streaming platforms (YouTube, Twitch, Kick), controllers of their own processing, including of their viewers' data; the site only links to the channels and embeds no player, it sends them no data",
    ],
    transfers: ["None"],
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
