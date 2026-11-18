import { describe, expect, it } from "@jest/globals";
import { constants as zlibConstants, gunzipSync } from "node:zlib";
import { reconnectFrameBytes } from "@/lib/server/tournament-stream-frames";
import { GZIP_STREAM_HEADER } from "@/lib/server/sse-gzip";
import { isStreamReconnectData, STREAM_RECONNECT_DATA } from "@/lib/shared/stream-reconnect";

/** Trame « relis ta session » du flux (`lib/shared/stream-reconnect.ts`, `ADMIN_PLAYER_VIEW.md`). */
describe("reconnectFrameBytes", () => {
  it("reconnectFrameBytes_identity_isReconnectDataFrame", () => {
    const text = new TextDecoder().decode(reconnectFrameBytes("identity"));

    expect(text).toBe('data: {"type":"reconnect"}\n\n');
  });

  it("reconnectFrameBytes_gzip_inflatesToSameFrame", () => {
    const bytes = Buffer.concat([Buffer.from(GZIP_STREAM_HEADER), Buffer.from(reconnectFrameBytes("gzip"))]);

    const text = gunzipSync(bytes, { finishFlush: zlibConstants.Z_SYNC_FLUSH }).toString("utf8");

    expect(text).toBe('data: {"type":"reconnect"}\n\n');
  });
});

describe("isStreamReconnectData", () => {
  it("isStreamReconnectData_reconnectData_returnsTrue", () => {
    expect(isStreamReconnectData(STREAM_RECONNECT_DATA)).toBe(true);
  });

  it("isStreamReconnectData_otherMessage_returnsFalse", () => {
    expect(isStreamReconnectData('{"type":"snapshot"}')).toBe(false);
  });
});
