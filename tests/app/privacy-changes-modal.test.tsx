import { afterEach, describe, expect, it, jest } from "@jest/globals";

let mockPathname: string | null = "/tournois";
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createPrivacyDetailsReads,
  loadPrivacyChangeDetails,
  PrivacyChangesModal,
  privacyDetailsPending,
  privacyDetailsReadCovers,
  privacyDetailsRequestKey,
  runPrivacyDetailsRead,
  type PrivacyChangeDetails,
  type PrivacyDetailsReadHooks,
} from "@/components/privacy/PrivacyChangesModal";
import { ToastProvider } from "@/components/ui/toast";
import { PRIVACY_CHANGES, type PrivacyChange } from "@/lib/shared/privacy-changes";
import { privacyChangeHeads } from "@/lib/shared/privacy-changes-en";

/**
 * La modale se rend **côté serveur**, depuis la mise en page racine : ce que
 * `renderToStaticMarkup` produit ici est ce que le joueur voit à la première
 * peinture, sans attendre l'hydratation.
 */
const render = (changes: PrivacyChange[]) =>
  renderToStaticMarkup(
    <ToastProvider>
      <PrivacyChangesModal changes={changes} />
    </ToastProvider>,
  );

describe("PrivacyChangesModal — rendu serveur", () => {
  afterEach(() => {
    mockPathname = "/tournois";
  });

  it("se tait sur /rgpd, seule page où elle couvrirait ce qu'elle invite à lire", () => {
    mockPathname = "/rgpd";
    expect(render([...PRIVACY_CHANGES])).not.toMatch(/role="dialog"/);
  });

  it("se tait aussi sur /en/rgpd : la route compte, pas le préfixe de langue", () => {
    mockPathname = "/en/rgpd";
    expect(render([...PRIVACY_CHANGES])).not.toMatch(/role="dialog"/);
  });

  it("revient sur toute autre page, sous-pages de /rgpd comprises", () => {
    for (const path of ["/", "/profil", "/rgpd/autre", "/regles"]) {
      mockPathname = path;
      expect(render([...PRIVACY_CHANGES])).toMatch(/role="dialog"/);
    }
  });
  it("ne rend rien quand tout a été lu", () => {
    expect(render([])).not.toMatch(/role="dialog"/);
  });

  it("présente tous les changements dus d'un coup, avec leur date et leur détail", () => {
    const markup = render([...PRIVACY_CHANGES]);
    expect(markup).toMatch(/role="dialog"/);
    expect(markup).toMatch(/aria-modal="true"/);
    expect(markup).toContain(`${PRIVACY_CHANGES.length} changements de nos règles de confidentialité`);
    for (const change of PRIVACY_CHANGES) {
      expect(markup).toContain(change.title.replace(/'/g, "&#x27;"));
      expect(markup).toContain(`dateTime="${change.publishedAt}"`);
    }
    expect(markup).toContain(PRIVACY_CHANGES[0].details[0].slice(0, 40).replace(/'/g, "&#x27;"));
  });

  it("informe sans rien faire accepter : un seul bouton, aucune suppression", () => {
    const markup = render([PRIVACY_CHANGES[0]]);
    expect(markup).toContain("J&#x27;ai pris connaissance");
    expect(markup).toContain("aucun accord ne t&#x27;est demandé");
    // Ni acceptation, ni refus qui coûterait le compte (RGPD, art. 7.4 et 21).
    expect(markup).not.toMatch(/J&#x27;accepte|Je refuse|supprime mon compte|Supprimer définitivement/);
    expect(markup).not.toMatch(/Plus tard|Fermer/);
    expect(markup.match(/<button/g)).toHaveLength(1);
    // L'opposition et les autres droits : la politique, ouverte à côté.
    expect(markup).toContain('href="/rgpd"');
    expect(markup).toMatch(/t&#x27;opposer à un traitement/);
  });

  it("rend les liens d'action d'une entrée, et aucun pour une entrée qui n'en a pas", () => {
    const withLinks: PrivacyChange = {
      ...PRIVACY_CHANGES[0],
      links: [{ href: "/profil#identite", label: "Changer mon pseudo" }],
    };
    expect(render([withLinks])).toContain('href="/profil#identite"');
    expect(render([withLinks])).toContain("Changer mon pseudo");
    expect(render([{ ...PRIVACY_CHANGES[0], links: undefined }])).not.toContain("/profil#");
  });

  // #587 : la mise en page envoie les entrées sans détail ; la modale l'attend.
  it("PrivacyChangesModal_detailsDeferred_rendsTitlesAndSummariesWithoutDetailsAndHoldsTheButton", () => {
    const entry = PRIVACY_CHANGES[0];

    const markup = renderToStaticMarkup(
      <ToastProvider>
        <PrivacyChangesModal changes={privacyChangeHeads([entry])} detailsDeferred />
      </ToastProvider>,
    );

    expect(markup).toContain(entry.title.replace(/'/g, "&#x27;"));
    expect(markup).not.toContain(entry.details[0].slice(0, 40).replace(/'/g, "&#x27;"));
    expect(markup).toContain("Chargement du détail des changements…");
    expect(markup).toMatch(/<button[^>]*disabled=""/);
  });

  it("privacyDetailsPending_followsTheDueRequest", () => {
    // Détail donné par la mise en page : rien à attendre.
    expect(privacyDetailsPending(false, "fr|a,b", null)).toBe(false);
    // Lecture en vol.
    expect(privacyDetailsPending(true, "fr|a,b", null)).toBe(true);
    // Tout est lu, ou la lecture a échoué (l'erreur libère le bouton : la politique porte tout).
    expect(privacyDetailsPending(true, "", null)).toBe(false);
    expect(privacyDetailsPending(true, "fr|a,b", "fr|a,b")).toBe(false);
    // Une autre lecture est due (entrée ajoutée, langue changée) : le bouton attend de nouveau.
    expect(privacyDetailsPending(true, "fr|c", "fr|a,b")).toBe(true);
  });

  it("privacyDetailsRequestKey_asksOnlyWhatIsMissingInThePageLanguage", () => {
    const heads = [
      { id: "a", details: [] },
      { id: "b", details: [] },
    ];
    // Rien de lu : toute la liste, dans la langue de la page.
    expect(privacyDetailsRequestKey(heads, {}, "fr")).toBe("fr|a,b");
    // Liste qui rétrécit ou se réordonne, détail déjà lu : aucune lecture.
    const loaded = { "fr:a": ["x"], "fr:b": [] };
    expect(privacyDetailsRequestKey([heads[1], heads[0]], loaded, "fr")).toBe("");
    expect(privacyDetailsRequestKey([heads[0]], loaded, "fr")).toBe("");
    // Entrée ajoutée sous la modale ouverte : elle seule.
    expect(privacyDetailsRequestKey([...heads, { id: "c", details: [] }], loaded, "fr")).toBe("fr|c");
    // Passage à l'anglais : tout se relit en anglais.
    expect(privacyDetailsRequestKey(heads, loaded, "en")).toBe("en|a,b");
    // Détail déjà porté par l'entrée : rien à lire.
    expect(privacyDetailsRequestKey([{ id: "a", details: ["y"] }], {}, "fr")).toBe("");
  });

  it("privacyDetailsRequestKey_emptyList_returnsEmptyKey", () => {
    expect(privacyDetailsRequestKey([], {}, "fr")).toBe("");
  });

  it("privacyDetailsPending_failedReadCoversShrunkKey_releasesTheButton", () => {
    // La dernière lecture (a, c) a échoué ; une lecture dépassée a depuis livré a.
    expect(privacyDetailsPending(true, "fr|c", "fr|a,c")).toBe(false);
  });

  it("privacyDetailsPending_failedInOtherLocale_holdsTheButton", () => {
    expect(privacyDetailsPending(true, "fr|a", "en|a")).toBe(true);
  });

  it("privacyDetailsReadCovers_sameLocaleSubset_true", () => {
    expect(privacyDetailsReadCovers("fr|a,c", "fr|c")).toBe(true);
  });

  it("privacyDetailsReadCovers_otherLocale_false", () => {
    expect(privacyDetailsReadCovers("en|a,c", "fr|c")).toBe(false);
  });

  it("privacyDetailsReadCovers_idNotInRead_false", () => {
    expect(privacyDetailsReadCovers("fr|a", "fr|a,c")).toBe(false);
  });

  it("privacyDetailsReadCovers_noReadYet_falseUnlessNothingIsDue", () => {
    expect(privacyDetailsReadCovers(null, "fr|a")).toBe(false);
    expect(privacyDetailsReadCovers(null, "")).toBe(true);
  });

  it("createPrivacyDetailsReads_languageRoundTrip_onlyTheLastReadSpeaks", () => {
    const reads = createPrivacyDetailsReads();

    const firstFr = reads.start("fr|a,b");
    const en = reads.start("en|a,b");
    const secondFr = reads.start("fr|a,b");

    // Même clé que la première, mais seule la troisième lecture parle : l'échec
    // tardif de la première se tait.
    expect(firstFr).not.toBeNull();
    expect(en).not.toBeNull();
    expect(secondFr).not.toBeNull();
    expect(reads.isLatest(firstFr!)).toBe(false);
    expect(reads.isLatest(en!)).toBe(false);
    expect(reads.isLatest(secondFr!)).toBe(true);
  });

  it("createPrivacyDetailsReads_supersededSuccessShrinksTheKey_startsNoDuplicateRead", () => {
    const reads = createPrivacyDetailsReads();
    reads.start("fr|a");
    reads.start("fr|a,c");

    // La lecture de a revient : il ne reste que c, que la dernière lecture attend déjà.
    expect(reads.start("fr|c")).toBeNull();
  });

  // Performance cycle 1 : une lecture dépassée est abandonnée, pas laissée finir.
  it("createPrivacyDetailsReads_newRead_abortsThePreviousOneStillInFlight", () => {
    const reads = createPrivacyDetailsReads();
    const first = reads.start("fr|a")!;
    const firstSignal = reads.signal(first)!;
    expect(firstSignal.aborted).toBe(false);

    const second = reads.start("en|a")!;

    expect(firstSignal.aborted).toBe(true);
    expect(reads.signal(first)).toBeUndefined();
    expect(reads.signal(second)?.aborted).toBe(false);
  });

  it("createPrivacyDetailsReads_coveredKey_doesNotAbortTheRunningRead", () => {
    const reads = createPrivacyDetailsReads();
    const first = reads.start("fr|a,b")!;

    expect(reads.start("fr|a")).toBeNull();

    expect(reads.signal(first)?.aborted).toBe(false);
  });

  it("runPrivacyDetailsRead_supersededByLanguage_abortedReadStaysSilent", async () => {
    const reads = createPrivacyDetailsReads();
    const hooks = {
      load: jest.fn((_ids: string[], signal?: AbortSignal) =>
        new Promise<Record<string, readonly string[]>>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      ),
      onStart: jest.fn(),
      onLoaded: jest.fn(),
      onFailed: jest.fn(),
      isOpen: () => true,
    };

    runPrivacyDetailsRead(reads, "fr|a", hooks);
    runPrivacyDetailsRead(reads, "en|a", { ...hooks, load: jest.fn(() => new Promise<Record<string, readonly string[]>>(() => {})) });
    await Promise.resolve();
    await Promise.resolve();

    expect(hooks.onFailed).not.toHaveBeenCalled();
    expect(hooks.load.mock.calls[0][1]?.aborted).toBe(true);
  });

  it("createPrivacyDetailsReads_sameKeyRerendered_startsOnce", () => {
    const reads = createPrivacyDetailsReads();

    expect(reads.start("fr|a")).toBe(1);
    expect(reads.start("fr|a")).toBeNull();
  });

  it("createPrivacyDetailsReads_entryAddedUnderOpenModal_startsANewRead", () => {
    const reads = createPrivacyDetailsReads();
    reads.start("fr|a");

    expect(reads.start("fr|c")).toBe(2);
  });

  it("createPrivacyDetailsReads_forgetNotLatest_keepsLatestCovering", () => {
    const reads = createPrivacyDetailsReads();
    const first = reads.start("fr|a")!;
    reads.start("en|a");
    reads.start("fr|a");

    reads.forget(first);

    expect(reads.start("fr|a")).toBeNull();
  });

  it("PrivacyChangesModal_detailsGiven_buttonIsNotHeld", () => {
    const markup = render([PRIVACY_CHANGES[0]]);

    expect(markup).not.toMatch(/<button[^>]*disabled=""/);
    expect(markup).not.toContain("Chargement du détail");
  });

  it("parle au singulier pour un seul changement", () => {
    expect(render([PRIVACY_CHANGES[0]])).toContain("Nos règles de confidentialité ont changé");
  });
});

/**
 * Le comportement client ne se monte pas sans navigateur ; ses contrats se
 * lisent sur la source, où une régression se verrait d'abord.
 */
/** Lecture différée : le test la résout ou la rejette quand il veut. */
function deferredLoad() {
  const pending: { resolve: (details: PrivacyChangeDetails) => void; reject: (error: Error) => void }[] = [];
  const load = jest.fn<PrivacyDetailsReadHooks["load"]>(
    () => new Promise<PrivacyChangeDetails>((resolve, reject) => pending.push({ resolve, reject })),
  );
  return { load, pending };
}

function readHooks(load: PrivacyDetailsReadHooks["load"], open = { current: true }) {
  return {
    load,
    onStart: jest.fn<PrivacyDetailsReadHooks["onStart"]>(),
    onLoaded: jest.fn<PrivacyDetailsReadHooks["onLoaded"]>(),
    onFailed: jest.fn<PrivacyDetailsReadHooks["onFailed"]>(),
    isOpen: () => open.current,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("runPrivacyDetailsRead — câblage des lectures de détail", () => {
  it("runPrivacyDetailsRead_emptyKey_startsNothing", () => {
    const { load } = deferredLoad();
    const hooks = readHooks(load);

    runPrivacyDetailsRead(createPrivacyDetailsReads(), "", hooks);

    expect(load).not.toHaveBeenCalled();
    expect(hooks.onStart).not.toHaveBeenCalled();
  });

  it("runPrivacyDetailsRead_newKey_relocksThenLoadsRequestedIds", async () => {
    const { load, pending } = deferredLoad();
    const hooks = readHooks(load);

    runPrivacyDetailsRead(createPrivacyDetailsReads(), "fr|a,b", hooks);
    pending[0].resolve({ a: ["détail a"] });
    await settle();

    expect(hooks.onStart).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(["a", "b"], expect.any(AbortSignal));
    expect(hooks.onLoaded).toHaveBeenCalledWith(["a", "b"], { a: ["détail a"] });
  });

  it("runPrivacyDetailsRead_keyCoveredByLatest_startsNoDuplicateRead", () => {
    const { load } = deferredLoad();
    const reads = createPrivacyDetailsReads();
    const hooks = readHooks(load);

    runPrivacyDetailsRead(reads, "fr|a", hooks);
    runPrivacyDetailsRead(reads, "fr|a", hooks);

    expect(load).toHaveBeenCalledTimes(1);
    expect(hooks.onStart).toHaveBeenCalledTimes(1);
  });

  it("runPrivacyDetailsRead_latestFailsWhileOpen_reportsFailure", async () => {
    const { load, pending } = deferredLoad();
    const hooks = readHooks(load);

    runPrivacyDetailsRead(createPrivacyDetailsReads(), "fr|a", hooks);
    pending[0].reject(new Error("HTTP 500"));
    await settle();

    expect(hooks.onFailed).toHaveBeenCalledTimes(1);
  });

  it("runPrivacyDetailsRead_supersededReadFails_staysSilent", async () => {
    const { load, pending } = deferredLoad();
    const reads = createPrivacyDetailsReads();
    const hooks = readHooks(load);
    runPrivacyDetailsRead(reads, "fr|a", hooks);
    runPrivacyDetailsRead(reads, "en|a", hooks);

    pending[0].reject(new Error("HTTP 500"));
    await settle();

    expect(hooks.onFailed).not.toHaveBeenCalled();
  });

  // Revue std 4 : modale masquée (lien vers /rgpd) pendant la lecture — aucun
  // toast sur une page sans modale, et la lecture repart à la réouverture.
  it("runPrivacyDetailsRead_latestFailsAfterModalHidden_silentAndRereadsOnReopen", async () => {
    const { load, pending } = deferredLoad();
    const reads = createPrivacyDetailsReads();
    const open = { current: true };
    const hooks = readHooks(load, open);
    runPrivacyDetailsRead(reads, "fr|a", hooks);
    open.current = false;

    pending[0].reject(new Error("HTTP 500"));
    await settle();
    open.current = true;
    runPrivacyDetailsRead(reads, "fr|a", hooks);

    expect(hooks.onFailed).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);
  });

  // Revue sécurité cycle 1 : un échec dit modale ouverte restait « couvrant » ;
  // masquée puis rouverte, la modale ne relisait jamais le détail.
  it("runPrivacyDetailsRead_failedWhileOpenThenHiddenAndReopened_rereads", async () => {
    const { load, pending } = deferredLoad();
    const reads = createPrivacyDetailsReads();
    const hooks = readHooks(load);
    runPrivacyDetailsRead(reads, "fr|a", hooks);
    pending[0].reject(new Error("HTTP 503"));
    await settle();

    reads.dropFailed();
    runPrivacyDetailsRead(reads, "fr|a", hooks);

    expect(hooks.onFailed).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("runPrivacyDetailsRead_failedWhileOpenRerendered_noRetryLoop", async () => {
    const { load, pending } = deferredLoad();
    const reads = createPrivacyDetailsReads();
    const hooks = readHooks(load);
    runPrivacyDetailsRead(reads, "fr|a", hooks);
    pending[0].reject(new Error("HTTP 503"));
    await settle();

    runPrivacyDetailsRead(reads, "fr|a", hooks);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("createPrivacyDetailsReads_dropFailed_keepsAReadInFlightOrSucceeded", async () => {
    const { load, pending } = deferredLoad();
    const reads = createPrivacyDetailsReads();
    const hooks = readHooks(load);
    runPrivacyDetailsRead(reads, "fr|a", hooks);

    reads.dropFailed();
    runPrivacyDetailsRead(reads, "fr|a", hooks);
    pending[0].resolve({ a: ["x"] });
    await settle();
    reads.dropFailed();
    runPrivacyDetailsRead(reads, "fr|a", hooks);

    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("PrivacyChangesModal — contrats du geste", () => {
  const source = readFileSync(join(__dirname, "..", "..", "components", "privacy", "PrivacyChangesModal.tsx"), "utf8");

  it("envoie les identifiants montrés, pas « tout ce qui est dû »", () => {
    expect(source).toContain('fetch("/api/profile/privacy-changes"');
    expect(source).toContain("await record(changes.map((change) => change.id));");
  });

  it("garde l'écriture en vol quand un lien d'action charge un nouveau document (changement de langue)", () => {
    expect(source).toMatch(/fetch\("\/api\/profile\/privacy-changes", \{[\s\S]*?keepalive: true,[\s\S]*?\}\)/);
  });

  it("suivre un lien d'action vaut prise de connaissance et ferme la modale sans attendre", () => {
    expect(source).toContain("onClick={() => followLink(change.id)}");
    const body = source.slice(source.indexOf("const followLink = (changeId: string) => {"));
    // Fermée avant l'envoi : elle ne doit pas rester sur l'écran où elle envoie.
    expect(body.indexOf("close(true);")).toBeGreaterThan(-1);
    expect(body.indexOf("close(true);")).toBeLessThan(body.indexOf("record("));
    // Seul le changement du lien est acquitté, pas ses voisins.
    expect(body).toContain("record([changeId])");
    // Pas de second enregistrement si le bouton en a déjà lancé un, et sa
    // réponse ne parle plus d'une modale refermée.
    expect(body.indexOf("if (busy) {")).toBeLessThan(body.indexOf("record("));
    expect(body).toContain("leftByLink.current = true;");
    expect(source).toContain("if (!leftByLink.current) showSuccess(");
    expect(source).toContain(`showError(leftByLink.current ? t("privacyModal.replay")`);
  });

  it("ne touche jamais au compte : ni aperçu ni route de suppression", () => {
    expect(source).not.toContain("/api/profile/deletion");
    expect(source).not.toMatch(/method: "DELETE"/);
    expect(source).not.toContain("account-deletion");
  });

  it("n'est pas refermable par Échap ni par un clic à côté", () => {
    expect(source).toContain("onClose: () => {}");
    expect(source).not.toMatch(/overlay[^>]*onClick/);
  });

  it("passe par useToast pour les retours, jamais un message en ligne", () => {
    expect(source).toContain("useToast()");
    expect(source).toContain("showError(");
  });
});

describe("mise en page racine", () => {
  const layout = readFileSync(join(__dirname, "..", "..", "app", "layout.tsx"), "utf8");

  it("monte la modale et déclenche l'annonce Discord", () => {
    // Entrées traduites par la mise en page (lot 7b-2), dans la langue de la page.
    // #587 : sans leur détail, que la modale lit à l'ouverture.
    expect(layout).toContain(
      "<PrivacyChangesModal changes={privacyChangeHeads(localizedPrivacyChanges(privacyChanges, locale))} detailsDeferred />",
    );
    expect(layout).toContain("void dispatchPrivacyChangeNotifications().catch(");
  });

  it("lit les changements sur toutes les pages et fait taire la modale de recrutement", () => {
    // Le silence de `/rgpd` est décidé côté client : décidé ici, il suivrait le
    // joueur d'un lien à l'autre (la mise en page n'est pas re-rendue).
    // Lue en parallèle des marches du podium et des comptes sans fiche.
    expect(layout).toContain("const privacyChangesLoad = pendingChangesFor(user?.id);");
    expect(layout).toMatch(/const \[privacyChanges, rawPodiumTiers, profilelessPlayers\] = await Promise\.all\(\[\s*privacyChangesLoad,/);
    expect(layout).not.toContain("PRIVACY_POLICY_PAGE");
    // Seule la modale d'arrivée se tait : la banderole n'est pas modale et reste.
    expect(layout).toMatch(
      /modalSilenced=\{recruitmentModalSilenced\(\{\s*privacyPending: privacyChanges\.length > 0,/,
    );
    expect(layout).not.toMatch(/bannerDismissed=\{[^}]*privacyChanges/);
  });
});

describe("revue UI cycle 1 : chargement des détails", () => {
  const source = readFileSync("components/privacy/PrivacyChangesModal.tsx", "utf8");

  it("modal_detailsPending_loadingOutputInsideActionsFooter", () => {
    const loading = source.indexOf("styles.detailsLoading");
    expect(loading).toBeGreaterThan(source.indexOf("className={styles.actions}"));
    expect(loading).toBeGreaterThan(source.indexOf("</ScrollArea>"));
  });

  it("loadDetails_fetch_timeoutConstant", () => {
    expect(source).toContain("PRIVACY_DETAILS_TIMEOUT_MS = 15_000");
  });
});

/**
 * Revue sécurité cycle 1 : `AbortSignal.any` / `.timeout`, absents de Safari
 * avant 17.4, faisaient échouer toute lecture du détail — remplacés par un
 * `AbortController` et une minuterie.
 */
describe("loadPrivacyChangeDetails — abandon sans AbortSignal.any", () => {
  const realFetch = globalThis.fetch;
  const realAny = (AbortSignal as { any?: unknown }).any;
  const realTimeout = (AbortSignal as { timeout?: unknown }).timeout;
  let seen: AbortSignal | undefined;

  const hangingFetch = () =>
    jest.fn((_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        // Comme `fetch` : un signal déjà levé rejette d'emblée.
        if (seen?.aborted) reject(new Error("aborted"));
        seen?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

  afterEach(() => {
    globalThis.fetch = realFetch;
    Object.assign(AbortSignal, { any: realAny, timeout: realTimeout });
    jest.useRealTimers();
    seen = undefined;
  });

  it("loadPrivacyChangeDetails_olderBrowserWithoutAnyOrTimeout_readsDetails", async () => {
    Object.assign(AbortSignal, { any: undefined, timeout: undefined });
    globalThis.fetch = jest.fn(async () => Response.json({ details: { a: ["détail"] } })) as typeof fetch;

    await expect(loadPrivacyChangeDetails("a", "fr", new AbortController().signal)).resolves.toEqual({
      a: ["détail"],
    });
  });

  it("loadPrivacyChangeDetails_callerAborts_requestAborted", async () => {
    globalThis.fetch = hangingFetch() as unknown as typeof fetch;
    const caller = new AbortController();

    const read = loadPrivacyChangeDetails("a", "fr", caller.signal);
    caller.abort();

    await expect(read).rejects.toThrow("aborted");
    expect(seen?.aborted).toBe(true);
  });

  it("loadPrivacyChangeDetails_alreadyAbortedSignal_abortsAtOnce", async () => {
    globalThis.fetch = hangingFetch() as unknown as typeof fetch;
    const caller = new AbortController();
    caller.abort();

    await expect(loadPrivacyChangeDetails("a", "fr", caller.signal)).rejects.toThrow();
    expect(seen?.aborted).toBe(true);
  });

  it("loadPrivacyChangeDetails_noAnswerWithin15s_abortedByTimer", async () => {
    jest.useFakeTimers();
    globalThis.fetch = hangingFetch() as unknown as typeof fetch;

    const read = loadPrivacyChangeDetails("a", "fr");
    const settled = expect(read).rejects.toThrow("aborted");
    jest.advanceTimersByTime(14_999);
    expect(seen?.aborted).toBe(false);
    jest.advanceTimersByTime(1);

    await settled;
  });

  it("loadPrivacyChangeDetails_httpError_rejects", async () => {
    globalThis.fetch = jest.fn(async () => new Response("", { status: 503 })) as typeof fetch;

    await expect(loadPrivacyChangeDetails("a", "fr")).rejects.toThrow("HTTP 503");
  });
});
