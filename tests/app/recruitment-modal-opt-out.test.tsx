import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RecruitmentHighlight,
  recordRecruitmentModalOptOut,
  recruitmentOptOutToast,
} from "@/components/recruitment-highlight";
import { RecruitmentTextProvider } from "@/components/i18n/recruitment-text";
import { messagesFor } from "@/lib/server/i18n-messages";
import {
  RECRUITMENT_MODAL_OFF_COOKIE,
  RECRUITMENT_MODAL_OFF_MAX_AGE,
  recruitmentModalOffInBrowser,
  recruitmentModalOptedOut,
  type RecruitmentAd,
} from "@/lib/shared/recruitment";
import { recruitmentClientMessages } from "@/lib/shared/recruitment-text";
import { readSource } from "../helpers/read-source";

/**
 * « Ne plus afficher » sur la modale d'arrivée du recrutement
 * (`docs/features/RECRUITMENT.md` § Ne plus afficher) : gardé sur le compte
 * connecté, sinon sur ce navigateur, reporté au compte à la connexion
 * (`tests/lib/server/auth.test.ts`).
 */

function ad(overrides: Partial<RecruitmentAd> = {}): RecruitmentAd {
  return {
    id: 42,
    title: "Cherche coach Overwatch",
    titleEn: null,
    rolesEn: null,
    bodyEn: null,
    teamName: "Test - Eclipse",
    domain: "AUTRE",
    roles: "Coach",
    body: "Description de l'annonce.",
    contactUrl: null,
    contactDiscord: null,
    contactDiscordId: null,
    contactPreferred: "AUTO",
    priority: "PRIORITY",
    active: true,
    ...overrides,
  };
}

type Props = Parameters<typeof RecruitmentHighlight>[0];

const props = (overrides: Partial<Props> = {}): Props => ({
  modalAds: [ad()],
  modalSilenced: false,
  modalSeen: [],
  bannerAds: [],
  bannerDismissed: false,
  onAdPage: false,
  ...overrides,
});

describe("recruitmentModalOptedOut — qui a dit « Ne plus afficher »", () => {
  it("tait la modale pour un compte qui l'a posé, quel que soit le navigateur (autres appareils)", () => {
    expect(recruitmentModalOptedOut({ accountOff: true, browserCookie: undefined })).toBe(true);
  });

  it("tait la modale sur le navigateur qui porte le cookie, connecté ou non", () => {
    expect(recruitmentModalOptedOut({ accountOff: undefined, browserCookie: "1" })).toBe(true);
    expect(recruitmentModalOptedOut({ accountOff: false, browserCookie: "1" })).toBe(true);
  });

  it("laisse la modale s'ouvrir sans aucun des deux, ou sur une valeur forgée", () => {
    expect(recruitmentModalOptedOut({ accountOff: false, browserCookie: undefined })).toBe(false);
    expect(recruitmentModalOptedOut({ accountOff: undefined, browserCookie: null })).toBe(false);
    for (const forged of ["", "0", "true", "1 ", "11"]) expect(recruitmentModalOffInBrowser(forged)).toBe(false);
  });

  it("garde le cookie un an au plus (plafond des navigateurs : 400 jours)", () => {
    expect(RECRUITMENT_MODAL_OFF_MAX_AGE).toBe(365 * 24 * 60 * 60);
  });
});

