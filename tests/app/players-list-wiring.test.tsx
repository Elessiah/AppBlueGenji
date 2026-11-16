import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactNode } from "react";
import type { DirectoryPlayer } from "@/lib/shared/types";
import { directoryPlayer } from "../helpers/auth-user";

/**
 * Le **branchement** des filtres de l'annuaire des joueurs
 * (`app/(secured)/joueurs/PlayersList.tsx`) : tri et filtres sont testés comme
 * fonctions pures (`players-sort-filter.test.ts`), ce fichier garde leur câblage
 * — `chooseStatus` (rôle remis à « Tous », notification une fois), puces de rôle
 * inertes et leur garde au clic, case des comptes supprimés inerte ou enfoncée.
 * Sans DOM, le composant est joué comme une fonction : `useState` en cases
 * relues à chaque « rendu », les effets (chargement) ne tournent pas.
 */
const cells: unknown[] = [];
let cursor = 0;
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = cursor++;
      if (!(index in cells)) cells[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      const set = (next: T | ((value: T) => T)) => {
        cells[index] = typeof next === "function" ? (next as (value: T) => T)(cells[index] as T) : next;
      };
      return [cells[index] as T, set];
    },
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: () => {},
    useMemo: <T,>(factory: () => T) => factory(),
    useCallback: <T,>(callback: T) => callback,
    useDeferredValue: <T,>(value: T) => value,
  };
});

const showError = jest.fn<(message: string) => void>();
const showInfo = jest.fn<(message: string, options?: { once?: boolean }) => void>();
jest.mock("@/components/ui/toast", () => ({ useToast: () => ({ showError, showInfo }) }));
jest.mock("@/components/i18n/players-text", () => ({
  usePlayersText: () => ({
    locale: "fr",
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
    rich: (key: string) => key,
  }),
}));
jest.mock("@/components/i18n/shell-text", () => ({ richNodes: (node: unknown) => node }));
jest.mock("@/lib/shared/hooks/useProgressiveList", () => ({
  useProgressiveList: <T,>(items: readonly T[]) => ({ visible: items, hidden: 0, showMore: () => {} }),
}));

import PlayersList from "@/app/(secured)/joueurs/PlayersList";

type ButtonProps = {
  children?: ReactNode;
  onClick?: () => void;
  "aria-pressed"?: boolean;
  "aria-disabled"?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
};
type Button = { props: ButtonProps };

/** Première case d'état du composant : la liste chargée par `/api/players`. */
const PLAYERS_SLOT = 0;

function render(): unknown {
  cursor = 0;
  return PlayersList();
}

/** Tous les `<button>` rendus par le composant lui-même (ses enfants composants ne sont pas joués). */
function buttons(node: unknown, found: Button[] = []): Button[] {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) buttons(child, found);
    return found;
  }
  const element = node as { type?: unknown; props?: ButtonProps };
  if (element.type === "button" && element.props) found.push(element as Button);
  buttons(element.props?.children, found);
  return found;
}

function button(label: string): Button {
  const match = buttons(render()).find((b) => b.props.children === label);
  if (!match) throw new Error(`bouton introuvable : ${label}`);
  return match;
}

function deletedToggle(): Button | undefined {
  return buttons(render()).find((b) => b.props["aria-label"]?.startsWith("list.showDeleted"));
}

function withPlayers(players: DirectoryPlayer[]): void {
  cells[PLAYERS_SLOT] = players;
}

beforeEach(() => {
  cells.length = 0;
  jest.clearAllMocks();
  render();
});

describe("PlayersList — statut et rôle", () => {
  it("chooseStatus_freeWithRoleSelected_resetsRoleAndShowsInfoOnce", () => {
    button("list.roleFilter.DPS").props.onClick?.();

    button("list.statusFilter.free").props.onClick?.();

    expect(button("list.statusFilter.free").props["aria-pressed"]).toBe(true);
    expect(button("list.roleFilter.all").props["aria-pressed"]).toBe(true);
    expect(button("list.roleFilter.DPS").props["aria-pressed"]).toBe(false);
    expect(showInfo).toHaveBeenCalledWith("list.roleReset", { once: true });
  });

  it("chooseStatus_allWithRoleSelected_keepsRoleWithoutInfo", () => {
    button("list.roleFilter.DPS").props.onClick?.();

    button("list.statusFilter.all").props.onClick?.();

    expect(button("list.roleFilter.DPS").props["aria-pressed"]).toBe(true);
    expect(showInfo).not.toHaveBeenCalled();
  });

  it("roleChip_underFreeStatus_inertDescribedAndClickIgnored", () => {
    button("list.statusFilter.free").props.onClick?.();

    const dps = button("list.roleFilter.DPS");
    expect(dps.props["aria-disabled"]).toBe(true);
    expect(dps.props["aria-describedby"]).toBe("players-roles-inert");
    expect(button("list.roleFilter.all").props["aria-disabled"]).toBeUndefined();

    dps.props.onClick?.();

    expect(button("list.roleFilter.DPS").props["aria-pressed"]).toBe(false);
    expect(button("list.roleFilter.all").props["aria-pressed"]).toBe(true);
  });

  it("roleChip_underAllStatus_clickSelectsRole", () => {
    const tank = button("list.roleFilter.TANK");
    expect(tank.props["aria-disabled"]).toBeUndefined();

    tank.props.onClick?.();

    expect(button("list.roleFilter.TANK").props["aria-pressed"]).toBe(true);
  });
});

describe("PlayersList — comptes supprimés", () => {
  it("deletedToggle_underFreeStatus_inertAndClickIgnored", () => {
    withPlayers([directoryPlayer({ id: 1 }), directoryPlayer({ deleted: true, pseudo: "Supprimé" })]);
    button("list.statusFilter.free").props.onClick?.();

    const toggle = deletedToggle();
    expect(toggle?.props["aria-disabled"]).toBe(true);
    expect(toggle?.props["aria-describedby"]).toBe("players-deleted-inert");
    expect(toggle?.props["aria-pressed"]).toBe(false);

    toggle?.props.onClick?.();

    expect(deletedToggle()?.props["aria-pressed"]).toBe(false);
  });

  it("deletedToggle_underAllStatus_clickShowsDeleted", () => {
    withPlayers([directoryPlayer({ id: 1 }), directoryPlayer({ deleted: true, pseudo: "Supprimé" })]);
    const toggle = deletedToggle();
    expect(toggle?.props["aria-label"]).toBe('list.showDeleted:{"count":1}');
    expect(toggle?.props["aria-pressed"]).toBe(false);
    expect(toggle?.props["aria-disabled"]).toBeUndefined();

    toggle?.props.onClick?.();

    expect(deletedToggle()?.props["aria-pressed"]).toBe(true);
  });

  it("deletedToggle_noDeletedAccount_notRendered", () => {
    withPlayers([directoryPlayer({ id: 1 })]);

    expect(deletedToggle()).toBeUndefined();
  });
});
