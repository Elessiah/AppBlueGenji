import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { AudienceBeaconEntry } from "@/lib/shared/audience";
import { AudienceTracker } from "@/lib/shared/audience-tracker";

/**
 * Page d'arrivée affichée avant l'installation du suivi
 * (`AudienceTracker.arrive`, cycle de sécurité 5 de `feature/stats-page`) :
 * datée de son affichage, comptée si elle était visible alors.
 */

let clock = 0;
let visible = true;
let send: jest.Mock<(entries: AudienceBeaconEntry[]) => void>;

function tracker() {
  return new AudienceTracker({
    now: () => clock,
    isVisible: () => visible,
    device: () => "desktop",
    referrerHost: () => "discord.com",
    send,
  });
}

const sent = () => send.mock.calls.flatMap(([entries]) => entries);

beforeEach(() => {
  clock = 10_000;
  visible = true;
  send = jest.fn<(entries: AudienceBeaconEntry[]) => void>();
});

describe("AudienceTracker.arrive", () => {
  it("arrive_visibleAtMount_viewDatedAtMountAndTimeFromMount", () => {
    const t = tracker();
    t.arrive("/tournois", 9_000, true);
    clock = 15_000;

    t.leave();

    expect(sent()).toEqual([
      { p: "/tournois", t: 0, a: 6_000, d: "desktop", f: 1, r: "discord.com" },
      { p: "/tournois", t: 6_000, a: 0, d: "desktop", c: 1, o: 6_000 },
    ]);
  });

  it("arrive_hiddenAtMount_notCountedUntilVisible", () => {
    const t = tracker();
    t.arrive("/tournois", 9_000, false);
    t.leave();
    expect(sent()).toEqual([]);

    t.visible();
    t.leave();

    expect(sent().map((entry) => [entry.p, entry.t, entry.f])).toEqual([["/tournois", 0, 1]]);
  });

  it("arrive_futureTimestamp_clampedToNow", () => {
    const t = tracker();
    t.arrive("/tournois", 20_000, true);
    clock = 12_000;

    t.leave();

    expect(sent().map((entry) => [entry.a, entry.t])).toEqual([
      [2_000, 0],
      [0, 2_000],
    ]);
  });

  it("arrive_alreadyArrived_behavesAsNavigate", () => {
    const t = tracker();
    t.navigate("/");

    t.arrive("/equipes", 1_000, true);
    t.leave();

    const views = sent().filter((entry) => entry.c !== 1);
    expect(views.map((entry) => [entry.p, entry.f ?? 0, entry.a])).toEqual([
      ["/", 1, 0],
      ["/equipes", 0, 0],
    ]);
  });
});
