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

const showError = jest.fn<(message: string) => void>();
const showSuccess = jest.fn<(message: string) => void>();
const push = jest.fn<(href: string) => void>();
const refresh = jest.fn<() => void>();
jest.mock("@/components/ui/toast", () => ({ useToast: () => ({ showError, showSuccess }) }));
jest.mock("@/components/i18n/locale-navigation", () => ({
  LocaleLink: () => null,
  useLocaleRouter: () => ({ push, refresh }),
}));
jest.mock("@/components/cyber/CyberButton", () => ({ CyberButton: () => null }));
jest.mock("@/components/cyber/CyberCard", () => ({ CyberCard: () => null }));

import { ReactivationPanel } from "@/app/connexion/reactivation/ReactivationPanel";
import { FR_LOGIN_TEXT } from "@/lib/shared/login-text";

jest.mock("@/components/i18n/login-text", () => ({
  useLoginText: () => jest.requireActual<typeof import("@/lib/shared/login-text")>("@/lib/shared/login-text").FR_LOGIN_TEXT,
}));

type Props = { disabled?: boolean; onClick?: () => Promise<void>; children?: ReactNode };

function render(finalAt: string | null): ReactElement {
  cursor = 0;
  return ReactivationPanel({ finalAt });
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const FUTURE = "2026-12-03T10:00:00.000Z";

beforeEach(() => {
  cells.length = 0;
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

  it("410 : vue « expiré » et notification", async () => {
    global.fetch = jest.fn(async () => jsonResponse(410, { error: "REACTIVATION_EXPIRED" })) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    expect(showError).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.expired"));
    expect(findButton(render(FUTURE))).toBeNull();
  });

  it("500 : notification, la vue ne change pas et le bouton se rouvre", async () => {
    global.fetch = jest.fn(async () => jsonResponse(500, { error: "REACTIVATION_FAILED" })) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    expect(showError).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.failed"));
    const again = findButton(render(FUTURE));
    expect(again).not.toBeNull();
    expect(again!.props.disabled).toBeFalsy();
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
    expect(findButton(render(FUTURE))!.props.disabled).toBeFalsy();
  });

  it("succès : navigation, et le bouton reste fermé pendant qu'elle court", async () => {
    global.fetch = jest.fn(async () => jsonResponse(200, { reactivated: true })) as typeof fetch;
    await findButton(render(FUTURE))!.props.onClick!();
    expect(showSuccess).toHaveBeenCalledWith(FR_LOGIN_TEXT.t("reactivation.done"));
    expect(push).toHaveBeenCalledWith("/profil");
    expect(refresh).toHaveBeenCalled();
    expect(findButton(render(FUTURE))!.props.disabled).toBe(true);
  });
});
