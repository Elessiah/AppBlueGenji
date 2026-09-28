import { describe, expect, it } from "@jest/globals";
import {
  PUSH_BODY_MAX,
  PUSH_ENDPOINT_MAX,
  PUSH_SUPPORT_NOTICES,
  PUSH_TITLE_MAX,
  PUSH_TOPICS,
  PUSH_TOPIC_KEYS,
  buildPushPayload,
  canReceivePushTopic,
  decodeBase64Url,
  isAllowedPushEndpoint,
  isIosUserAgent,
  isPushTopic,
  parsePushSubscription,
  pushErrorMessage,
  pushSupport,
  pushTargetPath,
  sanitizeDisabledTopics,
  visiblePushTopics,
} from "@/lib/shared/push-notifications";

const P256DH = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 7)]).toString("base64url");
const AUTH = Buffer.alloc(16, 3).toString("base64url");
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc:def";

describe("registre des sujets", () => {
  it("donne à chaque sujet un libellé et une description", () => {
    for (const topic of PUSH_TOPIC_KEYS) {
      expect(PUSH_TOPICS[topic].label.length).toBeGreaterThan(0);
      expect(PUSH_TOPICS[topic].description.length).toBeGreaterThan(0);
    }
  });

  it("met le départ de match en tête : l'ordre des clés est celui de l'écran", () => {
    expect(PUSH_TOPIC_KEYS[0]).toBe("MATCH_START");
  });

  it("reconnaît ses sujets et rien d'autre", () => {
    expect(isPushTopic("MATCH_START")).toBe(true);
    expect(isPushTopic("toString")).toBe(false);
    expect(isPushTopic(42)).toBe(false);
  });

  it("réserve les alertes de staff à la permission qui les reçoit", () => {
    const player = { roles: [] };
    const referee = { roles: ["ARBITRE" as const] };
    expect(canReceivePushTopic(player, "REFEREE_ALERT")).toBe(false);
    expect(canReceivePushTopic(referee, "REFEREE_ALERT")).toBe(true);
    expect(canReceivePushTopic(referee, "STAFF_REPORT")).toBe(false);
    expect(canReceivePushTopic({ isAdmin: true }, "STAFF_REPORT")).toBe(true);
    expect(visiblePushTopics(player)).not.toContain("REFEREE_ALERT");
    expect(visiblePushTopics(player)).toContain("MATCH_START");
    expect(visiblePushTopics({ isAdmin: true })).toEqual(PUSH_TOPIC_KEYS);
  });

  it("nettoie une liste de sujets coupés reçue du réseau", () => {
    expect(sanitizeDisabledTopics(["MATCH_REMINDER", "INCONNU", "MATCH_START", "MATCH_START", 3])).toEqual([
      "MATCH_START",
      "MATCH_REMINDER",
    ]);
    expect(sanitizeDisabledTopics("MATCH_START")).toEqual([]);
    expect(sanitizeDisabledTopics(null)).toEqual([]);
  });
});

describe("pushTargetPath", () => {
  it("garde un chemin du site", () => {
    expect(pushTargetPath("/tournois/4#match-9")).toBe("/tournois/4#match-9");
  });

  it("ramène une URL absolue du site à son chemin", () => {
    expect(pushTargetPath("https://site.test/equipes/3", "https://site.test")).toBe("/equipes/3");
    expect(pushTargetPath("https://site.test", "https://site.test")).toBe("/");
  });

  it.each([
    "https://ailleurs.test/piege",
    "//ailleurs.test",
    "/\\ailleurs.test",
    "javascript:alert(1)",
    "relatif",
    "/\nailleurs",
  ])("refuse %j et retombe sur l'accueil", (url) => {
    expect(pushTargetPath(url, "https://site.test")).toBe("/");
  });
});

describe("buildPushPayload", () => {
  it("borne titre et corps, et étiquette par sujet par défaut", () => {
    const payload = buildPushPayload("MATCH_START", {
      title: "T".repeat(200),
      body: `  ${"b".repeat(1000)}  `,
      url: "/tournois",
    });
    expect(Array.from(payload.title)).toHaveLength(PUSH_TITLE_MAX);
    expect(payload.title.endsWith("…")).toBe(true);
    expect(Array.from(payload.body)).toHaveLength(PUSH_BODY_MAX);
    expect(payload.tag).toBe("MATCH_START");
    expect(payload.topic).toBe("MATCH_START");
  });

  it("replie les espaces et retombe sur le nom du site sans titre", () => {
    const payload = buildPushPayload("MATCH_START", { title: "   ", body: "a\n\n b", url: "/", tag: "x" });
    expect(payload.title).toBe("BlueGenji Esport");
    expect(payload.body).toBe("a b");
    expect(payload.tag).toBe("x");
  });

  it("filtre le lien", () => {
    expect(buildPushPayload("MATCH_START", { title: "t", body: "b", url: "https://evil.test" }).url).toBe("/");
  });

  it("coupe par caractère, sans casser un emoji", () => {
    const payload = buildPushPayload("MATCH_START", { title: "🎮".repeat(100), body: "", url: "/" });
    expect(Array.from(payload.title).every((char) => char === "🎮" || char === "…")).toBe(true);
  });
});

describe("isAllowedPushEndpoint", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/x",
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
    "https://web.push.apple.com/QJ",
  ])("accepte %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com:8443/x",
    "https://127.0.0.1/x",
    "https://evilfcm.googleapis.com.evil.test/x",
    "https://notfcm.googleapis.com.attacker.test/x",
    "https://user:pass@fcm.googleapis.com/x",
    "https://localhost/x",
    "pas une url",
  ])("refuse %s", (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it("refuse une adresse démesurée", () => {
    expect(isAllowedPushEndpoint(`https://fcm.googleapis.com/${"x".repeat(PUSH_ENDPOINT_MAX)}`)).toBe(false);
  });
});

