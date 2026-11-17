import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactNode } from "react";

/**
 * EF-71 — comportement des gestes convertis, joué sans DOM : chaque composant
 * est appelé comme une fonction, ses `useState` lus dans des cases (relues au
 * rendu suivant), la garde d'envoi **réelle** (`useBusyGuard`). Une
 * acceptation (conditions) ou une prise de connaissance (confidentialité) ne
 * part qu'une fois par geste, jamais case décochée ; une création d'équipe
 * refusée rend le bouton.
 */
const cells: unknown[] = [];
let cursor = 0;
const refs: { current: unknown }[] = [];
let refCursor = 0;
let effects: Array<() => unknown> = [];
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useId: () => "test-id",
    useMemo: <T,>(factory: () => T) => factory(),
    useCallback: <T,>(fn: T) => fn,
    useRef: <T,>(initial: T) => {
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index] as { current: T };
    },
    useEffect: (effect: () => unknown) => {
      effects.push(effect);
    },
    useLayoutEffect: (effect: () => unknown) => {
      effects.push(effect);
    },
    useState: <T,>(initial: T | (() => T)) => {
      const index = cursor++;
      if (!(index in cells)) cells[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      const set = (next: T | ((previous: T) => T)) => {
        cells[index] = typeof next === "function" ? (next as (previous: T) => T)(cells[index] as T) : next;
      };
      return [cells[index] as T, set];
    },
  };
});
jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});

const showError = jest.fn<(message: string) => void>();
const showSuccess = jest.fn<(message: string) => void>();
const push = jest.fn<(href: string) => void>();
const refresh = jest.fn<() => void>();
jest.mock("@/components/ui/toast", () => ({ useToast: () => ({ showError, showSuccess, showInfo: jest.fn() }) }));
jest.mock("@/components/i18n/locale-navigation", () => ({
  LocaleLink: () => null,
  useLocalePathname: () => ({ path: "/tournois" }),
  useLocaleRouter: () => ({ push, replace: push, refresh }),
}));
jest.mock("@/components/i18n/shell-text", () => ({
  useShellText: () => ({ t: (key: string) => key, rich: () => [], locale: "fr" }),
  richNodes: (nodes: unknown) => nodes,
}));
jest.mock("@/components/i18n/teams-text", () => ({
  useTeamsText: () => ({ t: (key: string) => key, rich: () => [] }),
}));
jest.mock("@/components/i18n/team-errors-text", () => ({
  useTeamErrorMessage: () => (code: string) => code,
  useMembershipErrorMessage: () => (code: string) => code,
}));
jest.mock("@/components/use-logout", () => ({ useLogout: () => ({ leaving: false, logout: jest.fn() }) }));
jest.mock("@/lib/shared/hooks/useDialogBehavior", () => ({ useDialogBehavior: () => ({ current: null }) }));
jest.mock("@/components/ui/image-crop-dialog", () => ({
  appendCroppedImage: jest.fn(),
  preloadImageCropDialog: jest.fn(),
  useImageCropper: () => ({ cropImage: jest.fn(), cropDialog: null }),
}));
jest.mock("@/lib/shared/hooks/useFieldErrors", () => ({
  useFieldErrors: () => ({
    flag: jest.fn(),
    clear: jest.fn(),
    report: jest.fn(() => false),
    aria: () => ({}),
    message: () => undefined,
  }),
}));

import { TermsAcceptanceModal } from "@/components/legal/TermsAcceptanceModal";
import { PrivacyChangesModal } from "@/components/privacy/PrivacyChangesModal";
import CreateTeamForm from "@/app/(secured)/equipes/creer/CreateTeamForm";
import { BusyButton } from "@/components/ui/busy-button";
import type { PrivacyChange } from "@/lib/shared/privacy-changes";

type Props = Record<string, unknown> & { children?: ReactNode };
type Element = { type: unknown; props: Props };

/** Tous les éléments de l'arbre rendu (sans les rendre : enfants des props seulement). */
function elements(node: unknown, found: Element[] = []): Element[] {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found);
    return found;
  }
  const element = node as Partial<Element>;
  if (!element.props) return found;
  found.push(element as Element);
  elements(element.props.children, found);
  return found;
}

const busyButtons = (tree: unknown) => elements(tree).filter((element) => element.type === BusyButton);
/** Le `BusyButton` dont le libellé (`BusyLabel`) a ce texte au repos. */
const buttonLabelled = (tree: unknown, idle: string) => {
  const button = busyButtons(tree).find((element) => elements(element.props.children).some((child) => child.props.idle === idle));
  if (!button) throw new Error(`bouton « ${idle} » absent`);
  return button.props as { busy: boolean; onClick: () => void; onBlockedClick?: () => void };
};
const input = (tree: unknown, match: (props: Props) => boolean) => {
  const found = elements(tree).find((element) => element.type === "input" && match(element.props));
  if (!found) throw new Error("champ absent");
  return found.props as { onChange: (event: unknown) => void };
};

