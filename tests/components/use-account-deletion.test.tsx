import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactElement } from "react";

/**
 * La suppression du compte commune à « Mon profil » et à la fenêtre bloquante
 * des conditions (`useAccountDeletion`) : même aperçu, même confirmation, même
 * route, même issue. Sans DOM dans les tests, le crochet est joué comme une
 * fonction : `useState` est remplacé par des cases relues à chaque « rendu ».
 */
const cells: unknown[] = [];
let cursor = 0;
function rerender(): void {
  cursor = 0;
}

jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(initial: T) => {
      const index = cursor++;
      if (!(index in cells)) cells[index] = initial;
      const set = (next: T) => {
        cells[index] = next;
      };
      return [cells[index] as T, set];
    },
  };
});

const showError = jest.fn<(message: string, options?: { lang?: string }) => void>();
const showSuccess = jest.fn<(message: string, options?: { lang?: string }) => void>();
jest.mock("@/components/ui/toast", () => ({ useToast: () => ({ showError, showSuccess }) }));
jest.mock("@/components/i18n/locale-context", () => ({ useAppLocale: () => locale.current }));
const locale: { current: "fr" | "en" } = { current: "fr" };

import {
  ACCOUNT_DELETED_REDIRECT_MS,
  ACCOUNT_DELETION_PREVIEW_TIMEOUT_MS,
  previewAccountDeletion,
  requestAccountDeletion,
  useAccountDeletion,
} from "@/components/account/use-account-deletion";
import { FR_PROFILE } from "@/app/(secured)/profil/_lib/profile-text";
import type { ConfirmActionDialogProps } from "@/components/ui/confirm-action-dialog";
import { RETENTION_UNKNOWN } from "@/lib/shared/account-deletion";
import { readSource } from "../helpers/read-source";
import { scopedText } from "@/lib/shared/scoped-text";
import enProfile from "@/messages/en/profile.json";

type FetchCall = { url: string; init?: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeFetch(responses: Record<string, () => Response | Promise<Response>>, calls: FetchCall[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = `${init?.method ?? "GET"} ${url}`;
    const respond = responses[key];
    if (!respond) throw new TypeError("network down");
    return respond();
  }) as typeof fetch;
}

