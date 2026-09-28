import { afterEach, describe, expect, it } from "@jest/globals";
import { oauthErrorMessage } from "@/app/connexion/_lib/login-errors";
import {
  detectLoginEnvironment,
  loginEnvironmentAdvice,
  loginEnvironmentNotice,
  readLoginEnvironmentSignals,
} from "@/lib/shared/login-environment";

/**
 * Le conseil « change de navigateur » n'a de valeur que s'il tombe juste : dit
 * à tort, il envoie un joueur dans un autre navigateur pour une panne qui est
 * la nôtre ; tu, il laisse un joueur d'iPhone réessayer en boucle un
 * aller-retour qui ne peut pas aboutir.
 */

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36";
const ANDROID_WEBVIEW =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0 Mobile Safari/537.36";
const INSTAGRAM_IOS = `${IPHONE_SAFARI} Instagram 350.0.0.0`;
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

describe("detectLoginEnvironment", () => {
  it("reconnaît l'app lancée depuis l'écran d'accueil d'iOS par `navigator.standalone`", () => {
    expect(detectLoginEnvironment({ userAgent: IPHONE_SAFARI, iosStandalone: true })).toBe("IOS_INSTALLED_APP");
  });

  it("la reconnaît aussi par le mode d'affichage", () => {
    expect(detectLoginEnvironment({ userAgent: IPHONE_SAFARI, standaloneDisplay: true })).toBe("IOS_INSTALLED_APP");
  });

  it("reconnaît un iPad qui se présente en Mac, grâce à l'écran tactile", () => {
    expect(
      detectLoginEnvironment({ userAgent: IPAD_AS_MAC, standaloneDisplay: true, maxTouchPoints: 5 }),
    ).toBe("IOS_INSTALLED_APP");
  });

  it("ne prend pas un vrai Mac installé pour un iPad", () => {
    expect(
      detectLoginEnvironment({ userAgent: IPAD_AS_MAC, standaloneDisplay: true, maxTouchPoints: 0 }),
    ).toBe("BROWSER");
  });

  it("laisse tranquille Safari ordinaire sur iPhone", () => {
    expect(detectLoginEnvironment({ userAgent: IPHONE_SAFARI, iosStandalone: false })).toBe("BROWSER");
  });

  it("laisse tranquille une app installée par Chrome ou Android, qui partage les cookies", () => {
    expect(detectLoginEnvironment({ userAgent: ANDROID_CHROME, standaloneDisplay: true })).toBe("BROWSER");
    expect(detectLoginEnvironment({ userAgent: DESKTOP_CHROME, standaloneDisplay: true })).toBe("BROWSER");
  });

  it.each<[string, string]>([
    ["WebView Android", ANDROID_WEBVIEW],
    ["Instagram", INSTAGRAM_IOS],
    ["Facebook", `${IPHONE_SAFARI} [FBAN/FBIOS;FBAV/450.0]`],
    ["TikTok", `${ANDROID_CHROME} musical_ly_2023`],
  ])("reconnaît le navigateur intégré %s", (_name, userAgent) => {
    expect(detectLoginEnvironment({ userAgent })).toBe("IN_APP_BROWSER");
  });

  it("donne la priorité à l'app iOS installée sur le navigateur intégré", () => {
    expect(detectLoginEnvironment({ userAgent: INSTAGRAM_IOS, iosStandalone: true })).toBe("IOS_INSTALLED_APP");
  });

  it("ne voit rien d'anormal dans un navigateur de bureau", () => {
    expect(detectLoginEnvironment({ userAgent: DESKTOP_CHROME })).toBe("BROWSER");
  });
});

describe("loginEnvironmentAdvice", () => {
  it("se tait dans un navigateur ordinaire", () => {
    expect(loginEnvironmentAdvice("BROWSER")).toBeNull();
  });

  it.each(["IOS_INSTALLED_APP", "IN_APP_BROWSER"] as const)(
    "nomme les deux sorties pour %s : un autre navigateur et le code Discord",
    (environment) => {
      const advice = loginEnvironmentAdvice(environment) ?? "";
      expect(advice).toMatch(/navigateur|Safari/);
      expect(advice).toContain("code Discord");
    },
  );
});

