import { describe, expect, it } from "@jest/globals";
import { isListGateOpen, type ListGateState } from "@/app/(secured)/tournois/_lib/list-gate";

const open: ListGateState = { listFetched: true, mineSettled: true, hiddenSettled: true };

describe("isListGateOpen — porte d'affichage de /tournois", () => {
  it("s'ouvre quand la liste, « Mes tournois » et les invisibles ont répondu", () => {
    expect(isListGateOpen(open)).toBe(true);
  });

  it.each<[string, Partial<ListGateState>]>([
    ["la liste publique n'est pas arrivée", { listFetched: false }],
    ["« Mes tournois » n'a pas répondu", { mineSettled: false }],
    ["la première lecture des invisibles n'a pas répondu", { hiddenSettled: false }],
  ])("reste fermée tant que %s", (_, missing) => {
    expect(isListGateOpen({ ...open, ...missing })).toBe(false);
  });

  it("ne s'ouvre qu'à la dernière réponse, quel que soit l'ordre d'arrivée", () => {
    const orders: (keyof ListGateState)[][] = [
      ["listFetched", "mineSettled", "hiddenSettled"],
      ["mineSettled", "listFetched", "hiddenSettled"],
      ["hiddenSettled", "mineSettled", "listFetched"],
      ["mineSettled", "hiddenSettled", "listFetched"],
    ];
    for (const order of orders) {
      const state: ListGateState = { listFetched: false, mineSettled: false, hiddenSettled: false };
      const opened = order.map((key) => {
        state[key] = true;
        return isListGateOpen(state);
      });
      expect(opened).toEqual([false, false, true]);
    }
  });
});
