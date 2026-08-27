import { describe, expect, it } from "@jest/globals";
import { createDialogStack, type ScrollLockTarget } from "@/lib/shared/dialog-stack";

/** Cible d'essai : mémorise la valeur courante et l'historique des écritures. */
function fakeTarget(initial = ""): ScrollLockTarget & { value: string; writes: string[] } {
  return {
    value: initial,
    writes: [],
    get() {
      return this.value;
    },
    set(next: string) {
      this.value = next;
      this.writes.push(next);
    },
  };
}

describe("createDialogStack", () => {
  it("starts empty and locks nothing", () => {
    const target = fakeTarget("auto");
    const stack = createDialogStack(target);
    expect(stack.size).toBe(0);
    expect(target.writes).toEqual([]);
    expect(target.value).toBe("auto");
  });

  it("locks scrolling on the first layer and restores on the last", () => {
    const target = fakeTarget("auto");
    const stack = createDialogStack(target);
    const a = Symbol("a");

    stack.push(a);
    expect(target.value).toBe("hidden");
    expect(stack.size).toBe(1);

    stack.pop(a);
    expect(target.value).toBe("auto");
    expect(stack.size).toBe(0);
  });

  it("does not re-lock or re-save when a second layer opens", () => {
    const target = fakeTarget("auto");
    const stack = createDialogStack(target);
    const a = Symbol("a");
    const b = Symbol("b");

    stack.push(a);
    stack.push(b);
    // Une seule écriture : la deuxième couche ne repose pas le verrou, et
    // surtout n'enregistre pas « hidden » comme valeur à restaurer.
    expect(target.writes).toEqual(["hidden"]);
    expect(stack.size).toBe(2);
  });

  it("keeps the lock while any layer remains open", () => {
    const target = fakeTarget("auto");
    const stack = createDialogStack(target);
    const a = Symbol("a");
    const b = Symbol("b");

    stack.push(a);
    stack.push(b);
    stack.pop(b);
    expect(target.value).toBe("hidden");
    stack.pop(a);
    expect(target.value).toBe("auto");
  });

  it("restores the original value whatever the unmount order", () => {
    // Le cas qui bloquait la page : React nettoie dans l'ordre de l'arbre, donc
    // la couche ouverte en premier peut être démontée en premier.
    for (const reversed of [false, true]) {
      const target = fakeTarget("auto");
      const stack = createDialogStack(target);
      const outer = Symbol("outer");
      const inner = Symbol("inner");

      stack.push(outer);
      stack.push(inner);
      const order = reversed ? [outer, inner] : [inner, outer];
      for (const token of order) stack.pop(token);

      expect(target.value).toBe("auto");
      expect(stack.size).toBe(0);
    }
  });

  it("survives three layers closed in an arbitrary order", () => {
    const target = fakeTarget("scroll");
    const stack = createDialogStack(target);
    const tokens = [Symbol("a"), Symbol("b"), Symbol("c")];
    tokens.forEach((t) => stack.push(t));

    stack.pop(tokens[1]);
    expect(target.value).toBe("hidden");
    stack.pop(tokens[0]);
    expect(target.value).toBe("hidden");
    stack.pop(tokens[2]);
    expect(target.value).toBe("scroll");
  });

  it("ignores a duplicate push so a replayed effect cannot skew the depth", () => {
    const target = fakeTarget("auto");
    const stack = createDialogStack(target);
    const a = Symbol("a");

    stack.push(a);
    stack.push(a);
    expect(stack.size).toBe(1);
    stack.pop(a);
    expect(target.value).toBe("auto");
  });

  it("ignores popping an unknown or already-closed token", () => {
    const target = fakeTarget("auto");
    const stack = createDialogStack(target);
    const a = Symbol("a");
    const ghost = Symbol("ghost");

    stack.push(a);
    stack.pop(ghost);
    expect(stack.size).toBe(1);
    expect(target.value).toBe("hidden");

    stack.pop(a);
    stack.pop(a);
    expect(stack.size).toBe(0);
    // La restauration n'a lieu qu'une fois : une deuxième fermeture ne réécrit rien.
    expect(target.writes).toEqual(["hidden", "auto"]);
  });

  it("re-locks correctly after everything has been closed", () => {
    const target = fakeTarget("auto");
    const stack = createDialogStack(target);
    const a = Symbol("a");
    const b = Symbol("b");

    stack.push(a);
    stack.pop(a);
    target.value = "visible"; // la page a changé de réglage entre-temps
    stack.push(b);
    expect(target.value).toBe("hidden");
    stack.pop(b);
    expect(target.value).toBe("visible");
  });

  it("names only the last opened layer as the top one", () => {
    const stack = createDialogStack(fakeTarget());
    const a = Symbol("a");
    const b = Symbol("b");

    stack.push(a);
    expect(stack.isTop(a)).toBe(true);

    stack.push(b);
    // C'est ce qui empêche un seul Échap de fermer les deux modales.
    expect(stack.isTop(a)).toBe(false);
    expect(stack.isTop(b)).toBe(true);

    stack.pop(b);
    expect(stack.isTop(a)).toBe(true);
  });

  it("hands the top back to the remaining layer when a middle one closes", () => {
    const stack = createDialogStack(fakeTarget());
    const a = Symbol("a");
    const b = Symbol("b");
    const c = Symbol("c");
    [a, b, c].forEach((t) => stack.push(t));

    stack.pop(b);
    expect(stack.isTop(c)).toBe(true);
    stack.pop(c);
    expect(stack.isTop(a)).toBe(true);
  });

  it("has no top layer when nothing is open", () => {
    const stack = createDialogStack(fakeTarget());
    const a = Symbol("a");
    expect(stack.isTop(a)).toBe(false);
    stack.push(a);
    stack.pop(a);
    expect(stack.isTop(a)).toBe(false);
  });

  it("keeps two stacks independent", () => {
    const first = fakeTarget("auto");
    const second = fakeTarget("auto");
    const a = createDialogStack(first);
    const b = createDialogStack(second);
    const token = Symbol("shared");

    a.push(token);
    expect(first.value).toBe("hidden");
    expect(second.value).toBe("auto");
    expect(b.isTop(token)).toBe(false);
  });
});
