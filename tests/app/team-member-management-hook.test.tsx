import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

const showError = jest.fn<(message: string) => void>();
const showSuccess = jest.fn<(message: string) => void>();
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showError, showSuccess, showInfo: jest.fn() }),
}));

import { useMemberManagement } from "@/app/(secured)/equipes/[id]/_hooks/useMemberManagement";
import { AppLocaleProvider } from "@/components/i18n/locale-context";

/**
 * Gestes du roster (`useMemberManagement`) : ce qu'ils envoient, et ce qu'ils
 * relisent ensuite. Le hook est capté par un rendu serveur — ses gestes sont
 * des fonctions qu'on appelle ensuite comme le ferait un clic.
 */

type Gestures = ReturnType<typeof useMemberManagement>;

function captureGestures(onChanged: () => void, onOwnRolesChanged?: () => void): Gestures {
  let captured: Gestures | null = null;
  function Probe() {
    captured = useMemberManagement(7, onChanged, onOwnRolesChanged);
    return null;
  }
  renderToStaticMarkup(
    <AppLocaleProvider locale="fr">
      <Probe />
    </AppLocaleProvider>,
  );
  if (!captured) throw new Error("hook non rendu");
  return captured;
}

const fetchMock = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

function sentRequest() {
  const [url, init] = fetchMock.mock.calls[0];
  return { url, method: init?.method, body: JSON.parse(String(init?.body)) as unknown };
}

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("useMemberManagement — « Mes rôles »", () => {
  it("updateOwnRoles_success_putsRolesAndRefreshesOnlyTheTeamDetail", async () => {
    const onChanged = jest.fn<() => void>();
    const onOwnRolesChanged = jest.fn<() => void>();
    respond(200, { roles: ["TANK"] });

    const ok = await captureGestures(onChanged, onOwnRolesChanged).updateOwnRoles(["TANK"]);

    expect(ok).toBe(true);
    expect(sentRequest()).toEqual({ url: "/api/teams/7/my-roles", method: "PUT", body: { roles: ["TANK"] } });
    expect(onOwnRolesChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();
    expect(showSuccess).toHaveBeenCalledTimes(1);
  });

  it("updateOwnRoles_refused_returnsFalseShowsErrorWithoutRefresh", async () => {
    const onChanged = jest.fn<() => void>();
    const onOwnRolesChanged = jest.fn<() => void>();
    respond(400, { error: "ROLE_NOT_SELF_ASSIGNABLE" });

    const ok = await captureGestures(onChanged, onOwnRolesChanged).updateOwnRoles(["DPS"]);

    expect(ok).toBe(false);
    expect(showError).toHaveBeenCalledTimes(1);
    expect(onOwnRolesChanged).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("updateOwnRoles_noOwnRolesCallback_fallsBackToOnChanged", async () => {
    const onChanged = jest.fn<() => void>();
    respond(200, { roles: [] });

    await captureGestures(onChanged).updateOwnRoles([]);

    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe("useMemberManagement — gestion", () => {
  it("addMember_emptyRoles_postsEmptyList", async () => {
    respond(200, { result: "INVITED" });

    const ok = await captureGestures(jest.fn<() => void>()).addMember("Nova", []);

    expect(ok).toBe(true);
    expect(sentRequest()).toEqual({
      url: "/api/teams/7/members",
      method: "POST",
      body: { pseudo: "Nova", roles: [] },
    });
  });

  it("addMember_refused_reportsCodeToListener", async () => {
    const onRefused = jest.fn<(code: string, message: string) => void>();
    respond(404, { error: "USER_NOT_FOUND" });

    const ok = await captureGestures(jest.fn<() => void>()).addMember("Nova", ["DPS"], onRefused);

    expect(ok).toBe(false);
    expect(onRefused).toHaveBeenCalledWith("USER_NOT_FOUND", expect.any(String));
  });

  it("updateRoles_success_refreshesOnChanged", async () => {
    const onChanged = jest.fn<() => void>();
    const onOwnRolesChanged = jest.fn<() => void>();
    respond(200, {});

    await captureGestures(onChanged, onOwnRolesChanged).updateRoles(3, []);

    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onOwnRolesChanged).not.toHaveBeenCalled();
  });
});
