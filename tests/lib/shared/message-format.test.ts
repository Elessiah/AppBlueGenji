import { describe, expect, it } from "@jest/globals";
import { createTranslator } from "next-intl";
import { messagesFor } from "@/lib/server/i18n-messages";
import { A11Y_SETTINGS } from "@/lib/shared/accessibility-settings";
import { CONFORMITY_LABELS, accessibilityFooterLabel } from "@/lib/shared/accessibility-statement";
import { REPORT_FORM_NAME } from "@/lib/shared/legal-contact";
import { LOCALES, SITE_TIME_ZONE } from "@/lib/shared/locales";
import { formatMessage, formatMessageParts, parseMessage } from "@/lib/shared/message-format";
import { FR_SHELL_MESSAGES, shellMessage, shellText, type ShellKey } from "@/lib/shared/shell-text";
import { SOURCE_CODE_LINK_LABEL } from "@/lib/shared/source-code";
import { readSource } from "../../helpers/read-source";

type Tree = { [key: string]: string | Tree };

/** Chaque clé feuille de la coquille, par son chemin pointé. */
function leafKeys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : leafKeys(value, path);
  });
}

/** Une valeur par argument du message — y compris des pluriels à éprouver. */
function sampleValues(message: string, count: number): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [, name, type] of message.matchAll(/\{\s*([A-Za-z_]\w*)\s*(?:,\s*(\w+))?/g)) {
    values[name] = type === "plural" ? count : `«${name}»`;
  }
  return values;
}

describe("formatMessage — sous-ensemble d'ICU", () => {
  it("rend le texte tel quel, apostrophes comprises", () => {
    expect(formatMessage("fr", "Réglages d'accessibilité")).toBe("Réglages d'accessibilité");
    expect(formatMessage("en", "Turn all off")).toBe("Turn all off");
  });

  it("insère les arguments sans les interpréter", () => {
    expect(formatMessage("fr", "Mon équipe : {team}", { team: "Les {Ours} <b>" })).toBe("Mon équipe : Les {Ours} <b>");
    expect(formatMessage("en", "{a}-{a}", { a: 2 })).toBe("2-2");
    expect(formatMessage("en", "x{missing}y")).toBe("xy");
  });

  it("choisit la branche de pluriel selon la langue, `=n` d'abord", () => {
    const fr = "{count, plural, =0 {aucun} one {# actif} other {# actifs}}";
    expect(formatMessage("fr", fr, { count: 0 })).toBe("aucun");
    expect(formatMessage("fr", fr, { count: 1 })).toBe("1 actif");
    expect(formatMessage("fr", fr, { count: 2 })).toBe("2 actifs");
    expect(formatMessage("fr", "{n, plural, one {# x} other {# xs}}", { n: 0 })).toBe("0 x");
    expect(formatMessage("en", "{n, plural, one {# x} other {# xs}}", { n: 0 })).toBe("0 xs");
    expect(formatMessage("en", "{n, plural, one {# x} other {# xs}}", { n: 1200 })).toBe("1,200 xs");
  });

  it("confie les balises à l'appelant, ou n'en garde que le contenu", () => {
    const parts = formatMessageParts("fr", "Recopie <strong>{text}</strong> pour confirmer", { text: "Les Bleus" }, {
      strong: (children) => ({ tag: "strong", children }),
    });
    expect(parts).toEqual(["Recopie ", { tag: "strong", children: ["Les Bleus"] }, " pour confirmer"]);
    expect(formatMessage("fr", "a <b>gras</b> z")).toBe("a gras z");
  });

  it("refuse ce qu'il ne sait pas interpréter, au lieu d'afficher autre chose", () => {
    for (const source of [
      "{n, select, a {x} other {y}}",
      "{n, number}",
      "{n, plural, one {x}}",
      "a } b",
      "a </b> c",
      "<b>a",
      "{ 1x }",
      "{n",
    ]) {
      expect(() => parseMessage(source)).toThrow(/Message ICU non pris en charge/);
    }
  });
});

describe("coquille — équivalence avec next-intl, message par message", () => {
  const keys = leafKeys(FR_SHELL_MESSAGES);

  it("couvre toute la coquille", () => {
    expect(keys.length).toBeGreaterThan(80);
  });

  it.each(LOCALES.map((locale) => [locale]))("%s : même texte que next-intl, pluriels compris", (locale) => {
    const messages = messagesFor(locale);
    const reference = createTranslator({ locale, messages, timeZone: SITE_TIME_ZONE, namespace: "shell" });
    const ours = shellText(locale, messages.shell);
    for (const key of keys) {
      const source = shellMessage(messages.shell, key);
      expect(source).toBeDefined();
      for (const count of [0, 1, 2, 5]) {
        const values = sampleValues(source ?? "", count);
        const expected = reference.markup(key as Parameters<typeof reference.markup>[0], {
          ...values,
          strong: (chunks: string) => `<strong>${chunks}</strong>`,
          // Lien des conditions (`termsModal.checkbox`, lot 7b).
          terms: (chunks: string) => `<terms>${chunks}</terms>`,
          // Lien de la politique (`privacyModal.policy`, lot 7b-2).
          policy: (chunks: string) => `<policy>${chunks}</policy>`,
        });
        const actual = ours
          .rich<string>(key as ShellKey, values, {
            strong: (children) => `<strong>${children.join("")}</strong>`,
            terms: (children) => `<terms>${children.join("")}</terms>`,
            policy: (children) => `<policy>${children.join("")}</policy>`,
          })
          .join("");
        expect(`${key}: ${actual}`).toBe(`${key}: ${expected}`);
      }
    }
  });

  it("une clé inconnue s'affiche telle quelle plutôt que de faire tomber la page", () => {
    expect(shellText("fr").t("nope.missing" as ShellKey)).toBe("nope.missing");
  });
});

