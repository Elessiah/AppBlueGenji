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
import type { PrivacyChange } from "@/lib/shared/privacy-changes";
import { PUSH_SUBSCRIPTION_RETENTION_DAYS } from "@/lib/shared/push-notifications";
import { SITE_VISITOR_RETENTION_MONTHS, SITE_VISIT_DETAIL_RETENTION_DAYS } from "@/lib/shared/site-visits";
import { TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS } from "@/lib/shared/team-join-request-notice";

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
      "If you cast: your username is shown with the stream you join. The link of the stream you open separately is published with the match; that stream goes, with its link, once no caster holds it any more — whether you leave it or your account is deleted; only the link set in the match's live configuration stays with the match. When your account is deleted, the link you provided — when opening your stream or in that configuration — also goes, played matches included, even if another caster still holds that stream. If you are a member of the organizers, the channel you set in that configuration on a match you already cast counts as yours (set before you signed up as its caster, it stays the organizers' link); a link set before the site recorded who provided it has no known author and stays with the match.",
      "A caster no longer replaces another: a new registration is added without removing anyone. A registration is now only removed by the caster themselves, by the staff or automatically.",
    ],
  },
  "2026-10-arbitre-designe-des-matchs": {
    linkLabels: ["Read the “Assigned referee of a match” paragraph"],
    title: "Assigned match referees",
    summary:
      "A staff member can now referee a match: they take it, or the staff assigns it to them. Both teams and the referees see their username and BattleTag as soon as both opponents are known, the match's casters while the match is being played; the public only reads “Referee assigned”.",
    details: [
      "If you play or cast a match: its assigned referee is presented to you in the match's “Contacts” and launch windows, at the same times as the match contacts (as soon as both your opponents are known if you play, while the match is being played if you cast) — their username and BattleTag, even when hidden, never their Discord tag; their username alone appears there as soon as the launch window shows the match. The launch window also opens to them: they read the match contacts there, hidden BattleTag included, which they already read as a referee in the “Contacts” window. Nothing else changes for your own data.",
      "If you referee: your username and BattleTag (even when hidden) are presented in this way to the parties to your matches, on the basis of legitimate interest (they know who referees): you object to it through the report form (GDPR category) — once upheld, your objection means the staff no longer assigns you matches — and you can withdraw from a match at any time, the staff otherwise being able to assign that match to you again, without notice; your “Ready” is expected before the launch. If the refereeing is removed from you by the staff (removal, match assigned to another referee or switched to self-management) or automatically (requirements no longer met, or you now play the match), you are notified by push notification only, with the reason, as long as you hold the refereeing permission — “Refereeing removed” setting. When your account is deleted, you are removed from all your matches.",
      "Taking a match, its removal, self-management and the first map are noted in the staff log on Discord without naming anyone; a match that enters its launch with neither a referee nor self-management is flagged to the referees, without switching anything automatically.",
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
      "The terms of use move to version 7: their “Match contacts” section provides for several casters per match, the assigned referee and the match page, and presenting the assigned referee now rests on the performance of the service, no longer on legitimate interest, once that referee has accepted this version.",
    details: [
      "Match contacts: a match's contacts go to each of its casters while the match is being played, and each caster's also to the other casters of the match. The assigned referee is presented there — their username and BattleTag, even when hidden, never their Discord tag in that capacity (if they also cast the match, their caster contacts follow the casters' rule) — to both teams and to the referees from the moment both opponents are known until the end of the match, and to the casters while the match is being played.",
      "Match page: it repeats the casters' contacts (certified Discord tag and BattleTag, even when hidden) and the assigned referee's username and BattleTag, even when hidden, to the same people at the same times as the match's “Contacts” window; the teams' contacts stay in the “Contacts” and launch windows. A hidden BattleTag can be read nowhere else on the site.",
      "If you referee: once you have accepted version 7, presenting your username and BattleTag to the parties to your matches rests on the performance of the service — the terms of use provide for it —, no longer on legitimate interest: objecting through the report form no longer applies to it, and an objection already upheld still stands (the staff no longer assigns you matches). Until you accept it, it still rests on legitimate interest, and you can object to it through the report form (GDPR category); as the acceptance window then covers the tournament pages, you withdraw from a match by asking for it through that same form. You can still withdraw from a match at any time, the staff being able to assign it to you again; if you no longer meet the requirements to referee (refereeing permission, certified Discord tag, linked Battle.net account), or become a player of the match before its launch, you are no longer presented.",
      "Streaming: the terms now say that the evening #live message names the teams and, in a solo tournament, the players by their public username before a match scheduled that evening starts and once the match is finished, not only when it starts. A match being listed in that message before it goes on air leaves no trace on the site.",
      "Acceptance: without accepting the terms, you can delete your account directly from the window that presents them to you, as from your profile.",
      "Terms of use: version 7, in force since 30 October 2026, says so in its “Match contacts”, “Match streaming” and “Acceptance” sections. A window presents it to you until you have accepted it: accepting it lets you keep using the site.",
    ],
  },
  "2026-10-ne-plus-voir-invitation-certification-sur-le-compte": {
    title: "“Don't show again” on the verification invitation: kept on the account",
    linkLabels: ["Read the “Cookies & trackers” section"],
    summary:
      "The “Don't show again” choice on the window inviting you, on a tournament page, to verify your Discord tag (and your BattleTag depending on the game) is now kept on your account, no longer in the browser: it applies in all your browsers, and no longer to the other accounts used in the same browser.",
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
      "The information of October 21 said the opposite: that the session records, after “Later”, that the window no longer needs to be suggested. In fact, the mark is set at login and cleared at your first answer (“Later”, closing the window or its button leading to “My profile”, “Don't show again” — which clears it on all your sessions —, or verification, whether it succeeds or is refused because your Discord account changed since you logged in), or as soon as there is nothing left to suggest.",
      "This mark contains nothing else, goes with the session and isn't included in the export of your data. Nothing else changes: “Don't show again” is still kept on your account, with its date.",
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
