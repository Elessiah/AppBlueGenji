import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { AudienceBeaconEntry } from "@/lib/shared/audience";
import { AudienceTracker } from "@/lib/shared/audience-tracker";

/** Suivi des pages vues dans le navigateur (`<AudienceBeacon />`, registre T19). */

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
  it("signale la première page avec son référent, puis la suivante en navigation interne", () => {
    const t = tracker();
    t.navigate("/");
    clock = 5000;
    t.navigate("/classement");
    clock = 7000;
    t.leave();

    expect(send.mock.calls[0][0]).toEqual([
      { p: "/", t: 5000, a: 7000, d: "mobile", f: 1, r: "discord.com" },
      { p: "/classement", t: 2000, a: 2000, d: "mobile" },
    ]);
  });

  it("ignore une navigation vers la page déjà affichée", () => {
    const t = tracker();
    t.navigate("/");
    t.navigate("/");
    t.leave();

    expect(send.mock.calls[0][0]).toHaveLength(1);
  });

  it("ne compte une page ouverte en arrière-plan qu'à son premier passage au premier plan", () => {
    visible = false;
    const t = tracker(null);
    t.navigate("/regles");
    clock = 10_000;
    t.visible();
    clock = 13_000;
    t.leave();

    expect(send.mock.calls[0][0]).toEqual([{ p: "/regles", t: 3000, a: 3000, d: "mobile", f: 1, r: null }]);
  });

  it("envoie la page en passant en arrière-plan, puis n'ajoute qu'une suite au retour", () => {
    const t = tracker();
    t.navigate("/equipes");
    clock = 4000;
    t.hidden();
    clock = 60_000;
    t.visible();
    clock = 61_000;
    t.leave();

    expect(send.mock.calls[0][0]).toEqual([{ p: "/equipes", t: 4000, a: 4000, d: "mobile", f: 1, r: "discord.com" }]);
    expect(send.mock.calls[1][0]).toEqual([{ p: "/equipes", t: 1000, a: 1000, d: "mobile", c: 1 }]);
  });

  it("plafonne le temps d'une page à 30 minutes", () => {
    const t = tracker();
    t.navigate("/");
    clock = 3 * 60 * 60 * 1000;
    t.leave();

    expect(send.mock.calls[0][0][0].t).toBe(1_800_000);
  });

  it("ne signale pas la page de fréquentation", () => {
    const t = tracker();
    t.navigate("/frequentation");
    clock = 1000;
    t.leave();

    expect(send).not.toHaveBeenCalled();
  });

  it("garde la file jusqu'au tick tant qu'elle compte moins de dix pages", () => {
    const t = tracker();
    t.navigate("/");
    t.navigate("/classement");

    expect(t.pendingCount).toBe(1);
    expect(send).not.toHaveBeenCalled();

    t.tick();

    expect(send).toHaveBeenCalledTimes(1);
    expect(t.pendingCount).toBe(0);
  });

  it("envoie la file dès la dixième page", () => {
    const t = tracker();
    for (const path of ["/", "/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h", "/i", "/j"]) t.navigate(path);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toHaveLength(10);
  });
});
