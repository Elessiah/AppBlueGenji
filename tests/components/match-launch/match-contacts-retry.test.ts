import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  CONTACTS_RETRY_MAX_WAIT_MS,
  contactsRetryDelay,
  casterRereadDelay,
  readMatchContacts,
  REREAD_RETRIES,
  REREAD_RETRY_MS,
  isFinalRefusal,
  contactsCardKey,
  parseRetryAfter,
  rereadOnCardChange,
  failureIsSilent,
  type ContactsCard,
  shouldRetryReread,
} from "@/components/match-launch/MatchContactsDialog";
import { casterContactsPending, exposesCasterContacts, exposesMatchContacts, matchUnderway, readsContactsEarly, type LaunchCaster, type LaunchSide, type MatchLaunchInfo } from "@/lib/shared/match-launch";
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
    await expect(readMatchContacts(7, { startAt: START, wait })).resolves.toMatchObject({
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
    await expect(readMatchContacts(7, { startAt: START, wait })).resolves.toMatchObject({
      error: "MATCH_CONTACTS_UNAVAILABLE",
    });
    await expect(readMatchContacts(7, { startAt: null, wait })).resolves.toMatchObject({
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
    await expect(readMatchContacts(7, { startAt: START, wait })).resolves.toEqual({ error: "UNAUTHORIZED", retryAfterMs: null });
    await expect(readMatchContacts(7, { startAt: START, wait })).resolves.toEqual({ error: null, retryAfterMs: null });
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

const CASTER: LaunchCaster = {
  userId: 9,
  pseudo: "Voix",
  discordTag: "voix",
  battletag: null,
  battletagVerified: false,
  ready: false,
  contactsShown: false,
  isViewer: false,
};
const launchSide = (teamId: number, name: string): LaunchSide => ({
  teamId,
  name,
  logoUrl: null,
  isGhost: false,
  isSolo: false,
  ready: false,
  contacts: [],
  contactsShown: true,
});
const info = (
  phase: MatchLaunchInfo["phase"],
  caster: LaunchCaster | readonly LaunchCaster[] | null = CASTER,
  startAt: string | null = START,
  role: MatchLaunchInfo["viewer"]["role"] = "TEAM1",
): MatchLaunchInfo => ({
  matchId: 7,
  tournamentId: 3,
  tournamentName: "Coupe",
  phase,
  startAt,
  lobbyOpenedAt: null,
  autoLaunchAt: null,
  launchedAt: null,
  hostTeamId: 10,
  team1: launchSide(10, "Alpha"),
  team2: launchSide(20, "Bravo"),
  // Décision du serveur (`exposesCaster`), telle que la réponse la porte ;
  // la fiche du lecteur lui-même porte `isViewer` (`buildLaunchCaster`).
  casters: (caster === null ? [] : Array.isArray(caster) ? caster : [caster as LaunchCaster]).map((one) => ({
    ...one,
    isViewer: one.isViewer || (role === "CASTER" && one.userId === CASTER.userId),
    contactsShown: exposesCasterContacts(phase, role),
  })),
  viewer: {
    role,
    canDeclareReady: false,
    isCaster: role === "CASTER",
    earlyContacts: role !== "CASTER",
    ready: false,
  },
});

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
  });

  it("co-casters : la fiche de l'autre caster attend le départ, la sienne non", () => {
    const other: LaunchCaster = { ...CASTER, userId: 12, pseudo: "Écho" };
    const cocast = info("SCHEDULED", [CASTER, other], START, "CASTER");
    expect(cocast.casters.map((caster) => caster.isViewer)).toEqual([true, false]);
    expect(casterContactsPending(cocast)).toBe(true);
    expect(casterRereadDelay(cocast, SERVER_BEFORE)).toBe(11_000);
    // Deux casters tus à un joueur : une seule relecture, à l'heure du serveur.
    expect(casterRereadDelay(info("SCHEDULED", [CASTER, other]), SERVER_BEFORE)).toBe(11_000);
    expect(casterContactsPending(info("LOBBY", [CASTER, other]))).toBe(false);
  });

  // Décision du 2026-10-21 : l'arbitre lit les contacts du caster dès que les adversaires sont connus.
  it("pas pour un arbitre : contacts du caster ouverts avant le départ, sans relecture", () => {
    for (const phase of ["TO_PLAN", "SCHEDULED", "LOBBY", "LAUNCHED"] as const) {
      const referee = info(phase, CASTER, START, "REFEREE");
      expect(casterContactsPending(referee)).toBe(false);
      expect(casterRereadDelay(referee, SERVER_BEFORE)).toBeNull();
    }
  });

  it("une seule règle, serveur et modale : exposesCasterContacts", () => {
    // En attente = caster tu à un lecteur qui n'est pas ce caster : la même règle.
    for (const phase of ["NONE", "TO_PLAN", "SCHEDULED", "LOBBY", "LAUNCHED"] as const) {
      for (const role of ["TEAM1", "TEAM2", "REFEREE"] as const) {
        expect(casterContactsPending(info(phase, CASTER, START, role))).toBe(!exposesCasterContacts(phase, role));
      }
    }
    expect(exposesCasterContacts("SCHEDULED", "TEAM1")).toBe(false);
    expect(exposesCasterContacts("SCHEDULED", "REFEREE")).toBe(true);
    expect(exposesCasterContacts("LAUNCHED", "TEAM2")).toBe(true);
    // Hors phase (match terminé, adversaire manquant) : rien, arbitre compris.
    expect(exposesCasterContacts("NONE", "REFEREE")).toBe(false);
  });

  it("le temps du match, une seule définition : matchUnderway", () => {
    expect((["NONE", "TO_PLAN", "SCHEDULED", "LOBBY", "LAUNCHED"] as const).filter(matchUnderway)).toEqual(["LOBBY", "LAUNCHED"]);
    const phases = ["NONE", "TO_PLAN", "SCHEDULED", "LOBBY", "LAUNCHED"] as const;
    // Joueur ou arbitre par la carte : dès que les adversaires sont connus ; sinon le temps du match.
    expect(phases.filter((phase) => exposesMatchContacts(phase, true))).toEqual(["TO_PLAN", "SCHEDULED", "LOBBY", "LAUNCHED"]);
    expect(phases.filter((phase) => exposesMatchContacts(phase, false))).toEqual(["LOBBY", "LAUNCHED"]);
    expect(readsContactsEarly({ playsMatch: true, referee: false })).toBe(true);
    expect(readsContactsEarly({ playsMatch: false, referee: true })).toBe(true);
    expect(readsContactsEarly({ playsMatch: false, referee: false })).toBe(false);
  });

  it("échecs passagers en rafale sans rien de lu : une seule notification", () => {
    // Première lecture puis REREAD_RETRIES tentatives, toutes en échec passager.
    let toasts = 0;
    for (let failuresBefore = 0; failuresBefore <= REREAD_RETRIES; failuresBefore += 1) {
      if (!failureIsSilent(true, false, failuresBefore)) toasts += 1;
    }
    expect(toasts).toBe(1);
    expect(failureIsSilent(true, false, 0)).toBe(true); // chargement maintenu
    expect(failureIsSilent(true, false, 1)).toBe(false); // la tentative échoue aussi : dit
  });

  it("contacts déjà affichés : échec passager tu ; refus définitif toujours dit", () => {
    for (let failuresBefore = 0; failuresBefore <= REREAD_RETRIES; failuresBefore += 1) {
      expect(failureIsSilent(true, true, failuresBefore)).toBe(true);
      expect(failureIsSilent(false, true, failuresBefore)).toBe(false);
      expect(failureIsSilent(false, false, failuresBefore)).toBe(false);
    }
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

  const CARD: ContactsCard = {
    startAt: START,
    launchedAt: null,
    casters: [{ userId: 9, pseudo: "Voix", streamId: 1, ready: false }],
    team1Id: 1,
    team2Id: 2,
    hostTeamId: 1,
    team1Ready: false,
    team2Ready: false,
  };
  const key = (patch: Partial<ContactsCard> = {}) => contactsCardKey({ ...CARD, ...patch });
  const card = (patch: Partial<ContactsCard> = {}): ContactsCard => ({ ...CARD, ...patch });

  it("chaque écriture qui touche la modale la fait relire, une fois", () => {
    const writes: Partial<ContactsCard>[] = [
      { launchedAt: "2026-10-19T17:50:00.000Z" }, // lancement forcé
      { startAt: "2026-10-19T18:30:00.000Z" }, // reprogrammé
      { startAt: null }, // remis à planifier
      { casters: [] }, // caster retiré
      { casters: [{ userId: 12, pseudo: "Écho", streamId: 1, ready: false }] }, // autre caster
      { casters: [...CARD.casters, { userId: 12, pseudo: "Écho", streamId: 2, ready: false }] }, // co-caster inscrit
      { team2Id: 3 }, // adversaire corrigé
      { hostTeamId: 2 }, // hôte changé
      { team1Ready: true },
      { team2Ready: true },
      { casters: [{ ...CARD.casters[0], ready: true }] }, // « Prêt » du caster
    ];
    for (const patch of writes) {
      expect(rereadOnCardChange(card(), card(patch), info("SCHEDULED"))).toBe(true);
      expect(rereadOnCardChange(card(), card(patch), info("LOBBY", null))).toBe(true);
    }
  });

  it("rien sans changement, ni avant la première lecture (l'horloge du navigateur ne relit rien)", () => {
    expect(rereadOnCardChange(card(), card(), info("SCHEDULED"))).toBe(false);
    // Un instantané neuf porte un nouveau tableau de casters, mêmes valeurs : rien à relire.
    expect(rereadOnCardChange(card(), card({ casters: CARD.casters.map((caster) => ({ ...caster })) }), info("SCHEDULED"))).toBe(false);
    expect(rereadOnCardChange(card(), card({ hostTeamId: 2 }), null)).toBe(false);
    expect(rereadOnCardChange(null, card(), info("SCHEDULED"))).toBe(false);
  });

  it("sans phase de lancement : le `launchedAt` posé après l'heure ne relit pas un match déjà lu lancé", () => {
    const launched = { launchedAt: "2026-10-19T18:00:05.000Z" };
    expect(rereadOnCardChange(card(), card(launched), info("LAUNCHED"))).toBe(false);
    expect(rereadOnCardChange(card(), card(launched), info("LOBBY"))).toBe(true);
    expect(rereadOnCardChange(card(), card({ ...launched, team1Ready: true }), info("LAUNCHED"))).toBe(true);
  });

  it("refus de quota : l'attente de `Retry-After` est lue, en secondes", () => {
    expect(parseRetryAfter("40")).toBe(40_000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("0")).toBeNull();
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
  });

  it("refus de quota : rendu avec son attente", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "RATE_LIMITED" }), { status: 429, headers: { "Retry-After": "40" } }),
    );
    await expect(readMatchContacts(7, { startAt: START, wait: noWait() })).resolves.toEqual({
      error: "RATE_LIMITED",
      retryAfterMs: 40_000,
    });
  });

  it("empreinte : vide sans carte, stable pour les mêmes valeurs", () => {
    expect(contactsCardKey(null)).toBe("");
    expect(key()).toBe(contactsCardKey({ ...CARD }));
    expect(key({ startAt: null })).not.toBe(key());
  });

  it("câblage : carte transmise, relecture passagère silencieuse, affichage à la phase du serveur", () => {
    const dialog = readSource("components/match-launch/MatchContactsDialog.tsx");
    expect(dialog).toContain("}, [matchId, readKey]);");
    expect(dialog).toContain("rereadOnCardChange(previousCard.current, card, launch)");
    expect(dialog).toContain("Math.max(REREAD_RETRY_MS, rereadWait)");
    expect(dialog).toContain('if (launch?.viewer.role !== "REFEREE") window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT));');
    expect(dialog).toContain("}, [cardKey, launch]);");
    expect(dialog).toContain("const timer = setTimeout(rereadNow, delay);");
    expect(dialog).toContain("const transient = !isFinalRefusal(read.error);");
    expect(dialog).toContain("shouldRetryReread(rereadFailures)");
    expect(dialog).toContain("casterRereadDelay(launch, serverDate)");
    // Échec passager de la première lecture : chargement le temps d'une nouvelle
    // tentative, puis notification une fois ; les tentatives suivantes continuent.
    expect(dialog).toMatch(/if \(transient\) \{\n\s*setRereadWait\(read\.retryAfterMs \?\? 0\);\n\s*setRereadFailures\(\(count\) => count \+ 1\);\n\s*\}\n\s*if \(keepWaiting\(transient\)\) return;/);
    expect(dialog).toMatch(/setRereadWait\(0\);\n\s*setRereadFailures\(\(count\) => count \+ 1\);\n\s*if \(keepWaiting\(true\)\) return;/);
    expect(dialog).toContain("failureIsSilent(transient, shown, rereadFailures)");
    expect(dialog).toContain("<CasterCards");
    expect(dialog).toContain("casters={launch.casters}");
    const card = readSource("app/(secured)/tournois/[id]/_components/MatchCardActions.tsx");
    expect(card).toMatch(/<MatchContactsDialog[\s\S]*?card=\{match\}[\s\S]*?\/>/);
  });
});
