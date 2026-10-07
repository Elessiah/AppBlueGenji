/**
 * Accessibility statement — English translation (lot 7b, D1) of
 * `accessibility-statement.ts`, whose French text prevails.
 *
 * Only the **wording** lives here: the status, the audit rate and the date are
 * read from the French module, so the two pages can never disagree on them.
 * `KNOWN_ISSUES_EN` follows `KNOWN_ISSUES` item by item (same criterion, same
 * order): a PR that settles or adds a limit changes both lists — a test fails
 * otherwise.
 */

import {
  ACCESSIBILITY_STATEMENT_DATE,
  type ConformityStatus,
  type KnownIssue,
} from "@/lib/shared/accessibility-statement";

/** `ACCESSIBILITY_STANDARD`. The RGAA is the French accessibility standard. */
export const ACCESSIBILITY_STANDARD_EN = "RGAA 4.1.2 (WCAG 2.1 level AA criteria)";

/** `CONFORMITY_LABELS` — same wording as the footer link (`shell.footer.conformity`). */
export const CONFORMITY_LABELS_EN: Record<ConformityStatus, string> = {
  TOTAL: "fully compliant",
  PARTIAL: "partially compliant",
  NONE: "non-compliant",
};

/** `accessibilityStatementDateLabel` in English: `2026-10-02` → « October 2, 2026 ». */
export function accessibilityStatementDateLabelEn(iso: string = ACCESSIBILITY_STATEMENT_DATE): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  }).format(new Date(`${iso}T12:00:00Z`));
}

/** `KNOWN_ISSUES`, item by item. */
export const KNOWN_ISSUES_EN: readonly KnownIssue[] = [
  {
    title: "Screen reader journeys",
    criterion: "Entire standard",
    detail:
      "No complete journey has yet been carried out with NVDA or VoiceOver (logging in, registering " +
      "a team, reporting a score): defects that no automated tool detects may remain.",
    workaround: null,
  },
  {
    title: "The association's documents",
    criterion: "RGAA 13.3",
    detail:
      "The bylaws (PDF), the membership form (DOCX) and the internal rules (Google Docs) " +
      "are published without any accessibility check of the document.",
    workaround: "an accessible version of these documents can be requested:",
    requestByContact: true,
  },
];

/** `EVALUATION_METHODS`, same order. */
export const EVALUATION_METHODS_EN: readonly string[] = [
  "Internal audit of September 24, 2026, axe tool and keyboard navigation",
  "Automated checks of the repository on every change (contrast, focus, landmarks, dialogs, accessible names)",
];

/** `EVALUATION_SAMPLE`. */
export const EVALUATION_SAMPLE_EN =
  "No sample of pages within the meaning of the RGAA has been put together, as no complete audit has been carried out.";

/** `EVALUATION_ENVIRONMENT`. */
export const EVALUATION_ENVIRONMENT_EN =
  "No test environment (browsers and versions) is documented for the internal audit, " +
  "and no assistive technology was used (see “Screen reader journeys”).";
