import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Le contrat de la vitrine tient en une phrase : **toute écriture du staff
 * invalide la lecture correspondante**. Sans lui, un Community Manager ajoute
 * une carte, revient sur la page, ne la voit pas, et recharge en boucle —
 * exactement le réflexe que cette PR entend supprimer.
 *
 * Ce contrat s'oublie facilement : il y a quatorze écritures réparties sur
 * quatre services, et chaque nouvelle en ajoute une occasion. Deux avaient
 * d'ailleurs déjà été manquées. Ce fichier les couvre toutes, plus le
 * comportement du cache lui-même face à une base injoignable.
 */
jest.mock("@/lib/server/database");

import { getDatabase } from "@/lib/server/database";
import { cachedShowcase, invalidateShowcase } from "@/lib/server/showcase-cache";
import { clearCache } from "@/lib/server/cache";
import {
  createAboutStat,
  deleteAboutStat,
  listAboutStats,
  reorderAboutStats,
  updateAboutStat,
} from "@/lib/server/about-stats-service";
import {
  createAboutPillar,
  deleteAboutPillar,
  listAboutPillars,
  reorderAboutPillars,
  updateAboutPillar,
} from "@/lib/server/about-pillars-service";
import {
  createSponsor,
  deleteSponsor,
  listSponsors,
  reorderSponsors,
  updateSponsor,
} from "@/lib/server/sponsors-service";
import { getSiteCopy, resetSiteCopy, setSiteCopy } from "@/lib/server/site-copy-service";

/** Lignes rendues par le prochain `execute`, poussées dans l'ordre d'appel. */
let execute: jest.Mock;

/** Réponse par défaut : une ligne plausible, plus un `insertId` pour les écritures. */
function anyRows() {
  return [[{ id: 1, value: "1", label: "L", title: "T", text: "X", name: "N", slug: "s", tier: "GOLD" }], []];
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();

  execute = jest.fn(async () => anyRows() as never);
  (getDatabase as jest.Mock).mockResolvedValue({
    execute,
    getConnection: jest.fn(async () => ({
      release: jest.fn(),
      beginTransaction: jest.fn(async () => undefined),
      commit: jest.fn(async () => undefined),
      rollback: jest.fn(async () => undefined),
      execute,
    })),
  } as never);
});

afterEach(() => {
  clearCache();
  jest.restoreAllMocks();
});

describe("cachedShowcase", () => {
  it("ne calcule qu'une fois pour des lecteurs simultanés", async () => {
    const loader = jest.fn(async () => "valeur");
    const readers = Array.from({ length: 50 }, () => cachedShowcase("k", loader));

    expect(await Promise.all(readers)).toEqual(Array(50).fill("valeur"));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("oublie tout dès qu'une écriture le demande", async () => {
    const loader = jest.fn(async () => "valeur");
    await cachedShowcase("a", loader);
    await cachedShowcase("b", loader);

    invalidateShowcase();

    await cachedShowcase("a", loader);
    await cachedShowcase("b", loader);
    expect(loader).toHaveBeenCalledTimes(4);
  });

  it("ne conserve jamais un échec", async () => {
    // Une coupure d'une seconde ne doit pas figer du contenu de substitution
    // pendant toute une minute.
    const loader = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("DB_DOWN"))
      .mockResolvedValue("revenue");

    await expect(cachedShowcase("k", loader)).rejects.toThrow("DB_DOWN");
    expect(await cachedShowcase("k", loader)).toBe("revenue");
  });
});

/**
 * Chaque écriture est exerçée pour de vrai, puis on vérifie que la lecture
 * suivante repart en base. `read` est relu deux fois d'abord pour prouver que
 * le cache mordait bien.
 */
describe("écritures de vitrine — chacune invalide sa lecture", () => {
  const cases: { nom: string; read: () => Promise<unknown>; write: () => Promise<unknown> }[] = [
    { nom: "createAboutStat", read: listAboutStats, write: () => createAboutStat({ value: "1", label: "L" }) },
    { nom: "updateAboutStat", read: listAboutStats, write: () => updateAboutStat(1, { value: "1", label: "L" }) },
    { nom: "reorderAboutStats", read: listAboutStats, write: () => reorderAboutStats([1]) },
    { nom: "deleteAboutStat", read: listAboutStats, write: () => deleteAboutStat(1) },

    { nom: "createAboutPillar", read: listAboutPillars, write: () => createAboutPillar({ title: "T", text: "X" }) },
    { nom: "updateAboutPillar", read: listAboutPillars, write: () => updateAboutPillar(1, { title: "T", text: "X" }) },
    { nom: "reorderAboutPillars", read: listAboutPillars, write: () => reorderAboutPillars([1]) },
    { nom: "deleteAboutPillar", read: listAboutPillars, write: () => deleteAboutPillar(1) },

    {
      nom: "createSponsor",
      read: listSponsors,
      write: () => createSponsor({ name: "N", tier: "GOLD", logoUrl: null, websiteUrl: null, description: null, active: true }),
    },
    {
      nom: "updateSponsor",
      read: listSponsors,
      write: () => updateSponsor(1, { name: "N", tier: "GOLD", logoUrl: null, websiteUrl: null, description: null, active: true }),
    },
    { nom: "reorderSponsors", read: listSponsors, write: () => reorderSponsors([1]) },
    { nom: "deleteSponsor", read: listSponsors, write: () => deleteSponsor(1) },

  ];

  it.each(cases)("$nom relance la lecture suivante", async ({ read, write }) => {
    await read();
    const afterFirstRead = execute.mock.calls.length;

    // Le cache mord : une seconde lecture ne touche pas la base.
    await read();
    expect(execute.mock.calls.length).toBe(afterFirstRead);

    await write().catch(() => undefined);
    const afterWrite = execute.mock.calls.length;

    await read();
    expect(execute.mock.calls.length).toBeGreaterThan(afterWrite);
  });
});

/**
 * Les deux écritures de textes rafraîchissent le cache elles-mêmes : elles
 * invalident, puis relisent pour renvoyer l'ensemble à jour. La lecture suivante
 * est donc servie depuis un cache **déjà repeuplé** — ce qui satisfait le même
 * contrat par un autre chemin : le lecteur ne voit jamais la valeur d'avant.
 */
describe("écritures de textes — le cache est repeuplé sur place", () => {
  const cases = [
    { nom: "setSiteCopy", write: () => setSiteCopy("home.hero.title", "Titre") },
    { nom: "resetSiteCopy", write: () => resetSiteCopy("home.hero.title") },
  ];

  it.each(cases)("$nom relit avant de rendre la main", async ({ write }) => {
    await getSiteCopy();
    const afterFirstRead = execute.mock.calls.length;

    await getSiteCopy();
    expect(execute.mock.calls.length).toBe(afterFirstRead);

    // L'écriture doit aboutir : un `catch` masquerait un contrat non tenu.
    await write();

    // Elle a touché la base au-delà de son propre `INSERT`/`DELETE` : elle a
    // relu pour repeupler.
    expect(execute.mock.calls.length).toBeGreaterThan(afterFirstRead + 1);
  });
});
