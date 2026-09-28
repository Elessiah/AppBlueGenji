import { describe, expect, it } from "@jest/globals";
import {
  decideStreamWrite,
  STREAM_STALL_TIMEOUT_MS,
} from "@/lib/server/stream-backpressure";

describe("decideStreamWrite", () => {
  it("écrit tant que la file a de la place", () => {
    expect(decideStreamWrite(1024, null, 1_000)).toEqual({ action: "WRITE", backedUpSince: null });
  });

  it("oublie un engorgement passé dès que la file se dégage", () => {
    // Sans cela, un client lent un instant puis rétabli serait fermé à la
    // prochaine lenteur, sur un délai compté depuis la première.
    expect(decideStreamWrite(1, 500, 100_000)).toEqual({ action: "WRITE", backedUpSince: null });
  });

  it("écrit sur un flux sans mesure (`null`), l'écriture levant d'elle-même", () => {
    expect(decideStreamWrite(null, 500, 100_000).action).toBe("WRITE");
  });

  it("saute la trame quand la file est pleine, et note depuis quand", () => {
    expect(decideStreamWrite(0, null, 1_000)).toEqual({ action: "SKIP", backedUpSince: 1_000 });
    expect(decideStreamWrite(-5_000, null, 1_000)).toEqual({ action: "SKIP", backedUpSince: 1_000 });
  });

  it("garde l'instant du premier engorgement", () => {
    expect(decideStreamWrite(0, 1_000, 30_000)).toEqual({ action: "SKIP", backedUpSince: 1_000 });
  });

  it("ferme une file restée pleine trop longtemps", () => {
    expect(decideStreamWrite(0, 1_000, 1_000 + STREAM_STALL_TIMEOUT_MS - 1).action).toBe("SKIP");
    expect(decideStreamWrite(0, 1_000, 1_000 + STREAM_STALL_TIMEOUT_MS)).toEqual({
      action: "CLOSE",
      backedUpSince: 1_000,
    });
  });
});