/**
 * Les règles (`rules`, lot 3) passent aussi par ce formateur, côté serveur
 * (`components/rules/RuleText.tsx`) : chaque message doit y donner le même
 * texte que `next-intl`, gras compris.
 */
describe("règles — équivalence avec next-intl, message par message", () => {
  type Leaf = { key: string; source: string };
  const leaves = (tree: unknown, prefix = ""): Leaf[] =>
    typeof tree === "string"
      ? [{ key: prefix, source: tree }]
      : Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));

  it.each(LOCALES.map((locale) => [locale]))("%s", (locale) => {
    const messages = leaves(messagesFor(locale).rules);
    expect(messages.length).toBeGreaterThan(300);
    for (const { key, source } of messages) {
      const reference = createTranslator({ locale, messages: { m: source }, timeZone: SITE_TIME_ZONE });
      for (const count of [0, 1, 2]) {
        const values = sampleValues(source, count);
        const expected = reference.markup("m", { ...values, b: (chunks: string) => `<b>${chunks}</b>` });
        const actual = formatMessageParts<string>(locale, source, values, { b: (children) => `<b>${children.join("")}</b>` }).join("");
        expect(`${key}: ${actual}`).toBe(`${key}: ${expected}`);
      }
    }
  });
});

describe("coquille — le français reprend les textes de référence", () => {
  it("réglages d'accessibilité : mêmes intitulés que la déclaration", () => {
    for (const setting of A11Y_SETTINGS) {
      expect(FR_SHELL_MESSAGES.a11yMenu.settings[setting.key]).toEqual({
        label: setting.label,
        description: setting.description,
      });
    }
    expect(Object.keys(FR_SHELL_MESSAGES.a11yMenu.settings).sort()).toEqual(A11Y_SETTINGS.map((s) => s.key).sort());
  });

  it("mention RGAA du pied de page, code source, signalement", () => {
    expect(FR_SHELL_MESSAGES.footer.conformity).toEqual(CONFORMITY_LABELS);
    for (const status of ["TOTAL", "PARTIAL", "NONE"] as const) {
      expect(
        shellText("fr").t("footer.accessibilityStatus", { status: shellText("fr").t(`footer.conformity.${status}`) }),
      ).toBe(accessibilityFooterLabel(status));
    }
    expect(FR_SHELL_MESSAGES.footer.links.sourceCode).toBe(SOURCE_CODE_LINK_LABEL);
    expect(FR_SHELL_MESSAGES.footer.reportProblem).toBe(REPORT_FORM_NAME);
  });

  it("l'anglais applique le glossaire figé", () => {
    const en = messagesFor("en").shell;
    expect(en.nav.links).toMatchObject({ players: "Players", teams: "Teams", tournaments: "Tournaments" });
    expect(en.nav.reports).toBe("Reports");
    expect(en.footer.links.volunteers).toBe("Volunteers");
    expect(en.footer.links.partners).toBe("Partners");
  });
});

describe("mise en page racine", () => {
  const layout = readSource("app/layout.tsx");

  it("ne sérialise les textes de la coquille que hors français", () => {
    expect(layout).toContain("const shellMessages = locale === DEFAULT_LOCALE ? undefined : messagesFor(locale).shell;");
    expect(layout).toContain("<ShellTextProvider locale={locale} messages={shellMessages}>");
  });

  it("enveloppe les notifications, le menu d'accessibilité et le lien d'évitement", () => {
    const provider = layout.indexOf("<ShellTextProvider");
    expect(provider).toBeGreaterThan(0);
    for (const child of ["<ToastProvider>", "<AccessibilityMenu", "<SkipLink />"]) {
      expect(layout.indexOf(child)).toBeGreaterThan(provider);
    }
  });

  it("aucun composant de la coquille n'importe next-intl côté client", () => {
    for (const file of [
      "components/i18n/shell-text.tsx",
      "components/ui/toast.tsx",
      "components/ui/confirm-action-dialog.tsx",
      "components/accessibility/AccessibilityMenu.tsx",
      "components/accessibility/SkipLink.tsx",
      "components/arena-nav.tsx",
      "components/account-menu.tsx",
      "components/cyber/landing/PublicNavMenu.tsx",
      "components/legal/SiteFooterBar.tsx",
      "app/error.tsx",
      "app/global-error.tsx",
      "lib/shared/shell-text.ts",
      "lib/shared/message-format.ts",
    ]) {
      expect(`${file}: ${readSource(file)}`).not.toMatch(/from "next-intl/);
    }
  });
});
