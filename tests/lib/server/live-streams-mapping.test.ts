import { describe, expect, it } from "@jest/globals";
import { mapCard, mapMatch, type MatchRow, type TournamentListRow } from "@/lib/server/tournaments/_internal";
import type { CastEligibilityFields } from "@/lib/server/tournaments/cast-eligibility";
import type { MatchCasterRow } from "@/lib/server/tournaments/match-casters";
import type { RowOverrides } from "../../helpers/row-overrides";
import { matchRow as baseMatchRow, tournamentListRow } from "../../helpers/tournament-rows";

/**
 * Revalidation des liens de diffusion à la lecture.
 *
 * Les routes d'écriture normalisent déjà, mais une ligne posée avant la liste
 * blanche — ou éditée à la main en base — ne doit jamais ressortir en `href`.
 * Le piège le plus concret est l'URL sans schéma : rendue telle quelle, elle
 * devient un lien **relatif** qui renvoie le visiteur dans le site au lieu de
 * la chaîne de diffusion.
 */

/** La ligne de liste d'un tournoi en cours, avec sa chaîne officielle `liveUrl`. */
function tournamentRow(liveUrl: string | null): TournamentListRow {
  return tournamentListRow({ name: "Coupe", state: "RUNNING", registered_teams: 8, live_url: liveUrl });
}

/** Le match 5 (Alpha contre Bravo), à l'heure `startAt`, mode `AUTO`. */
function matchRow(startAt: Date | null = null, overrides: RowOverrides<MatchRow> = {}): MatchRow {
  return baseMatchRow({
    id: 5,
    team1_name: "Alpha",
    team2_name: "Bravo",
    updated_at: new Date("2026-08-20T00:00:00Z"),
    start_at: startAt,
    live_trigger: "AUTO",
    ...overrides,
  });
}

/** Un caster du match 5 sur le stream `streamId`, éligible sauf `eligibility`. */
function casterRow(userId: number, streamId: number, eligibility: Partial<CastEligibilityFields> = {}): MatchCasterRow {
  return {
    matchId: 5,
    userId,
    streamId,
    readyAt: null,
    pseudo: `Caster${userId}`,
    eligibility: {
      discord_verified_at: new Date("2026-08-01T00:00:00Z"),
      discord_pseudo: "caster#0",
      blizzard_sub: "sub",
      overwatch_battletag: "Caster#1234",
      overwatch_battletag_typed: null,
      is_deleted: 0,
      is_admin: 0,
      platform_roles_json: JSON.stringify(["CASTER"]),
      ...eligibility,
    },
  };
}

describe("mapCard — chaîne officielle", () => {
  it("laisse passer un lien déjà normalisé", () => {
    expect(mapCard(tournamentRow("https://twitch.tv/bg")).liveUrl).toBe("https://twitch.tv/bg");
  });

  it("normalise une URL sans schéma plutôt que d'en faire un lien relatif", () => {
    expect(mapCard(tournamentRow("twitch.tv/bg")).liveUrl).toBe("https://twitch.tv/bg");
  });

  it("écarte une URL hors liste blanche laissée en base", () => {
    expect(mapCard(tournamentRow("https://exemple.com/live")).liveUrl).toBeNull();
    expect(mapCard(tournamentRow("javascript:alert(1)")).liveUrl).toBeNull();
  });

  it("garde null quand aucune chaîne n'est renseignée", () => {
    expect(mapCard(tournamentRow(null)).liveUrl).toBeNull();
  });
});

/** Un stream du match 5, tel que le lit `loadMatchStreams`. */
const stream = (id: number, liveUrl: string | null, staff = false) => ({ id, matchId: 5, liveUrl, staff });

describe("mapMatch — chaîne du match", () => {
  it("normalise et filtre de la même façon", () => {
    expect(mapMatch(matchRow(), { streams: [stream(1, "kick.com/bg", true)] }).liveUrl).toBe("https://kick.com/bg");
    expect(mapMatch(matchRow(), { streams: [stream(1, "https://exemple.com/live", true)] }).liveUrl).toBeNull();
    expect(mapMatch(matchRow(), { streams: [stream(1, null, true)] }).liveUrl).toBeNull();
    expect(mapMatch(matchRow()).liveUrl).toBeNull();
  });

  it("le premier lien est celui du staff, même ouvert après celui d'un caster", () => {
    const match = mapMatch(matchRow(), {
      streams: [stream(1, "https://twitch.tv/caster"), stream(2, "https://twitch.tv/staff", true)],
      casters: [casterRow(1, 1)],
    });
    expect(match.liveUrl).toBe("https://twitch.tv/staff");
  });

  it("sans stream du staff, le premier lien est celui du plus petit stream montré", () => {
    const match = mapMatch(matchRow(), {
      streams: [stream(4, "https://twitch.tv/b"), stream(2, "https://twitch.tv/a"), stream(3, null)],
      casters: [casterRow(1, 4), casterRow(2, 2), casterRow(3, 3)],
    });
    expect(match.liveUrl).toBe("https://twitch.tv/a");
  });

  it("avant le lancement, ne montre ni le stream ni le lien d'un caster devenu inéligible", () => {
    const match = mapMatch(matchRow(), {
      streams: [stream(1, "https://twitch.tv/caster")],
      casters: [casterRow(1, 1, { is_deleted: 1 })],
    });
    expect(match.liveUrl).toBeNull();
    expect(match.streams).toEqual([]);
  });

  it("un match lancé garde tous ses streams et son premier lien : on ne réécrit pas une diffusion en cours", () => {
    const match = mapMatch(matchRow(null, { launched_at: new Date("2026-08-20T10:00:00Z") }), {
      streams: [stream(1, "https://twitch.tv/caster")],
      casters: [casterRow(1, 1, { is_deleted: 1 })],
    });
    expect(match.liveUrl).toBe("https://twitch.tv/caster");
    expect(match.streams).toHaveLength(1);
  });

  it("un match joué tait le stream orphelin et son lien (D25)", () => {
    const match = mapMatch(matchRow(null, { status: "COMPLETED" }), {
      streams: [stream(1, "https://twitch.tv/orphelin")],
      casters: [],
    });
    expect(match.liveUrl).toBeNull();
    expect(match.streams).toEqual([]);
  });

  it("un match joué garde le lien du stream que tient un caster devenu inéligible", () => {
    const match = mapMatch(matchRow(null, { status: "COMPLETED" }), {
      streams: [stream(1, "https://twitch.tv/caster")],
      casters: [casterRow(1, 1, { is_deleted: 1 })],
    });
    expect(match.liveUrl).toBe("https://twitch.tv/caster");
  });

  it("expose le mode et l'antenne tels quels", () => {
    const match = mapMatch(matchRow());
    expect(match.liveTrigger).toBe("AUTO");
    expect(match.liveStartedAt).toBeNull();
  });
});

describe("mapMatch — date de début", () => {
  it("sérialise l'horaire en ISO", () => {
    const startAt = new Date("2026-08-29T18:30:00Z");
    expect(mapMatch(matchRow(startAt)).startAt).toBe("2026-08-29T18:30:00.000Z");
  });

  it("garde null quand aucun horaire n'est annoncé", () => {
    expect(mapMatch(matchRow()).startAt).toBeNull();
  });

  it("tolère une ligne antérieure à la colonne", () => {
    // La migration ajoute la colonne, mais un appelant qui construit une ligne
    // sans elle (test, cache d'un ancien format) ne doit pas produire `undefined`
    // dans la charge utile poussée par le flux.
    const { start_at: _absent, ...row } = matchRow();
    expect(mapMatch(row as MatchRow).startAt).toBeNull();
  });
});
