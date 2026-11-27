/**
 * English translation (lot 7b-2, D1) of the published privacy changes
 * (`PRIVACY_CHANGES`, `privacy-changes.ts`), whose French text prevails.
 *
 * Keyed by the entry's **stable identifier**: the identifier, the publication
 * date, the audience and the link targets stay those of the French entry —
 * only the wording is translated. A published entry is never rewritten, in
 * French as in English; a new French entry comes with its English here, in
 * the same PR (a test fails otherwise, and the modal would show French).
 *
 * Read **server side only** (`app/layout.tsx`, `/en/rgpd`): the modal receives
 * the entries already in the page's language, so no client bundle carries
 * this module.
 */

import { PLANNING_RETENTION_DAYS } from "@/lib/shared/planning";
import { GETI_RETENTION_DAYS, GETI_RETENTION_MAX_DAYS } from "@/lib/shared/geti/ingest";
import { DM_TEST_HOURLY_LIMIT } from "@/lib/shared/discord-dm-test";
import { PLAYER_VIEW_MAX_HOURS } from "@/lib/shared/player-view";
import { ACCOUNT_REACTIVATION_DAYS } from "@/lib/shared/account-deletion";
import { AUDIENCE_MAX_ENGAGED_MINUTES, AUDIENCE_MIN_VISITORS, AUDIENCE_RAW_RETENTION_MONTHS } from "@/lib/shared/audience";
import {
  VOICE_BOT_RELEASED_MAX_HOURS,
  VOICE_BOT_UNRELEASED_MAX_HOURS,
  VOICE_CHANNEL_LATE_HOURS,
  VOICE_CHANNEL_LEAD_MINUTES,
  VOICE_ROW_RETENTION_DAYS,
} from "@/lib/shared/match-voice";
import { ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS, BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import { SUSPENSION_RETENTION_MONTHS } from "@/lib/shared/account-suspension";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import { REPORT_RETENTION_DAYS_AFTER_RESOLUTION } from "@/lib/shared/content-reports";
import { DATA_CONTACT_NAME } from "@/lib/shared/legal-contact";
import {
  BOT_FEED_EVENT_RETENTION_DAYS,
  BOT_STAFF_LOG_RETENTION_DAYS,
  SITE_MINIMUM_AGE,
  SUPPORT_TICKET_RETENTION_MONTHS,
  WEB_ACCESS_LOG_RETENTION_DAYS,
} from "@/lib/shared/legal-durations";
import { DATA_CONTACT_ROLE_EN, REPORT_FORM_NAME_EN, WEB_ACCESS_LOG_FIELDS_EN, monthsEn } from "@/lib/shared/legal-text-en";
import type { Locale } from "@/lib/shared/locales";
import { LOGO_QUARANTINE_MONTHS } from "@/lib/shared/logo-quarantine";
import { PRIVACY_CHANGES, type PrivacyChange } from "@/lib/shared/privacy-changes";
import { PUSH_SUBSCRIPTION_RETENTION_DAYS } from "@/lib/shared/push-notifications";
import { SITE_VISITOR_RETENTION_MONTHS, SITE_VISIT_DETAIL_RETENTION_DAYS } from "@/lib/shared/site-visits";
import { TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS } from "@/lib/shared/team-join-request-notice";
import {
  TEAM_INVITE_NOTICE_COOLDOWN_HOURS,
  TEAM_INVITE_NOTICES_DAILY_CAP,
  TEAM_INVITE_NOTICES_PER_PLAYER_CAP,
  TEAM_NOTICE_DMS_HOURLY_CAP,
} from "@/lib/shared/team-invite-notice";

/** The translated part of an entry: its wording, and its links' labels (same targets, same order). */
export type PrivacyChangeTranslation = {
  title: string;
  summary: string;
  details: readonly string[];
  linkLabels?: readonly string[];
};

const READ_REPORTS = "Read the “Reports” section";
const READ_RECIPIENTS = "Read the “Recipients and transfers” section";
const READ_AUDIENCE = "Read the “Audience measurement” section";
const READ_POLICY = "Read the privacy policy";

export const PRIVACY_CHANGES_EN: Readonly<Record<string, PrivacyChangeTranslation>> = {
  "2026-09-recapitulatif-rgpd": {
    title: "Summary of the rules in force",
    summary:
      "We have reviewed how BlueGenji processes your data. Here, all at once, are the rules that apply to your account today.",
    details: [
      "No email address is requested or kept any more: those collected before have been deleted. Your account relies only on usernames and on the technical identifiers of the services you log in with (Google, Discord, Blizzard).",
      "An account is no longer linked to another through its address: you add or remove a means of logging in yourself, from “Connected apps” (« Applications connectées ») in My profile. The last one cannot be removed, otherwise no one could get in any more.",
      "Your Discord tag remains invisible to everyone until it is certified. Once certified (with a code, or by logging in with Discord), the organizers can read it to reach you during a tournament: administrators at all times, referees while you are taking part in a tournament in progress. Never the public.",
      "If you link your Battle.net account, Blizzard fills in your BattleTag and replaces it at each login. Its visibility on your profile does not change.",
      "Your profile picture is copied to our servers at login: no page of the site calls on Google to display it any more, and an avatar you hide is hidden everywhere, home page included.",
      "Deleting your account erases it entirely if it has left no trace. If it has played or organized a tournament, or if it owns a team, it is anonymized and only the sporting record remains. You can export your data at any time from My profile.",
      "Only technical cookies are set. Site traffic is measured with a hash salted with a secret that only the association holds: neither your IP address nor your account is recorded as such with your visits. The bot's public activity feed displays no Discord identifier.",
      "The activity log the staff follow on Discord names no player: it talks about teams and writes “a player”, including in solo tournaments.",
    ],
  },
  "2026-09-sauvegardes-chiffrees": {
    title: "Encrypted backups and guaranteed deletions",
    summary: `The platform is backed up in encrypted archives kept for ${BACKUP_RETENTION_DAYS} days, and an account deletion stays effective even if a backup is restored.`,
    details: [
      `The database is backed up every week in an archive encrypted before upload, with a key that only the association holds, then stored with Microsoft (OneDrive), which stores it without being able to read it. Each archive is destroyed after ${BACKUP_RETENTION_DAYS} days, without going through a trash.`,
      "Uploaded images (avatars, logos) are copied, encrypted, every hour. An image removed from the site disappears from the backup within the hour.",
      `Deleted data may therefore remain for up to ${BACKUP_RETENTION_DAYS} days in these archives, which cannot be corrected one by one. So that it never comes back, each account deletion is noted in a log — account number and creation date, date of deletion, nothing else — kept for ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} days: if a backup ever had to be restored, the deletions made since are applied again before the service resumes.`,
    ],
  },
  "2026-09-battletag-masque-matchs": {
    title: "Hidden BattleTag: readable where it is needed to play",
    summary:
      "A hidden BattleTag stays off your public page and the directory, but the players of your matches and the referees can read it until the tournament is over.",
    details: [
      "The other players of a match you play (opponents and teammates) can read your BattleTag on your page, even when hidden: it is how players add each other in game to start the game.",
      "Referees and administrators can also read it while you are taking part in a tournament that is not over. Otherwise, an administrator does not see a hidden BattleTag.",
      "This access ends when the tournament is over. To stop sharing your BattleTag altogether, erase it from My profile.",
    ],
  },
  "2026-09-google-one-tap-connexion": {
    title: "Google called on the login page only",
    summary:
      "The “Continue with Google” prompt no longer loads across the whole site: only on the login page, and after you have accepted the privacy policy.",
    details: [
      "Previously, every visitor who was not logged in loaded Google's login prompt (Google One Tap) on every page: Google received their IP address and the page viewed.",
      "From now on, no page of the site calls on Google, except the login page, once the policy has been accepted. Google may set a “g_state” cookie there to remember that you closed the prompt.",
      "Nothing changes for your account: the means of logging in and the data kept remain the same.",
    ],
  },
  "2026-09-lancement-des-matchs": {
    title: "Match launch: your contacts shown to your opponent and the caster",
    summary:
      "When a match is launched, both teams and the caster see the certified Discord tag and the BattleTag of one or two players of each team.",
    details: [
      "For each team, the site presents the captain, a manager or the owner — first a player whose Discord tag or BattleTag is verified —, and a second player if that is the only way to have both a Discord contact and a BattleTag.",
      "An uncertified Discord tag is never shown. A BattleTag is, even unverified, marked “not verified”: it is how players add each other in game.",
      "The caster registered on a match is presented in the same way to both teams, and sees their contacts: registering to cast requires a certified Discord tag and a linked Battle.net account.",
      "This information is only visible between the parties to the match, from its launch until it is over. The site also keeps, with the match, the time at which each party declared itself ready.",
    ],
  },
  "2026-09-suppression-pseudo-emprunt": {
    title: "Account deletion: wider erasure, replacement username",
    summary:
      "A deleted account that has played no match is now erased entirely. An account that has played keeps its results under a borrowed username.",
    details: [
      "If you have played no match (and have organized no tournament, own no team and are not registered for a solo tournament), deletion erases your account entirely — even if your team had been registered for a tournament without you playing.",
      "If you have played, your results remain, because they also belong to the teams you played against. Your username is then replaced by a randomly drawn borrowed username, and your page clearly states that the account has been deleted.",
      "Everything that identifies you is erased: Discord and game tags, login accounts, avatar, adulthood, roles on the site and the history of your consents.",
      "Accounts already deleted follow the same rule: those without a match are erased, the others receive a borrowed username.",
    ],
  },
  "2026-09-tag-discord-visible-joueurs": {
    title: "Discord tag: visible to other players, if you choose",
    summary: "A box in My profile can show your certified Discord tag to other players; it starts unticked.",
    details: [
      "When ticked, it makes your Discord tag readable on your page by any logged-in player, so that people can add you without going through the organizers. A visitor without an account never sees it.",
      "It only applies to a certified tag: a tag you have not proven stays hidden from everyone, ticked or not.",
      "Certification does not change: it opens your tag to administrators, and to referees during a tournament — not to other players.",
    ],
  },
  "2026-09-signalements-conditions": {
    title: "Reports and appeals",
    summary: "You are notified of a report that targets you, and you can contest it.",
    details: [
      `A report keeps its category, its description, the players, teams or tournaments designated, its author's account and, if they provide them, their name and email address. It is read by the administrators, then erased ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} days after it is archived — later if a logo was hidden or deleted as a result, until the deadline for contesting.`,
      "If a report targets you, or a team you are a member of, you receive a Discord direct message (if your Discord account is linked or your tag certified). You read what you are accused of — never who reported it — and you can contest it; an appeal reopens an archived report.",
      `A reported team logo may be hidden: it is no longer online, and it is permanently deleted after ${LOGO_QUARANTINE_MONTHS} months without a challenge, or restored if the challenge succeeds. You and your teammates are notified.`,
      "Acceptance of the terms of use (when creating the account or a team, or when receiving the management of a team) is recorded with its date and version; it appears in the export of your data.",
    ],
  },
  "2026-09-demande-adhesion-discord": {
    title: "Requests to join your team announced on Discord",
    summary: "If you manage a team, the bot notifies you by direct message when a player asks to join it.",
    details: [
      "The owner and the managers of a team receive a Discord direct message for each request to join, if they have linked their Discord account or certified their tag. The other members receive nothing.",
      `The message does not name the player: it links to the team's page, where the request is accepted or declined. The same person can only make the bot write to the same team once every ${TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS} hours.`,
    ],
  },
  "2026-09-notifications-push": {
    title: "Push notifications, if you turn them on",
    summary:
      "You can be notified on your phone or computer of the start of your matches and of what concerns you on the site. Nothing is sent without your agreement.",
    details: [
      "Notifications are only turned on by your action, device by device, from “My profile”; you choose the topics, and you turn them off whenever you want.",
      "The site keeps the subscription address your browser gives it and its encryption keys. The message goes through your browser's push service (Google, Mozilla, Apple or Microsoft), encrypted for your device only: that service cannot read it.",
      `A subscription is erased when you turn it off, when your browser revokes it, with your account, or after ${PUSH_SUBSCRIPTION_RETENTION_DAYS} days without a notification delivered. No notification carries a player's username.`,
    ],
  },
  "2026-09-mesure-audience-duree": {
    title: `Site traffic: visit details kept for ${SITE_VISIT_DETAIL_RETENTION_DAYS} days`,
    summary: `The details of visits to the site (page viewed, date) are now erased after ${SITE_VISIT_DETAIL_RETENTION_DAYS} days.`,
    details: [
      `Until now, each visit kept, with no time limit, a salted hash of the visitor, the page viewed and the date. These details are now erased after ${SITE_VISIT_DETAIL_RETENTION_DAYS} days, after being added to a daily counter that only keeps the number of visits.`,
      "To count unique visitors since the launch, the site keeps a single hash per visitor, without page or date, with only the indication “logged in or not”. Without the server's secret, it cannot be linked to anyone; the association, which holds it, can recompute it. Neither your IP address nor your account is recorded as such.",
    ],
  },
  "2026-09-certification-discord-volontaire": {
    title: "Discord tag: certification is no longer automatic",
    summary:
      "Logging in through Discord no longer opens your tag to the organizers: you certify it yourself, in one click, from your profile.",
    details: [
      "Until now, logging in through Discord (button or code by direct message) certified your Discord tag, and so made it readable by administrators, by referees during your tournaments, and by the players and caster of your matches. From now on, logging in only records your Discord username, invisible to everyone; it is the “Certify my tag” button (« Certifier mon tag ») in “My profile” that opens it to the organizers.",
      "If your tag was certified automatically, it stays certified: the organizers can still reach you during a tournament. To remove this exposure, remove your tag in “My profile”: your next login through Discord will record it again without certifying it.",
      "The username, the login identifiers and the account are based on the performance of the service you request, and no longer on consent: the privacy policy says so. The Google One Tap prompt on the login page now only appears if you ask for it, through a box unticked by default.",
    ],
  },
  "2026-10-retrait-google-one-tap": {
    title: "No more Google prompt, recipients named",
    summary:
      "The “Continue with Google” prompt on the login page has been removed: no page of the site calls on Google in your browser any more. The privacy policy now names every recipient of your data and the transfers outside the Union.",
    details: [
      "The “Google One Tap” box disappears. The “g_state” cookie Google could set is no longer set, and any that remains is erased at your next visit to the site. Logging in through Google still goes through the button on the login page.",
      "The site and the bot are hosted in France (in Caen). A new “Recipients and transfers” section of the privacy policy says what goes to Discord, Google, Blizzard, your browser's push service and Microsoft (encrypted backups), and on what basis a transfer to the United States rests.",
      "Nothing changes for your account: the means of logging in (apart from the prompt) and the data kept remain the same.",
    ],
  },
  "2026-09-comptes-google-anterieurs": {
    title: "Your username and picture may have come from Google",
    summary:
      "Your account, created before September 30, 2026, is linked to Google: its username and picture may have come from your Google profile. Nothing has been changed for you: check them in “My profile”.",
    details: [
      "Until September 30, 2026, an account created by logging in with Google received as its username the name of that Google account, often a real first and last name, and its Google picture was copied to the site and shown to the other members. Since then, an account created through Google receives a neutral username, and the imported picture stays hidden until you choose to show it.",
      "Nothing has been changed on your account. If your username is your real name, replace it. If your picture comes from Google and you do not want to show it, change it, delete it, or untick “Avatar” in the “Privacy” section (« Confidentialité ») to hide it.",
      "If your account was created another way (Discord, Blizzard) or if you have already changed your username and picture, you have nothing to do.",
    ],
    linkLabels: ["Change my username or avatar", "Hide my avatar"],
  },
  "2026-10-signalements-base-legale": {
    title: "Reports: no more agreement box to exercise a right",
    summary:
      "A GDPR request, a copyright report, content reported for moderation, a request to the hosting provider or an appeal no longer requires ticking an agreement box: the association is required to handle them. For other reports, nothing changes.",
    details: [
      "These categories are now based on the association's legal obligation (GDPR, art. 12; EU Digital Services Act, art. 11, 16 and 20), and no longer on your consent: there is therefore no consent left to withdraw for them, but your request is always handled. You keep your rights of access and rectification; erasure waits until the request has been handled, as the association is required to handle it (GDPR, art. 17.3.b).",
      "A GDPR request, a request to the hosting provider or an appeal asks for an email address if your Discord tag is not certified: the site sends no email, and without it the association could not answer you.",
      "The author of a copyright report receives an acknowledgment of receipt, then the decision taken and the means of redress, at the address they provide.",
    ],
    linkLabels: [READ_REPORTS],
  },
  "2026-10-signalements-contestation-auteur": {
    title: "Reports: the author can contest the decision",
    summary: `If you report content (copyright, moderation) from your account, you can now contest the decision taken, including a decision not to act. Your report is kept ${LOGO_QUARANTINE_MONTHS} months after it is resolved, instead of 30 days, for the length of that period.`,
    details: [
      `The appeal is made through the “Appeal” category (« Contestation ») of the “${REPORT_FORM_NAME_EN}” form, once the report has been archived. It is read by the association's administrators; the persons targeted are not informed of it.`,
      `A bug report, a GDPR request or a request to the hosting provider, or a report sent without an account, is still erased ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} days after it is archived — later if a logo or avatar was hidden or deleted as a result.`,
    ],
    linkLabels: [READ_REPORTS],
  },
  "2026-10-anonymisation-conditions": {
    title: "Account deletion: the acceptance of the terms goes too",
    summary:
      "When a deleted account is kept under a borrowed username (because it has played matches), the last version of the terms of use it had accepted and its date are now erased, as the details of its acceptances already were.",
    details: ["Nothing changes as long as your account exists: the acceptance of the terms is kept for the lifetime of the account."],
  },
  "2026-10-journal-connexions": {
    title: `Logins: IP address kept for ${CONNECTION_LOG_RETENTION_DAYS} days`,
    summary: `At each login, the site now notes your IP address, the date and time, and the means of logging in used. This data is kept for ${CONNECTION_LOG_RETENTION_DAYS} days (one year), even if you delete your account: the law requires it of the association, which hosts the content published by its members.`,
    details: [
      "It serves no other purpose: no screen of the site displays it, and it is only disclosed to a judicial authority that requests it (French Act on Confidence in the Digital Economy, « loi pour la confiance dans l'économie numérique », art. 6).",
      "You find it in the export of your data, from “My profile”, as long as your account exists.",
    ],
    linkLabels: [READ_POLICY],
  },
  "2026-10-rectificatifs-information": {
    title: "Three clarifications on our previous announcements",
    summary:
      "Three pieces of information given in our previous announcements were inaccurate: here they are, corrected. Nothing changes in the processing of your data.",
    details: [
      `Backups: the encryption key is not held by “the association” in general, but only by the association's technical manager, who is also the site's host; it is never sent to Microsoft. And if a backup ever had to be restored, only the account deletions made since are applied again: another erasure after the archive (tag or BattleTag removed, means of logging in unlinked, visibility setting changed…) would come back with it (an archive is kept for ${BACKUP_RETENTION_DAYS} days at most).`,
      "Certified Discord tag: referees can read it as soon as you are taking part (alone or with your team) in a tournament that is not over — including during registration —, and not only during a tournament in progress.",
      "Audience measurement: the hash recorded at each visit is pseudonymized data, not anonymous. Without the server's secret, it cannot be linked to anyone; but the association, which holds it, can recompute the hash of an account, or of an IP address combined with a browser, and find the corresponding visits.",
    ],
    linkLabels: [READ_AUDIENCE, READ_RECIPIENTS],
  },
  "2026-10-mesure-audience-opposition": {
    title: "Audience measurement: objection and limited period",
    summary: `You can now object to audience measurement from the privacy policy, and the site respects your browser's Global Privacy Control and Do Not Track signals: a refused visit is not recorded (the server reads these signals itself). The hash kept to count unique visitors is erased ${SITE_VISITOR_RETENTION_MONTHS} months after your last visit, instead of being kept with no limit.`,
    details: [
      "Your choice is remembered in your browser by a cookie that only contains the value “1”, never an identifier; it is undone with the same button. A browser signal, for its part, is set in the browser.",
      `Hashes recorded before this change are dated from when it was introduced: their last visit had not been kept. The visit details are still erased after ${SITE_VISIT_DETAIL_RETENTION_DAYS} days, as before.`,
    ],
    linkLabels: [READ_AUDIENCE],
  },
  "2026-10-contact-donnees": {
    title: "A person to contact about your data",
    summary: `To exercise your rights over your data or ask a question about it, you can now contact directly the person the association has appointed for these requests, the ${DATA_CONTACT_ROLE_EN}, by email or by phone. The site's form remains open.`,
    details: [
      `This person is ${DATA_CONTACT_NAME}. Their contact details can be found in the privacy policy and the legal notice of the site. The “${REPORT_FORM_NAME_EN}” form, “GDPR” category (« RGPD »), and the association's contact details remain open.`,
      `An email you send them, and the reply they send you by email, go through their personal mailbox, hosted by Microsoft (Outlook.com, possible transfers to the United States), which can read them; a call, a text or a voice message goes through their telephone operator. Your request and the reply — email, text, voice message or call record — are kept for as long as it takes to handle it, then ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} days after it is closed, like a GDPR request made through the form.`,
      "This is not a data protection officer within the meaning of the GDPR: the association remains responsible for processing your data and for answering your requests.",
    ],
    linkLabels: ["Read the “Exercising your rights” section"],
  },
  "2026-10-suspension-comptes": {
    title: "Suspension of an account by moderation",
    summary: `Moderation can now suspend an account contrary to the terms of use: its sessions are closed and login refused while the suspension runs. The decision (facts relied on, clause invoked, dates) is kept for the duration of the suspension, then ${SUSPENSION_RETENTION_MONTHS} months so that it can be contested.`,
    details: [
      `The holder receives the decision and its reasons by Discord direct message if their account is linked to it, and at each login attempt during the suspension. They contest it without logging in, through “${REPORT_FORM_NAME_EN}” (“Other” category, « Autre »), then, where appropriate, before the court.`,
      "Moderation of content and accounts contrary to the terms of use — hiding or removing an image, suspension — is based on the association's legitimate interest in enforcing its rules. An image removed outside any report is now removed on a written reason, sent with the decision.",
      "A suspension appears in the export of your data, and disappears with your account or when it is anonymized.",
    ],
    linkLabels: [READ_REPORTS],
  },
  "2026-10-registre-complete": {
    title: "Support, streams and the association's email",
    summary:
      "The privacy policy now describes the support portal, match streaming, the web server's technical logs and the association's email. It also specifies the minimum age to create an account.",
    details: [
      `Support portal (Spiceworks): a ticket is kept there for as long as it takes to handle it, then ${monthsEn(SUPPORT_TICKET_RETENTION_MONTHS)} after it is closed.`,
      `Match streaming (YouTube, Twitch or Kick): your username and your team's name may appear on screen, and the replay link stays with the match. You can object through “${REPORT_FORM_NAME_EN}”, “GDPR” category (« RGPD »).`,
      `Web server: each request (${WEB_ACCESS_LOG_FIELDS_EN}) is noted in a technical log kept for ${WEB_ACCESS_LOG_RETENTION_DAYS} days at most, for the site's security.`,
      `The association's email: it is a Gmail mailbox, which Google hosts and can read (possible transfers to the United States). A request received at this email or at the association's phone is kept for as long as it takes to handle it, then ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} days after it is closed.`,
      `Minimum age: you must be at least ${SITE_MINIMUM_AGE} years old to create an account. The site does not ask for a date of birth and does not check age.`,
      `Connection data: the legal log of logins only records logins (without source port), and the information provided when your account was created leaves with it (apart from the encrypted backup copies, erased after ${BACKUP_RETENTION_DAYS} days, and the record of your deletion in the log that replays it after a restoration, kept for ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} days; the rest of what remains is detailed in the register).`,
    ],
    linkLabels: [READ_RECIPIENTS, "Read the “Minimum age” paragraph"],
  },
  "2026-10-sauvegardes-hetzner": {
    title: "Backups stored in Germany",
    summary:
      "Since October 1, 2026, the encrypted backups of the site and the bot are sent to Hetzner, in Germany, and no longer to Microsoft (OneDrive): they stay in the European Union.",
    details: [
      "Hetzner Online GmbH stores the backup copies in the European Union, as a processor, and cannot read them: they are encrypted before upload, with keys that only the site's host holds. The retention periods do not change.",
      "Microsoft no longer receives any new backup. It remains a recipient through the mailbox of the person to contact for your requests regarding your data.",
      "Support portal: Spiceworks acts there as the association's processor, and its transfers to the United States are based on the Data Privacy Framework.",
      "Match streaming: only your username, your team's name and your in-game results appear, never a webcam or voice chat; the site sends nothing to the streaming platforms. You can object and appear under a neutral name.",
    ],
    linkLabels: [READ_RECIPIENTS, "Read the “Match streaming” paragraph"],
  },
  "2026-10-bot-durees-journaux": {
    title: "Discord bot: logs and activity feed limited in time",
    summary:
      "The BlueGenji Discord bot now erases its activity feed and its staff log after a fixed period, and the messages of an exclusion imposed from now on as soon as it is lifted.",
    details: [
      `Public activity feed on the bot's page (time, server, level or role of each announcement): ${BOT_FEED_EVENT_RETENTION_DAYS} days, then deleted.`,
      `Staff's private log, and the bot's direct messages to its owner: one year (${BOT_STAFF_LOG_RETENTION_DAYS} days), then deleted.`,
      "Exclusion from the relay imposed from now on: its notice and its reason are deleted, from the log as from the direct messages, as soon as it is lifted.",
      "/scrim and /recrute commands: the level and the role are now chosen from a list, no more free text for new announcements.",
      `Restoring a backup of the bot: it is done on the bot's machine, the database no longer goes through Discord; the copy of the previous database is deleted after ${BACKUP_RETENTION_DAYS} days at the latest.`,
    ],
    linkLabels: ["Read the bot's privacy policy"],
  },
  "2026-10-scores-map-par-map": {
    title: "Match scores: map-by-map details and replay codes",
    summary: "A match score is now entered map by map, each map with the replay code of the game.",
    details: [
      "Each map of a match carries its score and its replay code; the match score follows from them.",
      "A replay code makes it possible to watch the game again in game, and to read there the in-game identifiers of the players present, including a BattleTag hidden on the site.",
      "Codes recorded by the referees or retained as the result are visible to logged-in members on the tournament page, so that a match streamed live and one that is not offer the same information; those of a pending team proposal, only to the two teams of the match and the referees. They are kept with the result they document.",
      "The site remembers which account entered the details; this link is erased when the account is deleted, and appears in the export of your data.",
      "A detail that no longer explains the result retained (score corrected by the referees) is erased. The game remains kept by the game's publisher: deleting your account does not erase your identifiers from a replay, and the codes remain attached to the result.",
    ],
    linkLabels: [READ_POLICY],
  },
  "2026-10-code-replay-facultatif-arbitrage": {
    title: "Match scores: replay code optional for the referees",
    summary: "A score is now only entered map by map; the referees may record a map without its replay code.",
    details: [
      "A match score is now only entered map by map, referees included: there is no longer any score set by hand.",
      "When the replay of a game is lost, the referees may record the map without a replay code: it shows “No replay code”, and no code is collected then.",
      "Teams still provide the replay code of every map they report.",
    ],
    linkLabels: [READ_POLICY],
  },
  "2026-10-suivi-tournoi-sans-compte": {
    title: "Tournaments: the page can also be followed without an account",
    summary:
      "The page of a published tournament can now be viewed without logging in: bracket, scores, rankings, names of the teams and usernames of the players taking part.",
    details: [
      "A visitor without an account follows the tournament at /suivre/tournois/…: they read there what streams and Discord already show — team names, usernames of the players taking part, scores, rankings, username of a match's caster —, as well as team logos and, for a solo tournament, the avatar of each player taking part (unless they hid it) and their internal account number, which carries their podium mark, as well as BlueGenji Survival penalties (entrant, round, points), without their reason or the referee who imposed them.",
      "Replay codes are not shown there: they remain reserved to logged-in members.",
      "The page is served from a shared copy, renewed at least every two and a half minutes: a username change, a hidden avatar or an account deletion may show up there with that delay.",
      "The page is excluded from search engines and opens no session. Like any page of the site, its visit is counted by the audience measurement, unless you object; beyond that, the visitor's IP address is only used there, in memory, to limit the number of reads.",
      "You can object to your username being displayed, as for match streaming.",
    ],
    linkLabels: ["Read the paragraph “Following a tournament without an account”"],
  },
  "2026-10-langue-du-compte": {
    title: "Notifications: in your account's language",
    summary:
      "Your account now keeps a language, French or English: push notifications reach you in that language.",
    details: [
      "The account's language is that of the site page you last logged in from (a login started elsewhere, from a link or a bookmark, does not change it, nor does a login through the Google, Discord or Blizzard button from a browser that does not tell (too old, or one that strips this information); French by default, in particular for an account that has not logged in again since this change); you can change it in “My profile”, Notifications section — that choice holds until you next log in from a page in the other language.",
      "The site only keeps this choice (French or English), for the lifetime of the account. It appears in the export of your data and goes back to French if the account is anonymized.",
      "Discord messages stay in French.",
    ],
    linkLabels: ["Read the “Push notifications” section"],
  },
  "2026-10-horaires-de-match": {
    title: "Match times announced, changed or removed",
    summary:
      "When the referees set, change or remove the time of one of your matches, you are told; a single reminder remains, within the 24 h before kickoff.",
    details: [
      "The announcement goes to the members of both teams of the match (coaches and managers included; to both players in a solo tournament) — as soon as the time is set if both sides are known, otherwise as the match approaches (within the 48 h before it) — by Discord direct message and by push notification if you turned them on (topic “Match times and reminders”). You are also told when a tournament update removes you, or your team, from a match whose time you had received. In a tournament whose referees do not schedule the matches, a removed time is not announced: without a time, the match goes into launch as soon as it is playable.",
      "The “Match times and reminders” topic in “My profile” only controls push notifications, not these direct messages.",
      "The reminders one week and one hour before the match are gone.",
      "These messages carry no player username: team names, or “Your match” in a solo tournament.",
      "The site keeps, with the match, the time that was announced, to tell you “instead of …” if it changes; it does not keep the text of the messages.",
      "If you are on the tournament staff and turned on push notifications, you are also told when another member schedules a match, or changes or removes its time, and when a tournament update deletes a scheduled match (topic “Scheduled matches”, which you can turn off in “My profile”). Each match time set, changed or removed by the referees is recorded in the staff activity log: unnamed on Discord, with its author's username and account ID in the server logs.",
    ],
    linkLabels: ["Read the “Push notifications” section", "Read the “Exercising your rights” section"],
  },
  "2026-10-annonce-des-matchs-diffuses": {
    title: "Streamed matches announced on Discord",
    summary:
      "When a streamed match starts, the bot announces it to the whole Discord server of the association, with the names of both teams.",
    details: [
      "The announcement is posted in the #live channel of the association's Discord server, with an @everyone mention: the names of both teams, the tournament's name and the stream link.",
      "It carries no player username: in a solo tournament, each entrant is written “a player”.",
      "The site only keeps a record of the announcement (the match, the identifiers of its two entrants and its date), deleted with the match. The message stays in the channel, at Discord (United States), until the association deletes it.",
    ],
    linkLabels: ["Read the “Match streaming” paragraph", READ_RECIPIENTS],
  },
  "2026-10-rappel-de-check-in": {
    title: "Check-in reminder 10 h before the match",
    summary:
      "A second match reminder goes out 10 h before kickoff, with the link to the Discord server where check-in opens 15 minutes before the match; referees receive the schedule of upcoming matches.",
    details: [
      "The 24 h reminder stays. The 10 h one — or, for a match scheduled less than 10 h ahead, the announcement of its time — adds the invite link to the check-in Discord server. It goes to the same people through the same channels (Discord direct message, push notification of the “Match times and reminders” topic), with no player username.",
      "If you are on the tournament staff, a refereeing schedule lists the upcoming matches about 10 hours ahead (times, tournaments, rounds and team names; “a player” in a solo tournament): in the staff activity log on Discord, and by push notification if you turned them on (topic “Refereeing schedule”, which you can turn off in “My profile”).",
      "No new data is collected: the site only keeps, with the match, a record of the reminder and the schedule sent for its time.",
    ],
    linkLabels: ["Read the “Push notifications” section", "Read the “Exercising your rights” section"],
  },
  "2026-10-pseudo-live-et-messages-de-match": {
    title: "Your username in #live announcements, and match direct messages up to you",
    summary:
      "In a solo tournament, the announcement of a streamed match in the #live channel now names the players by their username; you can turn off the Discord direct messages about your matches from “My profile”.",
    details: [
      "#live announcement, solo tournament: your public BlueGenji username replaces “a player” (the username on your page, editable in My profile, with no effect on an announcement already posted: unless changed, your Discord username or BattleTag taken when the account was created, or even your Google account name for a Google account created before September 30, 2026; never your numeric Discord identifier). A team match still names only the teams. The site's other Discord messages still carry no player username. The neutral name obtained by objecting applies to the stream only: to stay unnamed in #live, don't register. A registration made before this date stays “a player”.",
      "These announcements stay in the channel as long as it exists, even after your account is deleted; the team or player concerned can ask for their deletion (“Report a problem”, “GDPR” category).",
      "Match direct messages (time set, changed or removed, reminders, the “Match retiré” notice): legitimate interest, with a right to object. Untick “Discord direct messages about my matches” in “My profile”, Notifications section, to stop receiving them; your push notifications keep their own settings. The site keeps this choice for the life of the account, in your data export.",
      "Referee alerts and the refereeing schedule, sent to referees and administrators, fall under performance of the service and are not turned off this way.",
    ],
    linkLabels: ["Read the “Match streaming” paragraph", "Read the “Match Discord direct messages” paragraph"],
  },
  "2026-10-base-pseudo-live-et-automod": {
    title: "Your username in #live: legal basis clarified, terms of use updated",
    summary:
      "In a solo tournament, your username in the #live announcement rests on performance of the service you register for, not on legitimate interest; an AutoMod block or flag may pass its text on to the Discord server's moderators. The terms of use move to version 4 to say so.",
    details: [
      "#live announcement of a solo tournament: your public username appears in it under performance of the service — the announcement is part of the tournament you register for — and no longer under legitimate interest. Nothing changes in practice: no neutral name for that announcement, not registering remains the way not to be named in it, and a past announcement is deleted on request (“Report a problem”, “GDPR” category).",
      "If a Discord AutoMod rule blocks or flags a #live announcement, its text (including your username in a solo tournament) may reach the moderation alert channel of the association's Discord server, where it stays until the moderators delete it or on request (“Report a problem”, “GDPR” category).",
      "Match direct messages: each now ends with a line saying where to turn them off (“My profile”, Notifications section). The site keeps your choice in your legitimate interest: that is what lets it honour it.",
      "Terms of use: version 4, in force since 14 October 2026, includes this #live announcement rule. Read them again: the login page shows them to you anew as long as they have not been accepted in your browser and, if you manage a team and have not already accepted them, before your next management action. At login, your account no longer records an acceptance only kept by your browser (possibly another person's): only the one you have just given on the login page counts, if you start the login from that page (or enter the Discord code there) within ten minutes.",
    ],
    linkLabels: [
      "Read the “Match streaming” paragraph",
      "Read the “Match Discord direct messages” paragraph",
      "Read the terms of use",
    ],
  },
  "2026-10-messages-de-match-tags-certifies": {
    title: "Match direct messages: only with a certified Discord tag",
    summary:
      "To avoid spam, the bot now only sends the direct messages about your matches to accounts with a certified Discord tag; your push notifications don't change.",
    details: [
      "Time set, changed or removed, reminders (24 h and 10 h before) and the “Match retiré” notice: these Discord direct messages now only go to a Discord tag certified in “My profile”. An uncertified tag no longer receives any, whether it was typed by hand or linked by signing in with Discord — a typed tag can point to someone else's Discord account by mistake, and only certification confirms that you agree to be reached there.",
      "If your tag is already certified, nothing changes for you; otherwise, verify it in “My profile”, Discord section, to receive them. Your push notifications, the “Discord direct messages about my matches” box and staff messages (referees, administration) don't change.",
      "No new data is collected: fewer Discord usernames and IDs are sent to the bot.",
    ],
    linkLabels: ["See my Discord tag", "Read the “Match Discord direct messages” paragraph"],
  },
  "2026-10-contacts-de-match-avant-le-depart": {
    title: "Your match contacts: visible as soon as your opponents are known",
    summary:
      "The members of both teams and the caster of your match can see the contacts shown at launch as soon as both opponents of the match are known, even before its time is set, through the “Contacts” button on the match card.",
    details: [
      "It's the same information as at a match launch — the certified Discord tag and the BattleTag, even if hidden, of one or two members per team (player, coach, manager or owner), and those of the signed-up caster, with the team role and whether the BattleTag comes from a linked Battle.net account —, shown to the same people: only the parties to the match (members of both teams and the signed-up caster). Our texts said “the players”: as before, it is in fact every current member of both teams, coaches, managers and owners included — which also applies to the hidden BattleTag read on a profile during the tournament.",
      "What changes is when: as soon as the match has both its opponents, with or without a set time, no longer only at its launch, so you can get organised ahead of time. They stop being visible once the match is over.",
      "The launch phase (“Ready” and the launch window) becomes an option of each tournament, off by default: without it, a match starts at its time and no “Ready” is recorded.",
    ],
  },
  "2026-10-contacts-de-match-caster-et-conditions-v5": {
    title: "Match contacts: the caster only during the match, terms of use updated",
    summary:
      "A match's registered caster now only sees its contacts while the match is being played, from its start to its end, and the teams see the caster's over that same time; your hidden BattleTag can now only be read in the “Contacts” window of your matches, which referees and administrators open at the same times as the teams. The terms of use move to version 5 to say so.",
    details: [
      "Caster: they only see the certified Discord tag, the BattleTag (even when hidden) and the team role of a match's contacts while the match is being played — from its start (launch window opened, or match launched) to its end —, no longer as soon as both opponents are known. Symmetrically, the members of both teams now only see the caster's contacts while the match is being played; they keep the teams' contacts as soon as both opponents are known, “To schedule” included.",
      "Hidden BattleTag: it can no longer be read on your profile by the players of your matches, nor by referees and administrators during a tournament. It can now only be read in the “Contacts” window of a match where you are presented as a contact — by both teams and by referees and administrators as soon as both opponents are known, by the caster while the match is being played. If you don't want them to see it, remove it from your profile (if it comes from Battle.net, unlink your Battle.net account first — after adding another way to log in if it is your only one). This reading is based on the performance of the service — running the tournament —, not on your consent.",
      "Terms of use: version 5, in force since 19 October 2026, adds the “Match contacts” section, which provides for this sharing. Read them again: the login page shows them to you anew as long as they have not been accepted in your browser and, if you manage a team and have not already accepted them, before your next management action.",
    ],
    linkLabels: ["Read the “Match contacts” section", "Read the “Data collected” section"],
  },
  "2026-10-conditions-v6-acceptation-pour-tous": {
    title: "Terms of use: version 6, to be accepted by every account",
    summary:
      "The terms of use move to version 6: every logged-in account must now accept them to keep using the site, no longer only team managers. They also specify that your hidden BattleTag can be read in a match's “Contacts” window and in its launch window.",
    details: [
      "Acceptance: as long as you have not accepted the version in force, a window shows them to you on every page, whether you manage a team or not. It can no longer be postponed: the “Later” button and its bg_terms_later cookie are gone. Without accepting, you can log out, read this policy, the legal notice, the accessibility statement, the bot's legal pages and the tournament rules, follow or contest your reports from their page, report content through the “Report a problem” button of these pages, and open your profile, notably to export your data or delete your account. Refusing does not remove you from your teams or registrations: your contacts are still shared with the parties to your matches and match messages go on, unless you delete your account. Your acceptance is recorded with the version, the date and where you gave it (this window, if you manage no team).",
      "Hidden BattleTag: it remains visible to your opponents, admins and referees during a tournament match, and to its caster, in the match's “Contacts” window and in its launch window, if you are one of the contacts shown. The launch window, which repeats these contacts at the start of the match, only opens to both teams and the caster. Same data, same durations, same basis: the performance of the service.",
      "Terms of use: version 6, in force since 19 October 2026, says so in its “Acceptance” and “Match contacts” sections.",
    ],
    linkLabels: ["Read the “Acceptance” section", "Read the “Match contacts” section"],
  },
  "2026-10-annonces-live-par-soiree": {
    title: "#live announcements: one message per evening",
    summary:
      "Announcements of streamed matches in the #live channel are grouped into one message per evening, which lists with their times the matches already live, those scheduled until the end of the evening (four hours after the first live stream) and those finished, marked “Terminé” with their score, and which is edited at each match start and end.",
    details: [
      "The names do not change: the teams' names or, in a solo tournament, your public BlueGenji username. What changes is when: a streamed match scheduled that evening appears in the message even before it starts, with its time.",
      "The evening's message is edited when another match starts or ends, and then shows the public username of that moment: a username changed before that edit appears instead of the old one. These edits continue up to four hours after the evening ends; when the message can no longer be edited, a new message without a mention takes over, and the old one stays in the channel.",
      "Only a stream on the official BlueGenji channel notifies the whole server (@everyone); another channel only notifies the members who have the StreamViewer role. The message can still be read by every member of the channel, as before.",
      "The site keeps the ID of the evening's message (not its text), deleted one day after the evening ends. On the record of a match's announcement, it also notes whether its going live was not announced (refused by the bot or AutoMod, or evening closed after its message was deleted; the match may have appeared in the message before as scheduled): that record is kept, without a new attempt, until the match is deleted, and appears in the export of your data.",
    ],
  },
  "2026-10-recrutement-ne-plus-afficher": {
    title: "Recruitment window: “Don't show again”",
    summary:
      "The window of urgent recruitment announcements that opens on its own has a “Don't show again” button. The site keeps this choice so as not to open it for you again: on this browser and, if you are logged in, on your account. You can undo it in “My profile”.",
    details: [
      "On the browser, the choice is held in the bg_recr_off cookie (value “1”, no personal identifier), kept for one year; unticking the “My profile” box sets it too.",
      "On the account, it follows you to your other devices. Made before logging in (or not saved right away), it is carried over to your account at your next login or on your next visit while logged in. It is kept as long as the account, appears in the export of your data and returns to the default when the account is deleted.",
      "You can undo this choice in “My profile”: your account then records that you turned the window back on (a mark kept until a new “Don't show again”, included in the export) and the cookie of that browser is deleted. From then on, no cookie is carried over to your account any more: a browser that holds it (set earlier, while logged out, or because it could not be saved to your account) only keeps the window closed there; only a new “Don't show again” made while logged in, or the “My profile” box, turns it off again on your account.",
      "The announcements stay on the Recruitment page and in the banner; “Later” does not change: the window comes back for an urgent announcement you have not seen yet.",
    ],
  },
  "2026-10-arbitre-qui-joue-le-match": {
    title: "Referee who plays in the match: the rest of the staff warned",
    summary:
      "When a staff member who plays in a match settles its score dispute, corrects its result, imposes their opponent's withdrawal or pauses its automatic confirmation, the other staff members are warned, and the action is recorded in the staff activity log.",
    details: [
      "To know this, at each of these actions the site checks whether its author is a member of one of the two teams of the match, or left it since the match was launched, its first report or, failing these, its creation (or whether they are its player, in a solo tournament); for an imposed withdrawal, only the withdrawn team's opponent is looked at.",
      "The alert goes as a push notification to the other referees and administrators subscribed to push notifications (topic “Refereeing by a staff player”, on by default, which you can turn off in “My profile”), never to the author. It gives the tournament, the round and, except for a pause, the retained outcome with the team names (none in a solo tournament), without the username of the author or of any player.",
      "The staff activity log gives on Discord only the tournament and the kind of action, unnamed; the server logs also keep the round, the outcome and the team names (neither for a pause, no names in a solo tournament), and the username and account ID of its author.",
      "Each of these four actions (any withdrawal imposed by the referees that closes a match included, one trace per match closed against a known opponent, whichever team is withdrawn), whether or not its author plays in the match, also leaves a short trace in the server logs: the match number, and the username and account ID of its author.",
    ],
    linkLabels: ["Read the “Push notifications” section", "Read the “Exercising your rights” section"],
  },
  "2026-10-pastille-battletag-fiche": {
    title: "Player page: “Verified BattleTag” badge",
    linkLabels: ["Read the “Data collected” section", "Read the “Exercising your rights” section"],
    summary:
      "If your BattleTag comes from a linked Battle.net account, your player page shows a “Verified BattleTag” badge to any logged-in player who opens it — including when your BattleTag is hidden: the page then says “Hidden” with the badge, never showing the BattleTag.",
    details: [
      "The badge only says that your BattleTag was proven by Battle.net, just as the certified Discord tag badge says your tag was proven: it names neither your BattleTag nor your Battle.net account, whose identifier never leaves our servers.",
      "It rests on our legitimate interest (knowing who has proven their game identity). You can object to it through the report form (GDPR category), or make it disappear by unlinking your Battle.net account in “My profile” (Connected apps) — after adding another login method if it is your only one. No new data is collected.",
      "The certified Discord tag badge follows the same rule: it can be read on your player page by any logged-in player, even if your tag is not visible to other players. It rests on the same legitimate interest, you can object to it the same way, and it disappears if you remove your tag.",
    ],
  },
  "2026-10-proposition-certification-discord": {
    title: "Discord tag verification suggested at login",
    linkLabels: ["Read the “Data collected” section"],
    summary:
      "After logging in with Discord or with Blizzard (Battle.net), a window suggests, once, that you verify your Discord tag if it isn't verified yet (or add one, if you have none), with a table of what verification changes. Logging in still verifies nothing: only your explicit confirmation does.",
    details: [
      "“Later” (or closing the window) keeps nothing on your account: your login session only records that the window no longer needs to be suggested, and this mark goes with the session. The window comes back at your next login with Discord or Blizzard.",
      "“Don't show again” is kept on your account, with its date: the window no longer opens, on any device. This choice lasts as long as the account, is included in the export of your data and is erased if the account is anonymized. Verification remains possible at any time in “My profile”.",
      "Logging in with Google doesn't open this window.",
    ],
  },
  "2026-10-contacts-du-caster-aux-arbitres": {
    linkLabels: ["Read the “Match contacts” section", "Read the “Data collected” section"],
    title: "Caster contacts: visible to referees and administrators before the match",
    summary:
      "If you cast a match, referees and administrators see your contacts as soon as both its opponents are known, no longer only while the match is being played (for administrators, only your BattleTag is affected: they could already see your certified Discord tag); both its teams still only see them while the match is being played.",
    details: [
      "It's the same information as before (your certified Discord tag and your BattleTag, even when hidden), in the same “Contacts” window of the match, until its end. Only the timing changes for referees: they can reach you to organise the stream ahead of time. Administrators could already see your certified Discord tag at any time: for them, only your BattleTag is affected.",
      "Nothing changes for players: their contacts stay visible to referees as soon as both opponents are known, and to the caster only while the match is being played.",
      "As before, this reading is based on the performance of the service — running the tournament. The terms of use (“Match contacts” section) say so, with no new version to accept.",
    ],
  },
  "2026-10-messages-discord-dans-ta-langue": {
    linkLabels: ["Read the “Push notifications” section"],
    title: "Discord direct messages in your account's language",
    summary:
      "The direct messages the site sends you on Discord (match reminders and times, moderation notices, requests to join your team, data information, login code) are now written in your account's language, French or English — the same as your push notifications.",
    details: [
      "For the code sent by Discord direct message (login, certification or change of the tag), the site sends the association's bot the language of the account already linked to that Discord account, and the bot writes the code in that language without keeping it. The other messages are written by the site, as before.",
      "When the language cannot be read (unknown account, outage), the message is sent once, in French then in English — in French alone when both do not fit in one message. Messages posted in Discord channels stay in French.",
      "No new data is collected: it's the language already kept with your account, which you change in “My profile”.",
    ],
  },
  "2026-10-base-du-choix-des-messages-de-match": {
    linkLabels: ["Read the “Match Discord direct messages” paragraph"],
    title: "Your match direct messages choice: legal basis clarified",
    summary:
      "The site keeps your choice about the Discord direct messages of your matches under a legal obligation — to keep honouring your objection — and no longer in your legitimate interest.",
    details: [
      "Nothing changes in practice: the “Discord direct messages about my matches” box in “My profile” and what it turns off (time, reminders, “Match retiré”) stay the same, and the choice is kept for the lifetime of the account, only so that it is respected.",
      "The messages themselves are still based on the association's legitimate interest, with your right to object.",
    ],
  },
  "2026-10-sauvegardes-deux-fois-par-semaine": {
    title: "Backups twice a week",
    summary:
      "The encrypted backups of the site's and the bot's databases are now made twice a week, on Sunday and Tuesday evenings, and no longer once a week as stated in the information of September 23, 2026.",
    details: [
      `What is backed up, the encryption and the retention period do not change: each archive is destroyed after ${BACKUP_RETENTION_DAYS} days at most.`,
    ],
  },
  "2026-10-avis-de-retrait-du-cast": {
    linkLabels: ["Read the “Match Discord direct messages” paragraph"],
    title: "Cast removed: you are notified, with the reason",
    summary:
      "If you cast a match and your registration is removed by the staff, automatically (casting requirements no longer met, or you now play in the match) or because another caster takes your place, the site notifies you by Discord direct message and push notification, with the reason.",
    details: [
      "The message names the match (team names, “a match” in a solo tournament), its tournament and its round, never who removed the registration. The direct message only goes to a certified Discord tag and is turned off, like the other match messages, with the “Discord direct messages about my matches” box in “My profile”; the push notification, only sent if you still hold the streaming permission, has its own setting, “Cast removed”.",
      "A caster's registration for a match, its takeover by another caster and its removal (with the reason for a takeover or an automatic removal) are also noted in the staff log on Discord, without naming anyone (“a caster”, “the staff”).",
    ],
  },
  "2026-10-plusieurs-casters-par-match": {
    linkLabels: ["Read the “Match streaming” paragraph"],
    title: "Several casters per match",
    summary:
      "A match can now have several casters: each one joins a stream of the match (co-cast) or opens their own, with its own link. The match contacts presented to the caster while the match is being played are presented to each registered caster, and each caster's are also presented to the other casters of the match.",
    details: [
      "What is shown and when do not change: certified Discord tag and BattleTag (even hidden), in the match's “Contacts” and launch windows, only while the match is being played (to the referees, as soon as both its opponents are known), as part of the performance of the service.",
      "If you cast: your username is shown with the stream you join. The link of the stream you open separately is published with the match; that stream goes, with its link, once no caster holds it any more — whether you leave it or your account is deleted; only the link set in the match's live configuration stays with the match. When your account is deleted, the link you provided — when opening your stream or in that configuration — also goes, played matches included, even if another caster still holds that stream. If you are a member of the organizers, the channel you set in that configuration on a match you already cast counts as yours (set before you signed up as its caster or after you left it, it stays the organizers' link; re-saving a link already set does not change its author); a link set before the site recorded who provided it has no known author and stays with the match.",
      "A caster no longer replaces another: a new registration is added without removing anyone. A registration is now only removed by the caster themselves, by the staff or automatically.",
    ],
  },
  "2026-10-arbitre-designe-des-matchs": {
    linkLabels: ["Read the “Assigned referee of a match” paragraph"],
    title: "Assigned match referees",
    summary:
      "A staff member can now referee a match: they take it, or the staff assigns it to them. Both teams and the referees see their username and BattleTag as soon as both opponents are known, the match's casters while the match is being played; the public only reads “Referee assigned”.",
    details: [
      "If you play or cast a match: its assigned referee is presented to you in the match's “Contacts” and launch windows, at the same times as the match contacts (as soon as both your opponents are known if you play, while the match is being played if you cast) — their username and BattleTag, even when hidden, never their Discord tag in that capacity (if they also cast the match, their caster contacts follow the casters' rule); their username alone appears there as soon as the launch window shows the match. The launch window also opens to them: they read the match contacts there, hidden BattleTag included, which they already read as a referee in the “Contacts” window. Nothing else changes for your own data.",
      "If you referee: your username and BattleTag (even when hidden) are presented in this way to the parties to your matches, on the basis of legitimate interest (they know who referees): you object to it through the report form (GDPR category) — once upheld, your objection means the staff no longer assigns you matches, those you already hold staying yours — and you can withdraw from a match at any time, the staff otherwise being able to assign that match to you again, without notice; your “Ready” is expected before the launch. If the refereeing is removed from you by the staff (removal, match assigned to another referee or switched to self-management) or automatically (requirements no longer met, or you now play the match), you are notified by push notification only, with the reason, as long as you hold the refereeing permission — “Refereeing removed” setting. When your account is deleted, you are removed from all your matches.",
      "Taking a match, the staff assigning or replacing its referee, the removal of the refereeing, self-management, the first map and the maps picked from the round's pool are noted in the staff log on Discord without naming anyone; a match that enters its launch with neither a referee nor self-management is flagged to the referees, without switching anything automatically.",
    ],
  },
  "2026-10-reglages-du-salon-aux-managers": {
    linkLabels: ["Read the “Match Discord direct messages” paragraph"],
    title: "Lobby settings sent to managers",
    summary:
      "If you manage an entered team (owner or manager) or play a solo tournament, the site sends you the game settings by Discord direct message and push notification when the lobby of a match opens.",
    details: [
      "The message says who plays on the left (the host) and on the right, the first map, the first ban, the reminder to sort the players by role if the match is cast, and whether it has an assigned referee or is self-managed, with the team names, the tournament, the round and the link to the match page. It contains no BattleTag, no Discord tag and no player username: in a solo tournament, it says “you” and “your opponent”. It is sent when the lobby opens, and again if it reopens, for instance after a change of time.",
      "The direct message only goes to a certified Discord tag and is turned off, like the other match messages, with the “Discord direct messages about my matches” box in “My profile”; the push notification has its own topic, “Lobby settings”, on by default for anyone who turned on push notifications, which you can turn off in “My profile”.",
    ],
  },
  "2026-10-conditions-v7-casters-et-arbitre": {
    linkLabels: [
      "Read the “Match contacts” section",
      "Read the “Match streaming” section",
      "Read the “Assigned referee of a match” paragraph",
    ],
    title: "Terms of use: version 7 (casters, assigned referee, match page)",
    summary:
      "The terms of use move to version 7: their “Match contacts” section provides for several casters per match, the assigned referee and the match page, and presenting the assigned referee now rests on the performance of the service, no longer on legitimate interest, once that referee has accepted this version. It must be accepted: a window presents it to you until you have accepted it.",
    details: [
      "Match contacts: a match's contacts go to each of its casters while the match is being played, and each caster's also to the other casters of the match. The assigned referee is presented there — their username and BattleTag, even when hidden, never their Discord tag in that capacity (if they also cast the match, their caster contacts follow the casters' rule) — to both teams and to the referees from the moment both opponents are known until the end of the match, and to the casters while the match is being played.",
      "Match page: it repeats the casters' contacts (certified Discord tag and BattleTag, even when hidden) and the assigned referee's username and BattleTag, even when hidden, to the same people at the same times as the match's “Contacts” window; the teams' contacts stay in the “Contacts” and launch windows. A hidden BattleTag can be read nowhere else on the site.",
      "If you referee: once you have accepted version 7, presenting your username and BattleTag to the parties to your matches rests on the performance of the service — the terms of use provide for it —, no longer on legitimate interest: objecting through the report form no longer applies to it, and an objection already upheld still stands (the staff no longer assigns you matches; those you already hold stay yours). Until you accept it, it still rests on legitimate interest, and you can object to it through the report form (GDPR category); as the acceptance window then covers the tournament pages, you withdraw from a match by asking for it through that same form. You can still withdraw from a match at any time, the staff being able to assign it to you again; if you no longer meet the requirements to referee (refereeing permission, certified Discord tag, linked Battle.net account), or become a player of the match before its launch, you are no longer presented.",
      "Streaming: the terms now say that the evening #live message names the teams and, in a solo tournament, the players by their public username before a match scheduled that evening starts (a match whose broadcast is set to open at its start time) and once the match is finished, not only when it starts. A match being listed in that message before it goes on air leaves no trace on the site.",
      "Acceptance: without accepting the terms, you can delete your account directly from the window that presents them to you, as from your profile.",
      "Terms of use: version 7, in force since 29 October 2026, says so in its “Match contacts”, “Match streaming” and “Acceptance” sections. A window presents it to you until you have accepted it: accepting it lets you keep using the site.",
    ],
  },
  "2026-10-ne-plus-voir-invitation-certification-sur-le-compte": {
    title: "“Don't show again” on the verification invitation: kept on the account",
    linkLabels: ["Read the “Cookies & trackers” section"],
    summary:
      "The “Don't show again” choice on the window inviting you, on a tournament page, to verify your Discord tag (and your BattleTag, depending on the game and the account) is now kept on your account, no longer in the browser: it applies in all your browsers, and no longer to the other accounts used in the same browser.",
    details: [
      "What is kept: the date of the choice, on your account. It is included in the export of your data and erased when the account is anonymised.",
      "A “Don't show again” ticked before this change, kept in the browser, is not carried over to your account: the window may come back once, to be ticked again. That former local storage value is no longer read, and it is erased when a tournament page opens.",
      "Simply closing the window is still remembered for the tab only (session storage, never sent to the server).",
    ],
  },
  "2026-10-proposition-certification-discord-marque-de-session": {
    title: "Discord tag verification suggestion: what your session records",
    linkLabels: ["Read the “Data collected” section"],
    summary:
      "A clarification of the information of October 21, 2026: at each login with Discord or Blizzard, as long as your Discord tag isn't verified and you haven't chosen “Don't show again”, your login session records that the verification window still needs to be suggested to you, once per login.",
    details: [
      "The information of October 21 said the opposite: that the session records, after “Later”, that the window no longer needs to be suggested. In fact, the mark is set at login and cleared at your first answer (“Later”, closing the window or its button to “My profile”, “Don't show again” — which clears it on all your sessions —, or verification, whether it succeeds or is refused because your Discord tag can no longer be verified from this window), or as soon as there is nothing left to suggest. An answer that doesn't reach the site, or that it refuses because another account has logged in since in that browser or your account can't be found, doesn't clear it: the window may come back at the next page load.",
      "This mark contains nothing else, goes with the session and isn't included in the export of your data. Nothing else changes: “Don't show again” is still kept on your account, with its date.",
    ],
  },
  "2026-10-battletag-des-matchs-overwatch-seulement": {
    title: "BattleTag in matches: Overwatch only",
    linkLabels: ["Read the “Data collected” section", "Read the “Assigned referee of a match” paragraph"],
    summary:
      "In a Marvel Rivals tournament, no BattleTag is presented any more in a match's windows or on its page — neither the teams' contacts', nor the casters', nor the assigned referee's: players don't invite each other by BattleTag there. In Overwatch, nothing changes.",
    details: [
      "Marvel Rivals: the match's “Contacts” window, its launch window and the match page no longer show the BattleTag of the teams' contacts, of a caster or of the assigned referee, nor whether it is verified, and the site no longer sends it to these windows at all. A caster keeps their certified Discord tag there, the assigned referee their username; the match page no longer shows the “To invite” instruction there.",
      "A team now presents only one contact there, chosen on the certified Discord tag alone: a verified BattleTag no longer moves a player up nor brings in a second member. A team none of whose members has certified their Discord tag is presented by one member's username and team role (captain, manager, owner, then a player), with no other identifier.",
    ],
  },
  "2026-10-opposition-arbitre-retrait-des-matchs": {
    title: "A referee's objection: removal from their ongoing matches",
    linkLabels: ["Read the “Assigned referee of a match” paragraph"],
    summary:
      "When the staff upholds a referee's objection to being presented to the parties to their matches, that referee is now removed from all their unfinished matches and can no longer referee — neither take a match nor be assigned one — until it is lifted. Until now, the matches they already held stayed theirs.",
    details: [
      "If you referee: once upheld, your objection (report form, GDPR category) removes you from all your unfinished matches, launched ones included — you are notified by push notification, match by match — and the staff assigns another referee; your finished matches keep their referee. You can no longer take a match nor be assigned one until the staff lifts it, which it only does at your request (same form); it still stands once version 7 of the terms is accepted.",
      "The date your objection was upheld is kept on your account until it is lifted or the account is deleted, and is included in your data export. The staff log on Discord notes the action and its lifting without naming anyone or the matches removed; the staff member who took it, your account identifier and the number of matches removed only appear in the server logs.",
      "If you play or cast a match: its referee may thus change before or during the match; the new referee is presented to you like the previous one.",
    ],
  },
  "2026-10-pseudo-arbitre-aux-membres": {
    title: "A match referee's username can be read by all signed-in members",
    linkLabels: ["Read the “Assigned referee of a match” paragraph"],
    summary:
      "On the card and page of a match, until its score is reported or the tournament ends, any signed-in member now reads its assigned referee's username instead of “Referee assigned”. Visitors without an account and the public follow page still read “Referee assigned”. The referee's “Ready” can now only be read by the parties to the match and the referees.",
    details: [
      "If you referee: your username alone — never your BattleTag nor your Discord tag — can be read by any signed-in member on the card and page of the matches you referee, until their score is reported or the tournament ends. This display falls under legitimate interest (members knowing who referees a match): you may object to it through the report form (GDPR category), with the same effect as an objection to being presented to the parties — once upheld, it removes you from your unfinished matches.",
      "Your referee “Ready” is no longer sent to the whole audience of the tournament: only the parties to the match and the referees read it, in the “Contacts” and launch windows. The staff log on Discord still names no one.",
    ],
  },
  "2026-10-roles-de-plateforme-journal-du-staff": {
    title: "Platform roles: noted in the staff log",
    linkLabels: ["Read entry T05 of the register"],
    summary:
      "When an administrator grants or removes a platform role (administrator, referee, caster, community manager, recruiter) — including on their own account, from “My profile” — the action is now noted in the staff log, without naming anyone on Discord.",
    details: [
      "On Discord, the private staff log only says that an account's roles were changed by the staff: neither your username, nor the administrator's, nor the roles.",
      "In the server logs, the line keeps the username and identifier of the administrator who did it, the identifier of the account concerned and the roles saved, according to their automatic rotation.",
      "An administrator can now set their own roles from “My profile”, but never remove their own administration there: only another administrator can.",
    ],
  },
  "2026-10-battletag-tape-garde-non-verifie": {
    title: "Typed BattleTag: kept, never “verified”",
    linkLabels: ["Read “Data collected”"],
    summary:
      "When you link Battle.net or sign in with it and Blizzard gives no BattleTag, the one you had typed in by hand stays on your profile, but is no longer treated as verified: no “verified” badge, no certified contact for your team, and not enough identity to cast or referee a match. Before, it passed as verified without Blizzard confirming it.",
    details: [
      "When Blizzard gives a BattleTag, it always replaces yours, and only that one is verified.",
      "A typed BattleTag can still be changed from “My profile”, even with Battle.net linked.",
      "If your Battle.net was already linked with a BattleTag, the rule applies at your next Battle.net sign-in: until then, your BattleTag keeps its current state.",
    ],
  },
  "2026-10-conditions-v8-arbitre-et-battletag": {
    linkLabels: ["Read the “Match contacts” section", "Read the “Content published by users” section"],
    title: "Terms of use: version 8 (assigned referee, typed BattleTag)",
    summary:
      "The terms of use move to version 8: they now say that any signed-in member reads the username of a match's assigned referee, that refereeing requires a BattleTag taken from a linked Battle.net account, and that a hand-typed BattleTag is kept without being treated as verified. It must be accepted: a window presents it to you until you have accepted it.",
    details: [
      "Assigned referee: their username alone — never their BattleTag or Discord tag — is read by any signed-in member on the match card and page, until its score is reported or the tournament ends, under legitimate interest (knowing who referees); they may object to it through the report form (GDPR category). Visitors without an account still read “Referee assigned”. To referee, you need the refereeing permission, a certified Discord tag and a BattleTag taken from a linked Battle.net account: a hand-typed BattleTag is not enough.",
      "BattleTag: when Battle.net gives none, the one you typed in by hand stays on your profile, and can be changed or erased from “My profile”, without being treated as verified; a BattleTag received from Battle.net can still only be erased once Battle.net is unlinked.",
      "Privacy policy: it also states, without changing anything the site does, that each registered caster gets a push notice when the match they cast starts, that the staff who manage tournaments read in a match's “Refereeing” window the username of its referee and of the accounts that can referee, that a caster's certified Discord tag can also be read in the match's launch window, by both its teams, its other casters and its assigned referee while the match is being played, and that the push notice of a refereeing removal falls under your consent to push notifications.",
      "Terms of use: version 8, in force since 31 October 2026, says so in its “Match contacts” and “Content published by users” sections. A window presents it to you until you have accepted it: accepting it lets you keep using the site.",
    ],
  },
  "2026-10-suppression-compte-et-export": {
    linkLabels: ["Read the “Match streaming” paragraph"],
    title: "Account deletion and export: directory, #live message, casts and refereeing",
    summary:
      "The player directory no longer shows a deleted account's identifier or creation date, deleting a caster's account removes their channel link from the #live message of an evening still under way that keeps another link, and the export of your data now gives your casts, the channel links you provided, your refereeing and the origin of your BattleTag.",
    details: [
      "Player directory: a deleted account keeps its stand-in username, its team and its record there, but no longer its identifier or creation date; its card no longer opens a page, and the “Newest” sort puts it at the end of the list.",
      "Evening #live message: when a caster's account is deleted, the message of an evening still under way is updated without their channel link if it keeps another link; otherwise, or once the evening has ended, it keeps it, and the caster concerned can, like the team or player, ask for its deletion through the report form (GDPR category).",
      "Export of your data: it also gives your caster registrations (with your “Ready”), the channel links you provided on a match, the matches you are the assigned referee of (with your “Ready”) and whether your BattleTag comes from Battle.net or was typed in by hand.",
    ],
  },
  "2026-10-lien-organisation-choix-explicite": {
    linkLabels: ["Read the “Match streaming” paragraph"],
    title: "Streaming: the organizers' link is chosen, no longer inferred",
    summary:
      "A member of the organizers who sets up a match's broadcast now states, with a checkbox, whether the link they set is the organizers' or their own channel, instead of the site inferring it from what they cast: only their own channel goes with their account.",
    details: [
      "What changes: in a match's broadcast window, a member of the organizers (permission to manage tournaments) ticks “This link is the organisation's” — unticked by default — to say the link is the organisation's, or leaves it unticked if it is their own channel. Ticked, the link stays with the match whatever happens to their account, even if they cast that match; unticked, it is attached to them and goes when their account is deleted, played matches included, like a caster's. An account without that permission always sets its own channel.",
      "What does not change: a link already saved keeps its author at the time; saving the same link again does not change its author; the link a caster opens separately and a link set before the site recorded who provided it are handled as before.",
    ],
  },
  "2026-11-page-du-match-infos-de-connexion": {
    linkLabels: ["Read the “Assigned referee of a match” paragraph"],
    title: "Match page: connection info and the referee's Discord tag",
    summary:
      "A match's page now shows its parties alone — players of both teams, casters, assigned referee — both teams' contacts, like the “Contacts” window, and the assigned referee's certified Discord tag, so they can be reached.",
    details: [
      "Connection info: each team's presented contacts (certified Discord tag and, in Overwatch, BattleTag, even when hidden, with the team role) also appear on the match page, at the same times as in the “Contacts” window — as soon as both opponents are known if you play or referee that match (or if, as a site referee, you cast it), while the match is being played if you cast —, and only to the parties to the match: not to other members, visitors, or referees with no role in that match (who keep the “Contacts” window).",
      "Assigned referee: their certified Discord tag is now presented, in the “Contacts” window and on the match page, to both its teams and its casters, at the same times as their BattleTag — never in the launch window nor to referees with no role in that match; if they also cast the match, their tag and BattleTag follow the casters' rule: its parties read them only while the match is being played, launch window included, the other referees from the moment both its opponents are known. As the terms of use do not provide for it, this falls under legitimate interest (the parties being able to reach their referee): the referee may object to it through the report form (GDPR category), with the same effect as an objection to being presented to the parties (removal from their unfinished matches).",
      "What does not change: nothing new is collected, and none of this enters what the site broadcasts to every viewer of a tournament.",
    ],
  },
  "2026-11-salons-vocaux-equipe": {
    linkLabels: ["Read the “Team voice channels” paragraph"],
    title: "Team voice channels before matches",
    summary:
      "A tournament can now open, from fifteen minutes before each match, a 5-seat Discord voice channel per team, and only launch the match once both channels are full: the bot counts the people present, and the site keeps the channel, its number and its times, never who.",
    details: [
      "What changes: in a tournament with the “Team voice channels” option (off by default), the association's bot creates a voice channel named after each team of a match, from 15 minutes before its time — never for a solo entry nor for a match against a ghost team. The match waits until both channels are full (referees can force it; if the bot doesn't answer, it doesn't wait), and its page shows “Voice channel: 3/5” to its teams, its casters and staff (any signed-in member can also read that number; a visitor without an account only sees whether the match is waiting for its channels).",
      "What is processed: to count, the bot holds in memory at all times (option on or not), without ever recording it, the voice state (Discord identifier of the member and of their voice session, channel they are in, microphone or sound muted by them or by moderation, screen sharing or camera on, request to speak and stage suppression), with the member profile Discord attaches to it, of the members of the association's Discord server, and keeps for each channel a record with no name (identifier, numbers of the match and team, times); the site only receives and keeps the channel's identifier, the numbers of the match and team, that number and the times of the count (or of a bot outage), of creation and of hand-back, erased a week after the channel was handed back (match finished, score confirmed, cancelled, back to waiting or taken off the schedule, team out of the pairing, tournament ended or option turned off). The bot deletes the channel as soon as it empties once handed back, within 24 and a half hours at the latest (while the bot is running, unless Discord prevents it: it retries at every sweep). This rests on legitimate interest (smooth running of tournaments); joining a channel remains a choice, but until both are full, the match waits for referees to force its launch. You can object to this processing (section “Your rights” of the privacy page).",
    ],
  },
  "2026-11-suppression-inscription-solo-et-fiche": {
    linkLabels: ["Read what deletion removes"],
    title: "Account deletion: upcoming solo registrations and the player page",
    summary:
      "If nothing else keeps it, deleting your account now erases it entirely even if you're registered for a solo tournament that hasn't started yet: the registration is withdrawn with it. And a deleted account's page only stays visible if it played at least one match.",
    details: [
      "Solo registrations: a registration for a solo tournament that hasn't started yet, where you played no match, no longer keeps your account under a borrowed username — if nothing else keeps it (a match played, a team owned, a tournament organized, an entry in a solo tournament that has already started or ended), it is erased entirely and the registration withdrawn from the tournament; otherwise, the registration stays, under a borrowed username. Once the tournament has started or ended, the entrant stays, under a borrowed username, as before.",
      "Player page: a deleted account's page, under its borrowed username, is now kept only if it played at least one match (its statistics also belong to its opponents); otherwise the page is not found, and its name is shown without a link.",
      "What doesn't change: nothing new is collected; the traces left after any deletion (including encrypted backups, deletion log, connection data, audience measurement) are the same.",
    ],
  },
  "2026-11-invitations-equipe-notifiees": {
    linkLabels: ["Read the “Push notifications” section"],
    title: "Team invitations announced by push and on Discord",
    summary:
      "When a team invites you, when the staff offers you to take over a ghost team, or when the ownership of your team is transferred to you, the site now lets you know by push notification and by a direct message from the Discord bot.",
    details: [
      `What changes: the push notification (topic “Team invitations”, which you can turn off from My profile) and the Discord direct message (if you linked your Discord account or verified your tag) only name the team — never who invites you, offers you the takeover or transfers the team to you — and lead to My profile, where the invitation is accepted or declined, or to the team's page. For an ordinary invitation, the same team only gets the same player notified once every ${TEAM_INVITE_NOTICE_COOLDOWN_HOURS} hours, a team or the same person gets ${TEAM_INVITE_NOTICES_DAILY_CAP} players notified at most within that time, and a player only gets the invitation of ${TEAM_INVITE_NOTICES_PER_PLAYER_CAP} teams at most within that time; a takeover offered by the staff is only announced once per team and per player within that time; a transferred ownership is announced at each transfer; the invitation itself is always recorded.`,
      "What doesn't change: nothing new is collected or kept; nothing is sent to a suspended or deleted account, nor to the author of the action. The direct message falls under organizing competitions (legitimate interest, register T03), which you can object to (section “Your rights” of the privacy page); the push notification, under your consent (register T12).",
    ],
  },
  "2026-11-battlenet-requis-overwatch-seulement": {
    linkLabels: ["Read the requirements for casting a match", "Read the “Assigned referee of a match” paragraph"],
    title: "Casting or refereeing: Battle.net required in Overwatch only",
    summary:
      "To cast or referee a Marvel Rivals match, a linked Battle.net account is no longer required: the certified Discord tag is enough, together with the streaming or refereeing permission. For an Overwatch match, nothing changes.",
    details: [
      "What changes: for a Marvel Rivals match, the site no longer checks that your Battle.net account is linked nor that your BattleTag comes from it; it no longer takes it into account for these matches. For an Overwatch match, the requirement stays: a certified Discord tag and a BattleTag taken from a linked Battle.net account. The terms of use, which ask only referees for Battle.net, will say so in their next version.",
      "What doesn't change: nothing new is collected or kept, and a caster or referee is presented to the parties to their match as before; only a staff member without Battle.net, who could not cast or referee a Marvel Rivals match, can now do so and be presented in it (username and certified Discord tag).",
    ],
  },
  "2026-11-tag-discord-arbitre-execution-du-service": {
    linkLabels: ["Read the “Assigned referee of a match” paragraph"],
    title: "Assigned referee: the basis for presenting your Discord tag",
    summary:
      "If you referee a match, presenting your certified Discord tag to both its teams and its casters now rests, once version 7 of the terms or a later one is accepted, on performance of the service, no longer on legitimate interest: without it, the parties to the match cannot reach you.",
    details: [
      "What changes: the legal basis of this presentation, deemed strictly necessary for the minimum functioning of the service, once version 7 of the terms or a later one is accepted (before that acceptance, legitimate interest, with the same right to object); once that version is accepted, it has no objection of its own.",
      "What doesn't change: nothing new is collected or shown, to the same people at the same times; your referee objection (report form, GDPR category) — to your presentation before version 7, or to the display of your username to members —, once upheld, still removes you from your unfinished matches, this tag included.",
    ],
  },
  "2026-11-tag-discord-arbitre-version-9": {
    linkLabels: ["Read the “Assigned referee of a match” paragraph"],
    title: "Assigned referee: your Discord tag's basis follows version 9",
    summary:
      "If you referee a match, presenting your certified Discord tag to both its teams and its casters now rests, once version 9 of the terms or a later one is accepted, on performance of the service, no longer on legitimate interest: without it, the parties to the match cannot reach you.",
    details: [
      "What changes: the legal basis of this presentation, deemed strictly necessary for the minimum functioning of the service, once version 9 of the terms or a later one is accepted — not version 7, as the notice of 5 November 2026 said (before that acceptance, legitimate interest, with the same right to object); once that version is accepted, it has no objection of its own.",
      "What doesn't change: nothing new is collected or shown, to the same people at the same times; your referee objection (report form, GDPR category) — to your presentation before version 7 (before version 9 for this tag), or to the display of your username to members —, once upheld, still removes you from your unfinished matches, this tag included.",
    ],
  },
  "2026-11-conditions-v9-contacts-et-suppression": {
    linkLabels: ["Read the “Match contacts” section", "Read the “Account” section"],
    title: "Terms of use: version 9 (match contacts, voice channels, account deletion)",
    summary:
      "The terms of use move to version 9: they now say what a match page shows to its parties, that Battle.net is only required from the referee of an Overwatch match, what team voice channels are, and what deleting an account carries off. It must be accepted: a window presents it to you until you have accepted it.",
    details: [
      "Match contacts: the match page shows, to the parties to the match alone (members of both its teams, its casters, its assigned referee), both teams' contacts and the assigned referee's certified Discord tag, at the same times as the “Contacts” window — this sharing being strictly necessary for the minimum functioning of the service; the launch window never shows the assigned referee's Discord tag, unless they also cast the match, and the other referees read these contacts in the “Contacts” window only. The BattleTag is only presented in an Overwatch tournament, and refereeing a match only requires a BattleTag taken from a linked Battle.net account for an Overwatch match.",
      "Team voice channels: in a tournament with the option, the bot opens a voice channel for each team before its matches; the match's launch does not depend on it and no one is counted in it (the match page only says whether each channel is open); these channels rest on the association's legitimate interest (smooth running of tournaments).",
      "Account deletion: it only becomes final after 30 days, during which signing in again lets you reactivate the account (through an explicit confirmation; a suspended account can be reactivated too, and comes back suspended); as soon as it is requested, the account is shown as anonymous everywhere (borrowed username, no avatar or player page, in results, rankings, rosters and tournament pages) — reactivation gives it back its username and avatar, which no one else can take in the meantime (if taken all the same, the username comes back, shortened if needed, followed by “OG” — or “OG2”, “OG3”… up to “OG10” if those are taken too, failing that the borrowed username —, to change in the profile) —, the account leaves its teams (ownership handed to a co-owner, a manager, a captain or another member; ghost or disbanded team if it was its only player), its organised tournaments go to another staff member when someone can take them over, its registrations for a solo tournament that hasn't started yet are withdrawn, its casts of matches not yet completed, its referee assignments and its pending team invitations and join requests are withdrawn and its remaining matches in a running solo tournament where it never played are lost by forfeit — which reactivation does not undo.",
      "On the data side: during the 30 days, the real username and the avatar are kept apart, for reactivation only, then erased; the request is recorded in the off-database log that replays deletions after a backup is restored (account identifier and creation date, date of the request), and replaced in that log, on reactivation, by a line carrying the date of the reactivation and that of the undone request (so that a restored backup does not bring the account back as pending deletion); signing in to an account pending deletion creates a 15-minute reactivation ticket (account, sign-in method, expiry and token hash) and the strictly necessary cookie that carries it (`__Host-bg_reactivation`); when an account is erased, the hash (SHA-256) of an avatar removed by moderation is kept, with no link to any account, to refuse it being uploaded again; the staff log on Discord records requested deletions and their reactivations, as well as the withdrawals or forfeits they cause, in one line per tournament for those, without naming the player (“a player”).",
      "Correction: the private message announcing version 6 of the terms of use said “No consent is asked of you”, whereas the terms themselves do need your agreement: the acceptance window collects it, and it presents version 9 to you until you have accepted it.",
      "Terms of use: version 9, in force since 6 November 2026, says so in its “Account” and “Match contacts” sections. A window presents it to you until you have accepted it: accepting it lets you keep using the site.",
    ],
  },
  "2026-11-salons-vocaux-sans-comptage": {
    linkLabels: ["Read the “Team voice channels” paragraph"],
    title: "Team voice channels: no more counting, no more waiting",
    summary:
      "Team voice channels no longer hold a match's launch, and the bot no longer counts the people present: for each channel, the site only keeps its identifier and its times — neither who is in it nor how many.",
    details: [
      `What changes: a match with channels launches as in any other tournament, whether they are full or not; its page only says whether each channel is open. The number of people present is no longer requested from the bot, and the one already kept is erased with its column (apart from the encrypted backup copies, ${BACKUP_RETENTION_DAYS} days at most). Channels are now also opened for a match already launched or whose score awaits confirmation. The channel is now also handed back when a solo entry or a ghost team enters the match, when the tournament is hidden again or moved back before its start, or when the match is left without a confirmed score ${VOICE_CHANNEL_LATE_HOURS} hours after its time; while it is open and from ${VOICE_CHANNEL_LEAD_MINUTES} minutes before the match time, the site asks the bot for it again, under the team's name, about once a minute, to reopen one if it was deleted.`,
      "What stays: to know whether a channel is empty and delete it, the bot still holds in memory, without recording it, the voice state of the members of the association's Discord server; nothing new is collected. It still rests on legitimate interest (smooth running of tournaments).",
    ],
  },
  "2026-11-check-in-du-match": {
    linkLabels: ["Read the “Match Discord direct messages” paragraph"],
    title: "Match check-in: one message, 15 minutes before, to every member of the entrants",
    summary:
      "The lobby settings message becomes the “match check-in”: it is now sent 15 minutes before kickoff, and to every member of both entrants — no longer only to those who manage a team.",
    details: [
      "What changes: when it is sent (15 minutes before kickoff, instead of when the lobby opens — unless the lobby opens earlier, and for a match with no time, which keep the lobby opening) and who receives it (every member of both entrants — players, coaches and managers included —, no longer only their owners and managers). The message also tells you to join your team's voice channel and the check-in channel, and gives the game settings, the map order, the match's stream link when it is public, the reminder to enter the scores and who to report a problem to.",
      "What does not change: it still contains no BattleTag, no Discord tag and no player username (in a solo tournament, it says “you” and “your opponent”); the direct message only goes to a certified Discord tag and is turned off, like the other match messages, with the “Discord direct messages about my matches” box in “My profile”; the push notification topic, “Lobby settings”, becomes “Match check-in”: on by default on a subscribed device, it is turned off in “My profile”.",
    ],
  },
  "2026-11-battletag-de-cast": {
    linkLabels: ["Read the “Match streaming” paragraph"],
    title: "A BattleTag of its own for a cast",
    summary:
      "If you cast a match, you can give a BattleTag of its own for that cast, when signing up or in “Configure my broadcast”: that one, and not your profile's, is shown to the parties of the match and to the referees. Left empty, nothing changes. Opening your own stream now requires your channel link.",
    details: [
      "What the site keeps: the BattleTag you type for that cast, with your caster registration on that match; it goes with it (leaving the cast, deleting your account) and is never copied onto your profile; it appears in the export of your data, with that registration.",
      "Who it is shown to, and when: exactly as your profile BattleTag was — in the “Contacts” and launch windows and on the match page, to the members of both its teams and its other casters only while the match is being played, to its designated referee and to the referees (“tournaments” permission) as soon as both its opponents are known, in an Overwatch tournament only, as part of the performance of the service. Nobody verifies it: it is never presented as a proven BattleTag, and the “OW BattleTag” setting of your profile does not hide it — you are the one giving it, for this match.",
      "Your channel link becomes required to open your own stream on a match (it was optional): it is published with the match, as before, and goes as before (“Match streaming” paragraph). Joining an existing stream does not require one.",
      "A member of the organizers who casts can also state, when opening their own stream or in “Configure my broadcast”, that their link is the organizers' one: that link then does not go with their account, but with that stream once no caster holds it any more.",
    ],
  },
  "2026-11-check-in-aux-gerants": {
    linkLabels: ["Read the “Match Discord direct messages” paragraph"],
    title: "Match check-in: self-managed matches only, to those who manage the team",
    summary:
      "The match check-in is now only sent for a self-managed match, and only to the owner and managers of each team (or the player of a solo tournament), once per match.",
    details: [
      "What changes for the check-in: a refereed match or one with no refereeing decision no longer receives one; a team's players and coaches no longer receive it, only its owner and managers. It is sent only once per match and per entrant: neither a change of time, nor a cancelled launch, nor a re-pairing sends it again. The site keeps the record of that sending (the match, its place in the tournament and the entrant) with the tournament: even a rollback that erases and recreates the match does not send it again; the record goes with the tournament or the entrant.",
      "What does not change: the content of the check-in (no BattleTag, Discord tag or player username), the direct message reserved for a certified Discord tag, and the “Discord direct messages about my matches” box in “My profile” to object to it.",
    ],
  },
  "2026-11-annonce-nouveau-match": {
    linkLabels: ["Read the “Match Discord direct messages” paragraph", "Read the “Push notifications” section"],
    title: "Notice of a new match",
    summary:
      "As soon as both opponents of one of your matches are known, first round included, you are told: the opposing team, the time if it is set and the link to the match page, by Discord direct message and push notification.",
    details: [
      "Who is told: all members of both teams (or the player of a solo tournament, without the message naming their opponent) — nobody for a ghost team, and nothing for a match where a team is dissolved —, once per match and pairing, as soon as both opponents are known, first round included; if the time is already set, the announcement gives it and “Match scheduled” is not sent as well. No username, BattleTag or Discord tag appears in it, only team names.",
      "Push notifications: this new topic, “New match”, is on by default on devices already subscribed, like every topic; you can turn it off in “My profile” — a time already set at pairing is only sent with it, and only the reminders give it again then. Discord direct message: only if your tag is certified, on the basis of legitimate interest (smooth running of tournaments); the “Discord direct messages about my matches” box in “My profile” turns it off with the others.",
      "What the site keeps, with the tournament and erased with it or with either entrant once deleted (a dissolved team stays in the tournament, and the record with it): for each announced match, its place in the tournament, the numbers of both entrants, the announced time and the date of the record — or the mark that it was not announced (match already paired when the feature went live, team dissolved, sending failed three times) —, so it is announced only once per pairing; in a solo tournament, an entry's number leads to its player, who can no longer be recognised through it once their account is anonymised. Nothing new is collected about your account.",
      "The register also states what the site already kept without saying so: the records of match starts sent (match, pairing and phase of the notice, with their date), kept with the match.",
    ],
  },
  "2026-11-lien-de-l-organisation-hors-du-cast": {
    linkLabels: ["Read the “Match streaming” paragraph"],
    title: "The organizers' link is no longer stated while casting",
    summary:
      "When opening your own stream or in “Configure my broadcast”, you can no longer say your link is the organizers': it is always yours, and goes with your account if it is deleted.",
    details: [
      "Only the match's live configuration (organizers' staff, assigned referee) still states whether a link is the organizers'; what it keeps does not change.",
      "A link a caster had called the organizers' before this change keeps that status: it does not go with their account, but with that stream once no caster holds it any more.",
    ],
  },
  "2026-11-mode-d-antenne-et-arbitre": {
    linkLabels: ["Read the “Match streaming” paragraph"],
    title: "Live mode: kept for whoever set it, and the assigned referee sets up the broadcast",
    summary:
      "A match's live mode can now only be changed by the caster who set it, the match's assigned referee or an administrator. The assigned referee can also edit the links of their match's casters and configure the organizers' broadcast.",
    details: [
      "What the site keeps: the account of the caster who set the live mode, with the match; it is erased when that caster leaves the match or no longer meets the conditions to cast it, when the mode is removed, or when their account is deleted — the assigned referee or an administrator who changes the mode leaves it with them —, and it appears in the export of your data.",
      "Who sets what: a mode set by the staff stays with the staff; a co-caster can no longer change someone else's. The assigned referee of a match, for that match only, sees and edits its casters' links and the configuration of the organizers' broadcast — the referee of another match cannot.",
    ],
  },
  "2026-11-empreinte-avatar-supprime": {
    linkLabels: ["Read the “Reports” section", "Read the “Account deletion” paragraph"],
    title: "Avatar deleted by moderation: its hash is kept from the deletion",
    summary:
      "The hash of an avatar that moderation deletes is now kept from that deletion, and no longer when the account is erased, to refuse it being uploaded again. An avatar that is only hidden no longer leaves any as long as it is not deleted.",
    details: [
      "What the site keeps: the hash (SHA-256) of the image, without time limit, in a list of blocked images that designates no account and only dates a block to the day, when moderation deletes an avatar — immediately, on a report or from the player's page, by the staff after a hiding (challenge rejected, or before the deadline), or automatically at the end of a hiding without a challenge —, whether the account is active or pending deletion. It only serves to refuse the same image being uploaded again, as an avatar or as a team logo; when deleted immediately, its file is only erased if nothing else on the site points to it.",
      "As long as the account exists (anonymized included), the hash is also kept on the deletion decision taken on a report or after a hiding, with the outcome of its challenge, which moderation records there: upheld, the block stays; accepted, it is lifted, unless another deletion of the same image still justifies it. When the account is erased, those decisions are erased and the block becomes permanent: only the hash remains, with no link to any account. An automatic deletion made while its challenge was still awaiting its outcome only blocks the image once upheld, or on the erasure of the account if that comes first, then permanently.",
      "When an account is erased, only the hash of an avatar moderation had already deleted is taken or kept; an avatar that is only hidden leaves with the account, without leaving a hash, like an avatar moderation never deleted — on the deletion request, on anonymization or on erasure. A deleted team logo leaves no hash either.",
      "During the 30 days of a requested deletion, moderation can hide, restore or delete the avatar set aside for reactivation, like that of an active account; once hidden or deleted, it is not given back on reactivation.",
      "Hashes set on the erasure of an account before November 11, 2026 — then also those of an avatar that was only hidden — stay blocked, dated to the day they were set, which may be that of the erasure: any hash set before that date is brought back to the day.",
    ],
  },
  "2026-11-conditions-v10-avatar-et-succession": {
    linkLabels: ["Read the “Account” section", "Read the “Reporting and moderation” section", "Read the “Match streaming” section", "Read the “Match contacts” section"],
    title: "Terms of use: version 10 (deleted avatar, team takeover, #live announcement, voice channels)",
    summary:
      "The terms of use move to version 10: they now say that only an avatar deleted by moderation stays blocked, and how an accepted challenge lifts that block, that a suspended player only takes over a team after all the others, when the #live announcement comes before a match, and what the bot reads of team voice channels and who can clear them. It must be accepted: a window presents it to you until you have accepted it.",
    details: [
      "Reporting and moderation: when moderation deletes an avatar, the hash of the image is kept to refuse it being uploaded again, as an avatar or as a team logo, including after the account is deleted; an avatar that is only hidden is not blocked. Deleted automatically at the end of a hiding while its challenge is still awaiting its outcome, it is only blocked once the deletion is upheld, or on the erasure of the account if that comes first. The outcome of a challenge is kept with the decision: upheld, the block stays; accepted after a deletion decided on a report or after a hiding, it is lifted, unless another deletion of the same image still justifies it or the account has been erased in the meantime.",
      "Account: during the 30 days of a requested deletion, moderation can hide, restore or delete the avatar set aside, which is only given back on reactivation if it is then neither hidden nor deleted; a suspended player only takes over a team after all the others; at the end of that time, only an avatar that moderation has deleted can no longer be uploaded again — an avatar that is only hidden, or that moderation never deleted, leaves without its hash being kept.",
      "Match streaming: the evening's #live message only lists a match before it starts if its stream is due to open at its start time that evening; the others only appear in it when they go on air.",
      "Match contacts: the team voice channels passage now says what the bot reads of the server's voice state, without recording it, and who can clear a channel — the referees, or the team for its own channel (details in the “Team voice channels” announcements of the same day).",
      "Terms of use: version 10, in force since 11 November 2026, says so in its “Account”, “Reporting and moderation”, “Match streaming” and “Match contacts” sections. A window presents it to you until you have accepted it: accepting it lets you keep using the site.",
    ],
  },
  "2026-11-salons-vocaux-vidage-et-report": {
    linkLabels: ["Read the “Team voice channels” paragraph"],
    title: "Team voice channels: clearing by the referees, rescheduled match",
    summary:
      "Referees can now clear a team's voice channel, which is open to whoever sees the match category; a rescheduled match hands its channels back, reopened before its new time. The site keeps neither who is in a channel nor how many, and the bot does not record it.",
    details: [
      "Clearing: a referee or an administrator who does not play the match can clear a team's open channel; the bot disconnects all its occupants, read from the voice state it already holds in memory, without keeping, logging or telling the site anything about them, and the channel stays open. The staff activity log on Discord notes it without naming its author; the server logs name that author (username and account number), with the match and the outcome, unless they are the match's assigned referee, never named. Discord's audit log keeps the disconnections (their number and the clearing's reason, as Discord records them).",
      `Rescheduled match: a match whose time moves back to more than ${VOICE_CHANNEL_LEAD_MINUTES} minutes away hands its channels back to the bot, which deletes them once empty; new channels open ${VOICE_CHANNEL_LEAD_MINUTES} minutes before its new time.`,
      `The site's record: it is no longer closed ${VOICE_BOT_UNRELEASED_MAX_HOURS} hours after the channel was created if the bot has not taken it back; without an answer from the bot that takes it back or says it no longer tracks it, the record stays: a refused hand-back is retried once an hour after that period, an unavailable bot as the site is used, at most about once a minute; the record is erased ${VOICE_ROW_RETENTION_DAYS} days after that answer. It still only holds match and team numbers, the channel's identifier and times (including that of an outage, and whether it hit the whole bot): no user data.`,
      "What stays: no player data is collected; it still rests on legitimate interest (smooth running of tournaments).",
    ],
  },
  "2026-11-mode-d-antenne-precisions": {
    linkLabels: ["Read the “Match streaming” paragraph"],
    title: "Live mode: who sets it, and when the caster's account is erased",
    summary:
      "Clarifications on a match's live mode: the staff who hold the refereeing and streaming permissions set it, administrators or not; a caster who changes a mode with no holder becomes its holder (unless the match carries the organisation's link); the account of the caster who holds it stays with the match after launch, even if they no longer meet the requirements to cast it.",
    details: [
      "Who sets it: where the announcement of November 6, 2026 said “an administrator”, it is any staff member who holds both the refereeing and the streaming permissions, administrator or not. With the match's assigned referee, they change or remove any caster's mode.",
      "A mode with no holder — set by someone who does not cast the match (staff, referee), or whose caster who held it has left or, before launch, no longer meets the requirements — does not stay with the staff: a caster of the match who changes it becomes its holder (unless the match carries the organisation's link: only those staff and the assigned referee change it then), and the site then keeps their account with the match, like that of the caster who set it. Only those staff and the assigned referee remove a mode with no holder; it also goes when the last caster leaves the match, or is removed from it by the staff, with no stream left.",
      "When that account is erased: when the caster leaves the match or is removed from it before it launches (casting requirements no longer met, or having become one of its players), when the mode is removed, or when their account is deleted. Before launch, a caster who no longer meets the requirements is no longer treated as the holder: the first change someone else makes to the mode erases their account (or replaces it with that of the caster who changes it). Once the match has launched, the caster stays registered and keeps the mode, even if they no longer meet the requirements: their account stays with the match, unlike what the announcement of November 6, 2026 said.",
      "What does not change: nothing new is collected; this account still appears in the export of your data.",
    ],
  },
  "2026-11-check-in-trace-precisions": {
    linkLabels: ["Read the “Match Discord direct messages” paragraph"],
    title: "Match check-in: its sending record and the voice instruction clarified",
    summary:
      "Clarifications on the match check-in: the record of its sending carries its date and also goes when the bracket is rebuilt, and the instruction to join your team's voice channel is only in it in a tournament with team voice channels.",
    details: [
      "What the site keeps: for each check-in sent, the match's place in the tournament (phase, bracket, round, number), the entrant and the date it was sent — not the match number, which the announcement of November 6, 2026 mentioned. This record goes with the tournament or the entrant, and also when the elimination bracket of the phase (or of the tournament) is rebuilt because the number of entrants changed: its new matches then receive their own check-in. A rollback, however, keeps it.",
      "Content: the instruction to join your team's voice channel is only in it in a tournament with the “Team voice channels” option, for a match that has a time, never in a solo tournament nor against a ghost team.",
      "What does not change: the recipients, the direct message reserved for a certified Discord tag, and the “Discord direct messages about my matches” box in “My profile” to object to it.",
    ],
  },
  "2026-11-salons-vocaux-vidage-par-l-equipe": {
    linkLabels: ["Read the “Team voice channels” paragraph"],
    title: "Team voice channels: clearing by the team",
    summary:
      "A team's owner, a manager or its captain can now clear their team's voice channel, like the referees. Nothing more is kept.",
    details: [
      "Clearing by the team: a team's owner, a manager or its captain can clear their own team's open channel, never the opponent's; the bot disconnects all its occupants, as for a clearing by the referees, and the channel stays open. The site only reads their team and roles to check it, without keeping anything: this clearing is noted neither in the server logs nor in the staff activity log on Discord. Discord's audit log keeps the disconnections, as for any clearing.",
      "What does not change: no player data is collected; clearing by the referees stays as it is; it still rests on legitimate interest (smooth running of tournaments).",
    ],
  },
  "2026-11-contacts-du-caster-arbitre-designe": {
    linkLabels: ["Read the “Match contacts” section", "Read the “Data collected” section"],
    title: "Caster contacts: read by the assigned referee before the match, even if they also cast",
    summary:
      "If you cast a match, its assigned referee sees your contacts as soon as both its opponents are known, now even when they cast the match themselves (they then only saw them while the match was being played). Both its teams and its other casters still only see them while the match is being played.",
    details: [
      "What changes: a match's assigned referee who also casts it used to read their co-casters' contacts only while the match was being played, like a caster; they now read them as a referee, in the match's “Contacts” window and on its page, from the moment both its opponents are known until its end. It's the same information as before: your certified Discord tag and, in an Overwatch tournament only, your BattleTag, even when hidden.",
      "Corrected wording: the privacy policy and the notices about the Discord tag (profile, login) said that a match's assigned referee only read its casters' certified Discord tag while the match was being played; they read it, like the referees who don't cast the match, as soon as both opponents are known. These texts now say so, and state that another referee who plays or casts the match only reads your contacts while the match is being played.",
      "What does not change: both teams and the other casters of the match only read your contacts while the match is being played; the launch window only shows contacts at the start of the match; nothing changes for players. As before, this reading is based on the performance of the service — running the tournament (terms of use, “Match contacts” section, with no new version to accept).",
    ],
  },
  "2026-11-rectificatifs-hebergement-courriel-push": {
    linkLabels: [READ_RECIPIENTS, "Read the “Push notifications” section"],
    title: "Hosting, the association's email and push notifications: clarifications",
    summary:
      "The site and the bot have no hosting service provider: the association's technical manager runs them on their own machine, with no processing agreement. The association's email is moving to Google Workspace. A new push notification topic is on by default on a device already subscribed.",
    details: [
      "Hosting: the register said that a processing agreement with the site's host had been drafted and was awaiting signature. There is no hosting service provider: the association's technical manager runs the site and the bot on their own machine, on the association's behalf; they are not a processor, and no processing agreement is required. Hetzner, which stores the encrypted backups in the European Union, acts as a processor under Hetzner's data processing agreement accepted by the association's technical manager — not as a “sub-processor, through the host”, since the host is not a processor. Nothing changes in what is collected or in who reads it.",
      "The association's email: its Gmail mailbox is moving to Google Workspace. Google remains the recipient of what you write there; the privacy policy and the register will state its framework once the move is done.",
      "Push notifications: a topic added after notifications were turned on on a device — such as “Team invitations and ownership” — is on by default there, like the others; you can turn it off in “My profile”, topic by topic, or turn off the device's notifications. The notification of a team invitation, takeover or ownership follows the same caps as the Discord direct message and only names the team.",
      "Other clarifications, with no change to the processing: the evening announcement in the #live channel only lists in advance the matches whose broadcast is set to open at their start time; a team's voice channel is also handed back to the bot when the match or the tournament is deleted, and a channel never handed back and occupied is only deleted once empty; the match page says whether a channel is open, opening soon or unavailable; the staff log on Discord also records round maps and ban rules being changed, without naming anyone.",
    ],
  },
  "2026-11-conditions-v11-diffusion-sous-le-pseudo": {
    linkLabels: [
      "Read the “Match streaming” section",
      "Read the “Account” section",
      "Read the “Match contacts” section",
      "Read the policy's “Match streaming” paragraph",
    ],
    title: "Terms of use: version 11 (matches streamed under your username, clarifications)",
    summary:
      "The terms of use move to version 11: being streamed and recorded under your username during a tournament match is now part of the tournament (performance of the service), and it is no longer possible to object to it and appear under a neutral name; what concerns the casters, the published stream links and the AutoMod alert of a #live announcement moves to the same basis, that alert no longer being deleted on request. They also clarify the takeover of a team when an account is deleted, the hand-typed BattleTag, the assigned referee and team voice channels. It must be accepted: a window presents it to you until you have accepted it.",
    details: [
      "Match streaming — what changes: until now, the live streaming and recording of a match (your username, your team's name, your in-game results and performance — never a webcam or voice chat) rested on the association's legitimate interest, and you could object to it and appear under a neutral name. They are now part of the tournament you take part in, under performance of the service, like the #live announcement of a solo tournament: not appearing in them means not taking part in the tournament. The notices shown when registering for a tournament, the privacy policy and the register (T16) say so.",
      "Casters, links and AutoMod alert: a caster's voice, username and channel link, their setting of how a match goes live, the stream and replay links published on the site, and the copy of a #live announcement blocked or flagged by AutoMod in the moderators' alert channel rested on legitimate interest, with a right to object; they now fall under performance of the service too, which the “Match streaming” section provides for. The alert is no longer deleted on request: when the player's account is deleted, the moderators delete by hand the alerts they can identify, with no guarantee that all are found. As soon as deletion is requested, the site tells the staff in its activity log on Discord, without naming the player: only the tournament, the day and a time of each #live evening of a solo tournament in which they may have appeared are given, to find those alerts.",
      `Match streaming — what stays: what appears on screen; the site still sends nothing to the streaming platforms; a #live announcement is still deleted on request (“${REPORT_FORM_NAME_EN}” button, GDPR category). Version 11 applies as soon as it goes online, with no transitional rule.`,
      `Account: when an account is deleted, a team's ownership goes to a co-owner, else a manager, else a captain, else another member of the team (not only a player: a coach, for example), a member whose own account deletion has been requested not being counted; the team becomes a ghost team or is disbanded when no other member is left. That is what the site already did: only the wording is corrected. Deleting an account is “requested” from the profile: it only becomes final after ${ACCOUNT_REACTIVATION_DAYS} days.`,
      "Content and match contacts: a BattleTag saved before the site recorded its origin, in late October 2026, on an account with Battle.net linked, is treated as received from Battle.net until the next Battle.net login, even if it had been typed. The assigned referee's certified Discord tag is only read by the other parties to the match (both its teams, its casters), never by referees who have no role in that match (unless the assigned referee also casts that match, their tag then following the casters' rule): the terms now say so in a sentence of its own, with no change to the processing.",
      `Team voice channels: only scheduled matches (those that have a set time) have channels; the bot deletes them once the site has handed them back and they are empty, at the latest about ${VOICE_BOT_RELEASED_MAX_HOURS} hours after that hand-back even when occupied, a channel never handed back being deleted as soon as it is empty once ${VOICE_BOT_UNRELEASED_MAX_HOURS} hours have passed since its creation or its reuse, and staying as long as it is occupied, and a Discord error possibly delaying a deletion without limit; the match page says whether each channel is open, opening soon or unavailable. Nothing changes in the processing: the terms now say it as the privacy policy does. Unlike what the entry “Team voice channels: no more counting, no more waiting” said, the site keeps, for each channel, its identifier, the match and team numbers, its times (creation, hand-back, bot outage or refused hand-back) and whether an outage hit the whole bot, as the terms, the policy and the register say.`,
      "Discord bot: its privacy policy now says, like our policy, that the caster concerned can, like the team or player, ask for a #live announcement to be deleted.",
      "Terms of use: version 11, in force since 13 November 2026, says so in its “Match streaming”, “Account”, “Content published by users” and “Match contacts” sections. A window presents it to you until you have accepted it: accepting it lets you keep using the site.",
    ],
  },
  "2026-11-reprise-d-equipe-et-fiche-de-membre-du-bot": {
    linkLabels: ["Read the “Team voice channels” paragraph", "Read processing activity T08 in the register"],
    title: "Team takeover and ownership, Discord bot: clarifications",
    summary:
      "The direct message and the notification of a ghost team takeover no longer say “an admin”: they only name the team. Takeover and ownership notices now have caps. The Discord bot holds in memory the profiles of its servers' members: its policy and the register now say so.",
    details: [
      `Takeover of a ghost team: the Discord direct message and the push notification no longer say “an admin”; as for an invitation, they only name the team, never anyone. They now have caps: within ${TEAM_INVITE_NOTICE_COOLDOWN_HOURS} hours, the same staff member only has ${TEAM_INVITE_NOTICES_DAILY_CAP} players notified at most, and a player is only notified of ${TEAM_INVITE_NOTICES_PER_PLAYER_CAP} takeovers at most; beyond that, the offer stays visible in “My profile”.`,
      `Team ownership transferred: contrary to what the entry “Team invitations announced by push and on Discord” said, it no longer notifies at every transfer, but once per team and per player every ${TEAM_INVITE_NOTICE_COOLDOWN_HOURS} hours (a restart of the site, or more than a thousand transfers within that time, may let one more through). The notification topic is now called “Team invitations and ownership”; turning it off only turns off the notification, not the Discord direct message.`,
      "Discord bot: to read the members of its servers (memberships, refereeing role, commands, delivery of the site's direct messages, finding the Discord account a code goes to), the bot holds in memory the member profile Discord sends it (username, nickname, avatar, roles, join and boost dates, timeout), kept up to date by Discord, never recorded, lost when it stops. This was already the case: its privacy policy and the register (T08) now say so.",
      "Team voice channels: the bot writes to the staff's private log channel technical messages about the channels (identifier of a channel and Discord's error when its deletion or tracking fails, sweep report or failure, missing-permission alert), without any player data, kept for one year. This was already the case: the policy and the register (T18) now say so.",
    ],
  },
  "2026-11-avis-d-equipe-plafonds-et-base": {
    linkLabels: ["Read the “Team Discord direct messages” paragraph", "Read processing activity T03 in the register", "Open the setting in “My profile”"],
    title: "Team messages on Discord: caps and legal basis",
    summary:
      "Team Discord direct messages (invitation, takeover, ownership, join request) are now described in the policy, with their basis: the association's legitimate interest in forming teams. Their caps change slightly: only a message actually sent counts towards the delay, a team you were a member of no longer counts towards the per-player cap, and the whole site has an hourly cap.",
    details: [
      `Delay: the same team still writes to you only once per kind of message every ${TEAM_INVITE_NOTICE_COOLDOWN_HOURS} hours, but only a message actually sent now counts — an invitation that stayed silent (suspended account, cap reached) no longer holds back the next one. This delay is counted in memory: a restart of the site, or more than a thousand messages within that time, may let one more through.`,
      `Former team: you still receive invitations from ${TEAM_INVITE_NOTICES_PER_PLAYER_CAP} teams at most within ${TEAM_INVITE_NOTICE_COOLDOWN_HOURS} hours, but a team you were a member of no longer counts. To know this, the site reads, at each invitation or takeover, whether you were part of the inviting team (the team history it already keeps).`,
      `Site cap: beyond ${TEAM_NOTICE_DMS_HOURLY_CAP} invitations, takeovers or ownerships announced by direct message within one hour, all accounts together, the notice is sent as a push notification only; the invitation stays in “My profile”.`,
      "Legal basis: these messages are based on the association's legitimate interest in forming teams (register, T03). This was already the case: the policy now says so, next to the match direct messages. To object, untick “Discord direct messages about my matches and teams” in “My profile”.",
    ],
  },
  "2026-11-messages-d-equipe-reglage-du-profil": {
    linkLabels: ["Open the setting in “My profile”", "Read the “Team Discord direct messages” paragraph"],
    title: "Team direct messages: a box to turn them off",
    summary:
      "The “Discord direct messages about my matches” box in “My profile” becomes “Discord direct messages about my matches and teams”: unticked, it also turns off team Discord direct messages (invitation, offered ghost team takeover, transferred ownership, request to join a team you manage).",
    details: [
      "What changes: before each team direct message, the site reads this choice again; with the box unticked, only the push notification is sent, with its own settings. If you had already unticked the box, your team direct messages stop too. Each team direct message now ends with the link to this setting.",
      "What does not change: nothing new is collected; it is the same choice, kept for the lifetime of the account (legal obligation: that is what lets the site keep honouring your objection) and included in the export of your data. These messages are still based on the association's legitimate interest in forming teams (register, T03).",
    ],
  },
  "2026-11-bot-avis-d-exclusion": {
    linkLabels: ["Read the bot's privacy policy", "Read processing activity T08 in the register"],
    title: "Discord bot: the notice sent to an excluded member",
    summary:
      "When a member excluded from the network posts an advertisement in a relayed channel, the bot copies the reason for their exclusion to them by direct message. This was already the case: the bot's policy and the register now say so, along with what the bot keeps; lifting the exclusion now also retries at once deleting up to ten replaced notices still queued.",
    details: [
      "What the bot does: at most once a day, it copies the reason for their exclusion to the excluded member by direct message; a new notice replaces the previous one, which the bot deletes if it can. It keeps the ID of that message and the time of the last attempt to send it.",
      "When the exclusion is lifted, the notice is deleted with the rest. If Discord is temporarily unreachable, the ID of the excluded member, that of the message and the time it was queued are kept to retry during the bot's clean-up (every night, and when it restarts or after a restore; a limited number of notices each time), for 30 days at most, even after the exclusion is lifted; new: when it is lifted, up to ten of those replaced notices still queued are also retried at once, the others during the next clean-up. If lifting fails (the bot's database unavailable), the current notice may be deleted during a clean-up while the exclusion still applies. A notice that Discord refuses to delete for good (conversation or access closed), or that is still there after those 30 days, is no longer retried: the bot forgets its ID and the notice remains in the excluded member's direct conversation with the bot, like a notice sent before the bot kept its ID. If the bot's database is unavailable just after sending, or Discord's reply is lost, a notice may also remain without the bot keeping its ID; the same goes, after the bot's database is restored from a backup, for a notice sent since that backup.",
    ],
  },
  "2026-11-marque-de-session-rectificatif": {
    title: "Discord tag verification suggestion: when the window comes back (and two other clarifications)",
    linkLabels: ["Read the “Data collected” section"],
    summary:
      "A clarification of the information of October 29, 2026: when the site doesn't receive your answer to the Discord tag verification window, or refuses it, your session's mark stays, and the window may come back as long as that session lasts — not only at the next page load. The only exception: a verification refused because your tag can no longer be verified, where the window answers “Later” by itself, which only clears the mark if the site receives it and does not refuse it. Two clarifications too on match contacts and the referee's “Ready”.",
    details: [
      "The information of October 29 only named two refusals (another account logged in since in that browser, or your account can't be found) and said the window could come back at the next page load. In fact, any answer that doesn't reach the site, or that it refuses (a site failure included), leaves the mark on your session — except, as it said, a verification refused because your Discord tag can no longer be verified from that window: the window then answers “Later” by itself, which clears it in turn if it reaches the site and is not refused there. The window may then come back as long as that session lasts; when the refusal is due to another account logged in since in that browser, there it only comes back on your account at a new login with Discord or Blizzard — each of your sessions has its own mark, which your other devices keep.",
      "Match contacts: a caster who is also a referee of the site reads the contacts of the teams of their match (certified Discord tag and, in an Overwatch tournament, BattleTag, even when hidden) in the match card's “Contacts” window and in the match page's “Connection info”, as soon as both its opponents are known, like the other referees — and not only while the match is played, like the other casters.",
      "The assigned referee's “Ready”: its record is also shown to the match's parties and the site's referees and admins on the match page, and not only in the “Contacts” and launch windows; the state of the launch, which is public, may also let one guess whether they are ready.",
      "Nothing else changes: the mark contains nothing else, goes with the session and isn't included in the export of your data; “Don't show again” is still kept on your account, with its date.",
    ],
  },
  "2026-11-suppression-du-compte-bons-passages": {
    linkLabels: ["Read when an account is erased completely", "Read what becomes of the player's page"],
    title: "Account deletion: links to the right sections of the privacy page",
    summary:
      "The information of November 4, 2026 on account deletion (upcoming solo registrations and the player's page) pointed to the note on connection data on the privacy page, not to the passages it announced. Here they are.",
    details: [
      "The first link leads to the note saying when an account is erased completely; the second, to the “Tournament history & achievements” passage, which says what becomes of a deleted account's page and its links.",
      "Nothing changes: neither what is collected nor what deletion removes; only the reference is corrected.",
    ],
  },
  "2026-11-decisions-sur-image-et-signalement": {
    linkLabels: ["Read the “Reports” section"],
    title: "Moderated logos and avatars: the decision goes with its report",
    summary:
      "The decision taken on a reported team logo or avatar (hiding, restoring or deleting) had no retention period of its own. Once the image is restored or deleted, it is now erased with the report that prompted it, at the end of that report's retention period.",
    details: [
      "What goes: the decision itself — the moderation member who took it, its dates, the outcome of its challenge and, for a deleted avatar, its hash (SHA-256). The report is only erased once the decision can no longer be contested (see the “Reports” section); erasing the account still removes its decisions earlier.",
      "For an avatar whose deletion blocked the image, the hash then only stays in the list of blocked images, with no link to any account, and the block becomes permanent, as on the erasure of the account.",
      "What does not change: nothing new is collected — the moderation member who took the decision was already recorded on it, and the record of processing activities (T11) now lists it; a logo or avatar still hidden keeps its decision for as long as it is hidden.",
    ],
  },
  "2026-11-pseudo-emprunt-suffixe": {
    linkLabels: ["Read what becomes of a deleted account"],
    title: "Deleted accounts: a borrowed username that can't be guessed",
    summary:
      "The borrowed username that replaces that of a deleted account is now a name followed by six random characters (for example “AlphaFX-7f3k2q”), no longer a bare name from a public list: it can no longer be guessed. Accounts already deleted get theirs, and the name of their solo registration follows.",
    details: [
      "What the form says: to anyone who knows it, that an account was deleted — as its page already said; nothing about the person.",
      "For a link to the vanished page of a deleted account to become text, the page submits the names it displays to the site, and the site only answers for the current name. Against anyone trying to guess which accounts are in that case, it keeps, in memory only and for 24 hours at most, a never-written fingerprint of the wrong names submitted for such an account; past four, the link stays, to the page not found, until the end of that period.",
      "What does not change: nothing more is collected about you, and what deletion removes stays the same.",
    ],
  },
  "2026-11-apercus-partage-codes-replay": {
    linkLabels: ["Read what the page without an account shows", "Read your rights, including objection"],
    title: "Shared links: a preview, and public replay codes",
    summary:
      "A “Share” button gives the public link of a tournament or a match, with a preview (image and text) under the link. The replay code of each map, until now reserved to logged-in members, is now public as soon as the referees record the map played or the result is retained, matches already played included.",
    details: [
      "A tournament's preview shows its name, game, format, state, dates, number of entrants and the leading or winning team, otherwise its description published by the organizers; a match's, the round, the teams' names and logos, the score or the forfeit and each map played with its name, score and replay code (the score of each map was already public on the page without an account).",
      "Never a player's username taken from their account in a preview: in a solo tournament, the entrants are “Player 1” and “Player 2”, with no avatar. An unpublished tournament has no preview.",
      "A replay code lets anyone watch the game again in game, where the in-game identifiers of the players present appear, including a BattleTag hidden on the site. It becomes public map by map, as soon as the referees record the map or the result is retained, even before the match ends; a pending score proposal stays with the match's two teams and the referees. Codes already recorded become public too: you can object to the publication of the code of a match you took part in (link “Read your rights”); the association examines the request and, if it accepts it, removes the code.",
      "The IP address of whoever reads the page without an account or a tournament's rules (/regles/…?tournoi=…), or causes a preview image to be rendered, signed in or not, preview services included (its /64 network in IPv6), is used to cap these reads and images, and to measure the server's load without a single network being able to skew it; it is kept in memory only, two minutes at most after its last request. /rgpd and its register so far only mentioned the visitor without an account of that page, for one minute, while the address stayed in memory longer: it is now erased within that time.",
      "The site's other caps per IP address, in memory only, are now described too (register, T17): two minutes at most after the last request for the home page data, the bot page and the browser's security reports; thirty-one minutes for a report without an account; sixteen for a Discord login code; and also as long as the bot page's live feed stays open.",
      "The service that displays the preview (Discord, X, a messaging app) keeps a copy of it under its own rules.",
      "What does not change: nothing new about you is written to the database or to a log, and what deletion removes stays the same.",
    ],
  },
  "2026-11-statistiques-frequentation-detaillees": {
    linkLabels: ["Read what the detailed statistics measure", "Object to audience measurement"],
    title: "Detailed audience statistics, without cookies",
    summary:
      "The site now measures its traffic page by page (page views, visits, time spent, days and hours of visit) to present it, as aggregate figures only, to the association's partners and advertisers, on an unlisted public page. No cookie, no third-party tool, no link to your account.",
    details: [
      `For each page shown, your browser notes the type of page (home, a tournament's page…), never its exact address, a number or a name; the time spent with the tab visible, sent in slices, each capped at ${AUDIENCE_MAX_ENGAGED_MINUTES} minutes; your device class (mobile, tablet, computer); and, for the first page of a visit, the site you came from, which the server immediately reduces to a family (direct access, search engine, Discord, social network, video platform, other website).`,
      `The server adds a daily hash of your IP address (reduced to its /64 network in IPv6) and your browser, computed with a random salt drawn for the day and erased the next day, as soon as the day is counted: after that, no one, the association included, can recognise you (apart from an encrypted backup copy made in the meantime, ${BACKUP_RETENTION_DAYS} days at most). Your session is not read: the measurement does not know whether you are logged in.`,
      `These detailed page views are erased after ${AUDIENCE_RAW_RETENTION_MONTHS} months (apart from encrypted backup copies); the aggregate figures per day, without any hash, are kept with no limit. Your IP address (and, in IPv6, its /64 and /48 networks) and a short digest of your browser are only kept in memory, two minutes at most after your last request, to cap each network's submissions. The administration pages (including creating and editing a tournament) and the report pages are not measured.`,
      `The statistics page (/frequentation) is public but absent from search engines and menus: it only shows totals, with no breakdown of fewer than ${AUDIENCE_MIN_VISITORS} visitors from the same day (only each day's totals are given as they are), with the number of tournaments played, matches played, teams and accounts on the site.`,
      "Measurement exempt from consent (art. 82 of the French Data Protection Act, CNIL conditions for audience measurement). You can object to it as to the existing audience measurement: your browser's Global Privacy Control and Do Not Track signals, or the objection button of /rgpd, stop both measurements.",
      "What does not change: nothing new is linked to your account, and what its deletion removes stays the same (these measurements, which are not linked to it, do not depend on it).",
    ],
  },
  "2026-11-empreinte-perceptuelle-avatar": {
    linkLabels: [READ_REPORTS],
    title: "Avatar deleted by moderation: a perceptual hash is added",
    summary:
      "When moderation deletes an avatar, the site now keeps, next to its SHA-256 hash, a perceptual hash of the image: it also refuses the same image being uploaded again slightly cropped, resized, darkened or lightened, re-encoded or in another format.",
    details: [
      "What it is: a 64-bit summary of what the image looks like (its large light and dark areas), computed on the site, with no third-party service. It cannot be used to rebuild the image and designates no account. An image uploaded as an avatar or as a team logo is refused if its hash is very close to one of the perceptual hashes of the 2,000 most recently blocked images (by block date); older ones stay stored but are no longer compared.",
      "Where and for how long: exactly where the SHA-256 hash is kept, and for as long — in the list of blocked images, without time limit and with no link to any account, and on the deletion decision as long as that decision is kept. An accepted challenge that lifts the block removes both hashes together from the list of blocked images.",
      "An avatar deleted before this change stays blocked by its SHA-256 hash only; a perceptual hash is only added if the same image is blocked again while the site still keeps its file (a new deletion, an account erasure, the purge of a hidden avatar), the row keeping the date of its first block. An image that is too simple — nearly plain, a gradient, a symmetric pattern, or mostly a plain background, such as a name or an emblem on a flat colour — or that the site cannot decode has no perceptual hash: it is blocked by its SHA-256 hash only.",
      "What does not change: an avatar that is only hidden, or that moderation never deleted, leaves no hash; what deleting an account removes stays the same.",
    ],
  },
  "2026-11-test-messages-prives": {
    linkLabels: ["Read the “Test my DMs” paragraph"],
    title: "“Test my DMs”: a test direct message, at your request",
    summary:
      "From “My profile”, the “Test my DMs” button asks the BlueGenji bot to send a short test direct message to your linked Discord account, to check that it can reach you. Nothing is sent without your click.",
    details: [
      `The message only goes to your own linked Discord account, and only if your tag is certified; it contains neither a link nor anyone's name. The “Discord direct messages about my matches and teams” box does not apply to this test, which you request yourself, and a delivered test does not tick it again. The site tells you the result (message delivered, direct messages closed, not on any BlueGenji server, bot unreachable) and does not record it. Normally at most ${DM_TEST_HOURLY_LIMIT} tries per hour: this cap lives in memory and starts again from zero when the site restarts. Your account number and the time of each of your tries are kept there, sixty-one minutes at most after your last click on the button, for the caps on tries.`,
      "A message not delivered (direct messages closed or not on any of the servers) leaves a line giving its outcome as counts (delivered, not found, unreachable) in the staff log on Discord, and a sending the bot cannot carry out, a line giving the error — without naming anyone. Basis: performance of the service you request.",
      "What does not change: nothing new about you is written to the database, and what deleting the account removes stays the same.",
    ],
  },  "2026-11-roles-de-plateforme-fiche": {
    linkLabels: ["Read record T01 of the register"],
    title: "Platform roles: a title on the player page, a developer role",
    summary:
      "Correction: a platform role (administrator, referee, caster, community manager, recruiter) is shown as a title on the player page, which any logged-in member reads, whatever their visibility settings — /rgpd did not say so. A new role, developer, does not appear there.",
    details: [
      "What was inaccurate: the register only named, as the public of the player page, the data the player makes visible. Yet the title of a platform role always appears there, for any logged-in member. It disappears when the role is removed, and with the anonymization of a deleted account.",
      "The developer role, which is new, only opens reading the technical documentation of the site and the bot (published on GitHub): it gives access to no member data, is not part of the staff and does not appear on the player page. Granting or removing it is logged like the other roles: in the staff log on Discord naming no one, with its author, the account concerned and the roles saved in the server logs.",
      "What does not change: nothing new about you is collected, and what deleting the account removes stays the same.",
    ],
  },
  "2026-11-vue-joueur-du-staff": {
    linkLabels: ["Read record T05 of the register"],
    title: "Player view: the staff can see the site as a player",
    summary: `An account holding a platform role (staff member or developer) can suspend its rights on one of its sessions to see the site as a player, for ${PLAYER_VIEW_MAX_HOURS} hours at most. Each switch is noted, under its name, in the server logs.`,
    details: [
      "Nothing is said about it on Discord. In the server logs, each switch (on or off) leaves a line with the username and identifier of its author, according to their automatic rotation; basis: legitimate interest (administration of the platform), to which the person concerned may object.",
      "The player-view deadline is noted on the login session and is erased with it (logout, end of the session or deletion of the account). For the time of the switch, the server keeps in memory only, never written, the account number, the time of the switches and the hash of the session.",
      "What does not change: for a player without a platform role, nothing new is collected, and what deleting the account removes stays the same.",
    ],
  },
  "2026-11-planning-casts-arbitres": {
    linkLabels: ["Read record T20 of the register"],
    title: "Cast and referee schedule",
    summary: `Referees, casters and prods (a new platform role) get a \u201cSchedule\u201d page: they give their availability and preferences there, slot by slot, and the tournament staff assigns who covers each match. These data are kept ${PLANNING_RETENTION_DAYS} days after the start of the slot; the “solo caster” setting, as long as the account holds the caster role.`,
    details: [
      "What is kept: for each slot and each role held, the availability given and the preference; the assignments (who holds which role, proposed by the calculation or chosen by the staff, provisional or confirmed, with the staff account that set it) and their history (with the account that acted through the schedule, none when the site aligns the schedule with the match); the \u201csolo caster\u201d setting. Basis: the association's legitimate interest (organising its volunteers), with a right to object.",
      "Who reads it: referees, casters, prods and administrators see each slot's assignments (the reason for a calculated proposal — preference, load — only appears as “Calculation”, except to the tournament staff and the person concerned); only the tournament staff (referees and administrators) sees everyone's availability and preferences.",
      "Through the schedule, confirming or assigning a match's referee, or removing its assigned referee, acts on the match itself, like the staff does (register, T04 and T05): the staff log on Discord notes each change of the match's referee without naming anyone, and a referee removed by someone else is notified by push. Nothing else from the schedule is published on Discord.",
      "Deleting the account removes everything about it in the schedule (the actions it took as staff remain, without naming it); the export of your data contains it, actions taken as staff included.",
      "The “prod” title joins the platform role titles shown on the player page to every logged-in member.",
      "What does not change: for a player without a platform role, nothing new is collected.",
    ],
  },
  "2026-11-planning-notifications-desistements": {
    linkLabels: ["Read record T20 of the register"],
    title: "Schedule: notifications and withdrawals",
    summary: "Referees, casters and prods are now notified by Discord direct message and push notification of new slots in the schedule, of their assignments and of the withdrawals that concern them; everyone can withdraw from an assignment, with an optional reason read by the tournament staff only.",
    details: [
      "What is sent: a summary of the new slots where you can hold a role (one per planning wave), the notice of an assignment confirmed or set by hand (never of a mere proposal), the notice of the withdrawal from a confirmed assignment on a slot where you are assigned and confirmed yourself, and, to the tournament staff, a slot left open (a line naming no one in the staff log on Discord; the role also appears \u201copen\u201d on the schedule when no one is confirmed in it any more, without the reason). None of these messages names a player or a staff member: \u201ca caster withdrew\u201d.",
      "Each of these four topics can be turned off in the notification settings of \u201cMy profile\u201d; turning it off also turns off its Discord direct message (right to object, art. 21). Discord delivers these direct messages (United States, register T20).",
      "What is kept of a withdrawal: the role and slot left, the date, the optional reason (300 characters at most), whether it is late (less than 24 h before the start) and whether the assignment was confirmed \u2014 same retention as the rest of the schedule, in the export of your data; the reason is read by the tournament staff only. The schedule also records, without any person, which slots have already been announced.",
      "Suspended account: the schedule now reads whether a suspension is running, and a suspended account is left out of the schedule’s proposals, confirmations, appointments, replacements and notices (new slots, assignments, withdrawals, open slots); what was already confirmed or appointed for it stays until removed; the tournament staff and the other schedule members can only infer that the schedule no longer retains it, without seeing the suspension or its reasons; nothing more is kept.",
      "What does not change: for a player without a platform role, nothing new is collected or sent.",
    ],
  },
  "2026-11-date-butoir-planification": {
    linkLabels: ["Read record T04 of the register"],
    title: "Matches: scheduling deadline",
    summary: "The tournament staff can give a match a deadline before which its teams must agree on a time; whoever leads them in matches is notified, then reminded, and, failing a time, the match may be closed as a double forfeit.",
    details: [
      "What is sent, by Discord direct message and push notification, to whoever leads each entrant in matches (owner, managers, captain — or the player of a solo entry): the announcement of the deadline, a reminder 24 h and 3 h before, and the double-forfeit notice if it passes with no time. Team names only, no username; basis: legitimate interest (smooth running of tournaments).",
      "The new “Scheduling deadline” topic, which also turns these direct messages off, can be turned off in the notification settings of “My profile”, and the match direct messages switch there also turns these direct messages off (right to object, art. 21).",
      "What is kept: the deadline with the match, and the record of each notice sent (match and pairing, step, announced deadline, date sent, whether it reached anyone, without the text), erased when the deadline changes or goes, otherwise with the tournament.",
      "Cast and referee schedule (T20): each slot is now confirmed automatically as its start draws near (a lead time set by the staff, 24 h at least), or earlier at its match's deadline; the assignees are notified as for a confirmation by the staff, and the schedule records, with no person, which slots were confirmed automatically (same durations as the rest of the schedule).",
      "Staff: a deadline set, changed or removed is noted in the staff log on Discord without naming its author; the server logs keep its author (T05).",
    ],
  },
  "2026-11-incarner-un-role": {
    linkLabels: ["Read record T01 of the register", "Read record T05 of the register"],
    title: "Player view: replaced by “Impersonate a role”, for administrators only",
    summary: `Only an administrator can now narrow their rights on one of their sessions, to the platform roles they choose (none: player view), for ${PLAYER_VIEW_MAX_HOURS} hours at most. Each switch is noted under their name in the server logs, the entry with the roles impersonated; a return forced by the removal of their administration may be noted under the name of the administrator who removed it.`,
    details: [
      "What is also kept: the roles impersonated, on the login session with the deadline, with no effect after the return, the deadline or the removal of administration, erased on a return made before the deadline, otherwise at the latest with the session (logout, end of the session or deletion of the account), and in the server log line, according to its rotation; a return forced by the removal of administration may name the administrator who removed it, with the identifier of the account and the number of sessions; basis: legitimate interest (administration of the platform), to which the person concerned may object. Nothing is said about it on Discord.",
      "What does not change: for an account that has never been an administrator, nothing new is collected; the switches into player view made until now by the other holders of a platform role stay in the server logs, according to their rotation.",
    ],
  },
  "2026-11-planning-invites": {
    linkLabels: ["Read record T20 of the register"],
    title: "Schedule: guest casters and prods",
    summary: "The staff who assigns roles can mark a caster or a prod as a “guest”: they keep their other rights on the site, but are no longer part of the cast and referee schedule.",
    details: [
      "What is kept: the “guest” mark on the account, as long as the staff leaves it and the account is a caster or a prod; it is in the export of your data, is shown on “My profile” and goes with the account's deletion. Basis: the association's legitimate interest (organising its volunteers), with a right to object.",
      "What it changes: only the schedule is taken away, the referee role included for whoever also holds it; a guest is no longer proposed, assigned or notified by the schedule, and no longer reads its page; the mark leaves the upcoming assignments the schedule had given them as a withdrawal would (a replacement is looked for as usual), without notifying the guest, and erases their upcoming availability; what is past stays.",
      "Who sees it: the staff who assigns roles, and the guest on “My profile”. The tournament staff sees, in the schedule history, each assignment left as a removal by staff, for as long as that history is kept (T20), which also keeps its author's account without showing it; the other schedule members do not see the mark, and those assigned to the same slot only learn that a member was removed from it. Each action on the mark is noted in the staff log on Discord without naming anyone; the server logs keep its author and the account concerned (T05). The history appears in the guest's data export, without the author, and in the author's.",
      "What does not change: for an account that is not marked, nothing new is collected.",
    ],
  },
  "2026-11-caster-autonome-rediff": {
    linkLabels: ["Read record T05 of the register", "Read record T20 of the register"],
    title: "Staff: solo caster and replays in the log",
    summary: "A caster is notified when the staff changes their solo caster status, and adding, changing or removing a replay is noted in the staff log, with the link.",
    details: [
      "Notice to the caster: by Discord direct message (only if their Discord tag is certified) and push notification (on their subscribed devices), without naming the staff; the new “Solo caster” topic can be turned off in the notification settings of “My profile”, direct message included.",
      "Logs: both actions are noted on Discord without naming their author or the caster — a replay (the match, its team names and the link to the video, which is public and shows the channel that streamed it, without its other parameters) and the solo caster status, both in the staff log; the server logs keep their author and, for the status, the account concerned, according to their rotation. Basis: legitimate interest (organising and overseeing tournaments).",
    ],
  },
  "2026-11-prod-match": {
    linkLabels: ["Read record T16 of the register", "Read record T04 of the register", "Read record T05 of the register", "Read record T03 of the register"],
    title: "Matches: the live stream's prod",
    summary: "A match can have a prod, who handles the production of its live stream: they take the match themselves or are placed on it by the staff, and their username is shown with the match, like the casters'.",
    details: [
      "What is kept: the prod's account with the match, for as long as the match exists; it is removed from matches not yet launched if the account loses that role, is suspended or now plays in the match, and from matches not yet played if it is deleted (before the launch, a prod who no longer meets these conditions is no longer shown), and appears in the export of their data. Basis: legitimate interest (organising the volunteers who stream the tournaments), as for the planning; the prod can leave a match not yet played and object to it through the report form (GDPR category).",
      "Who sees it: as for casters, the readers of the tournament and of the match, including without an account. The prod is notified (Discord direct message, turned off with their other match direct messages, and push notification, turned off by its topic, from “My profile”) when someone other than themselves places or removes them, by the staff or automatically; their place taken or left and these actions are noted in the staff log on Discord without naming anyone, and the server logs keep the author of a staff action and the account concerned, according to their rotation.",
    ],
  },
  "2026-11-planning-place-le-cast": {
    linkLabels: ["Read record T20 of the register", "Read record T16 of the register"],
    title: "Schedule: casters and prod placed on their match",
    summary: "When nobody holds a match's cast (caster or prod) yet outside the schedule, the casters and the prod the schedule holds for it (assignment confirmed or set by hand) are placed on it: their username is then shown with the match, like a cast signup or a placed prod.",
    details: [
      "What changes: the site makes the cast signup or the prod place itself, on an assignment confirmed or set by hand, if the person meets the cast or prod requirements and does not play the match; it keeps that the signup or the place comes from the schedule, to remove it when the person leaves their assignment (withdrawal, removal by hand by the staff), except on a played match; this mark also goes when the account is deleted. A signup made by the caster themselves, or a prod taken by the person or set by the staff from the match, is never touched.",
      "Who sees it and who is notified: like any cast signup or prod, the readers of the tournament and of the match, including without an account. The prod receives the notice of a placed prod, unless the action is their own; a caster placed on a stream with no link yet is asked to add their channel's; the person the staff removes is notified. These actions are noted in the staff log on Discord without naming anyone, the author of a staff action and the accounts concerned in the server logs. Basis: the association's legitimate interest, as for the schedule, with a right to object.",
    ],
  },
  "2026-11-message-du-staff-tournoi": {
    linkLabels: ["Read record T04 of the register", "Read record T08 of the register"],
    title: "Tournaments: staff messages to participants",
    summary: "A tournament's staff can write to its participants, from the tournament page or from Discord: the message arrives by Discord direct message and push notification, signed “the tournament staff”. A new topic, “Tournament staff messages”, turns it off in “My profile”.",
    details: [
      "Who receives what: during registration or while the tournament is running, the current members of the registered teams, according to the categories the staff picks (players, managers, captains, owners, everyone), and the players of a solo tournament; a team that withdrew is no longer targeted. The message goes by Discord direct message (linked identifier or certified tag) and by push notification, in your language. The staff member only sees numbers (including how many have no Discord or turned the topic off), never your names. Basis: the association's legitimate interest in the smooth running of tournaments; you object to it by turning off the topic, which also turns off the direct message.",
      "What is kept: none of the text, neither by the site nor by the bot (it stays in the messages received); only a counter of each staff member's sendings per tournament, erased at the latest a quarter of an hour after its one-hour window ends, caps their number. The sending is noted in the staff log on Discord, kept for a year, without naming its author or quoting the text; the server logs keep its author and the length of the text, according to their rotation. From Discord, the bot sends the site the Discord identifier of whoever runs the command and their message, without keeping them; the site keeps that identifier (or, from its page, the account number) in memory only, eleven minutes at most, to cap the calls.",
    ],
  },
  "2026-11-annonces-de-recrutement-overwatch": {
    linkLabels: ["Read record T21 of the register", "Read the “Overwatch recruitment posts” paragraph"],
    title: "Overwatch recruitment posts copied to the site",
    summary: `The site copies the Overwatch recruitment posts published in the announcement channels of the association's Discord server — written there, or relayed by GETI Bot from the servers subscribed to its network — to gather them on a search page. A scrim search is kept there ${GETI_RETENTION_DAYS.lfs} days, the other posts ${GETI_RETENTION_DAYS.lfp} days.`,
    details: [
      "What is copied: the post's text, its author's Discord username and identifier, the server of origin of a relayed post, the dates, and the criteria read automatically in the text (rank, role, region, platform, language, availability, stated minimum age, team name) to filter the posts, as well as the message as the bot passed it, to redo that reading when it improves. Nothing is linked to an account of the site, and the association's bot, which reads those channels for the site, records none of it (it only holds them in memory: the reading of the channels' history, its sending queue, and Discord's message cache, erased when it restarts). Basis: the association's legitimate interest in helping players and teams find each other, for posts that are already public.",
      `How long, and how to remove a post: ${GETI_RETENTION_DAYS.lfs} days after its publication in the association's channel (for a relayed post, that of its relay) for a scrim search, ${GETI_RETENTION_DAYS.lfp} days for the others, then an automatic erasure. Deleting the post from the channel removes it from the site at once, editing it replaces the previous version — for a relayed post, when GETI Bot deletes or edits its relay, which the association does not control. A deletion made while the bot is stopped is only seen at its next reading of the channels, within the last 5,000 messages of each channel, and so is a message erased by its author's ban from the Discord server, which Discord does not report to the bot; failing that, or if the channel is deleted or closed to the bot, the post leaves at the end of its retention period. Apart from the encrypted backup copies (${BACKUP_RETENTION_DAYS} days at most) and the identifier of a post targeted by an objection, nothing is kept of a removed post or of its previous version. Its author, including the author of a post relayed from another server, can also object and ask the association to remove it (report form, GDPR category): their posts are then removed and no longer copied, the association keeping for that only their Discord identifier (or that of the targeted post), as long as the objection stands (${GETI_RETENTION_MAX_DAYS} days for a single post). A restored backup would not know an objection recorded after it, which would then have to be recorded again.`,
    ],
  },
  "2026-11-alertes-d-annonces-geti": {
    linkLabels: ["Read record T22 of the register", "Read the “Post alerts” paragraph"],
    title: "Alerts on a search of recruitment posts",
    summary: "On the Overwatch recruitment posts page, a signed-in account can create alerts: the site keeps the chosen category and filters, and notifies the account when a new post matches them.",
    details: [
      "What is kept: for each alert, the chosen category and filters, an optional name, its state (active or paused), its creation date and the date of the last notification, plus a technical record of the posts already reported, so that you are never notified twice. Ten alerts at most per account. Nothing is created without your action: the alert is a service you ask for.",
      "How you are notified: by push notification on the devices where you turned it on, and by Discord direct message if your Discord account is certified — at most once every 10 minutes per alert. The message carries only the name of your alert and a link to the page, neither a username nor the post's text. Your own post does not notify you when it carries its author's Discord identifier: the Discord identifier linked to your account is compared with it, and nothing more is kept. The “GETI post alerts” topic in “My profile” turns both off.",
      "How long: until you delete the alert (or pause it, which keeps it without notifying you); erasing your account removes all your alerts. The record of the posts already reported is erased after 15 days. Your alerts are included in the export of your data.",
    ],
  },
};

/**
 * The entries in the page's language: unchanged in French; in English, the
 * translated wording on the French entry (same `id`, date, audience and link
 * targets). An entry without a translation stays French — a test forbids it.
 */
export function localizedPrivacyChanges(changes: readonly PrivacyChange[], locale: Locale): PrivacyChange[] {
  if (locale === "fr") return [...changes];
  return changes.map((change) => {
    const english = PRIVACY_CHANGES_EN[change.id];
    if (!english) return change;
    return {
      ...change,
      title: english.title,
      summary: english.summary,
      details: english.details,
      links: change.links?.map((link, index) => ({ href: link.href, label: english.linkLabels?.[index] ?? link.label })),
    };
  });
}

/**
 * The entries as the root layout ships them to the privacy modal: everything
 * but the `details` (#587 — every page of an account behind on several entries
 * carried tens of kB of them). The modal fetches them once it opens
 * (`privacyChangeDetailsFor`, `GET /api/profile/privacy-changes`).
 */
export function privacyChangeHeads(changes: readonly PrivacyChange[]): PrivacyChange[] {
  return changes.map((change) => ({ ...change, details: [] }));
}

/**
 * The `details` of the registry entries `ids`, in `locale`, by id. Unknown ids
 * are skipped (the route has already refused them).
 */
export function privacyChangeDetailsFor(ids: readonly string[], locale: Locale): Record<string, readonly string[]> {
  const wanted = new Set(ids);
  const entries = localizedPrivacyChanges(PRIVACY_CHANGES.filter((change) => wanted.has(change.id)), locale);
  return Object.fromEntries(entries.map((change) => [change.id, change.details]));
}