describe("modale d'arrivée — bouton « Ne plus afficher »", () => {
  it("est rendu en français, en bouton distinct de « Plus tard »", () => {
    const markup = renderToStaticMarkup(<RecruitmentHighlight {...props()} />);
    expect(markup).toContain(">Ne plus afficher</button>");
    expect(markup).toContain("Plus tard");
  });

  it("est rendu en anglais sous /en", () => {
    const messages = recruitmentClientMessages(messagesFor("en").recruitment);
    const markup = renderToStaticMarkup(
      <RecruitmentTextProvider locale="en" messages={messages}>
        <RecruitmentHighlight {...props()} />
      </RecruitmentTextProvider>,
    );
    expect(markup).toContain(">Don&#x27;t show again</button>");
    expect(markup).not.toContain("Ne plus afficher");
  });

  it("a ses textes de toast dans les deux langues", () => {
    for (const locale of ["fr", "en"] as const) {
      const highlight = messagesFor(locale).recruitment.highlight;
      expect(highlight.dontShowAgain).toBeTruthy();
      expect(highlight.dontShowAgainDone).toBeTruthy();
      expect(highlight.dontShowAgainDoneBrowser).toBeTruthy();
      expect(highlight.dontShowAgainUnsaved).toBeTruthy();
    }
  });

  it("dit au lecteur non connecté que le choix ne vaut que pour ce navigateur (FR et EN)", () => {
    expect(messagesFor("fr").recruitment.highlight.dontShowAgainDoneBrowser).toContain("sur ce navigateur");
    expect(messagesFor("en").recruitment.highlight.dontShowAgainDoneBrowser).toContain("on this browser");
    expect(messagesFor("fr").recruitment.highlight.dontShowAgainDone).not.toContain("navigateur");
  });

  it("vient après « Plus tard », « Lire » et « Postuler » dans l'ordre du focus (Entrée pour fermer ne coupe jamais la modale)", () => {
    for (const modalAds of [[ad({ contactUrl: "https://example.test/postuler" })], [ad(), ad({ id: 43 })]]) {
      const markup = renderToStaticMarkup(<RecruitmentHighlight {...props({ modalAds })} />);
      const optOut = markup.indexOf(">Ne plus afficher</button>");
      expect(optOut).toBeGreaterThan(markup.indexOf(">Plus tard</button>"));
      expect(optOut).toBeGreaterThan(markup.indexOf("Lire l&#x27;annonce"));
      if (modalAds.length > 1) expect(markup.indexOf("← Précédente")).toBeLessThan(markup.indexOf(">Plus tard</button>"));
    }
  });

  it("n'impose aucun focus d'ouverture : le premier focalisable reste « Plus tard » sans pager, le pager sinon", () => {
    const markup = renderToStaticMarkup(<RecruitmentHighlight {...props()} />);
    expect(markup).not.toContain("data-autofocus");
    expect(markup.indexOf(">Plus tard</button>")).toBeLessThan(markup.indexOf(">Ne plus afficher</button>"));
  });

  it("dit « openings » en anglais, jamais « ads » (glossaire I18N.md : Annonces → Openings)", () => {
    const highlight = messagesFor("en").recruitment.highlight;
    for (const text of [
      highlight.dontShowAgain,
      highlight.dontShowAgainDone,
      highlight.dontShowAgainDoneBrowser,
      highlight.dontShowAgainUnsaved,
    ]) {
      expect(text).not.toMatch(/\bads?\b/i);
    }
    expect(highlight.dontShowAgainDone).toContain("openings");
  });

  it("laisse la modale s'ouvrir tant que rien n'est posé", () => {
    expect(renderToStaticMarkup(<RecruitmentHighlight {...props({ modalOptedOut: false })} />)).toContain('role="dialog"');
  });

  it("disparaît avec la modale une fois le choix fait (décidé par la mise en page), la banderole restant", () => {
    const markup = renderToStaticMarkup(
      <RecruitmentHighlight {...props({ modalOptedOut: true, bannerAds: [ad({ id: 44, priority: "IMPORTANT" })] })} />,
    );
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain("Ne plus afficher");
    expect(markup).toContain("Annonces de recrutement");
  });
});

