import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactElement, ReactNode } from "react";

/**
 * L'écran de réactivation : seul un ticket périmé (410) le change en « lien
 * expiré » ; une suspension ou une panne passagère se disent par une
 * notification et laissent le bouton ; un clic réussi ne rouvre pas le bouton
 * pendant la navigation ; une date illisible vaut un ticket absent. Sans DOM,
 * le composant est joué comme une fonction (`useState` en cases relues).
 */
const cells: unknown[] = [];
let cursor = 0;
const refs: { current: unknown }[] = [];
let refCursor = 0;
let effects: Array<() => void> = [];
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useId: () => "reactivation-id",
    useRef: <T,>(initial: T) => {
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index] as { current: T };
    },
    useEffect: (effect: () => void) => {
      effects.push(effect);
    },
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

const showError = jest.fn<(message: string) => void>();
const showSuccess = jest.fn<(message: string) => void>();
const showInfo = jest.fn<(message: string) => void>();
const push = jest.fn<(href: string) => void>();
const refresh = jest.fn<() => void>();
jest.mock("@/components/ui/toast", () => ({ useToast: () => ({ showError, showSuccess, showInfo }) }));
jest.mock("@/components/i18n/locale-navigation", () => ({
  LocaleLink: () => null,
  // Les sorties de l'écran passent par `replace` (pas d'entrée morte dans l'historique).
  useLocaleRouter: () => ({ push, replace: push, refresh }),
}));
jest.mock("@/components/cyber/CyberButton", () => ({ CyberButton: () => null }));
jest.mock("@/components/cyber/CyberCard", () => ({ CyberCard: () => null }));

import { ReactivationPanel } from "@/app/connexion/reactivation/ReactivationPanel";
import { FR_LOGIN_TEXT } from "@/lib/shared/login-text";

jest.mock("@/components/i18n/login-text", () => ({
  useLoginText: () => jest.requireActual<typeof import("@/lib/shared/login-text")>("@/lib/shared/login-text").FR_LOGIN_TEXT,
}));

type Props = { "aria-disabled"?: boolean; "aria-busy"?: boolean; onClick?: () => Promise<void>; children?: ReactNode };

function render(finalAt: string | null, hadTicket = true): ReactElement {
  cursor = 0;
  refCursor = 0;
  effects = [];
  return ReactivationPanel({ finalAt, hadTicket });
}

/** Tous les boutons rendus, dans l'ordre : « Réactiver », puis « Ne pas réactiver ». */
function findButtons(node: unknown, found: { props: Props }[] = []): { props: Props }[] {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) findButtons(child, found);
    return found;
  }
  const element = node as { props?: Props & Record<string, unknown> };
  if (element.props?.onClick) found.push(element as { props: Props });
  else findButtons(element.props?.children, found);
  return found;
}

/** Les textes rendus, à plat. */
function textsOf(node: unknown, found: string[] = []): string[] {
  if (typeof node === "string") found.push(node);
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) textsOf(child, found);
    return found;
  }
  textsOf((node as { props?: { children?: unknown } }).props?.children, found);
  return found;
}

/** Parcourt l'arbre rendu : les composants simulés ne s'exécutent pas, leurs enfants restent des éléments. */
function findButton(node: unknown): { props: Props } | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child);
      if (found) return found;
    }
    return null;
  }
  const element = node as { type?: unknown; props?: Props & Record<string, unknown> };
  if (element.props?.onClick) return element as { props: Props };
  return findButton(element.props?.children);
}

/** Le rôle ARIA posé quelque part dans l'arbre rendu (`alert`), sinon `null`. */
function findRole(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRole(child);
      if (found) return found;
    }
    return null;
  }
  const props = (node as { props?: { role?: string; children?: unknown } }).props;
  return props?.role ?? findRole(props?.children);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const FUTURE = "2026-12-03T10:00:00.000Z";

beforeEach(() => {
  cells.length = 0;
  refs.length = 0;
  jest.clearAllMocks();
});

