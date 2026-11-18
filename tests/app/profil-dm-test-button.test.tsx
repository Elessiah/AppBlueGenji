import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactNode } from "react";

/**
 * « Tester mes MP » (`DiscordDmTestButton`) joué sans DOM, comme
 * `leftover-busy-behaviour.test.tsx` : le composant est appelé comme une
 * fonction, ses `useState` lus dans des cases, la garde d'envoi réelle.
 */
const cells: unknown[] = [];
let cursor = 0;
const refs: { current: unknown }[] = [];
let refCursor = 0;
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
    useCallback: <T,>(fn: T) => fn,
    useRef: <T,>(initial: T) => {
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index] as { current: T };
    },
    useEffect: () => undefined,
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

const translate = jest.fn((key: string, _values?: Record<string, string>) => key);
const showError = jest.fn<(message: string) => void>();
const showSuccess = jest.fn<(message: string) => void>();
jest.mock("@/components/ui/toast", () => ({ useToast: () => ({ showError, showSuccess, showInfo: jest.fn() }) }));
jest.mock("@/components/i18n/profile-text", () => ({
  useProfileText: () => ({ t: translate }),
}));

import { DiscordDmTestButton, dmTestResponseAction } from "@/app/(secured)/profil/_components/DiscordDmTestButton";
import { BusyButton } from "@/components/ui/busy-button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import frProfile from "@/messages/fr/profile.json";
import enProfile from "@/messages/en/profile.json";

type Props = Record<string, unknown> & { children?: ReactNode };
type Element = { type: unknown; props: Props };

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

type ButtonProps = { onClick: () => void };
type DialogProps = { onConfirm: () => Promise<boolean>; onClose: () => void; title: string };

function render(props: { verified: boolean; onCertify: () => void; linked?: boolean | null }) {
  cursor = 0;
  refCursor = 0;
  return DiscordDmTestButton({ linked: true, ...props });
}
const button = (tree: unknown) => elements(tree).find((e) => e.type === BusyButton)?.props as unknown as ButtonProps;
const dialog = (tree: unknown) => elements(tree).find((e) => e.type === ConfirmActionDialog)?.props as unknown as
  | DialogProps
  | undefined;

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const fetchMock = jest.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const globals = globalThis as { fetch?: unknown };
const originalFetch = globals.fetch;
const response = (ok: boolean, body: unknown) => ({ ok, json: async () => body }) as Response;

beforeEach(() => {
  cells.length = 0;
  refs.length = 0;
  jest.clearAllMocks();
  globals.fetch = fetchMock;
});

afterEach(() => {
  globals.fetch = originalFetch;
});

describe("dmTestResponseAction", () => {
  it("dmTestResponseAction_okResponse_returnsOutcomeToast", () => {
    expect(dmTestResponseAction(true, { outcome: "DMS_CLOSED" })).toEqual({ tone: "error", key: "dmsClosed" });
  });

  it("dmTestResponseAction_notCertifiedError_returnsCertify", () => {
    expect(dmTestResponseAction(false, { error: "DISCORD_NOT_CERTIFIED" })).toBe("certify");
  });

  it("dmTestResponseAction_otherError_returnsErrorToast", () => {
    expect(dmTestResponseAction(false, { error: "BOT_INTERNAL_UNREACHABLE" })).toEqual({
      tone: "error",
      key: "botUnreachable",
    });
  });
});