function renderOnce<P extends object>(component: (props: P) => unknown, props: P): unknown {
  cursor = 0;
  refCursor = 0;
  effects = [];
  return component(props);
}

/** Premier rendu, ses effets joués (montage), puis le rendu qui en découle. */
function mount<P extends object>(component: (props: P) => unknown, props: P): unknown {
  renderOnce(component, props);
  for (const effect of effects) effect();
  return renderOnce(component, props);
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const fetchMock = jest.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const dispatchEvent = jest.fn<(event: Event) => boolean>();
const globals = globalThis as { fetch?: unknown; window?: unknown; document?: unknown };
const originalFetch = globals.fetch;

beforeEach(() => {
  cells.length = 0;
  refs.length = 0;
  jest.clearAllMocks();
  globals.fetch = fetchMock;
  globals.document = { body: {} };
  globals.window = {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent,
    setTimeout,
    clearTimeout,
  };
});

afterEach(() => {
  jest.useRealTimers();
  globals.fetch = originalFetch;
  delete globals.window;
  delete globals.document;
});

const ok = () => ({ ok: true, status: 200, json: async () => ({}) }) as Response;

describe("TermsAcceptanceModal — « J'accepte »", () => {
  const props = { initiallyRequired: true, request: "UPDATED" as const, privacyPending: false };
  const tickAndRender = () => {
    const first = mount(TermsAcceptanceModal, props);
    input(first, (p) => p.type === "checkbox").onChange({ target: { checked: true } });
    return renderOnce(TermsAcceptanceModal, props);
  };

  it("accept_doubleClickWhileFirstPending_postsOnce", async () => {
    const response = deferred<Response>();
    fetchMock.mockReturnValue(response.promise);
    const accept = buttonLabelled(tickAndRender(), "termsModal.accept");

    accept.onClick();
    accept.onClick();
    response.resolve(ok());
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/profile/terms");
    expect(showSuccess).toHaveBeenCalledWith("termsModal.accepted");
  });

  it("accept_unchecked_noPostAndBlockedClickExplains", () => {
    const accept = buttonLabelled(mount(TermsAcceptanceModal, props), "termsModal.accept");

    accept.onClick();
    accept.onBlockedClick?.();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith("termsModal.checkFirst");
  });

  it("accept_failure_showsErrorAndRetrySendsAgain", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(ok());
    const accept = buttonLabelled(tickAndRender(), "termsModal.accept");

    accept.onClick();
    await flush();
    accept.onClick();
    await flush();

    expect(showError).toHaveBeenCalledWith("termsModal.failed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("PrivacyChangesModal — « J'ai pris connaissance »", () => {
  const change: PrivacyChange = {
    id: "a",
    publishedAt: "2026-10-29",
    title: "Titre a",
    summary: "Résumé a.",
    details: ["Détail a"],
  };

  it("acknowledge_doubleClickWhileFirstPending_postsOnce", async () => {
    const response = deferred<Response>();
    fetchMock.mockReturnValue(response.promise);
    const [acknowledge] = busyButtons(mount(PrivacyChangesModal, { changes: [change] }));

    (acknowledge.props.onClick as () => void)();
    (acknowledge.props.onClick as () => void)();
    response.resolve(ok());
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ changeIds: ["a"] });
  });
});

describe("CreateTeamForm — « Créer l'équipe »", () => {
  const filledForm = () => {
    let tree = mount(CreateTeamForm, {});
    input(tree, (p) => p.id === "team-name").onChange({ target: { value: "Nova Team" } });
    tree = renderOnce(CreateTeamForm, {});
    input(tree, (p) => p.id === "team-terms").onChange({ target: { checked: true } });
    return renderOnce(CreateTeamForm, {});
  };
  const submitOf = (tree: unknown) => {
    const form = elements(tree).find((element) => element.type === "form");
    return form?.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>;
  };
  const event = { preventDefault: () => undefined };

  it("onSubmit_secondSubmitWhilePending_ignored", async () => {
    // La création réussie tient l'écran (`hold`) par une minuterie : simulée, elle ne retient pas Jest.
    jest.useFakeTimers({ doNotFake: ["setImmediate"] });
    const response = deferred<Response>();
    fetchMock.mockReturnValue(response.promise);
    const submit = submitOf(filledForm());

    void submit(event);
    void submit(event);
    response.resolve({ ok: true, status: 201, json: async () => ({ teamId: 7 }) } as Response);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/equipes/7");
  });

  it("onSubmit_creationRefused_releasesBusyAndShowsError", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "TEAM_NAME_TAKEN" }) } as Response);

    await submitOf(filledForm())(event);
    const after = renderOnce(CreateTeamForm, {});

    expect(showError).toHaveBeenCalledWith("TEAM_NAME_TAKEN");
    expect(buttonLabelled(after, "create.submit").busy).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});
