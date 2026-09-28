import { describe, expect, it } from "@jest/globals";
import { createSlotRegistry, type SlotObserver } from "@/app/(secured)/tournois/[id]/_lib/slot-registry";
import { readSource } from "../helpers/read-source";

/**
 * Registre des créneaux de l'arbre. Le défaut corrigé : une `ref` neuve à
 * chaque rendu faisait détacher puis rattacher chaque carte, donc `unobserve`
 * puis `observe` pour toutes et deux mesures complètes de l'arbre par
 * instantané du flux.
 */

interface Slot {
  name: string;
}

function recordingObserver() {
  const calls: string[] = [];
  const observer: SlotObserver<Slot> = {
    observe: (element) => calls.push(`observe ${element.name}`),
    unobserve: (element) => calls.push(`unobserve ${element.name}`),
  };
  return { observer, calls };
}

describe("createSlotRegistry", () => {
  it("rend la même ref d'un rendu à l'autre pour un même créneau", () => {
    const registry = createSlotRegistry<Slot>(() => null);
    expect(registry.refFor(1, 42)).toBe(registry.refFor(1, 42));
    expect(registry.refFor(1, 42)).not.toBe(registry.refFor(1, 43));
  });

  it("rend une ref neuve quand le match change de round", () => {
    const registry = createSlotRegistry<Slot>(() => null);
    const before = registry.refFor(1, 42);
    expect(registry.refFor(2, 42)).not.toBe(before);
  });

  it("enregistre et observe l'élément posé, puis l'oublie à son retrait", () => {
    const { observer, calls } = recordingObserver();
    const registry = createSlotRegistry<Slot>(() => observer);
    const card = { name: "a" };
    registry.refFor(1, 42)(card);
    expect(registry.nodes.get(42)).toEqual({ roundNumber: 1, element: card });
    registry.refFor(1, 42)(null);
    expect(registry.nodes.has(42)).toBe(false);
    expect(calls).toEqual(["observe a", "unobserve a"]);
  });

  it("ne réobserve rien tant que rien n'est posé ni retiré", () => {
    const { observer, calls } = recordingObserver();
    const registry = createSlotRegistry<Slot>(() => observer);
    const ref = registry.refFor(1, 42);
    ref({ name: "a" });
    // Rendus suivants : React compare la ref, identique, et ne la rappelle pas.
    expect(registry.refFor(1, 42)).toBe(ref);
    expect(calls).toEqual(["observe a"]);
  });

  it("demande une mesure au premier passage, puis seulement après un créneau posé ou retiré", () => {
    const registry = createSlotRegistry<Slot>(() => null);
    expect(registry.takeDirty()).toBe(true);
    expect(registry.takeDirty()).toBe(false);
    registry.refFor(1, 42)({ name: "a" });
    expect(registry.takeDirty()).toBe(true);
    expect(registry.takeDirty()).toBe(false);
    registry.refFor(1, 42)(null);
    expect(registry.takeDirty()).toBe(true);
  });

  it("ne défait pas l'enregistrement posé par la ref du nouveau round", () => {
    const { observer } = recordingObserver();
    const registry = createSlotRegistry<Slot>(() => observer);
    const card = { name: "a" };
    const oldRef = registry.refFor(1, 42);
    oldRef(card);
    // Rendu suivant : le match change de round. React appelle l'ancienne ref
    // avec null, puis la nouvelle avec l'élément — mais la nouvelle a pu être
    // créée (pendant le rendu) avant le détachement de l'ancienne.
    const newRef = registry.refFor(2, 42);
    oldRef(null);
    newRef(card);
    expect(registry.nodes.get(42)).toEqual({ roundNumber: 2, element: card });
    // Et la ref retenue reste la nouvelle : pas de ref neuve à chaque rendu.
    expect(registry.refFor(2, 42)).toBe(newRef);
  });

  it("n'efface pas un élément plus récent si l'ancienne ref se détache en retard", () => {
    const registry = createSlotRegistry<Slot>(() => null);
    const oldRef = registry.refFor(1, 42);
    oldRef({ name: "a" });
    const newRef = registry.refFor(2, 42);
    newRef({ name: "b" });
    oldRef(null);
    expect(registry.nodes.get(42)?.element).toEqual({ name: "b" });
  });

  it("lit l'observateur au moment du geste — il naît après les premières refs", () => {
    let current: SlotObserver<Slot> | null = null;
    const { observer, calls } = recordingObserver();
    const registry = createSlotRegistry<Slot>(() => current);
    registry.refFor(1, 1)({ name: "a" });
    current = observer;
    registry.refFor(1, 2)({ name: "b" });
    expect(calls).toEqual(["observe b"]);
  });
});

describe("câblage dans useSlotHeight", () => {
  const source = readSource("app/(secured)/tournois/[id]/_hooks/useSlotHeight.ts");

  it("ne relève plus la mesure à chaque rendu", () => {
    expect(source).not.toMatch(/useIsomorphicLayoutEffect\(recompute\)/);
    expect(source).toMatch(/if \(slots\.takeDirty\(\)\) recompute\(\)/);
  });

  it("sert les refs stables du registre", () => {
    expect(source).toContain("measureSlot: slots.refFor");
  });
});
