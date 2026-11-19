import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { ReactElement, ReactNode } from "react";

/**
 * Modale « Incarner un rôle », jouée sans DOM
 * (`docs/features/ADMIN_ROLE_IMPERSONATION.md`) : le composant est appelé
 * comme une fonction, ses `useState` lus dans des cases (relues au rendu
 * suivant). « Joueur (aucun rôle) » incarne sans rôle, la soumission envoie
 * les rôles cochés dans l'ordre canonique, un double envoi ne part qu'une
 * fois, un refus rend la modale, rien ne la ferme pendant l'envoi.
 */
const cells: unknown[] = [];
let cursor = 0;
const refs: { current: unknown }[] = [];
let refCursor = 0;
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useId: () => "id",
    useCallback: <T,>(fn: T) => fn,
    useEffect: (effect: () => unknown) => void effect(),
    useRef: <T,>(initial: T) => {
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index] as { current: T };
    },
    useState: <T,>(initial: T) => {
      const index = cursor++;
      if (!(index in cells)) cells[index] = initial;
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
jest.mock("@/components/i18n/shell-text", () => ({ useShellText: () => ({ t: (key: string) => key }) }));
jest.mock("@/lib/shared/hooks/useDialogBehavior", () => ({ useDialogBehavior: () => ({ current: null }) }));
jest.mock("@/lib/shared/hooks/useBackdropDismiss", () => ({ useBackdropDismiss: () => ({}) }));

import { ImpersonateRoleDialog } from "@/components/impersonate-role-dialog";
import type { PlatformRole } from "@/lib/shared/permissions";

type Props = Record<string, unknown> & { children?: ReactNode };
type Element = ReactElement<Props>;

const onClose = jest.fn<() => void>();
const onConfirm = jest.fn<(roles: PlatformRole[]) => Promise<boolean>>();

/** Rend la modale (deux passes : la première arme le portail). */
function render(): Element {
  cursor = 0;
  refCursor = 0;
  ImpersonateRoleDialog({ onClose, onConfirm });
  cursor = 0;
  refCursor = 0;
  return ImpersonateRoleDialog({ onClose, onConfirm }) as Element;
}

/** Tous les éléments de l'arbre rendu, en profondeur. */
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

const find = (tree: Element, match: (props: Props) => boolean) => {
  const found = elements(tree).find((element) => match(element.props));
  if (!found) throw new Error("élément introuvable");
  return found.props;
};
const playerButton = (tree: Element) => find(tree, (props) => "data-autofocus" in props);
const form = (tree: Element) => find(tree, (props) => props.role === "dialog");
const cancelButton = (tree: Element) => find(tree, (props) => props.children === "impersonate.cancel");
const rows = (tree: Element) => elements(tree).filter((element) => typeof element.props.role === "string" && "onToggle" in element.props);
const toggleRow = (tree: Element, role: PlatformRole) => {
  const row = rows(tree).find((element) => element.props.role === role);
  if (!row) throw new Error(`ligne ${role} absente`);
  (row.props.onToggle as (role: PlatformRole) => void)(role);
};
const submit = (tree: Element) =>
  (form(tree).onSubmit as (event: { preventDefault: () => void; stopPropagation: () => void }) => void)({
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  });

const globals = globalThis as { document?: unknown };
const savedDocument = globals.document;
beforeAll(() => {
  globals.document = { body: {} };
});
afterAll(() => {
  globals.document = savedDocument;
});

beforeEach(() => {
  cells.length = 0;
  refs.length = 0;
  jest.clearAllMocks();
  onConfirm.mockResolvedValue(true);
});

describe("ImpersonateRoleDialog — choix", () => {
  it("rows_offerEveryImpersonableRoleButAdmin", () => {
    expect(rows(render()).map((row) => row.props.role)).toEqual([
      "ARBITRE",
      "CASTER",
      "PROD",
      "COMMUNITY_MANAGER",
      "RECRUTEUR",
      "DEV",
    ]);
  });

  it("playerButton_click_confirmsWithNoRole", async () => {
    (playerButton(render()).onClick as () => void)();
    await Promise.resolve();

    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  it("submit_checkedRoles_confirmsThemInCanonicalOrder", () => {
    toggleRow(render(), "DEV");
    toggleRow(render(), "CASTER");

    submit(render());

    expect(onConfirm).toHaveBeenCalledWith(["CASTER", "DEV"]);
  });

  it("submit_roleCheckedThenUnchecked_confirmsWithoutIt", () => {
    toggleRow(render(), "ARBITRE");
    toggleRow(render(), "ARBITRE");

    submit(render());

    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  it("submit_rowsCheckedState_followsTheSelection", () => {
    toggleRow(render(), "PROD");

    const checked = rows(render()).filter((row) => row.props.checked === true).map((row) => row.props.role);

    expect(checked).toEqual(["PROD"]);
  });
});

describe("ImpersonateRoleDialog — envoi", () => {
  it("submit_twiceBeforeAnswer_confirmsOnce", () => {
    onConfirm.mockReturnValue(new Promise<boolean>(() => undefined));
    const tree = render();

    submit(tree);
    submit(tree);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("submit_pending_cancelDoesNotClose", () => {
    onConfirm.mockReturnValue(new Promise<boolean>(() => undefined));
    submit(render());

    (cancelButton(render()).onClick as () => void)();

    expect(onClose).not.toHaveBeenCalled();
  });

  it("submit_refused_givesTheDialogBack", async () => {
    onConfirm.mockResolvedValue(false);
    submit(render());
    await Promise.resolve();
    await Promise.resolve();

    submit(render());

    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it("toggle_whileSending_isIgnored", () => {
    onConfirm.mockReturnValue(new Promise<boolean>(() => undefined));
    submit(render());

    toggleRow(render(), "DEV");

    expect(rows(render()).filter((row) => row.props.checked === true)).toEqual([]);
  });

  it("cancel_idle_closes", () => {
    (cancelButton(render()).onClick as () => void)();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
