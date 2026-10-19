import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { CONTACTS_RETRY_DELAY_MS, readMatchContacts } from "@/components/match-launch/MatchContactsDialog";
import type { MatchLaunchInfo } from "@/lib/shared/match-launch";

/**
 * Relecture d'un refus « indisponible » (écart d'horloge à l'heure du départ,
 * `docs/features/MATCH_LAUNCH.md` § Contacts hors lancement) : une seule, et
 * seulement pour ce refus.
 */

const LAUNCH = { matchId: 7 } as unknown as MatchLaunchInfo;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  jest.restoreAllMocks();
});

describe("readMatchContacts", () => {
  it("succès d'emblée : une lecture, aucune attente", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { launch: LAUNCH }));
    const wait = jest.fn(async (_ms: number) => undefined);
    await expect(readMatchContacts(7, wait)).resolves.toEqual({ launch: LAUNCH });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/matches/7/contacts", { cache: "no-store" });
    expect(wait).not.toHaveBeenCalled();
  });

  it("indisponible puis servi (horloge du navigateur en avance) : relu une fois après le délai", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(404, { error: "MATCH_CONTACTS_UNAVAILABLE" }))
      .mockResolvedValueOnce(json(200, { launch: LAUNCH }));
    const wait = jest.fn(async (_ms: number) => undefined);
    await expect(readMatchContacts(7, wait)).resolves.toEqual({ launch: LAUNCH });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(CONTACTS_RETRY_DELAY_MS);
  });

  it("indisponible deux fois : le refus est rendu, sans troisième lecture", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => json(404, { error: "MATCH_CONTACTS_UNAVAILABLE" }));
    const wait = jest.fn(async (_ms: number) => undefined);
    await expect(readMatchContacts(7, wait)).resolves.toEqual({ error: "MATCH_CONTACTS_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("autre refus ou corps illisible : rendu sans relecture", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(401, { error: "UNAUTHORIZED" }))
      .mockResolvedValueOnce(new Response("oops", { status: 500 }));
    const wait = jest.fn(async (_ms: number) => undefined);
    await expect(readMatchContacts(7, wait)).resolves.toEqual({ error: "UNAUTHORIZED" });
    await expect(readMatchContacts(7, wait)).resolves.toEqual({ error: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wait).not.toHaveBeenCalled();
  });

  it("délai court : la modale reste en chargement quelques secondes au plus", () => {
    expect(CONTACTS_RETRY_DELAY_MS).toBeGreaterThan(0);
    expect(CONTACTS_RETRY_DELAY_MS).toBeLessThanOrEqual(5_000);
  });
});