describe("recordRecruitmentModalOptOut", () => {
  type Post = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  /** Le délai de la seconde tentative, sans attente réelle. */
  const noWait = async (_ms: number) => undefined;
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const reply = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body });

  it("non connecté : pose le cookie du navigateur, puis le fait reposer par le serveur (ITP), sans attendre", async () => {
    const writeCookie = jest.fn<(name: string, value: string, maxAge?: number) => boolean>(() => true);
    const hanging = jest.fn<Post>(() => new Promise<never>(() => undefined));
    expect(await recordRecruitmentModalOptOut(false, { writeCookie, post: hanging, wait: noWait })).toBe("BROWSER");
    expect(writeCookie).toHaveBeenCalledWith(RECRUITMENT_MODAL_OFF_COOKIE, "1", RECRUITMENT_MODAL_OFF_MAX_AGE);
    expect(hanging).toHaveBeenCalledWith("/api/recruitment/modal-dismiss");
  });

  it("non connecté : retente une fois, après un délai, un renouvellement qui n'aboutit pas (réseau ou 5xx)", async () => {
    for (const first of [() => Promise.reject(new Error("offline")), () => Promise.resolve(reply(502))]) {
      const wait = jest.fn(async (_ms: number) => undefined);
      const post = jest.fn<Post>().mockImplementationOnce(first).mockResolvedValueOnce(reply(200, { account: false }));
      expect(await recordRecruitmentModalOptOut(false, { writeCookie: () => true, post, wait })).toBe("BROWSER");
      await flush();
      expect(wait).toHaveBeenCalledWith(2_000);
      expect(post).toHaveBeenCalledTimes(2);
    }
  });

  it("non connecté : pas de seconde tentative quand le serveur a répondu, et deux échecs restent silencieux", async () => {
    const wait = jest.fn(async (_ms: number) => undefined);
    const ok = jest.fn<Post>().mockResolvedValue(reply(200, { account: false }));
    await recordRecruitmentModalOptOut(false, { writeCookie: () => true, post: ok, wait });
    await flush();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    const down = jest.fn<Post>().mockRejectedValue(new Error("offline"));
    expect(await recordRecruitmentModalOptOut(false, { writeCookie: () => true, post: down, wait })).toBe("BROWSER");
    await flush();
    expect(down).toHaveBeenCalledTimes(2);
  });

  it("connecté : pose le cookie d'abord, puis le choix sur le compte, en une seule tentative", async () => {
    const order: string[] = [];
    const writeCookie = jest.fn(() => order.push("cookie") > 0);
    const post = jest.fn<Post>(async (url: string) => {
      order.push(url);
      return reply(200, { account: true });
    });
    expect(await recordRecruitmentModalOptOut(true, { writeCookie, post, wait: noWait })).toBe("ACCOUNT");
    expect(order).toEqual(["cookie", "/api/recruitment/modal-dismiss"]);
  });

  it("connecté, compte non écrit (réseau, délai, 5xx) : succès « compte », rattrapé à la page suivante — aucune seconde tentative attendue", async () => {
    for (const fails of [() => Promise.reject(new Error("offline")), () => Promise.resolve(reply(500)), () => Promise.resolve(reply(502))]) {
      const wait = jest.fn(async (_ms: number) => undefined);
      const post = jest.fn<Post>().mockImplementation(fails);
      expect(await recordRecruitmentModalOptOut(true, { writeCookie: () => true, post, wait })).toBe("ACCOUNT");
      await flush();
      expect(post).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    }
  });

  it("connecté au chargement, session finie (account: false) ou compte supprimé (409) depuis : traité comme non connecté", async () => {
    for (const gone of [reply(200, { account: false }), reply(409, { error: "ACCOUNT_DELETED" })]) {
      expect(await recordRecruitmentModalOptOut(true, { writeCookie: () => true, post: async () => gone, wait: noWait })).toBe(
        "ACCOUNT",
      );
    }
  });

  it("cookie refusé au script : relu après la réponse, dont le Set-Cookie a pu le garder", async () => {
    let serverCookie = false;
    const sets = async () => {
      serverCookie = true;
      return reply(200, { account: false });
    };
    const cookieKept = () => serverCookie;
    expect(await recordRecruitmentModalOptOut(false, { writeCookie: () => false, cookieKept, post: sets, wait: noWait })).toBe(
      "BROWSER",
    );
    serverCookie = false;
    const down = async () => {
      throw new Error("offline");
    };
    expect(await recordRecruitmentModalOptOut(false, { writeCookie: () => false, cookieKept, post: down, wait: noWait })).toBe(
      "NONE",
    );
    expect(await recordRecruitmentModalOptOut(true, { writeCookie: () => false, cookieKept, post: down, wait: noWait })).toBe(
      "NONE",
    );
    expect(
      await recordRecruitmentModalOptOut(true, {
        writeCookie: () => false,
        cookieKept,
        post: async () => reply(200, { account: true }),
        wait: noWait,
      }),
    ).toBe("ACCOUNT");
  });

  it("borne l'attente du serveur sans AbortSignal.timeout (absent de Safari 15)", () => {
    const source = readSource("components/recruitment-highlight.tsx");
    expect(source).toContain("setTimeout(() => controller.abort(), OPT_OUT_TIMEOUT_MS)");
    expect(source).toContain('fetch(url, { method: "POST", keepalive: true, signal: controller.signal })');
    expect(source).not.toMatch(/AbortSignal\.timeout\(/);
    expect(source).toContain("const OPT_OUT_TIMEOUT_MS = 10_000;");
  });

  it("garde le bas de la modale visible sous les barres du navigateur mobile (dvh)", () => {
    const css = readSource("components/recruitment-highlight.module.css");
    expect(css).toMatch(/\.modal \{[^}]*max-height: 90vh;\s*max-height: 90dvh;/);
  });

  it("pose le cookie de façon synchrone, avant tout await (la modale se ferme aussitôt)", () => {
    const writeCookie = jest.fn(() => true);
    void recordRecruitmentModalOptOut(true, { writeCookie, post: () => new Promise(() => undefined), wait: noWait });
    expect(writeCookie).toHaveBeenCalledTimes(1);
  });
});

