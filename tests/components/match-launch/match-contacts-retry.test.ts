import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  CONTACTS_RETRY_MAX_WAIT_MS,
  contactsRetryDelay,
  casterContactsPending,
  casterRereadDelay,
  readMatchContacts,
  REREAD_RETRIES,
  REREAD_RETRY_MS,
  isFinalRefusal,
  rereadOnScheduleChange,
  shouldRetryReread,
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

  it("départ passé au serveur depuis plus de deux secondes (match terminé, tournoi clos…) : aucune relecture", () => {
    expect(contactsRetryDelay(START, SERVER_AFTER)).toBeNull();
    expect(contactsRetryDelay(START, "Mon, 19 Oct 2026 18:00:02 GMT")).toBeNull();
  });

  it("en-tête à la seconde du départ (tronqué, posé après la décision) : relu une seconde plus tard", () => {
    expect(contactsRetryDelay(START, "Mon, 19 Oct 2026 18:00:00 GMT")).toBe(1_000);
    expect(contactsRetryDelay(START, "Mon, 19 Oct 2026 18:00:01 GMT")).toBe(1_000);
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
const info = (
  phase: MatchLaunchInfo["phase"],
  caster: MatchLaunchInfo["caster"] = CASTER,
  startAt: string | null = START,
  role: MatchLaunchInfo["viewer"]["role"] = "TEAM1",
) => ({ matchId: 7, phase, startAt, caster, viewer: { role } }) as unknown as MatchLaunchInfo;

describe("contacts du caster en attente, modale ouverte", () => {
  it("en attente : caster inscrit sur un match pas encore parti au serveur", () => {
    expect(casterContactsPending(info("SCHEDULED"))).toBe(true);
    expect(casterContactsPending(info("TO_PLAN"))).toBe(true);
    expect(casterContactsPending(info("LOBBY"))).toBe(false);
    expect(casterContactsPending(info("LAUNCHED"))).toBe(false);
    expect(casterContactsPending(info("SCHEDULED", null))).toBe(false);
  });

  it("pas pour le caster lui-même (arbitre qui caste) : aucune note ni relecture sur sa propre fiche", () => {
    const own = info("SCHEDULED", CASTER, START, "CASTER");
    expect(casterContactsPending(own)).toBe(false);
    expect(casterRereadDelay(own, SERVER_BEFORE)).toBeNull();
    expect(casterContactsPending(info("SCHEDULED", CASTER, START, "REFEREE"))).toBe(true);
  });

  it("relecture échouée : retentée au plus REREAD_RETRIES fois", () => {
    expect(shouldRetryReread(0)).toBe(false);
    for (let failures = 1; failures <= REREAD_RETRIES; failures += 1) expect(shouldRetryReread(failures)).toBe(true);
    expect(shouldRetryReread(REREAD_RETRIES + 1)).toBe(false);
    expect(REREAD_RETRY_MS).toBeGreaterThanOrEqual(5_000);
  });

  it("relecture définitive (plus partie du match) : les contacts affichés sont retirés", () => {
    expect(isFinalRefusal("MATCH_CONTACTS_UNAVAILABLE")).toBe(true);
    expect(isFinalRefusal("UNAUTHORIZED")).toBe(true);
    expect(isFinalRefusal("INVALID_MATCH_ID")).toBe(true);
    expect(isFinalRefusal("MATCH_CONTACTS_READ_FAILED")).toBe(false);
    expect(isFinalRefusal("RATE_LIMITED")).toBe(false);
    expect(isFinalRefusal(null)).toBe(false);
  });

  it("le serveur a dit « programmé » mais son en-tête est déjà à l'heure : relu une seconde plus tard", () => {
    expect(casterRereadDelay(info("SCHEDULED"), "Mon, 19 Oct 2026 18:00:00 GMT")).toBe(1_000);
    expect(casterRereadDelay(info("SCHEDULED"), SERVER_AFTER)).toBe(1_000);
  });

  it("relecture à l'heure de départ du serveur, plus une seconde (horloge du navigateur en avance)", () => {
    expect(casterRereadDelay(info("SCHEDULED"), SERVER_BEFORE)).toBe(11_000);
    expect(casterRereadDelay(info("SCHEDULED"), "Mon, 19 Oct 2026 16:00:00 GMT")).toBe(2 * 3_600_000 + 1_000);
  });

  it("aucune relecture sans caster, sans heure, départ passé au serveur, ou contacts déjà là", () => {
    expect(casterRereadDelay(info("SCHEDULED", null), SERVER_BEFORE)).toBeNull();
    expect(casterRereadDelay(info("TO_PLAN", CASTER, null), SERVER_BEFORE)).toBeNull();
    expect(casterRereadDelay(info("SCHEDULED"), null)).toBeNull();
    expect(casterRereadDelay(info("LOBBY"), SERVER_BEFORE)).toBeNull();
  });

  it("horaire changé par une écriture (lancement forcé, reprogrammé, remis à planifier) : relu", () => {
    const at = (startAt: string | null, launchedAt: string | null = null) => ({ startAt, launchedAt, casterUserId: 9 });
    const pending = info("SCHEDULED");
    expect(rereadOnScheduleChange(at(START), at(START, "2026-10-19T17:50:00.000Z"), pending)).toBe(true);
    expect(rereadOnScheduleChange(at(START), at("2026-10-19T18:30:00.000Z"), pending)).toBe(true);
    expect(rereadOnScheduleChange(at(START), at(null), pending)).toBe(true);
    // Reprogrammé alors que la lecture tenait le match pour parti : relu pour le caster du moment.
    expect(rereadOnScheduleChange(at(START), at("2026-10-19T18:30:00.000Z"), info("LOBBY"))).toBe(true);
  });

  it("rien sans caster, sans lecture, ni sans changement (l'horloge du navigateur ne relit rien)", () => {
    const same = { startAt: START, launchedAt: null, casterUserId: null };
    expect(rereadOnScheduleChange(same, { ...same }, info("SCHEDULED"))).toBe(false);
    expect(rereadOnScheduleChange(same, { ...same, startAt: null }, info("SCHEDULED", null))).toBe(false);
    expect(rereadOnScheduleChange(same, { ...same, startAt: null }, null)).toBe(false);
  });

  it("caster qui s'inscrit ou se retire, modale ouverte : relu, avec ou sans caster déjà lu", () => {
    const base = { startAt: START, launchedAt: null, casterUserId: null };
    expect(rereadOnScheduleChange(base, { ...base, casterUserId: 9 }, info("SCHEDULED", null))).toBe(true);
    expect(rereadOnScheduleChange({ ...base, casterUserId: 9 }, base, info("LOBBY"))).toBe(true);
    expect(rereadOnScheduleChange(base, { ...base, casterUserId: 9 }, null)).toBe(false);
  });

  it("câblage : horaire de la carte transmis, relecture passagère silencieuse, affichage à la phase du serveur", () => {
    const dialog = readSource("components/match-launch/MatchContactsDialog.tsx");
    expect(dialog).toContain("}, [matchId, readKey]);");
    expect(dialog).toContain("rereadOnScheduleChange(previousSchedule.current, schedule, launch)");
    expect(dialog).toContain("}, [startAt, launchedAt, casterUserId, launch]);");
    expect(dialog).toContain("const timer = setTimeout(rereadNow, delay);");
    expect(dialog).toContain("if (reread && !isFinalRefusal(read.error)) {");
    expect(dialog).toContain("shouldRetryReread(rereadFailures)");
    expect(dialog).toContain("casterRereadDelay(launch, serverDate)");
    expect(dialog).toMatch(/if \(reread\) \{\n\s*setRereadFailures\(\(count\) => count \+ 1\);\n\s*return;/);
    expect(dialog).toContain("contactsShown={matchUnderway(launch.phase)}");
    const card = readSource("app/(secured)/tournois/[id]/_components/MatchCardActions.tsx");
    expect(card).toMatch(/<MatchContactsDialog[\s\S]*?startAt=\{match\.startAt\}[\s\S]*?launchedAt=\{match\.launchedAt\}[\s\S]*?casterUserId=\{match\.casterUserId\}[\s\S]*?\/>/);
  });
});
