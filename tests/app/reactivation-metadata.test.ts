import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const locale: { current: "fr" | "en" } = { current: "fr" };
jest.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
jest.mock("@/lib/server/request-locale", () => ({ requestLocale: async () => locale.current }));
jest.mock("@/lib/server/users/account-reactivation", () => ({
  peekReactivationTicket: async () => null,
  reactivationCookieName: () => "bg_reactivation",
}));
jest.mock("@/app/connexion/reactivation/ReactivationPanel", () => ({ ReactivationPanel: () => null }));

import { generateMetadata } from "@/app/connexion/reactivation/page";
import { messagesFor } from "@/lib/server/i18n-messages";
import { ACCOUNT_REACTIVATION_DAYS } from "@/lib/shared/account-deletion";
import { formatMessage } from "@/lib/shared/message-format";

beforeEach(() => {
  locale.current = "fr";
});

describe("métadonnées de l'écran de réactivation", () => {
  it.each(["fr", "en"])("%s : titre propre à l'écran, jamais celui de la connexion, noindex", async (lang) => {
    locale.current = lang === "en" ? "en" : "fr";
    const meta = await generateMetadata();
    const { reactivation, meta: loginMeta } = messagesFor(locale.current).login;
    expect(meta.title).toBe(reactivation.title);
    expect(meta.title).not.toBe(loginMeta.title);
    // Description propre aussi, pas celle de la connexion.
    expect(meta.description).toBe(
      formatMessage(locale.current, reactivation.metaDescription, { days: ACCOUNT_REACTIVATION_DAYS }),
    );
    expect(meta.description).not.toContain("{days}");
    expect(meta.description).toContain(String(ACCOUNT_REACTIVATION_DAYS));
    expect(meta.description).not.toBe(loginMeta.description);
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(JSON.stringify(meta.alternates)).toContain("/connexion/reactivation");
  });
});
