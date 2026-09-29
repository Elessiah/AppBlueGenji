import { describe, expect, it } from "@jest/globals";
import { constants as zlibConstants, gunzipSync } from "node:zlib";
import {
  acceptsGzip,
  concatBytes,
  deflateSegment,
  GZIP_STREAM_HEADER,
} from "@/lib/server/sse-gzip";
import {
  connectedFrameBytes,
  pingFrameBytes,
  snapshotFrameBytes,
} from "@/lib/server/tournament-stream-frames";
import { buildFrame } from "@/lib/server/tournaments/snapshot";
import type { TournamentSnapshotFrame } from "@/lib/server/tournaments/snapshot";
import type { TournamentSnapshot } from "@/lib/shared/types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Ce que décode un navigateur : l'en-tête gzip, puis les morceaux reçus — sans
 * bloc de fin, puisque le flux ne se termine jamais dans le cas nominal.
 */
function browserDecode(...chunks: Uint8Array[]): string {
  return gunzipSync(Buffer.concat([GZIP_STREAM_HEADER, ...chunks]), {
    finishFlush: zlibConstants.Z_SYNC_FLUSH,
  }).toString("utf8");
}

function snapshotFrame(payload: Record<string, unknown>, version = "v1"): TournamentSnapshotFrame {
  const json = JSON.stringify(payload);
  const frame = buildFrame(7, json, version);
  const snapshotJson = encoder.encode(JSON.stringify({ ...payload, version }));
  const start = frame.byteLength - 3 - snapshotJson.byteLength;
  return {
    snapshot: { ...payload, version } as unknown as TournamentSnapshot,
    version,
    frame,
    snapshotJson: frame.subarray(start, start + snapshotJson.byteLength),
  };
}

describe("deflateSegment — morceaux recollables", () => {
  it("se recolle derrière n'importe quel autre morceau et se décode d'un trait", () => {
    const parts = ["data: un\n\n", ": ping\n\n", `data: ${"x".repeat(50_000)}\n\n`, "data: ✦ 日本\n\n"];
    const decoded = browserDecode(...parts.map((part) => deflateSegment(encoder.encode(part))));
    expect(decoded).toBe(parts.join(""));
  });

  it("se décode trame par trame, sans attendre la suivante", () => {
    // Le vidage synchrone : sans lui, le décodeur du navigateur garderait la fin
    // d'une trame en attente de la suivante, et le direct n'en serait plus un.
    const first = deflateSegment(encoder.encode("data: premier\n\n"));
    expect(browserDecode(first)).toBe("data: premier\n\n");
  });

  it("compresse fortement le JSON répétitif d'un plateau", () => {
    const json = JSON.stringify(
      Array.from({ length: 254 }, (_, id) => ({ id, status: "COMPLETED", team1Ready: false })),
    );
    expect(deflateSegment(encoder.encode(json)).byteLength).toBeLessThan(json.length / 5);
  });
});

describe("concatBytes", () => {
  it("colle les morceaux dans l'ordre", () => {
    expect([...concatBytes([Uint8Array.of(1, 2), new Uint8Array(0), Uint8Array.of(3)])]).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("acceptsGzip", () => {
  it.each<[string | null | undefined, boolean]>([
    ["gzip, deflate, br, zstd", true],
    ["GZIP", true],
    ["x-gzip", true],
    ["br;q=1.0, gzip;q=0.8", true],
    ["*", true],
    ["gzip;q=0", false],
    ["*, gzip;q=0", false],
    ["*;q=0", false],
    ["br, deflate", false],
    ["identity", false],
    ["", false],
    [null, false],
    [undefined, false],
    ["gzip;q=abc", false],
  ])("%p → %p", (header, expected) => {
    expect(acceptsGzip(header)).toBe(expected);
  });
});

describe("trames du flux", () => {
  const payload = { card: { id: 7, name: 'Tournoi "}\\ ✦' }, matches: [{ id: 1 }] };

  it("rend la trame en clair telle quelle", () => {
    const frame = snapshotFrame(payload);
    expect(snapshotFrameBytes(frame, "identity")).toBe(frame.frame);
  });

  it("rend une trame compressée qui redonne la trame en clair, calculée une fois", () => {
    const frame = snapshotFrame(payload);
    const compressed = snapshotFrameBytes(frame, "gzip");
    expect(browserDecode(compressed)).toBe(decoder.decode(frame.frame));
    expect(snapshotFrameBytes(frame, "gzip")).toBe(compressed);
  });

  it("compose la trame de connexion autour de l'instantané déjà encodé", () => {
    const frame = snapshotFrame(payload);
    const envelope = { type: "connected", tournamentId: 7, tier: "PRIORITY", viewer: { myTeamId: 3 } };

    const plain = decoder.decode(connectedFrameBytes(envelope, frame.snapshot, frame, "identity"));
    expect(plain.startsWith("data: ")).toBe(true);
    expect(plain.endsWith("\n\n")).toBe(true);
    expect(JSON.parse(plain.slice(6, -2))).toEqual({ ...envelope, snapshot: frame.snapshot });

    const compressed = browserDecode(connectedFrameBytes(envelope, frame.snapshot, frame, "gzip"));
    expect(compressed).toBe(plain);
  });

  it("retombe sur la sérialisation sans trame en cache", () => {
    const snapshot = { card: { id: 7 }, version: "v9" };
    const envelope = { type: "connected" };
    const plain = decoder.decode(connectedFrameBytes(envelope, snapshot, null, "identity"));
    expect(JSON.parse(plain.slice(6, -2))).toEqual({ type: "connected", snapshot });
    expect(browserDecode(connectedFrameBytes(envelope, snapshot, null, "gzip"))).toBe(plain);
  });

  it("accepte une enveloppe vide", () => {
    const plain = decoder.decode(connectedFrameBytes({}, { a: 1 }, null, "identity"));
    expect(JSON.parse(plain.slice(6, -2))).toEqual({ snapshot: { a: 1 } });
  });

  it("encode le battement de cœur dans les deux encodages", () => {
    expect(decoder.decode(pingFrameBytes("identity"))).toBe(": ping\n\n");
    expect(browserDecode(pingFrameBytes("gzip"))).toBe(": ping\n\n");
  });

  it("enchaîne connexion, battement et instantané dans un seul flux décodable", () => {
    const frame = snapshotFrame(payload);
    const connected = connectedFrameBytes({ type: "connected" }, frame.snapshot, frame, "gzip");
    const decoded = browserDecode(connected, pingFrameBytes("gzip"), snapshotFrameBytes(frame, "gzip"));
    expect(decoded).toBe(
      decoder.decode(connectedFrameBytes({ type: "connected" }, frame.snapshot, frame, "identity")) +
        ": ping\n\n" +
        decoder.decode(frame.frame),
    );
  });
});
