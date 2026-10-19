import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  CONTACTS_RETRY_MAX_WAIT_MS,
  contactsRetryDelay,
  casterContactsPending,
  casterRereadDelay,
  readMatchContacts,
  rereadOnPhaseChange,
} from "@/components/match-launch/MatchContactsDialog";
import type { MatchLaunchInfo } from "@/lib/shared/match-launch";
import { readSource } from "../../helpers/read-source";

/**
 * Relecture d'un refus « indisponible » à la frontière du départ (écart
 * d'horloge entre navigateur et serveur, `docs/features/MATCH_LAUNCH.md`
 * § Bouton « Contacts ») : une seule, réglée sur l'heure du serveur, et
 * seulement quand le départ n'y est pas encore atteint.
 */

const LAUNCH = { matchId: 7 } as unknown as MatchLaunchInfo;
const START = "2026-10-19T18:00:00.000Z";
const SERVER_BEFORE = "Mon, 19 Oct 2026 17:59:50 GMT"; // 10 s avant le départ
const SERVER_AFTER = "Mon, 19 Oct 2026 18:05:00 GMT";

const json = (status: number, body: unknown, date?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(date ? { Date: date } : {}) },
  });
const unavailable = (date?: string) => json(404, { error: "MATCH_CONTACTS_UNAVAILABLE" }, date);
const noWait = () => jest.fn(async (_ms: number, _signal?: AbortSignal) => undefined);

afterEach(() => {
  jest.restoreAllMocks();
});

describe("contactsRetryDelay", () => {
  it("serveur avant le départ : attendre jusqu'au départ, plus une seconde (en-tête tronqué)", () => {
    expect(contactsRetryDelay(START, SERVER_BEFORE)).toBe(11_000);
  });

  it("départ passé au serveur (match terminé, tournoi clos…) : aucune relecture", () => {
    expect(contactsRetryDelay(START, SERVER_AFTER)).toBeNull();
    expect(contactsRetryDelay(START, "Mon, 19 Oct 2026 18:00:00 GMT")).toBeNull();
  });

  it("sans heure (à planifier, déjà lancé), sans en-tête ou illisible : aucune relecture", () => {
    expect(contactsRetryDelay(null, SERVER_BEFORE)).toBeNull();
    expect(contactsRetryDelay(START, null)).toBeNull();
    expect(contactsRetryDelay("pas une date", SERVER_BEFORE)).toBeNull();
    expect(contactsRetryDelay(START, "n'importe quoi")).toBeNull();
  });

  it("départ trop lointain : le refus n'est pas un écart d'horloge", () => {
    expect(contactsRetryDelay(START, "Mon, 19 Oct 2026 17:59:00 GMT")).toBeNull();
    expect(contactsRetryDelay(START, "Mon, 19 Oct 2026 17:59:31 GMT")).toBe(CONTACTS_RETRY_MAX_WAIT_MS);
  });
});