describe("previewAccountDeletion", () => {
  it("lit le motif de l'aperçu, sans cache", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = fakeFetch({ "GET /api/profile/deletion": () => jsonResponse(200, { mode: "ANONYMIZE", reason: "OWNED_TEAMS" }) }, calls);
    expect(await previewAccountDeletion(fetchImpl)).toEqual({ subject: "OWNED_TEAMS", previewed: "OWNED_TEAMS" });
    expect(calls[0].init?.cache).toBe("no-store");
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("sans `AbortSignal.timeout` (Safari < 16), l'aperçu reste borné : la requête est coupée au délai, pas laissée ouverte", async () => {
    const signal = AbortSignal as { timeout?: typeof AbortSignal.timeout };
    const original = signal.timeout;
    delete signal.timeout;
    jest.useFakeTimers();
    try {
      let seen: AbortSignal | undefined;
      const hanging = (async (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          seen = init?.signal ?? undefined;
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })) as typeof fetch;
      const pending = previewAccountDeletion(hanging);
      expect(seen?.aborted).toBe(false);
      jest.advanceTimersByTime(ACCOUNT_DELETION_PREVIEW_TIMEOUT_MS - 1);
      expect(seen?.aborted).toBe(false);
      jest.advanceTimersByTime(1);
      expect(seen?.aborted).toBe(true);
      expect(await pending).toEqual({ subject: RETENTION_UNKNOWN, previewed: RETENTION_UNKNOWN });
    } finally {
      jest.useRealTimers();
      signal.timeout = original;
    }
  });

  it("un aperçu qui répond à temps éteint sa minuterie : rien n'est coupé après coup", async () => {
    jest.useFakeTimers();
    try {
      const calls: FetchCall[] = [];
      const fetchImpl = fakeFetch({ "GET /api/profile/deletion": () => jsonResponse(200, { mode: "ERASE", reason: null }) }, calls);
      expect(await previewAccountDeletion(fetchImpl)).toEqual({ subject: null, previewed: null });
      expect(jest.getTimerCount()).toBe(0);
      expect(calls[0].init?.signal?.aborted).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("un effacement complet annoncé reste `null` (« il ne restera rien »)", async () => {
    const fetchImpl = fakeFetch({ "GET /api/profile/deletion": () => jsonResponse(200, { mode: "ERASE", reason: null }) }, []);
    expect(await previewAccountDeletion(fetchImpl)).toEqual({ subject: null, previewed: null });
  });

  it("aperçu refusé ou injoignable : l'incertitude, jamais la moitié rassurante", async () => {
    const refused = fakeFetch({ "GET /api/profile/deletion": () => jsonResponse(500, { error: "X" }) }, []);
    expect(await previewAccountDeletion(refused)).toEqual({ subject: RETENTION_UNKNOWN, previewed: RETENTION_UNKNOWN });
    expect(await previewAccountDeletion(fakeFetch({}, []))).toEqual({ subject: RETENTION_UNKNOWN, previewed: RETENTION_UNKNOWN });
  });
});

describe("requestAccountDeletion", () => {
  it("appelle DELETE /api/profile et rend le plan appliqué par le serveur", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = fakeFetch({ "DELETE /api/profile": () => jsonResponse(200, { deleted: true, mode: "ERASE", reason: null }) }, calls);
    expect(await requestAccountDeletion("TOURNAMENTS", fetchImpl)).toEqual({ ok: true, applied: null });
    expect(calls).toEqual([{ url: "/api/profile", init: { method: "DELETE" } }]);
  });

  it("sans `mode` dans la réponse, retombe sur l'aperçu", async () => {
    const fetchImpl = fakeFetch({ "DELETE /api/profile": () => jsonResponse(200, { deleted: true }) }, []);
    expect(await requestAccountDeletion("TOURNAMENTS", fetchImpl)).toEqual({ ok: true, applied: "TOURNAMENTS" });
  });

  it("un refus rend son code ; une panne ou un corps illisible, le code générique", async () => {
    const refused = fakeFetch({ "DELETE /api/profile": () => jsonResponse(400, { error: "ACCOUNT_STILL_REFERENCED" }) }, []);
    expect(await requestAccountDeletion(null, refused)).toEqual({ ok: false, code: "ACCOUNT_STILL_REFERENCED" });
    const unreadable = fakeFetch({ "DELETE /api/profile": () => new Response("<html>", { status: 502 }) }, []);
    expect(await requestAccountDeletion(null, unreadable)).toEqual({ ok: false, code: "ACCOUNT_DELETE_FAILED" });
    expect(await requestAccountDeletion(null, fakeFetch({}, []))).toEqual({ ok: false, code: "ACCOUNT_DELETE_FAILED" });
  });
});

describe("useAccountDeletion", () => {
  const realFetch = globalThis.fetch;
  const globalWithWindow = globalThis as { window?: unknown };
  const hadWindow = "window" in globalWithWindow;
  const fakeWindow = { location: { href: "/conditions" } };
  let calls: FetchCall[];

  beforeEach(() => {
    cells.length = 0;
    rerender();
    showError.mockReset();
    showSuccess.mockReset();
    locale.current = "fr";
    calls = [];
    jest.useFakeTimers();
    fakeWindow.location.href = "/tournois";
    if (!hadWindow) globalWithWindow.window = fakeWindow;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    jest.useRealTimers();
    if (!hadWindow) delete globalWithWindow.window;
  });

  function dialogProps(flow: ReturnType<typeof useAccountDeletion>): ConfirmActionDialogProps {
    expect(flow.dialog).not.toBeNull();
    return (flow.dialog as ReactElement<ConfirmActionDialogProps>).props;
  }

  it("ouvre la confirmation après l'aperçu, avec la phrase du motif, empilable sur la fenêtre des conditions", async () => {
    globalThis.fetch = fakeFetch({ "GET /api/profile/deletion": () => jsonResponse(200, { mode: "ANONYMIZE", reason: "TOURNAMENTS" }) }, calls);
    const flow = useAccountDeletion({ text: FR_PROFILE, layer: "overBlocking" });
    expect(flow.dialog).toBeNull();
    expect(flow.deleting).toBe(false);
    await flow.start();
    rerender();
    const opened = useAccountDeletion({ text: FR_PROFILE, layer: "overBlocking" });
    expect(opened.deleting).toBe(true);
    expect(opened.confirming).toBe(true);
    const props = dialogProps(opened);
    expect(props.title).toBe("Supprimer définitivement ton compte ?");
    expect(props.confirmLabel).toBe("Supprimer mon compte");
    expect(props.layer).toBe("overBlocking");
    expect(props.closeOnSuccess).toBe(false);
  });

  const englishProfileText: typeof FR_PROFILE = scopedText("en", enProfile);
  const fallbackCases: Array<{ name: string; page: "fr" | "en"; text: typeof FR_PROFILE; lang: "fr" | undefined }> = [
    { name: "sous /en, textes retombés sur le français : la confirmation se déclare française", page: "en", text: FR_PROFILE, lang: "fr" },
    { name: "sous /en, textes anglais : aucune langue à déclarer", page: "en", text: englishProfileText, lang: undefined },
    { name: "page française : aucune langue à déclarer", page: "fr", text: FR_PROFILE, lang: undefined },
  ];
  it.each(fallbackCases)("contentLang — $name", async ({ page, text, lang }) => {
    globalThis.fetch = fakeFetch({ "GET /api/profile/deletion": () => jsonResponse(200, { mode: "ERASE", reason: null }) }, calls);
    locale.current = page;
    await useAccountDeletion({ text }).start();
    rerender();
    const props = dialogProps(useAccountDeletion({ text }));
    expect(props.contentLang).toBe(lang);
    expect(props.title).toBe(text.t("deletion.question"));
  });

  it("un aperçu déjà en vol (lancé par la fenêtre des conditions au clic) est repris : aucune seconde requête", async () => {
    globalThis.fetch = fakeFetch({}, calls);
    await useAccountDeletion({ text: FR_PROFILE }).start(Promise.resolve({ subject: "OWNED_TEAMS", previewed: "OWNED_TEAMS" }));
    expect(calls).toHaveLength(0);
    rerender();
    const opened = useAccountDeletion({ text: FR_PROFILE });
    expect(opened.confirming).toBe(true);
    expect(dialogProps(opened).children).toBeDefined();
  });

  it("un second lancement pendant l'aperçu n'envoie rien de plus", async () => {
    globalThis.fetch = fakeFetch({ "GET /api/profile/deletion": () => jsonResponse(200, { mode: "ERASE", reason: null }) }, calls);
    const flow = useAccountDeletion({ text: FR_PROFILE });
    await flow.start();
    rerender();
    await useAccountDeletion({ text: FR_PROFILE }).start();
    expect(calls).toHaveLength(1);
  });

  it("annuler referme la confirmation, réarme le bouton et rend la main à l'écran", async () => {
    globalThis.fetch = fakeFetch({ "GET /api/profile/deletion": () => jsonResponse(200, { mode: "ERASE", reason: null }) }, calls);
    const onCancel = jest.fn<() => void>();
    await useAccountDeletion({ text: FR_PROFILE, onCancel }).start();
    rerender();
    dialogProps(useAccountDeletion({ text: FR_PROFILE, onCancel })).onClose();
    rerender();
    const closed = useAccountDeletion({ text: FR_PROFILE, onCancel });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(closed.dialog).toBeNull();
    expect(closed.deleting).toBe(false);
    expect(calls.map((call) => call.init?.method ?? "GET")).toEqual(["GET"]);
  });

  it("confirmer appelle la route de suppression (qui ferme la session), dit l'issue puis ramène à l'accueil de la langue", async () => {
    locale.current = "en";
    globalThis.fetch = fakeFetch(
      {
        "GET /api/profile/deletion": () => jsonResponse(200, { mode: "ERASE", reason: null }),
        "DELETE /api/profile": () => jsonResponse(200, { deleted: true, mode: "ERASE", reason: null }),
      },
      calls,
    );
    await useAccountDeletion({ text: FR_PROFILE }).start();
    rerender();
    const ok = await dialogProps(useAccountDeletion({ text: FR_PROFILE })).onConfirm();
    expect(ok).toBe(true);
    expect(calls.at(-1)).toEqual({ url: "/api/profile", init: { method: "DELETE" } });
    // Textes retombés sur le français sous /en : le toast le déclare aussi.
    expect(showSuccess).toHaveBeenCalledWith(expect.stringMatching(/^Compte effacé\./), { lang: "fr" });
    expect(fakeWindow.location.href).toBe("/tournois");
    jest.advanceTimersByTime(ACCOUNT_DELETED_REDIRECT_MS);
    expect(fakeWindow.location.href).toBe("/en");
  });

  it("un refus le dit et laisse la confirmation ouverte, sans quitter la page", async () => {
    globalThis.fetch = fakeFetch(
      {
        "GET /api/profile/deletion": () => jsonResponse(200, { mode: "ERASE", reason: null }),
        "DELETE /api/profile": () => jsonResponse(400, { error: "ACCOUNT_STILL_REFERENCED" }),
      },
      calls,
    );
    await useAccountDeletion({ text: FR_PROFILE }).start();
    rerender();
    expect(await dialogProps(useAccountDeletion({ text: FR_PROFILE })).onConfirm()).toBe(false);
    expect(showError).toHaveBeenCalledWith(expect.stringMatching(/rattaché à un tournoi ou à une équipe/), { lang: undefined });
    jest.advanceTimersByTime(ACCOUNT_DELETED_REDIRECT_MS * 2);
    expect(fakeWindow.location.href).toBe("/tournois");
  });
});

describe("une seule suppression pour deux écrans", () => {
  it("le profil et la fenêtre des conditions passent par `useAccountDeletion`, sans copie du geste", () => {
    const page = readSource("app/(secured)/profil/page.tsx");
    const terms = readSource("components/legal/TermsAccountDeletion.tsx");
    for (const source of [page, terms]) {
      expect(source).toContain("useAccountDeletion({");
      expect(source).not.toContain('fetch("/api/profile", { method: "DELETE" })');
      expect(source).not.toContain('"/api/profile/deletion"');
    }
    expect(terms).toContain('layer: "overBlocking"');
  });

  it("la confirmation empilée passe au-dessus de la fenêtre bloquante (1260), sous la modale de confidentialité (1300)", () => {
    const css = readSource("components/ui/confirm-action-dialog.module.css");
    const z = Number(/\.backdrop\.overBlocking \{\s*z-index: (\d+);/.exec(css)?.[1]);
    expect(z).toBeGreaterThan(1260);
    expect(z).toBeLessThan(1300);
    expect(readSource("components/legal/TermsAcceptanceModal.module.css")).toMatch(/\.overlay \{[^}]*z-index: 1260;/);
    expect(readSource("components/ui/confirm-action-dialog.tsx")).toContain('layer === "overBlocking" ? `${styles.backdrop} ${styles.overBlocking}` : styles.backdrop');
  });
});
