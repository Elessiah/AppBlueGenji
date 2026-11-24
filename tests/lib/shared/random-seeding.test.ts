import { describe, expect, it } from "@jest/globals";
import { isRandomDrawDue, randomDrawStatus, shuffleOrder } from "@/lib/shared/random-seeding";

const CLOSE = "2026-05-10T10:00:00.000Z";
const CLOSE_MS = Date.parse(CLOSE);

describe("randomDrawStatus", () => {
  it("rend OFF quand l'option est éteinte, même avec un tirage daté", () => {
    expect(randomDrawStatus({ enabled: false, drawnAt: "2026-05-11T00:00:00.000Z", registrationCloseAt: CLOSE })).toBe("OFF");
  });

  it("rend PENDING tant qu'aucun tirage n'est daté", () => {
    expect(randomDrawStatus({ enabled: true, drawnAt: null, registrationCloseAt: CLOSE })).toBe("PENDING");
  });

  it("rend DRAWN pour un tirage postérieur à la clôture", () => {
    expect(randomDrawStatus({ enabled: true, drawnAt: new Date(CLOSE_MS + 1), registrationCloseAt: CLOSE })).toBe("DRAWN");
  });

  it("rend PENDING pour un tirage antérieur ou égal à la clôture (inscriptions rouvertes)", () => {
    expect(randomDrawStatus({ enabled: true, drawnAt: CLOSE, registrationCloseAt: CLOSE })).toBe("PENDING");
    expect(randomDrawStatus({ enabled: true, drawnAt: new Date(CLOSE_MS - 1), registrationCloseAt: CLOSE })).toBe("PENDING");
  });

  it("rend PENDING sur une date illisible", () => {
    expect(randomDrawStatus({ enabled: true, drawnAt: "n'importe quoi", registrationCloseAt: CLOSE })).toBe("PENDING");
  });
});

describe("isRandomDrawDue", () => {
  const base = { enabled: true, drawnAt: null, registrationCloseAt: CLOSE } as const;

  it("est dû juste après la clôture, inscriptions ou attente du départ", () => {
    expect(isRandomDrawDue({ ...base, state: "REGISTRATION" }, CLOSE_MS + 1)).toBe(true);
    expect(isRandomDrawDue({ ...base, state: "UPCOMING" }, CLOSE_MS + 1)).toBe(true);
  });

  it("n'est pas dû avant ou à l'instant de la clôture", () => {
    expect(isRandomDrawDue({ ...base, state: "REGISTRATION" }, CLOSE_MS)).toBe(false);
    expect(isRandomDrawDue({ ...base, state: "REGISTRATION" }, CLOSE_MS - 1000)).toBe(false);
  });

  it("n'est jamais dû une fois le tournoi lancé ou terminé", () => {
    expect(isRandomDrawDue({ ...base, state: "RUNNING" }, CLOSE_MS + 1)).toBe(false);
    expect(isRandomDrawDue({ ...base, state: "FINISHED" }, CLOSE_MS + 1)).toBe(false);
  });

  it("n'est pas dû option éteinte ni tirage déjà fait", () => {
    expect(isRandomDrawDue({ ...base, enabled: false, state: "UPCOMING" }, CLOSE_MS + 1)).toBe(false);
    expect(
      isRandomDrawDue({ ...base, drawnAt: new Date(CLOSE_MS + 10), state: "UPCOMING" }, CLOSE_MS + 20),
    ).toBe(false);
  });
});

describe("shuffleOrder", () => {
  it("rend une permutation sans toucher l'entrée", () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffleOrder(input, () => 0);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...result].sort((a, b) => a - b)).toEqual(input);
  });

  it("applique Fisher–Yates : chaque tirage choisit dans [0, i]", () => {
    const asked: number[] = [];
    // Toujours le dernier indice possible : aucun échange, ordre conservé.
    const identity = shuffleOrder(["a", "b", "c", "d"], (n) => {
      asked.push(n);
      return n - 1;
    });
    expect(identity).toEqual(["a", "b", "c", "d"]);
    expect(asked).toEqual([4, 3, 2]);
    // Toujours 0 : [a,b,c,d] → i=3 ↔0 [d,b,c,a] → i=2 ↔0 [c,b,d,a] → i=1 ↔0 [b,c,d,a].
    expect(shuffleOrder(["a", "b", "c", "d"], () => 0)).toEqual(["b", "c", "d", "a"]);
  });

  it("laisse une liste vide ou d'un seul engagé telle quelle, sans tirer", () => {
    const never = () => {
      throw new Error("pas de tirage attendu");
    };
    expect(shuffleOrder([], never)).toEqual([]);
    expect(shuffleOrder([7], never)).toEqual([7]);
  });

  it("refuse un tirage hors bornes ou non entier", () => {
    expect(() => shuffleOrder([1, 2, 3], () => 3)).toThrow("INVALID_RANDOM_INT");
    expect(() => shuffleOrder([1, 2, 3], () => -1)).toThrow("INVALID_RANDOM_INT");
    expect(() => shuffleOrder([1, 2, 3], () => 0.5)).toThrow("INVALID_RANDOM_INT");
  });
});