describe("readMatchContacts", () => {
  it("succès d'emblée : une lecture, aucune attente", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { launch: LAUNCH }));
    const wait = noWait();
    await expect(readMatchContacts(7, { startAt: START, wait })).resolves.toMatchObject({ launch: LAUNCH });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/matches/7/contacts", { cache: "no-store", signal: undefined });
    expect(wait).not.toHaveBeenCalled();
  });

  it("caster à l'horloge en avance : relu une fois, à l'heure du serveur", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(unavailable(SERVER_BEFORE))
      .mockResolvedValueOnce(json(200, { launch: LAUNCH }));
    const wait = noWait();
    await expect(readMatchContacts(7, { startAt: START, wait })).resolves.toMatchObject({ launch: LAUNCH });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(11_000, undefined);
  });

  it("toujours indisponible : le refus est rendu, sans troisième lecture", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async () => unavailable(SERVER_BEFORE));
    const wait = noWait();
    await expect(readMatchContacts(7, { startAt: START, wait })).resolves.toEqual({
      error: "MATCH_CONTACTS_UNAVAILABLE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("match terminé ou sans heure : refus immédiat, sans attente ni seconde lecture", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(unavailable(SERVER_AFTER))
      .mockResolvedValueOnce(unavailable(SERVER_BEFORE));
    const wait = noWait();
    await expect(readMatchContacts(7, { startAt: START, wait })).resolves.toEqual({
      error: "MATCH_CONTACTS_UNAVAILABLE",
    });
    await expect(readMatchContacts(7, { startAt: null, wait })).resolves.toEqual({
      error: "MATCH_CONTACTS_UNAVAILABLE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wait).not.toHaveBeenCalled();
  });

  it("autre refus ou corps illisible : rendu sans relecture", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(401, { error: "UNAUTHORIZED" }, SERVER_BEFORE))
      .mockResolvedValueOnce(new Response("oops", { status: 500 }));
    const wait = noWait();
    await expect(readMatchContacts(7, { startAt: START, wait })).resolves.toEqual({ error: "UNAUTHORIZED" });
    await expect(readMatchContacts(7, { startAt: START, wait })).resolves.toEqual({ error: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wait).not.toHaveBeenCalled();
  });

  it("fermeture pendant l'attente : l'attente est coupée, aucune seconde lecture", async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(unavailable(SERVER_BEFORE));
      const controller = new AbortController();
      const read = readMatchContacts(7, { startAt: START, signal: controller.signal });
      const settled = expect(read).rejects.toBeDefined();
      await jest.advanceTimersByTimeAsync(0);
      controller.abort();
      await settled;
      await jest.advanceTimersByTimeAsync(CONTACTS_RETRY_MAX_WAIT_MS);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith("/api/matches/7/contacts", {
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

const CASTER = { userId: 9, pseudo: "Voix", contact: null } as unknown as MatchLaunchInfo["caster"];
const info = (phase: MatchLaunchInfo["phase"], caster: MatchLaunchInfo["caster"] = CASTER, startAt: string | null = START) =>
  ({ matchId: 7, phase, startAt, caster }) as unknown as MatchLaunchInfo;

describe("contacts du caster en attente, modale ouverte", () => {
  it("en attente : caster inscrit sur un match pas encore parti au serveur", () => {
    expect(casterContactsPending(info("SCHEDULED"))).toBe(true);
    expect(casterContactsPending(info("TO_PLAN"))).toBe(true);
    expect(casterContactsPending(info("LOBBY"))).toBe(false);
    expect(casterContactsPending(info("LAUNCHED"))).toBe(false);
    expect(casterContactsPending(info("SCHEDULED", null))).toBe(false);
  });

  it("relecture à l'heure de départ du serveur, plus une seconde (horloge du navigateur en avance)", () => {
    expect(casterRereadDelay(info("SCHEDULED"), SERVER_BEFORE)).toBe(11_000);
    expect(casterRereadDelay(info("SCHEDULED"), "Mon, 19 Oct 2026 16:00:00 GMT")).toBe(2 * 3_600_000 + 1_000);
  });

  it("aucune relecture sans caster, sans heure, départ passé au serveur, ou contacts déjà là", () => {
    expect(casterRereadDelay(info("SCHEDULED", null), SERVER_BEFORE)).toBeNull();
    expect(casterRereadDelay(info("TO_PLAN", CASTER, null), SERVER_BEFORE)).toBeNull();
    expect(casterRereadDelay(info("SCHEDULED"), SERVER_AFTER)).toBeNull();
    expect(casterRereadDelay(info("SCHEDULED"), null)).toBeNull();
    expect(casterRereadDelay(info("LOBBY"), SERVER_BEFORE)).toBeNull();
  });

  it("au départ par une écriture (carte au lancement), une fois, si le caster attend", () => {
    const pending = info("SCHEDULED");
    expect(rereadOnPhaseChange("SCHEDULED", "LOBBY", pending)).toBe(true);
    expect(rereadOnPhaseChange("SCHEDULED", "LAUNCHED", pending)).toBe(true);
    expect(rereadOnPhaseChange("TO_PLAN", "LAUNCHED", info("TO_PLAN"))).toBe(true);
  });

  it("jamais sans caster, contacts déjà là, à la fin du match, entre deux phases du match parti", () => {
    expect(rereadOnPhaseChange("SCHEDULED", "LOBBY", info("SCHEDULED", null))).toBe(false);
    expect(rereadOnPhaseChange("SCHEDULED", "LOBBY", info("LOBBY"))).toBe(false);
    expect(rereadOnPhaseChange("SCHEDULED", "LOBBY", null)).toBe(false);
    expect(rereadOnPhaseChange("LAUNCHED", "NONE", info("SCHEDULED"))).toBe(false);
    expect(rereadOnPhaseChange("LOBBY", "LAUNCHED", info("SCHEDULED"))).toBe(false);
    expect(rereadOnPhaseChange("TO_PLAN", "SCHEDULED", info("TO_PLAN"))).toBe(false);
  });

  it("câblage : phase de la carte transmise, relecture silencieuse, contacts du caster masqués si la carte revient avant le départ", () => {
    const dialog = readSource("components/match-launch/MatchContactsDialog.tsx");
    expect(dialog).toContain("}, [matchId, readKey]);");
    expect(dialog).toContain("rereadOnPhaseChange(previousPhase.current, phase, launch)");
    expect(dialog).toContain("casterRereadDelay(launch, serverDate)");
    expect(dialog).toMatch(/if \("error" in read\) \{\n\s*if \(reread\) return;/);
    expect(dialog).toContain("if (!alive || reread) return;");
    expect(dialog).toContain("contactsShown={matchUnderway(launch.phase) && (phase === null || matchUnderway(phase))}");
    const card = readSource("app/(secured)/tournois/[id]/_components/MatchCardActions.tsx");
    expect(card).toMatch(/<MatchContactsDialog[\s\S]*?phase=\{phase\}[\s\S]*?\/>/);
  });
});
