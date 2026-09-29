import { describe, expect, it } from "@jest/globals";
import {
  TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS,
  formatTeamJoinRequestNotice,
  shouldNotifyTeamJoinRequest,
  TEAM_JOIN_REQUEST_NOTICES_DAILY_CAP,
  teamJoinNoticeRecipients,
  type TeamJoinNoticeMember,
} from "@/lib/shared/team-join-request-notice";

function member(overrides: Partial<TeamJoinNoticeMember> = {}): TeamJoinNoticeMember {
  return {
    userId: 1,
    pseudo: "Nova",
    roles: ["OWNER"],
    discordId: "100000000000000001",
    discordPseudo: "nova",
    discordVerified: true,
    ...overrides,
  };
}

describe("teamJoinNoticeRecipients", () => {
  it("prévient le propriétaire et les managers", () => {
    const recipients = teamJoinNoticeRecipients([
      member({ userId: 1, pseudo: "Owner", roles: ["OWNER", "DPS"] }),
      member({ userId: 2, pseudo: "Manager", roles: ["MANAGER"] }),
    ]);
    expect(recipients.map((r) => r.discord?.label)).toEqual(["Owner", "Manager"]);
    expect(recipients.map((r) => r.userId)).toEqual([1, 2]);
  });

  it("ne prévient ni les rôles sportifs ni le capitaine", () => {
    const recipients = teamJoinNoticeRecipients([
      member({ roles: ["CAPITAINE"] }),
      member({ roles: ["TANK", "DPS", "HEAL", "COACH"] }),
      member({ roles: [] }),
    ]);
    expect(recipients).toEqual([]);
  });

  it("n'écrit sur Discord qu'à un moyen prouvé, mais garde chacun pour le push", () => {
    const recipients = teamJoinNoticeRecipients([
      member({ userId: 1, pseudo: "Id", discordId: "1", discordPseudo: null, discordVerified: false }),
      member({ userId: 2, pseudo: "Tag", discordId: null, discordPseudo: "tag", discordVerified: true }),
      member({ userId: 3, pseudo: "Saisi", discordId: null, discordPseudo: "quelquun", discordVerified: false }),
      member({ userId: 4, pseudo: "Rien", discordId: null, discordPseudo: null, discordVerified: false }),
    ]);
    expect(recipients).toEqual([
      { userId: 1, discord: { discordId: "1", handle: null, label: "Id" } },
      { userId: 2, discord: { discordId: null, handle: "tag", label: "Tag" } },
      { userId: 3, discord: null },
      { userId: 4, discord: null },
    ]);
  });

  it("ne transmet pas un tag non certifié à côté d'un identifiant", () => {
    const [recipient] = teamJoinNoticeRecipients([
      member({ discordId: "7", discordPseudo: "invérifié", discordVerified: false }),
    ]);
    expect(recipient).toEqual({ userId: 1, discord: { discordId: "7", handle: null, label: "Nova" } });
  });
});

describe("shouldNotifyTeamJoinRequest", () => {
  it("écrit pour la seule demande de la fenêtre", () => {
    expect(shouldNotifyTeamJoinRequest({ toThisTeam: 1, toAnyTeam: 1 })).toBe(true);
    // Une lecture qui ne verrait pas encore la ligne : prévenir plutôt que taire.
    expect(shouldNotifyTeamJoinRequest({ toThisTeam: 0, toAnyTeam: 0 })).toBe(true);
  });

  it("se tait sur une demande retirée puis redéposée dans la fenêtre", () => {
    expect(shouldNotifyTeamJoinRequest({ toThisTeam: 2, toAnyTeam: 2 })).toBe(false);
    expect(shouldNotifyTeamJoinRequest({ toThisTeam: 10, toAnyTeam: 10 })).toBe(false);
  });

  it("se tait au-delà du plafond du jour, toutes équipes confondues", () => {
    expect(
      shouldNotifyTeamJoinRequest({ toThisTeam: 1, toAnyTeam: TEAM_JOIN_REQUEST_NOTICES_DAILY_CAP }),
    ).toBe(true);
    expect(
      shouldNotifyTeamJoinRequest({ toThisTeam: 1, toAnyTeam: TEAM_JOIN_REQUEST_NOTICES_DAILY_CAP + 1 }),
    ).toBe(false);
  });

  it("borne la fenêtre à un jour", () => {
    expect(TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS).toBe(24);
  });
});

describe("formatTeamJoinRequestNotice", () => {
  it("nomme l'équipe et mène à sa fiche", () => {
    const text = formatTeamJoinRequestNotice({ teamName: "Les Glaciers", url: "https://site.test/equipes/5" });
    expect(text).toContain("« Les Glaciers »");
    expect(text).toContain("https://site.test/equipes/5");
    expect(text).toMatch(/demande à rejoindre/);
  });

  it("ne nomme aucun joueur", () => {
    const text = formatTeamJoinRequestNotice({ teamName: "X", url: "https://site.test/equipes/5" });
    expect(text).toContain("Un joueur");
  });
});