describe("decodeBase64Url", () => {
  it("décode avec ou sans remplissage", () => {
    expect(Array.from(decodeBase64Url("AQID") ?? [])).toEqual([1, 2, 3]);
    expect(Array.from(decodeBase64Url("AQ==") ?? [])).toEqual([1]);
    expect(Array.from(decodeBase64Url("AQ") ?? [])).toEqual([1]);
    expect(Array.from(decodeBase64Url("-_8") ?? [])).toEqual([0xfb, 0xff]);
  });

  it("refuse ce qui n'est pas du base64url", () => {
    expect(decodeBase64Url("a+b/")).toBeNull();
    expect(decodeBase64Url("a b")).toBeNull();
    expect(decodeBase64Url("A")).toBeNull();
  });
});

describe("parsePushSubscription", () => {
  it("accepte l'abonnement que rend PushSubscription.toJSON()", () => {
    expect(
      parsePushSubscription({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } }),
    ).toEqual({ ok: true, value: { endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH } });
  });

  it("refuse un service de push inconnu, par un refus distinct", () => {
    expect(
      parsePushSubscription({ endpoint: "https://intranet.local/x", keys: { p256dh: P256DH, auth: AUTH } }),
    ).toEqual({ ok: false, error: "PUSH_SERVICE_NOT_ALLOWED" });
  });

  it.each([
    null,
    "abonnement",
    { endpoint: ENDPOINT },
    { endpoint: ENDPOINT, keys: { p256dh: P256DH } },
    { endpoint: ENDPOINT, keys: { p256dh: AUTH, auth: AUTH } },
    { endpoint: ENDPOINT, keys: { p256dh: Buffer.alloc(65, 5).toString("base64url"), auth: AUTH } },
    { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: P256DH } },
    { endpoint: 12, keys: { p256dh: P256DH, auth: AUTH } },
  ])("refuse une forme illisible (%#)", (input) => {
    expect(parsePushSubscription(input)).toEqual({ ok: false, error: "INVALID_PUSH_SUBSCRIPTION" });
  });
});

describe("pushSupport", () => {
  const base = {
    serviceWorker: true,
    pushManager: true,
    notification: true,
    permission: "default" as const,
    ios: false,
    standalone: false,
  };

  it("est disponible sur un navigateur complet", () => {
    expect(pushSupport(base)).toBe("AVAILABLE");
  });

  it("demande l'écran d'accueil sur iOS, avant même de chercher l'API", () => {
    expect(pushSupport({ ...base, ios: true, pushManager: false })).toBe("IOS_NEEDS_INSTALL");
    expect(pushSupport({ ...base, ios: true, standalone: true })).toBe("AVAILABLE");
  });

  it("dit l'absence d'API, puis la permission bloquée", () => {
    expect(pushSupport({ ...base, serviceWorker: false })).toBe("UNSUPPORTED");
    expect(pushSupport({ ...base, notification: false })).toBe("UNSUPPORTED");
    expect(pushSupport({ ...base, permission: "denied" })).toBe("DENIED");
  });

  it("a une phrase pour chaque cas où le bouton n'est pas offert", () => {
    for (const notice of Object.values(PUSH_SUPPORT_NOTICES)) expect(notice.length).toBeGreaterThan(10);
  });
});

describe("isIosUserAgent", () => {
  it("reconnaît iPhone, iPad et l'iPad qui se dit Macintosh", () => {
    expect(isIosUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5)).toBe(true);
    expect(isIosUserAgent("Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)", 5)).toBe(true);
    expect(isIosUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
  });

  it("ne prend ni un Mac ni un Android pour un iPhone", () => {
    expect(isIosUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(isIosUserAgent("Mozilla/5.0 (Linux; Android 14)", 5)).toBe(false);
  });
});

describe("pushErrorMessage", () => {
  it("traduit un code connu et retombe sur une phrase sinon", () => {
    expect(pushErrorMessage("PUSH_SERVICE_NOT_ALLOWED")).toMatch(/navigateur/);
    expect(pushErrorMessage("INCONNU")).toMatch(/Réessaie/);
    expect(pushErrorMessage(null)).toMatch(/Réessaie/);
  });
});

describe("déclaration du traitement", () => {
  it("figure au registre avec la durée que le serveur applique, et aux changements de politique", async () => {
    const { PROCESSING_ACTIVITIES } = await import("@/lib/shared/processing-register");
    const { PRIVACY_CHANGES } = await import("@/lib/shared/privacy-changes");
    const { PUSH_SUBSCRIPTION_RETENTION_DAYS } = await import("@/lib/shared/push-notifications");
    const activity = PROCESSING_ACTIVITIES.find((entry) => entry.name === "Notifications push");
    expect(activity?.retention.join(" ")).toContain(`${PUSH_SUBSCRIPTION_RETENTION_DAYS} jours`);
    expect(activity?.legalBasis).toMatch(/Consentement/);
    const change = PRIVACY_CHANGES.find((entry) => entry.id === "2026-09-notifications-push");
    expect(change?.details.join(" ")).toContain(`${PUSH_SUBSCRIPTION_RETENTION_DAYS} jours`);
  });

  it("déclare un manifeste en mode autonome, condition du push sur iPhone", async () => {
    const { default: manifest } = await import("@/app/manifest");
    expect(manifest().display).toBe("standalone");
  });
});
