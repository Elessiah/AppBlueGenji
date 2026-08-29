import { afterEach, describe, expect, it } from "@jest/globals";
import {
  LANDING_READ_RULE,
  STREAM_OPEN_RULE,
  TOURNAMENT_READ_RULE,
  VISIT_REQUEST_RULE,
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

  it("ne plafonne pas ce qu'il ne sait pas distinguer", () => {
    // Sans en-tête de proxy, TOUS les visiteurs partagent la même identité : les
    // plafonner ensemble refuserait la page d'accueil à cent joueurs au bout de
    // 180 requêtes cumulées. On préfère ne pas compter que compter faux.
    for (let i = 0; i < 20; i += 1) {
      expect(enforceRateLimit(RULE, null)).toBeNull();
      expect(enforceRateLimit(RULE, undefined)).toBeNull();
      expect(enforceRateLimit(RULE, "   ")).toBeNull();
    }

    // Une identité connue reste plafonnée normalement.
    enforceRateLimit(RULE, "1.2.3.4");
    enforceRateLimit(RULE, "1.2.3.4");
    expect(enforceRateLimit(RULE, "1.2.3.4")).not.toBeNull();
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
    const names = [
      TOURNAMENT_READ_RULE,
      LANDING_READ_RULE,
      STREAM_OPEN_RULE,
      VISIT_REQUEST_RULE,
    ].map((rule) => rule.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("rassemble tous les plafonds au même endroit", () => {
    // Un plafond déclaré dans son fichier de route échapperait à cet inventaire
    // — et donc à toute vérification de cohérence.
    for (const rule of [TOURNAMENT_READ_RULE, LANDING_READ_RULE, STREAM_OPEN_RULE, VISIT_REQUEST_RULE]) {
      expect(rule.limit).toBeGreaterThan(0);
      expect(rule.windowMs).toBeGreaterThan(0);
    }
  });

  it("borne le rythme d'ouverture des flux, que le plafond de flux simultanés laisse passer", () => {
    // Une fermeture libère aussitôt la place : sans ce seau, une boucle
    // ouverture/fermeture referait indéfiniment le travail le plus cher.
    expect(STREAM_OPEN_RULE.limit).toBeLessThan(TOURNAMENT_READ_RULE.limit);
  });
});
