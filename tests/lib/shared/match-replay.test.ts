import { describe, expect, it } from "@jest/globals";
import {
  canHaveReplay,
  isValidReplayUrl,
  normalizeReplayUrl,
  visibleReplayUrl,
} from "@/lib/shared/match-replay";
import type { BracketMatch } from "@/lib/shared/types";
import { bracketMatch } from "../../helpers/bracket-match";

const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const played = bracketMatch({
  status: "COMPLETED",
  team1Id: 1,
  team2Id: 2,
  team1Score: 3,
  team2Score: 1,
  winnerTeamId: 1,
  loserTeamId: 2,
});

describe("normalizeReplayUrl", () => {
  it.each<[string, string]>([
    [VIDEO, VIDEO],
    ["youtube.com/watch?v=dQw4w9WgXcQ", "https://youtube.com/watch?v=dQw4w9WgXcQ"],
    [
      "http://WWW.YouTube.com/watch?v=dQw4w9WgXcQ&t=120s",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120s",
    ],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ"],
    ["  https://youtu.be/dQw4w9WgXcQ?t=42  ", "https://youtu.be/dQw4w9WgXcQ?t=42"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "https://www.youtube.com/live/dQw4w9WgXcQ"],
  ])("accepte et normalise %s", (input, expected) => {
    expect(normalizeReplayUrl(input)).toBe(expected);
    expect(isValidReplayUrl(input)).toBe(true);
  });

  it.each<[unknown]>([
    [null],
    [undefined],
    [42],
    [""],
    ["   "],
    // Plateformes de direct : le lien d'une chaîne n'est pas une rediff.
    ["https://www.twitch.tv/videos/123456"],
    ["https://kick.com/bluegenji"],
    // YouTube, mais pas une vidéo.
    ["https://www.youtube.com/"],
    ["https://www.youtube.com/@bluegenji"],
    ["https://www.youtube.com/watch"],
    ["https://www.youtube.com/watch?v="],
    ["https://www.youtube.com/watch?v=<script>"],
    ["https://youtu.be/"],
    ["https://youtu.be/abc/def"],
    // Hôtes trompeurs, schémas exécutables, identifiants, ports, longueur.
    ["https://youtube.com.exemple.invalid/watch?v=dQw4w9WgXcQ"],
    ["https://evil.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["javascript:alert(1)"],
    ["https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://youtube.com:8443/watch?v=dQw4w9WgXcQ"],
    [`https://youtube.com/watch?v=dQw4w9WgXcQ&x=${"a".repeat(300)}`],
  ])("refuse %p", (input) => {
    expect(normalizeReplayUrl(input)).toBeNull();
    expect(isValidReplayUrl(input)).toBe(false);
  });
});

describe("canHaveReplay", () => {
  it("accepte une rencontre terminée et disputée", () => {
    expect(canHaveReplay(played)).toBe(true);
  });

  it("accepte un match nul", () => {
    const draw: BracketMatch = { ...played, winnerTeamId: null, loserTeamId: null, team1Score: 2, team2Score: 2 };
    expect(canHaveReplay(draw)).toBe(true);
  });

  it.each<[string, Partial<BracketMatch>]>([
    ["un match à venir", { status: "PENDING" }],
    ["un match jouable", { status: "READY" }],
    ["un score en attente de confirmation", { status: "AWAITING_CONFIRMATION" }],
    ["une exemption", { team2Id: null }],
    ["un match fantôme", { team1Id: null, team2Id: null }],
    ["un forfait", { forfeitTeamId: 2 }],
    ["un double forfait", { doubleForfeit: true, winnerTeamId: null, loserTeamId: null }],
  ])("refuse %s", (_label, overrides) => {
    expect(canHaveReplay({ ...played, ...overrides })).toBe(false);
  });
});

describe("visibleReplayUrl", () => {
  it("rend le lien d'un match joué", () => {
    expect(visibleReplayUrl({ ...played, replayUrl: VIDEO })).toBe(VIDEO);
  });

  it("se tait sans lien", () => {
    expect(visibleReplayUrl({ ...played, replayUrl: null })).toBeNull();
  });

  it("se tait sur un match rouvert par un retour en arrière, lien gardé en base", () => {
    expect(visibleReplayUrl({ ...played, status: "READY", replayUrl: VIDEO })).toBeNull();
  });

  it("revalide le lien à la lecture — une ligne éditée à la main ne devient pas un href", () => {
    expect(visibleReplayUrl({ ...played, replayUrl: "https://exemple.invalid/x" })).toBeNull();
  });
});
