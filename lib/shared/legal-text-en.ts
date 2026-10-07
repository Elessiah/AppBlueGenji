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
 * Pure module, importable anywhere — but only the English legal pages
 * import it: no French page carries any of these strings.
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
  "The author of a notice receives, at the address they provide (required for copyright, optional otherwise), an acknowledgment of receipt, then the decision taken on it and the means of redress available to them. If they reported from their account, they can contest that decision — including a decision not to act — through the “Appeal” category (« Contestation ») of the same form, once the report has been archived.";

/** `STREAM_NOTICE_SHOWN` (`stream-notice.ts`). */
export const STREAM_NOTICE_SHOWN_EN =
  "What appears is the players' usernames, their team's name and their in-game results and performance — never a webcam or voice chat.";

/** `STREAM_NOTICE_OBJECTION` (`stream-notice.ts`). */
export const STREAM_NOTICE_OBJECTION_EN =
  "Any player can object: they then appear under a neutral name. The request is made through the “Report a problem” button, GDPR category (« RGPD »).";

/** `AUTHORITY_CONTACT_LANGUAGES` (`legal-contact.ts`), same order. */
export const AUTHORITY_CONTACT_LANGUAGES_EN: readonly string[] = ["French", "English"];

/** `DATA_CONTACT_ROLE` (`legal-contact.ts`). */
export const DATA_CONTACT_ROLE_EN = "technical host of the site";

/** `WEB_ACCESS_LOG_FIELDS` (`legal-durations.ts`), same items in the same order. */
export const WEB_ACCESS_LOG_FIELDS_EN =
  "IP address, date and time, page requested, response code, response size, referring page and browser";
