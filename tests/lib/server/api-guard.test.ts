import { afterEach, describe, expect, it } from "@jest/globals";
import {
  LANDING_READ_RULE,
  STREAM_OPEN_RULE,
  TOURNAMENT_READ_RULE,
  VISIT_REQUEST_RULE,
  clientNetworkKey,
  enforceRateLimit,
  peekRateToken,
  refundRateToken,
  takeRateToken,
  peekRateLimit,
  requestClientIp,
} from "@/lib/server/api-guard";
import { resetRateLimit, type RateLimitRule, type TokenBucketRule } from "@/lib/server/rate-limit";

const RULE: RateLimitRule = { name: "guard-test", limit: 2, windowMs: 60_000 };

afterEach(() => {
  resetRateLimit();
  delete process.env.TRUSTED_PROXY_HOPS;
  delete process.env.TRUSTED_PROXY_REAL_IP;
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

  it("ignore x-real-ip tant que l'exploitant ne l'a pas déclaré", () => {
    // Le cœur du correctif, et il est contre-intuitif. Ce repli ne se
    // déclenchait que là où `X-Forwarded-For` manquait — donc là où aucun relais
    // de confiance n'avait rien écrit, donc là où l'en-tête est forgeable par
    // l'appelant. Il n'aidait jamais un déploiement mandaté (l'en-tête y est
    // toujours présent) et donnait à un appelant non mandaté un seau neuf à
    // chaque requête : il affaiblissait le plafond au lieu de le servir.
    expect(requestClientIp(request({ "x-real-ip": "3.3.3.3" }))).toBeNull();
  });

  it("accepte x-real-ip lorsqu'il est déclaré", () => {
    // Une installation dont le proxy pose `X-Real-IP` et pas `X-Forwarded-For`
    // garde la capacité — mais par une décision écrite, pas par un repli.
    process.env.TRUSTED_PROXY_REAL_IP = "true";
    expect(requestClientIp(request({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
  });

  it("ne prend x-real-ip que si le proxy n'a rien dit", () => {
    // Déclaré ou non, l'en-tête du relais l'emporte : c'est le seul des deux
    // qu'un tiers ne peut pas choisir.
    process.env.TRUSTED_PROXY_REAL_IP = "true";
    expect(
      requestClientIp(request({ "x-forwarded-for": "1.1.1.1, 2.2.2.2", "x-real-ip": "3.3.3.3" })),
    ).toBe("2.2.2.2");
  });

  it("n'accepte que la déclaration exacte", () => {
    // Un `TRUSTED_PROXY_REAL_IP=1` ou `=yes` posé de mémoire ne doit pas
    // rouvrir la porte sans qu'on s'en aperçoive.
    for (const valeur of ["1", "yes", "TRUE", "", "false"]) {
      process.env.TRUSTED_PROXY_REAL_IP = valeur;
      expect(requestClientIp(request({ "x-real-ip": "3.3.3.3" }))).toBeNull();
    }
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

describe("peekRateLimit", () => {
  it("ne décompte rien sous le plafond", () => {
    for (let i = 0; i < 5; i += 1) expect(peekRateLimit(RULE, "a")).toBeNull();
    // Les deux actions du plafond restent entières.
    expect(enforceRateLimit(RULE, "a")).toBeNull();
    expect(enforceRateLimit(RULE, "a")).toBeNull();
  });

  it("refuse en 429, avec le même corps et les mêmes en-têtes, une fois le plafond atteint", async () => {
    enforceRateLimit(RULE, "a");
    enforceRateLimit(RULE, "a");

    const response = peekRateLimit(RULE, "a")!;
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "TOO_MANY_REQUESTS" });
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // Une autre identité n'est pas touchée.
    expect(peekRateLimit(RULE, "b")).toBeNull();
  });

  it("ne refuse pas ce qu'il ne sait pas distinguer", () => {
    enforceRateLimit(RULE, null);
    enforceRateLimit(RULE, null);
    enforceRateLimit(RULE, null);
    expect(peekRateLimit(RULE, null)).toBeNull();
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

describe("clientNetworkKey", () => {
  it("garde une adresse IPv4 telle quelle", () => {
    expect(clientNetworkKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("ramène une IPv4 encapsulée à son adresse", () => {
    expect(clientNetworkKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("réduit une IPv6 à son /64, quelle que soit l'écriture", () => {
    const key = "2001:db8:1:2::/64";
    expect(clientNetworkKey("2001:db8:1:2::1")).toBe(key);
    expect(clientNetworkKey("2001:0DB8:0001:0002:ffff:ffff:ffff:ffff")).toBe(key);
    expect(clientNetworkKey("[2001:db8:1:2:a::9]")).toBe(key);
    expect(clientNetworkKey("2001:db8:1:2::1%eth0")).toBe(key);
    expect(clientNetworkKey("2001:db8:1:3::1")).not.toBe(key);
    expect(clientNetworkKey("::1")).toBe("0:0:0:0::/64");
    expect(clientNetworkKey("2001:db8:1:2:3:4:1.2.3.4")).toBe(key);
  });

  it("rend une valeur illisible telle quelle, et null pour un inconnu", () => {
    expect(clientNetworkKey("2001:db8::1::2")).toBe("2001:db8::1::2");
    expect(clientNetworkKey("2001:db8:zz::1")).toBe("2001:db8:zz::1");
    expect(clientNetworkKey("1:2:3:4:5:6:7")).toBe("1:2:3:4:5:6:7");
    expect(clientNetworkKey(null)).toBeNull();
    expect(clientNetworkKey("  ")).toBeNull();
  });
});

describe("takeRateToken / peekRateToken / refundRateToken", () => {
  const BUCKET: TokenBucketRule = { name: "guard-bucket", capacity: 2, refillMs: 60_000 };

  it("refuse en 429 une fois la rafale prise, sans rien prendre de plus", async () => {
    expect(takeRateToken(BUCKET, "1.2.3.4")).toBeNull();
    expect(takeRateToken(BUCKET, "1.2.3.4")).toBeNull();
    const refused = takeRateToken(BUCKET, "1.2.3.4");
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get("retry-after")).not.toBeNull();
    expect(peekRateToken(BUCKET, "1.2.3.4")?.status).toBe(429);
  });

  it("rend le jeton remboursé", () => {
    takeRateToken(BUCKET, "1.2.3.4");
    takeRateToken(BUCKET, "1.2.3.4");
    refundRateToken(BUCKET, "1.2.3.4");
    expect(takeRateToken(BUCKET, "1.2.3.4")).toBeNull();
  });

  it("ne plafonne jamais l'identité inconnue", () => {
    for (let i = 0; i < 5; i += 1) expect(takeRateToken(BUCKET, null)).toBeNull();
    expect(peekRateToken(BUCKET, null)).toBeNull();
    refundRateToken(BUCKET, null);
  });
});
