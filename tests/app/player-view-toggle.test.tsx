import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * `usePlayerViewToggle` (`docs/features/ADMIN_ROLE_IMPERSONATION.md`), joué sans DOM :
 * le crochet est appelé comme une fonction, `useState` et `useRef` lus dans
 * des cases. Un échec se dit en notification avec le bon texte, la page n'est
 * relue qu'après une réussite, et un double clic n'envoie qu'une requête.
 */
const cells: unknown[] = [];
let cursor = 0;
const refs: { current: unknown }[] = [];
let refCursor = 0;
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useRef: <T,>(initial: T) => {
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index] as { current: T };
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
const refresh = jest.fn<() => void>();
jest.mock("@/components/ui/toast", () => ({ useToast: () => ({ showError }) }));
jest.mock("@/components/i18n/locale-navigation", () => ({ useLocaleRouter: () => ({ refresh }) }));
jest.mock("@/components/i18n/shell-text", () => ({ useShellText: () => ({ t: (key: string) => key }) }));

import { takePlayerViewFocus, usePlayerViewToggle } from "@/components/player-view-toggle";

const fetchMock = jest.fn<typeof fetch>();
const originalFetch = global.fetch;

function ToggleProbe(onDone?: () => void) {
  cursor = 0;
  refCursor = 0;
  return usePlayerViewToggle(onDone);
}

beforeEach(() => {
  cells.length = 0;
  refs.length = 0;
  jest.clearAllMocks();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  global.fetch = fetchMock;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("usePlayerViewToggle", () => {
  it("toggle_success_callsOnDoneThenRefreshes", async () => {
    const order: string[] = [];
    refresh.mockImplementation(() => order.push("refresh"));

    await ToggleProbe(() => order.push("done")).toggle(true);

    expect(order).toEqual(["done", "refresh"]);
    expect(showError).not.toHaveBeenCalled();
  });

  it("toggle_enterWithRoles_postsTheRolesAndResolvesTrue", async () => {
    const done = await ToggleProbe().toggle(true, ["CASTER"]);

    expect(done).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ active: true, roles: ["CASTER"] });
  });

  it("toggle_failure_resolvesFalse", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));

    await expect(ToggleProbe().toggle(true, ["ARBITRE"])).resolves.toBe(false);
  });

  it("toggle_enteringSucceeds_handsFocusToTheBannerOnce", async () => {
    await ToggleProbe().toggle(true);

    expect(takePlayerViewFocus("account")).toBe(false);
    expect(takePlayerViewFocus("banner")).toBe(true);
    expect(takePlayerViewFocus("banner")).toBe(false);
  });

  it("toggle_returningSucceeds_handsFocusToTheAccountButton", async () => {
    await ToggleProbe().toggle(false);

    expect(takePlayerViewFocus("banner")).toBe(false);
    expect(takePlayerViewFocus("account")).toBe(true);
  });

  it("toggle_failure_handsNoFocus", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));

    await ToggleProbe().toggle(false);

    expect(takePlayerViewFocus("account")).toBe(false);
  });

  it("toggle_twoInstancesAtOnce_sendOnePost", async () => {
    await Promise.all([ToggleProbe().toggle(true), ToggleProbe().toggle(false)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("toggle_failureEntering_showsImpersonateFailedWithoutRefresh", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 403 }));
    const onDone = jest.fn();

    await ToggleProbe(onDone).toggle(true);

    expect(showError).toHaveBeenCalledWith("account.impersonateFailed");
    expect(refresh).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("toggle_failureReturning_showsBackFailed", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));

    await ToggleProbe().toggle(false);

    expect(showError).toHaveBeenCalledWith("playerView.backFailed");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("toggle_doubleTap_sendsOnePost", async () => {
    const { toggle } = ToggleProbe();

    await Promise.all([toggle(false), toggle(false)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("toggle_pending_isTrueWhileTheRequestRuns", async () => {
    // Pas de `Promise.withResolvers` : la CI tourne sous Node 20, qui ne l’a pas.
    let resolveResponse: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => { resolveResponse = resolve; }));

    const running = ToggleProbe().toggle(true);
    expect(ToggleProbe().pending).toBe(true);
    resolveResponse(new Response("{}", { status: 200 }));
    await running;

    expect(ToggleProbe().pending).toBe(false);
  });
});
