import { afterEach, describe, expect, it } from "@jest/globals";
import {
  chargeRateLimit,
  checkRateLimit,
  consumeRateLimit,
  rateLimitIdentity,
  resetRateLimit,
  type RateLimitRule,
} from "@/lib/server/rate-limit";

const RULE: RateLimitRule = { name: "test", limit: 3, windowMs: 1_000 };

afterEach(() => {
  resetRateLimit();
});

describe("rate-limit — décompte", () => {
  it("laisse passer jusqu'au plafond", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(consumeRateLimit(RULE, "a").allowed).toBe(true);
    }
    expect(consumeRateLimit(RULE, "a").allowed).toBe(false);
  });

  it("annonce le reliquat", () => {
    expect(consumeRateLimit(RULE, "a").remaining).toBe(2);
    expect(consumeRateLimit(RULE, "a").remaining).toBe(1);
    expect(consumeRateLimit(RULE, "a").remaining).toBe(0);
  });

  it("indique combien de temps attendre une fois le quota épuisé", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) consumeRateLimit(RULE, "a", now);

    const blocked = consumeRateLimit(RULE, "a", now + 200);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(800);
  });

  it("ne fait pas payer une clé pour une autre", () => {
    for (let i = 0; i < 3; i += 1) consumeRateLimit(RULE, "a");
    expect(consumeRateLimit(RULE, "b").allowed).toBe(true);
  });

  it("ne fait pas payer un seau pour un autre", () => {
    const other: RateLimitRule = { name: "autre", limit: 3, windowMs: 1_000 };
    for (let i = 0; i < 3; i += 1) consumeRateLimit(RULE, "a");
    expect(consumeRateLimit(other, "a").allowed).toBe(true);
  });

  it("repart à zéro à la fenêtre suivante", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) consumeRateLimit(RULE, "a", now);

    expect(consumeRateLimit(RULE, "a", now + 999).allowed).toBe(false);
    expect(consumeRateLimit(RULE, "a", now + 1_000).allowed).toBe(true);
  });
});

describe("rate-limit — contrôle et débit séparés", () => {
  it("ne décompte rien au simple contrôle", () => {
    expect(checkRateLimit(RULE, "a").allowed).toBe(true);
    expect(checkRateLimit(RULE, "a").allowed).toBe(true);
    expect(checkRateLimit(RULE, "a").remaining).toBe(3);
  });

  it("permet de ne facturer qu'une action réellement effectuée", () => {
    // C'est le besoin du compteur de fréquentation : un chargement absorbé par
    // la fenêtre de session ne doit rien consommer, sinon plusieurs visiteurs
    // derrière un même NAT s'épuiseraient mutuellement leur quota.
    expect(checkRateLimit(RULE, "ip").allowed).toBe(true);
    chargeRateLimit(RULE, "ip");
    chargeRateLimit(RULE, "ip");
    chargeRateLimit(RULE, "ip");
    expect(checkRateLimit(RULE, "ip").allowed).toBe(false);
  });

  it("refuse sans rien décompter de plus quand le quota est épuisé", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) consumeRateLimit(RULE, "a", now);

    const first = consumeRateLimit(RULE, "a", now + 10);
    const second = consumeRateLimit(RULE, "a", now + 20);
    // La fenêtre ne se prolonge pas à chaque tentative refusée.
    expect(first.retryAfterMs).toBe(990);
    expect(second.retryAfterMs).toBe(980);
  });
});

describe("rate-limit — identité", () => {
  it("normalise les identités", () => {
    expect(rateLimitIdentity(42)).toBe("42");
    expect(rateLimitIdentity("  1.2.3.4  ")).toBe("1.2.3.4");
  });

  it("range les identités vides ensemble plutôt que de les laisser passer", () => {
    expect(rateLimitIdentity(null)).toBe("anonymous");
    expect(rateLimitIdentity(undefined)).toBe("anonymous");
    expect(rateLimitIdentity("   ")).toBe("anonymous");
  });
});

describe("rate-limit — bornes mémoire", () => {
  it("reste borné face à des identités fabriquées", () => {
    const rule: RateLimitRule = { name: "flood", limit: 5, windowMs: 60_000, maxKeys: 50 };
    for (let i = 0; i < 500; i += 1) consumeRateLimit(rule, `ip-${i}`);

    // Le seau s'est vidé au lieu de croître sans fin ; le service reste ouvert.
    expect(consumeRateLimit(rule, "ip-499").allowed).toBe(true);
  });
});

describe("rate-limit — remise à zéro", () => {
  it("vide un seau nommé", () => {
    for (let i = 0; i < 3; i += 1) consumeRateLimit(RULE, "a");
    resetRateLimit(RULE.name);
    expect(consumeRateLimit(RULE, "a").allowed).toBe(true);
  });

  it("vide tous les seaux", () => {
    const other: RateLimitRule = { name: "autre", limit: 1, windowMs: 1_000 };
    consumeRateLimit(RULE, "a");
    consumeRateLimit(other, "a");
    resetRateLimit();
    expect(checkRateLimit(RULE, "a").remaining).toBe(3);
    expect(checkRateLimit(other, "a").remaining).toBe(1);
  });
});