describe("ReactivationPanel", () => {
  it("une date illisible ou absente ouvre la vue « expiré », sans bouton", () => {
    for (const bad of [null, "pas une date", ""]) {
      cells.length = 0;
      expect(findButton(render(bad))).toBeNull();
    }
    cells.length = 0;
    expect(findButton(render(FUTURE))).not.toBeNull();
  });

  // Le bloc « expiré » (annoncé, focalisé) le dit une fois : pas de notification en double.
  it("410 : vue « expiré », sans notification en double", async () => {
    global.fetch = jest.fn(async () => jsonResponse(410, { error: "REACTIVATION_EXPIRED" })) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    expect(showError).not.toHaveBeenCalled();
    const tree = render(FUTURE);
    expect(findButton(tree)).toBeNull();
    expect(textsOf(tree)).toContain(FR_LOGIN_TEXT.t("reactivation.expired"));
  });

  it("sans cookie de ticket : « aucune réactivation n'attend », pas « lien expiré »", () => {
    const texts = textsOf(render(null, false));
    expect(texts).toContain(FR_LOGIN_TEXT.t("reactivation.missing"));
    expect(texts).not.toContain(FR_LOGIN_TEXT.t("reactivation.expired"));
  });

  it("cookie présent mais ticket périmé : « lien expiré »", () => {
    expect(textsOf(render(null, true))).toContain(FR_LOGIN_TEXT.t("reactivation.expired"));
  });

  it("panne passagère : « réessaie », le bouton reste", async () => {
    global.fetch = jest.fn(async () => jsonResponse(500, { error: "REACTIVATION_FAILED" })) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    expect(showError).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.failed"));
    expect(FR_LOGIN_TEXT.t("reactivation.failed")).not.toContain("Reconnecte-toi");
    expect(findButton(render(FUTURE))!.props["aria-disabled"]).toBe(false);
  });

  it("pendant l'envoi : libellé d'attente, aria-busy, et « Ne pas réactiver » neutralisé", async () => {
    let release = (_response: Response): void => undefined;
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => (release = resolve))) as typeof fetch;
    const pending = findButton(render(FUTURE))!.props.onClick!();
    const [confirm, cancel] = findButtons(render(FUTURE));
    expect(confirm.props.children).toBe(FR_LOGIN_TEXT.t("reactivation.confirming"));
    expect(confirm.props["aria-busy"]).toBe(true);
    expect(cancel.props["aria-disabled"]).toBe(true);
    release(jsonResponse(200, { reactivated: true }));
    await pending;
  });

  it("réactivé sans session (503) : dit la réactivation et renvoie à la connexion", async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(503, { error: "REACTIVATED_LOGIN_REQUIRED", reactivated: true }),
    ) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    expect(showSuccess).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.doneLoginRequired"));
    expect(showError).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/connexion");
  });

  it("réactivé sous un autre pseudo : une notification le dit, en plus du succès", async () => {
    global.fetch = jest.fn(async () => jsonResponse(200, { reactivated: true, pseudoChanged: true })) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    expect(showSuccess).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.done"));
    expect(showInfo).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.pseudoChanged"));
  });

  it("réactivé sous son pseudo : aucune note de pseudo", async () => {
    global.fetch = jest.fn(async () => jsonResponse(200, { reactivated: true, pseudoChanged: false })) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    expect(showInfo).not.toHaveBeenCalled();
  });

  it("réactivé sans session et sous un autre pseudo : les deux sont dits", async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(503, { error: "REACTIVATED_LOGIN_REQUIRED", reactivated: true, pseudoChanged: true }),
    ) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    expect(showSuccess).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.doneLoginRequired"));
    expect(showInfo).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.pseudoChanged"));
  });

  it("réactivé suspendu et sous un autre pseudo : la note de pseudo part aussi", async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(403, { error: "ACCOUNT_SUSPENDED", reactivated: true, pseudoChanged: true, suspension: { endsAt: null } }),
    ) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    expect(showInfo).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.pseudoChanged"));
  });

  it("« Ne pas réactiver » en cours : le bouton principal ne dit pas « Réactivation… »", async () => {
    let release = (_response: Response): void => undefined;
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => (release = resolve))) as typeof fetch;
    const pending = findButtons(render(FUTURE))[1].props.onClick!();
    const [confirm, cancel] = findButtons(render(FUTURE));
    expect(confirm.props.children).toBe(FR_LOGIN_TEXT.t("reactivation.confirm"));
    expect(confirm.props["aria-busy"]).toBe(false);
    expect(confirm.props["aria-disabled"]).toBe(true);
    expect(cancel.props["aria-busy"]).toBe(true);
    release(jsonResponse(200, { discarded: true }));
    await pending;
  });

  it("« Ne pas réactiver » refusé par le serveur : dit l'échec, reste sur l'écran", async () => {
    global.fetch = jest.fn(async () => jsonResponse(403, { error: "CROSS_SITE_REQUEST" })) as typeof fetch;
    await findButtons(render(FUTURE))[1].props.onClick!();
    expect(showError).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.declineFailed"));
    expect(showInfo).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(findButtons(render(FUTURE))[1].props["aria-disabled"]).toBe(false);
  });

  it("« Ne pas réactiver » : retire le ticket, dit l'issue avec la date, puis l'accueil", async () => {
    const fetchMock = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, { discarded: true }));
    global.fetch = fetchMock as typeof fetch;
    await findButtons(render(FUTURE))[1].props.onClick!();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/reactivate");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("DELETE");
    expect(showInfo).toHaveBeenCalledWith(expect.stringContaining("3 décembre 2026"));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("« Ne pas réactiver » hors ligne : dit l'échec (le cookie est resté), sans quitter l'écran", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("offline");
    }) as typeof fetch;
    await findButtons(render(FUTURE))[1].props.onClick!();
    expect(showError).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.declineFailed"));
    expect(showInfo).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("decline_pending_showsDecliningLabel", async () => {
    let release = (_response: Response): void => undefined;
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => (release = resolve))) as typeof fetch;
    const pending = findButtons(render(FUTURE))[1].props.onClick!();

    expect(findButtons(render(FUTURE))[1].props.children).toBe(FR_LOGIN_TEXT.t("reactivation.declining"));

    release(jsonResponse(200, { discarded: true }));
    await pending;
  });

  it("expiredBlock_openedExpired_hasNoAlertRole", () => {
    expect(findRole(render(null))).toBeNull();
  });

  it("expiredBlock_410UnderClick_hasAlertRole", async () => {
    global.fetch = jest.fn(async () => jsonResponse(410, { error: "REACTIVATION_EXPIRED" })) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();

    expect(findRole(render(FUTURE))).toBe("alert");
  });

  it("reactivate_secondClickWhileInFlight_sendsNoSecondFetch", async () => {
    let release = (_response: Response): void => undefined;
    const fetchMock = jest.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    global.fetch = fetchMock as typeof fetch;
    const first = findButton(render(FUTURE))!.props.onClick!();

    await findButton(render(FUTURE))!.props.onClick!();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(jsonResponse(200, { reactivated: true, pseudoChanged: false }));
    await first;
  });

  it("decline_requestHangsPastTimeout_abortsAndShowsDeclineFailed", async () => {
    jest.useFakeTimers();
    try {
      let signal: AbortSignal | null | undefined;
      global.fetch = jest.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init?.signal;
            signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ) as typeof fetch;
      const pending = findButtons(render(FUTURE))[1].props.onClick!();
      jest.advanceTimersByTime(8000);
      await pending;
      expect(signal?.aborted).toBe(true);
      expect(showError).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.declineFailed"));
      expect(push).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("après un échec, le focus revient au bouton du geste", async () => {
    global.fetch = jest.fn(async () => jsonResponse(500, { error: "REACTIVATION_FAILED" })) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    render(FUTURE);
    const focus = jest.fn();
    // Références dans l'ordre du composant : bouton principal, secondaire, geste à refocaliser.
    refs[0].current = { focus };
    effects[0]();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("410 : le focus passe au bloc « expiré » (le bouton qui l'avait a disparu)", async () => {
    global.fetch = jest.fn(async () => jsonResponse(410, { error: "REACTIVATION_EXPIRED" })) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    const focus = jest.fn();
    render(FUTURE);
    refs[0] = { current: { focus } };
    refCursor = 0;
    render(FUTURE);
    for (const effect of effects) effect();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("ouvert déjà expiré, l'écran ne vole pas le focus", () => {
    const focus = jest.fn();
    render(null);
    refs[0] = { current: { focus } };
    render(null);
    for (const effect of effects) effect();
    expect(focus).not.toHaveBeenCalled();
  });

  it("500 : notification, la vue ne change pas et le bouton se rouvre", async () => {
    global.fetch = jest.fn(async () => jsonResponse(500, { error: "REACTIVATION_FAILED" })) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    expect(showError).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.failed"));
    const again = findButton(render(FUTURE));
    expect(again).not.toBeNull();
    expect(again!.props["aria-disabled"]).toBeFalsy();
  });

  it("403 de suspension : le texte de la suspension, jamais « lien expiré »", async () => {
    global.fetch = jest.fn(async () => jsonResponse(403, { error: "ACCOUNT_SUSPENDED" })) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError).not.toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.expired"));
    expect(findButton(render(FUTURE))).not.toBeNull();
  });

  it("réseau coupé : notification et bouton rouvert", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("offline");
    }) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    expect(showError).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.failed"));
    expect(findButton(render(FUTURE))!.props["aria-disabled"]).toBeFalsy();
  });

  it("succès : navigation, et le bouton reste fermé pendant qu'elle court", async () => {
    global.fetch = jest.fn(async () => jsonResponse(200, { reactivated: true })) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    expect(showSuccess).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.done"));
    expect(push).toHaveBeenCalledWith("/profil");
    expect(refresh).toHaveBeenCalled();
    expect(findButton(render(FUTURE))!.props["aria-disabled"]).toBe(true);
  });
});
