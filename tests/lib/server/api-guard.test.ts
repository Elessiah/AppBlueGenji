import { afterEach, describe, expect, it } from "@jest/globals";
import {
  LANDING_READ_RULE,
  TOURNAMENT_READ_RULE,
  enforceRateLimit,
  requestClientIp,
} from "@/lib/server/api-guard";
import { resetRateLimit, type RateLimitRule } from "@/lib/server/rate-limit";

const RULE: RateLimitRule = { name: "guard-test", limit: 2, windowMs: 60_000 };

afterEach(() => {
  resetRateLimit();
  delete process.env.TRUSTED_PROXY_HOPS;
});

const request = (headers: Record<string, string>) =>
  new Request("https://bluegenji.test/api/landing/live", { headers });

describe("requestClientIp", () => {
  it("retient l'IP ajoutée par le proxy de confiance", () => {
    // `X-Forwarded-For` se lit de gauche à droite : chaque relais ajoute à
    // droite l'adresse dont il a reçu la requête. La partie gauche vient du
    // client et est falsifiable — sans quoi il suffirait de forger l'en-tête
    // pour se fabriquer une identité neuve à chaque requête et échapper au
    // plafond. Avec un seul nginx devant l'app, la bonne valeur est la dernière.
    expect(requestClientIp(request({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("2.2.2.2");
  });

  it("suit le nombre de relais déclarés", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(
      requestClientIp(request({ "x-forwarded-for": "9.9.9.9, 1.1.1.1, 2.2.2.2" })),
    ).toBe("1.1.1.1");
  });

  it("ne sort pas des bornes si la chaîne est plus courte qu'annoncé", () => {
    process.env.TRUSTED_PROXY_HOPS = "5";
    expect(requestClientIp(request({ "x-forwarded-for": "1.1.1.1" }))).toBe("1.1.1.1");
  });

  it("retombe sur x-real-ip à défaut", () => {
    expect(requestClientIp(request({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
  });

  it("rend null quand rien n'identifie le client", () => {
    expect(requestClientIp(request({}))).toBeNull();
  });
});

describe("enforceRateLimit", () => {
  it("laisse passer sous le plafond", () => {
    expect(enforceRateLimit(RULE, "a")).toBeNull();
    expect(enforceRateLimit(RULE, "a")).toBeNull();
  });

  it("refuse en 429 au-delà", async () => {
    enforceRateLimit(RULE, "a");
    enforceRateLimit(RULE, "a");

    const response = enforceRateLimit(RULE, "a");
    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);
    await expect(response!.json()).resolves.toEqual({ error: "TOO_MANY_REQUESTS" });
  });

  it("indique au client combien de temps attendre", () => {
    enforceRateLimit(RULE, "a");
    enforceRateLimit(RULE, "a");

    const response = enforceRateLimit(RULE, "a")!;
    const retryAfter = Number(response.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    // La réponse de refus ne doit jamais être mise en cache à la place de la
    // vraie donnée.
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("range les clients non identifiés ensemble", () => {
    // Sans identité, un client pourrait sinon échapper à tout plafond.
    expect(enforceRateLimit(RULE, null)).toBeNull();
    expect(enforceRateLimit(RULE, undefined)).toBeNull();
    expect(enforceRateLimit(RULE, "")).not.toBeNull();
  });
});

describe("plafonds des routes", () => {
  it("reste large devant les cadences de rafraîchissement", () => {
    // La liste se rafraîchit au mieux une fois par minute, le détail au mieux
    // toutes les 15 s : personne ne doit rencontrer ces plafonds en naviguant.
    expect(TOURNAMENT_READ_RULE.limit).toBeGreaterThanOrEqual(60);
    expect(TOURNAMENT_READ_RULE.windowMs).toBe(60_000);
    expect(LANDING_READ_RULE.limit).toBeGreaterThanOrEqual(TOURNAMENT_READ_RULE.limit);
  });

  it("garde des seaux distincts par route", () => {
    expect(TOURNAMENT_READ_RULE.name).not.toBe(LANDING_READ_RULE.name);
  });
});
