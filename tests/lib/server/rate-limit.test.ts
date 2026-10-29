import { afterEach, describe, expect, it } from "@jest/globals";
import {
  chargeRateLimit,
  checkRateLimit,
  consumeRateLimit,
  refundRateLimit,
  refundTokenBucket,
  takeTokenBucket,
  type TokenBucketRule,
  rateLimitIdentity,
  resetRateLimit,
  type RateLimitRule,
} from "@/lib/server/rate-limit";
import { tokensLeft } from "../../helpers/token-bucket";

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

describe("refundRateLimit", () => {
  it("refundRateLimit_afterConsume_givesTheSlotBack", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) consumeRateLimit(RULE, "a", now);

    refundRateLimit(RULE, "a", now + 1);

    expect(consumeRateLimit(RULE, "a", now + 2).allowed).toBe(true);
  });

  it("refundRateLimit_unknownKey_doesNothing", () => {
    refundRateLimit(RULE, "nobody");

    expect(checkRateLimit(RULE, "nobody").remaining).toBe(3);
  });

  it("refundRateLimit_afterWindowReset_doesNotGoBelowFreshQuota", () => {
    const now = 1_000_000;
    consumeRateLimit(RULE, "a", now);

    refundRateLimit(RULE, "a", now + 2_000);

    expect(checkRateLimit(RULE, "a", now + 2_000).remaining).toBe(3);
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

describe("rate-limit — seau à jetons", () => {
  const BUCKET: TokenBucketRule = { name: "bucket-test", capacity: 3, refillMs: 1_000 };

  it("accorde la rafale entière, dernier jeton compris, puis refuse", () => {
    const granted = [1, 2, 3].map(() => takeTokenBucket(BUCKET, "k", 0));
    expect(granted.map((state) => state.allowed)).toEqual([true, true, true]);
    expect(granted.map((state) => state.remaining)).toEqual([2, 1, 0]);
    const refused = takeTokenBucket(BUCKET, "k", 0);
    expect(refused).toEqual({ allowed: false, remaining: 0, retryAfterMs: 1_000 });
  });

  it("rend un jeton par pas, sans dépasser la capacité", () => {
    for (let i = 0; i < 3; i += 1) takeTokenBucket(BUCKET, "k", 0);
    expect(takeTokenBucket(BUCKET, "k", 500).allowed).toBe(false);
    expect(takeTokenBucket(BUCKET, "k", 500).retryAfterMs).toBe(500);
    expect(takeTokenBucket(BUCKET, "k", 1_000).allowed).toBe(true);
    expect(tokensLeft(BUCKET, "k", 1_000_000)).toBe(3);
  });

  it("un refus ne prend rien, un aperçu non plus", () => {
    for (let i = 0; i < 3; i += 1) takeTokenBucket(BUCKET, "k", 0);
    takeTokenBucket(BUCKET, "k", 0);
    tokensLeft(BUCKET, "k", 0);
    expect(takeTokenBucket(BUCKET, "k", 1_000).allowed).toBe(true);
  });

  it("rend un jeton remboursé, jamais au-delà de la capacité", () => {
    takeTokenBucket(BUCKET, "k", 0);
    refundTokenBucket(BUCKET, "k", 0);
    refundTokenBucket(BUCKET, "k", 0);
    refundTokenBucket(BUCKET, "inconnu", 0);
    expect(tokensLeft(BUCKET, "k", 0)).toBe(3);
    expect(tokensLeft(BUCKET, "inconnu", 0)).toBe(3);
  });

  it("sépare les clés et les seaux", () => {
    for (let i = 0; i < 3; i += 1) takeTokenBucket(BUCKET, "a", 0);
    expect(takeTokenBucket(BUCKET, "b", 0).allowed).toBe(true);
    expect(takeTokenBucket({ ...BUCKET, name: "other" }, "a", 0).allowed).toBe(true);
  });

  it("borne les clés suivies : les seaux pleins partent d'abord", () => {
    const small: TokenBucketRule = { ...BUCKET, name: "small", maxKeys: 2 };
    takeTokenBucket(small, "a", 0);
    takeTokenBucket(small, "b", 900);
    // « a » s'est rempli : oublié, il vaut un seau neuf ; « b » garde sa dette.
    takeTokenBucket(small, "c", 1_000);
    expect(tokensLeft(small, "b", 1_000)).toBe(2);
    expect(tokensLeft(small, "a", 1_000)).toBe(3);
  });

  it("plein de seaux entamés, évince les plus pleins et jamais tout : un seau vide garde sa dette", () => {
    const small: TokenBucketRule = { name: "evict", capacity: 10, refillMs: 60_000, maxKeys: 10 };
    // Un réseau épuisé, puis neuf autres à peine entamés : le seau est plein de clés actives.
    for (let i = 0; i < 10; i += 1) takeTokenBucket(small, "attaquant", 0);
    for (let i = 0; i < 9; i += 1) takeTokenBucket(small, `k${i}`, 0);

    expect(takeTokenBucket(small, "nouveau", 0).allowed).toBe(true);
    // La clé épuisée n'a pas retrouvé ses jetons (le seau n'a pas été vidé)…
    expect(takeTokenBucket(small, "attaquant", 0).allowed).toBe(false);
    // …et la nouvelle clé a bien sa place, jeton pris.
    expect(tokensLeft(small, "nouveau", 0)).toBe(9);
  });

  it("se remet à zéro avec les plafonds", () => {
    for (let i = 0; i < 3; i += 1) takeTokenBucket(BUCKET, "k", 0);
    resetRateLimit(BUCKET.name);
    expect(tokensLeft(BUCKET, "k", 0)).toBe(3);
  });
});