describe("recruitmentOptOutToast — le toast dit où le choix a été gardé", () => {
  it("succès sur le compte, succès « ce navigateur » non connecté, erreur si rien n'a pu être gardé", () => {
    expect(recruitmentOptOutToast("ACCOUNT")).toEqual({ kind: "success", key: "dontShowAgainDone" });
    expect(recruitmentOptOutToast("BROWSER")).toEqual({ kind: "success", key: "dontShowAgainDoneBrowser" });
    expect(recruitmentOptOutToast("NONE")).toEqual({ kind: "error", key: "dontShowAgainUnsaved" });
  });
});

describe("rattrapage du compte depuis le cookie, à chaque page connectée", () => {
  it("la mise en page racine l'appelle avec la session et le cookie du navigateur", () => {
    const layout = readSource("app/layout.tsx");
    expect(layout).toContain("healRecruitmentModalOff({");
    expect(layout).toContain("accountOff: user?.recruitmentModalOff,");
  });
});

describe("cookies de la mise en avant — envoyés aussi quand la visite vient d'un autre site", () => {
  it("sont posés en SameSite lax, jamais strict (lien Discord, recherche, retour d'OAuth)", () => {
    const source = readSource("components/recruitment-highlight.tsx");
    expect(source).toContain("path=/; samesite=lax");
    expect(source).not.toMatch(/samesite=strict/i);
  });

  it("sont décrits en lax sur /rgpd, en français et en anglais", () => {
    for (const file of ["app/rgpd/page.tsx", "app/rgpd/RgpdEn.tsx"]) {
      const page = readSource(file);
      expect(page).not.toContain("sameSite=strict");
      expect(page.match(/\(sameSite=lax\)/g)?.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("fermer ≠ ne plus afficher", () => {
  const source = readSource("components/recruitment-highlight.tsx");
  const body = (name: string) => {
    // La dernière occurrence : celle de la modale (la banderole a son propre `dismiss`).
    const start = source.lastIndexOf(`function ${name}()`);
    return source.slice(start, source.indexOf("\n  }\n", start));
  };

  it("« Plus tard », Échap et le voile gardent leur règle : ils ne posent pas le cookie de refus", () => {
    expect(body("dismiss")).toContain("RECRUITMENT_MODAL_COOKIE,");
    expect(body("dismiss")).not.toContain("RECRUITMENT_MODAL_OFF_COOKIE");
    expect(source).toContain("useDialogBehavior({ open, onClose: dismiss })");
    expect(source).toContain("useBackdropDismiss(dismiss)");
  });

  it("seul « Ne plus afficher » appelle le refus", () => {
    expect(source.match(/recordRecruitmentModalOptOut\(signedIn\)/g)).toHaveLength(1);
    expect(source).toContain("onClick={() => void optOut()}");
  });

  it("la mise en page racine lit le choix du compte avec la session et le cookie du navigateur", () => {
    const layout = readSource("app/layout.tsx");
    expect(layout).toContain("accountOff: user?.recruitmentModalOff");
    expect(layout).toContain("cookieStore.get(RECRUITMENT_MODAL_OFF_COOKIE)?.value");
    expect(layout).toContain("signedIn={user !== null}");
  });
});
