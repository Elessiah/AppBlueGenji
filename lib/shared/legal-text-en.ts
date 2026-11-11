/**
 * English renditions of the shared French legal sentences that several legal
 * pages quote (lot 7b, `docs/features/I18N.md` § Textes légaux du site).
 *
 * The French originals stay where they are and remain the reference — they
 * are also read by the forms, the bot and the register. Each constant here
 * translates **one** French constant, named in its comment; a test checks
 * that both lists have the same length, so an item added in French without
 * its English fails.
 *
 * Pure module, importable anywhere — the English legal pages import it, and so
 * do the bilingual bot documents (`bot-legal-content.ts`, which also feed the
 * bot's `LegalTerms`): changing a constant here can change those documents
 * too. No French page carries any of these strings.
 */

/** `REPORT_FORM_NAME` — the button as the shell shows it under `/en` (`shell.footer.reportProblem`). */
export const REPORT_FORM_NAME_EN = "Report a problem";

/** `COPYRIGHT_NOTICE_ELEMENTS` (`content-reports.ts`), same order. */
export const COPYRIGHT_NOTICE_ELEMENTS_EN: readonly string[] = [
  "the name or corporate name of its author",
  "their email address",
  "their capacity (rights holder, representative or third party)",
  "the content concerned and where to see it on the site",
  "the reason for the request",
  "a statement of good faith",
];

/** `copyrightNoticeElementsText()` in English (« a, b and c »). */
export function copyrightNoticeElementsTextEn(): string {
  const items = [...COPYRIGHT_NOTICE_ELEMENTS_EN];
  const last = items.pop();
  return items.length === 0 ? (last ?? "") : `${items.join(", ")} and ${last}`;
}

/** `NOTIFIER_FOLLOW_UP` (`content-reports.ts`). */
export const NOTIFIER_FOLLOW_UP_EN =
  "The author of a notice receives, at the address they provide (required for copyright, optional otherwise), an acknowledgment of receipt, then the decision taken on it and the means of redress available to them. If they reported from their account, they can contest that decision — including a decision not to act — through the “Appeal” category of the same form, once the report has been archived.";

/** `STREAM_NOTICE_SHOWN` (`stream-notice.ts`). */
export const STREAM_NOTICE_SHOWN_EN =
  "What appears is the players' usernames, their team's name and their in-game results and performance — never a webcam or voice chat.";

/** `STREAM_NOTICE_SERVICE` (`stream-notice.ts`). */
export const STREAM_NOTICE_SERVICE_EN =
  "Streaming and recording a match under its players' usernames is part of the tournament they take part in (performance of the service): a player who does not want to appear in it does not take part.";

/** `STREAM_NOTICE_ACCOUNTLESS` (`stream-notice.ts`). */
export const STREAM_NOTICE_ACCOUNTLESS_EN =
  `A player with no account on the site (a team registered by the staff, known as a “ghost” team, or a solo entry with no account) has not accepted the terms of use: for them, the streaming and recording of their matches rest on the association's legitimate interest in broadcasting its tournaments (GDPR, art. 6(1)(f)), and they can object to it (art. 21) through the “${REPORT_FORM_NAME_EN}” form (GDPR category).`;

/** `STREAM_NOTICE_CASTERS` (`stream-notice.ts`). */
export const STREAM_NOTICE_CASTERS_EN =
  "The following fall under performance of the service too: the voice, username and channel link of the caster who registers for a match, published with that match, and their setting of how it goes live; the stream and replay links published on the site; and the copy of the text of a #live announcement that Discord's automatic moderation (AutoMod) blocks or flags, sent to the server moderators' alert channel, where it stays until they delete it.";

/** `STREAM_NOTICE_LIVE` (`stream-notice.ts`). */
export const STREAM_NOTICE_LIVE_EN =
  `Streamed matches are announced in the #live channel of the association's Discord, by an evening message that lists each match at its time — before it starts if its stream is due to open at its start time that evening, while it is streamed, then once finished, with its score — and that names the teams and, in a solo tournament, the players by their public username. That announcement is part of the solo tournament the player registers for too (performance of the service): a player who does not want to be named in it does not register for the solo tournament. An announcement is deleted on request, through the “${REPORT_FORM_NAME_EN}” button, GDPR category.`;

/** `AUTHORITY_CONTACT_LANGUAGES` (`legal-contact.ts`), same order. */
export const AUTHORITY_CONTACT_LANGUAGES_EN: readonly string[] = ["French", "English"];

/** `DATA_CONTACT_ROLE` (`legal-contact.ts`). */
export const DATA_CONTACT_ROLE_EN = "technical host of the site";

/** `WEB_ACCESS_LOG_FIELDS` (`legal-durations.ts`), same items in the same order. */
export const WEB_ACCESS_LOG_FIELDS_EN =
  "IP address, date and time, page requested, response code, response size, referring page and browser";

/** « 1 month », « 6 months » : a duration in months, singular or plural. */
export function monthsEn(count: number): string {
  return `${count} ${count === 1 ? "month" : "months"}`;
}