describe("loginEnvironmentNotice", () => {
  it("ne prévient de rien dans un navigateur ordinaire", () => {
    expect(loginEnvironmentNotice("BROWSER")).toBeNull();
  });

  it.each(["IOS_INSTALLED_APP", "IN_APP_BROWSER"] as const)(
    "prévient avant le clic pour %s, et nomme le code Discord comme repli",
    (environment) => {
      const notice = loginEnvironmentNotice(environment) ?? "";
      expect(notice).toContain("Si elle échoue");
      expect(notice).toContain("code Discord");
    },
  );

  it("dit Safari à l'app iOS installée, seul navigateur qui partage ses cookies avec l'icône", () => {
    expect(loginEnvironmentNotice("IOS_INSTALLED_APP")).toContain("Safari");
  });
});

describe("oauthErrorMessage avec le contexte du navigateur", () => {
  const advice = loginEnvironmentAdvice("IOS_INSTALLED_APP") ?? "";

  it.each(["state", "oauth", "params", "session"])(
    "joint le conseil au refus « %s », que des cookies isolés expliquent",
    (kind) => {
      const message = oauthErrorMessage(kind, "discord", "IOS_INSTALLED_APP");
      expect(message).toContain(advice);
      // Le refus lui-même reste en tête.
      expect(message?.startsWith(oauthErrorMessage(kind, "discord") ?? "")).toBe(true);
    },
  );

  it.each(["not_configured", "unavailable", "terms"])(
    "ne joint rien au refus « %s », où le navigateur n'y est pour rien",
    (kind) => {
      expect(oauthErrorMessage(kind, "google", "IOS_INSTALLED_APP")).toBe(oauthErrorMessage(kind, "google"));
    },
  );

  it("ne change rien dans un navigateur ordinaire", () => {
    expect(oauthErrorMessage("state", "google", "BROWSER")).toBe(oauthErrorMessage("state", "google"));
  });

  it("reste muet sans motif, contexte ou non", () => {
    expect(oauthErrorMessage(null, "google", "IN_APP_BROWSER")).toBeNull();
  });
});

describe("readLoginEnvironmentSignals", () => {
  // Les tests tournent sous Node : `window` et `navigator` sont posés à la main.
  const globals = globalThis as Record<string, unknown>;
  const saved = { window: globals.window, navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator") };

  function stubBrowser(navigatorStub: object, matchMedia?: (query: string) => { matches: boolean }) {
    globals.window = { matchMedia };
    Object.defineProperty(globalThis, "navigator", { value: navigatorStub, configurable: true });
  }

  afterEach(() => {
    globals.window = saved.window;
    if (saved.navigator) Object.defineProperty(globalThis, "navigator", saved.navigator);
  });

  it("rend `null` côté serveur, sans `window`", () => {
    delete globals.window;
    expect(readLoginEnvironmentSignals()).toBeNull();
  });

  it("lit l'agent, `navigator.standalone`, l'écran tactile et le mode d'affichage", () => {
    stubBrowser(
      { userAgent: IPHONE_SAFARI, standalone: true, maxTouchPoints: 5 },
      (query) => ({ matches: query === "(display-mode: fullscreen)" }),
    );
    expect(readLoginEnvironmentSignals()).toEqual({
      userAgent: IPHONE_SAFARI,
      iosStandalone: true,
      standaloneDisplay: true,
      maxTouchPoints: 5,
    });
  });

  it("tolère un navigateur sans `matchMedia` ni `navigator.standalone`", () => {
    stubBrowser({ userAgent: DESKTOP_CHROME, maxTouchPoints: 0 });
    expect(readLoginEnvironmentSignals()).toMatchObject({ iosStandalone: false, standaloneDisplay: false });
  });
});
