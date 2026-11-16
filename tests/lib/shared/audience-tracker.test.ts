import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { AudienceBeaconEntry } from "@/lib/shared/audience";
import { AudienceTracker } from "@/lib/shared/audience-tracker";

/**
 * Suivi des pages vues dans le navigateur (`<AudienceBeacon />`, registre T19) :
 * la page vue part à son affichage (`t: 0`), son temps à sa clôture (`c: 1`).
 */

let clock = 0;
let visible = true;
let send: jest.Mock<(entries: AudienceBeaconEntry[]) => void>;

function tracker(referrer: string | null = "discord.com") {
  return new AudienceTracker({
    now: () => clock,
    isVisible: () => visible,
    device: () => "mobile",
    referrerHost: () => referrer,
    send,
  });
}

beforeEach(() => {
  clock = 0;
  visible = true;
  send = jest.fn<(entries: AudienceBeaconEntry[]) => void>();
});

describe("AudienceTracker", () => {
  it("navigate_firstPage_sendsViewAtDisplayWithReferrer", () => {
    const t = tracker();
    t.navigate("/");
    clock = 5000;
    t.navigate("/classement");
    clock = 7000;
    t.leave();

    expect(send.mock.calls[0][0]).toEqual([
      { p: "/", t: 0, a: 7000, d: "mobile", f: 1, r: "discord.com" },
      { p: "/", t: 5000, a: 2000, d: "mobile", c: 1, o: 7000 },
      { p: "/classement", t: 0, a: 2000, d: "mobile" },
      { p: "/classement", t: 2000, a: 0, d: "mobile", c: 1, o: 2000 },
    ]);
  });

  it("leave_afterReading_sendsTimeAsContinuationDatedAtClose", () => {
    const t = tracker();
    t.navigate("/regles");
    clock = 3 * 60 * 60 * 1000;
    t.hidden();

    expect(send.mock.calls[0][0][1]).toEqual({ p: "/regles", t: 1_800_000, a: 0, d: "mobile", c: 1, o: 10_800_000 });
  });

  it("finish_zeroVisibleTime_sendsNoTimeEntry", () => {
    const t = tracker();
    t.navigate("/");
    t.leave();

    expect(send.mock.calls[0][0]).toEqual([{ p: "/", t: 0, a: 0, d: "mobile", f: 1, r: "discord.com" }]);
  });

  it("navigate_samePage_ignored", () => {
    const t = tracker();
    t.navigate("/");
    t.navigate("/");
    t.leave();

    expect(send.mock.calls[0][0]).toHaveLength(1);
  });

  it("navigate_backgroundOpenedPage_viewSentAtFirstVisible", () => {
    visible = false;
    const t = tracker(null);
    t.navigate("/regles");
    clock = 10_000;
    t.visible();
    clock = 13_000;
    t.leave();

    expect(send.mock.calls[0][0]).toEqual([
      { p: "/regles", t: 0, a: 3000, d: "mobile", f: 1, r: null },
      { p: "/regles", t: 3000, a: 0, d: "mobile", c: 1, o: 3000 },
    ]);
  });

  it("visible_sameCountedPage_sendsOnlyContinuation", () => {
    const t = tracker();
    t.navigate("/equipes");
    clock = 4000;
    t.hidden();
    clock = 60_000;
    t.visible();
    clock = 61_000;
    t.leave();

    // La suite garde l'ouverture de la page (instant 0) : elle se range à son jour.
    expect(send.mock.calls[1][0]).toEqual([{ p: "/equipes", t: 1000, a: 0, d: "mobile", c: 1, o: 61_000 }]);
  });

  it("navigate_frequentationPage_sendsNothing", () => {
    const t = tracker();
    t.navigate("/frequentation");
    clock = 1000;
    t.leave();

    expect(send).not.toHaveBeenCalled();
  });

  it("tick_queueUnderTen_sendsOnTick", () => {
    const t = tracker();
    t.navigate("/");

    expect(t.pendingCount).toBe(1);
    expect(send).not.toHaveBeenCalled();

    t.tick();

    expect(send).toHaveBeenCalledTimes(1);
    expect(t.pendingCount).toBe(0);
  });

  it("enqueue_tenthEntry_sendsAtOnce", () => {
    const t = tracker();
    for (const path of ["/", "/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h", "/i"]) t.navigate(path);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toHaveLength(10);
  });
});

describe("AudienceTracker — tranches d'une longue lecture", () => {
  it("tick_visibleReadingPastCheckpoint_sendsChunkAndKeepsReading", () => {
    const t = tracker();
    t.navigate("/regles");
    clock = 600_000;
    t.tick();
    clock = 660_000;
    t.leave();

    expect(send.mock.calls[0][0].slice(1)).toEqual([{ p: "/regles", t: 600_000, a: 0, d: "mobile", c: 1, o: 600_000 }]);
    expect(send.mock.calls[1][0]).toEqual([{ p: "/regles", t: 60_000, a: 0, d: "mobile", c: 1, o: 660_000 }]);
  });

  it("tick_readingUnderCheckpoint_sendsNoChunk", () => {
    const t = tracker();
    t.navigate("/regles");
    clock = 540_000;
    t.tick();

    expect(send.mock.calls[0][0]).toEqual([{ p: "/regles", t: 0, a: 540_000, d: "mobile", f: 1, r: "discord.com" }]);
  });
});
