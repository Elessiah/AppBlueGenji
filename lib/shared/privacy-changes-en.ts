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
      "A visitor without an account follows the tournament at /suivre/tournois/…: they read there what streams and Discord already show — team names, usernames of the players taking part, scores, rankings, username of a match's caster —, as well as team logos and, for a solo tournament, the avatar of each player taking part (unless they hid it) and their internal account number, which carries their podium mark.",
      "Replay codes are not shown there: they remain reserved to logged-in members.",
      "The page is excluded from search engines and opens no session. Like any page of the site, its visit is counted by the audience measurement, unless you object; beyond that, the visitor's IP address is only used there, in memory, to limit the number of reads.",
      "You can object to your username being displayed, as for match streaming.",
    ],
    linkLabels: ["Read the paragraph “Following a tournament without an account”"],
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
