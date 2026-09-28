import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  cached,
  clearCache,
  invalidateCached,
  invalidateCachedPrefix,
} from "@/lib/server/cache";

afterEach(() => {
  clearCache();
  jest.useRealTimers();
});

/** Promesse dont le test décide du moment de résolution. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("cache — mémorisation", () => {
  it("ne calcule qu'une fois sur la fenêtre de vie", async () => {
    const loader = jest.fn(async () => "valeur");

    expect(await cached("k", 1_000, loader)).toBe("valeur");
    expect(await cached("k", 1_000, loader)).toBe("valeur");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("recalcule une fois la durée de vie écoulée", async () => {
    jest.useFakeTimers();
    const loader = jest.fn(async () => Date.now());

    await cached("k", 1_000, loader);
    jest.setSystemTime(Date.now() + 1_001);
    await cached("k", 1_000, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("garde les clés indépendantes", async () => {
    expect(await cached("a", 1_000, async () => "A")).toBe("A");
    expect(await cached("b", 1_000, async () => "B")).toBe("B");
    expect(await cached("a", 1_000, async () => "autre")).toBe("A");
  });
});

describe("cache — vol unique", () => {
  it("partage un même calcul entre appels concurrents", async () => {
    // C'est LA propriété qui protège le serveur : cent spectateurs réveillés par
    // le même score ne doivent produire qu'une passe en base.
    const gate = deferred<string>();
    const loader = jest.fn(() => gate.promise);

    const readers = Array.from({ length: 100 }, () => cached("k", 1_000, loader));
    gate.resolve("instantané");

    expect(await Promise.all(readers)).toEqual(Array(100).fill("instantané"));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("mutualise même sans mémorisation (durée de vie nulle)", async () => {
    const gate = deferred<number>();
    const loader = jest.fn(() => gate.promise);

    const readers = [cached("k", 0, loader), cached("k", 0, loader)];
    gate.resolve(7);
    await Promise.all(readers);

    expect(loader).toHaveBeenCalledTimes(1);
    // Rien n'a été conservé : la lecture suivante recalcule.
    await cached("k", 0, async () => 8);
    expect(await cached("k", 0, async () => 9)).toBe(9);
  });

  it("ne condamne pas une clé après un échec", async () => {
    const loader = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("BOOM"))
      .mockResolvedValue("ok");

    await expect(cached("k", 1_000, loader)).rejects.toThrow("BOOM");
    expect(await cached("k", 1_000, loader)).toBe("ok");
  });

  it("propage l'échec à tous les lecteurs en attente", async () => {
    const gate = deferred<string>();
    const loader = jest.fn(() => gate.promise);

    const readers = [cached("k", 1_000, loader), cached("k", 1_000, loader)];
    gate.reject(new Error("BOOM"));

    await expect(Promise.all(readers)).rejects.toThrow("BOOM");
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe("cache — invalidation", () => {
  it("oublie une clé sur demande", async () => {
    const loader = jest.fn(async () => "v");

    await cached("k", 60_000, loader);
    invalidateCached("k");
    await cached("k", 60_000, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("ne conserve pas un résultat rendu faux pendant son calcul", async () => {
    // Écriture survenue *pendant* la lecture : la valeur d'avant ne doit pas
    // s'installer en cache juste après elle, sinon le score affiché serait
    // périmé jusqu'à l'expiration.
    const gate = deferred<string>();
    const reader = cached("k", 60_000, () => gate.promise);

    invalidateCached("k");
    gate.resolve("ancienne");
    expect(await reader).toBe("ancienne");

    expect(await cached("k", 60_000, async () => "nouvelle")).toBe("nouvelle");
  });

  it("oublie tout un préfixe", async () => {
    await cached("liste:a", 60_000, async () => 1);
    await cached("liste:b", 60_000, async () => 2);
    await cached("autre:c", 60_000, async () => 3);

    invalidateCachedPrefix("liste:");

    expect(await cached("liste:a", 60_000, async () => 10)).toBe(10);
    expect(await cached("liste:b", 60_000, async () => 20)).toBe(20);
    expect(await cached("autre:c", 60_000, async () => 30)).toBe(3);
  });

  it("ne ressuscite pas une lecture invalidée quand la purge efface son compteur", async () => {
    // Le compteur d'invalidation d'une clé encore en vol ne doit pas être
    // effacé : le ramener à zéro le rendrait égal à la génération de départ du
    // chargeur, qui rangerait alors en cache la valeur lue AVANT l'écriture.
    let release!: (value: string) => void;
    const inFlight = cached("k", 60_000, () => new Promise<string>((r) => (release = r)));

    invalidateCached("k");

    // Amène la purge des compteurs à se déclencher : elle exige à la fois cinq
    // cents compteurs suivis et un cache déjà plein — d'où plus de clés écrites
    // que le plafond, la purge n'ayant lieu qu'une fois celui-ci atteint.
    for (let i = 0; i < 500; i += 1) invalidateCached(`g${i}`);
    for (let i = 0; i < 600; i += 1) await cached(`f${i}`, 60_000, async () => i);

    release("avant l'écriture");
    await inFlight;

    expect(await cached("k", 60_000, async () => "après l'écriture")).toBe("après l'écriture");
  });

  it("laisse une clé inconnue tranquille", () => {
    expect(() => invalidateCached("jamais-vue")).not.toThrow();
    expect(() => invalidateCachedPrefix("rien:")).not.toThrow();
  });
});

describe("cache — bornes mémoire", () => {
  it("reste borné face à un grand nombre de clés", async () => {
    for (let i = 0; i < 700; i += 1) {
      await cached(`k${i}`, 60_000, async () => i);
    }

    // Les plus anciennes ont été évincées : la clé 0 se recalcule, la dernière
    // écrite est toujours là.
    expect(await cached("k0", 60_000, async () => -1)).toBe(-1);
    expect(await cached("k699", 60_000, async () => -1)).toBe(699);
  });

  it("évince la clé la moins récemment lue, pas la plus anciennement écrite", async () => {
    // Une entrée partagée relue à chaque page (liste publique, classement) ne
    // doit pas céder sa place à une rafale de clés par compte lues une fois.
    await cached("partagee", 60_000, async () => "chère");
    for (let i = 0; i < 700; i += 1) {
      await cached(`compte:${i}`, 60_000, async () => i);
      // Relue entre deux écritures, comme à chaque page vue.
      await cached("partagee", 60_000, async () => "recalculée");
    }

    expect(await cached("partagee", 60_000, async () => "recalculée")).toBe("chère");
    expect(await cached("compte:0", 60_000, async () => -1)).toBe(-1);
  });

  it("replace en fin d'ordre une clé recalculée après expiration", async () => {
    jest.useFakeTimers();
    await cached("rechargee", 1_000, async () => "v1");
    await cached("autre", 60_000, async () => "a1");
    jest.advanceTimersByTime(1_001);
    // Recalculée : elle passe derrière « autre », au lieu de garder sa place
    // d'origine en tête de l'éviction.
    await cached("rechargee", 60_000, async () => "v2");
    // 2 + 498 clés : la dernière insertion trouve le cache plein et évince une
    // entrée, la moins récemment servie.
    for (let i = 0; i < 499; i += 1) await cached(`k${i}`, 60_000, async () => i);

    expect(await cached("rechargee", 60_000, async () => "v3")).toBe("v2");
    expect(await cached("autre", 60_000, async () => "a2")).toBe("a2");
  });
});