describe("DiscordDmTestButton", () => {
  it("button_stateNotRead_rendersNothing", () => {
    expect(render({ linked: null, verified: false, onCertify: jest.fn() })).toBeNull();
  });

  it("button_notLinked_rendersNothing", () => {
    expect(render({ linked: false, verified: false, onCertify: jest.fn() })).toBeNull();
  });

  it("button_hint_interpolatesHourlyLimit", () => {
    render({ verified: true, onCertify: jest.fn() });

    expect(translate).toHaveBeenCalledWith("dmTest.hint", { max: "3" });
  });

  it("button_verified_postsAndShowsSuccessToast", async () => {
    fetchMock.mockResolvedValue(response(true, { outcome: "SENT" }));
    const props = { verified: true, onCertify: jest.fn() };

    button(render(props)).onClick();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith("/api/profile/discord/dm-test", { method: "POST" });
    expect(showSuccess).toHaveBeenCalledWith("dmTest.sent");
  });

  it("button_verifiedDoubleClick_postsOnce", async () => {
    fetchMock.mockResolvedValue(response(true, { outcome: "SENT" }));
    const tree = render({ verified: true, onCertify: jest.fn() });

    button(tree).onClick();
    button(tree).onClick();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("button_notVerified_opensModalWithoutFetch", () => {
    const props = { verified: false, onCertify: jest.fn() };

    button(render(props)).onClick();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(dialog(render(props))?.title).toBe("dmTest.certifyTitle");
  });

  it("button_serverSaysNotCertified_opensModal", async () => {
    fetchMock.mockResolvedValue(response(false, { error: "DISCORD_NOT_CERTIFIED" }));
    const props = { verified: true, onCertify: jest.fn() };

    button(render(props)).onClick();
    await flush();

    expect(showError).not.toHaveBeenCalled();
    expect(dialog(render(props))).toBeDefined();
  });

  it("modal_certify_closesAndCallsOnCertify", async () => {
    const onCertify = jest.fn();
    const props = { verified: false, onCertify };
    button(render(props)).onClick();

    const confirmed = await dialog(render(props))?.onConfirm();

    expect(confirmed).toBe(true);
    expect(onCertify).toHaveBeenCalledTimes(1);
    expect(dialog(render(props))).toBeUndefined();
  });

  it("modal_cancel_closesWithoutOnCertify", () => {
    const onCertify = jest.fn();
    const props = { verified: false, onCertify };
    button(render(props)).onClick();

    dialog(render(props))?.onClose();

    expect(onCertify).not.toHaveBeenCalled();
    expect(dialog(render(props))).toBeUndefined();
  });

  it("button_networkError_showsFailedToast", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    button(render({ verified: true, onCertify: jest.fn() })).onClick();
    await flush();

    expect(showError).toHaveBeenCalledWith("dmTest.failed");
  });

  it("button_botUnreachable_showsDegradeToast", async () => {
    fetchMock.mockResolvedValue(response(false, { error: "BOT_INTERNAL_UNREACHABLE" }));

    button(render({ verified: true, onCertify: jest.fn() })).onClick();
    await flush();

    expect(showError).toHaveBeenCalledWith("dmTest.botUnreachable");
  });
});

describe("textes « Tester mes MP »", () => {
  it("texts_frAndEn_haveSameKeys", () => {
    expect(Object.keys(enProfile.dmTest).sort()).toEqual(Object.keys(frProfile.dmTest).sort());
    expect(frProfile.dmTest.button).toBe("Tester mes MP");
    expect(enProfile.dmTest.button).toBe("Test my DMs");
  });

  it("texts_hint_hasLimitPlaceholder", () => {
    expect(frProfile.dmTest.hint).toContain("{max} essais par heure");
    expect(enProfile.dmTest.hint).toContain("{max} tries per hour");
  });

  it("texts_tooMany_saysLater", () => {
    expect(frProfile.dmTest.tooMany).toBe("Trop de tests en peu de temps : réessaie plus tard.");
    expect(enProfile.dmTest.tooMany).toBe("Too many tests in a short time: try again later.");
  });

  it("texts_accessibleName_containsVisibleLabel", () => {
    expect(frProfile.dmTest.buttonLabel.startsWith(frProfile.dmTest.button)).toBe(true);
    expect(enProfile.dmTest.buttonLabel.startsWith(enProfile.dmTest.button)).toBe(true);
  });
});
