import { describe, expect, it } from "@jest/globals";
import {
  TEAM_JOIN_REQUEST_NOTICE_COOLDOWN_HOURS,
  formatTeamJoinRequestNotice,
  shouldNotifyTeamJoinRequest,
  teamJoinNoticeRecipients,
  type TeamJoinNoticeMember,
} from "@/lib/shared/team-join-request-notice";

function member(overrides: Partial<TeamJoinNoticeMember> = {}): TeamJoinNoticeMember {
  return {
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
      member({ pseudo: "Owner", roles: ["OWNER", "DPS"] }),
      member({ pseudo: "Manager", roles: ["MANAGER"] }),
    ]);
    expect(recipients.map((r) => r.label)).toEqual(["Owner", "Manager"]);
  });

  it("ne prévient ni les rôles sportifs ni le capitaine", () => {
    const recipients = teamJoinNoticeRecipients([
      member({ roles: ["CAPITAINE"] }),
      member({ roles: ["TANK", "DPS", "HEAL", "COACH"] }),
      member({ roles: [] }),
    ]);
    expect(recipients).toEqual([]);
  });

  it("n'écrit qu'à un moyen prouvé : identifiant, ou tag certifié", () => {
    const recipients = teamJoinNoticeRecipients([
      member({ pseudo: "Id", discordId: "1", discordPseudo: null, discordVerified: false }),
      member({ pseudo: "Tag", discordId: null, discordPseudo: "tag", discordVerified: true }),
      member({ pseudo: "Saisi", discordId: null, discordPseudo: "quelquun", discordVerified: false }),
      member({ pseudo: "Rien", discordId: null, discordPseudo: null, discordVerified: false }),
    ]);
    expect(recipients).toEqual([
      { discordId: "1", handle: null, label: "Id" },
      { discordId: null, handle: "tag", label: "Tag" },
    ]);
  });

  it("ne transmet pas un tag non certifié à côté d'un identifiant", () => {
    const [recipient] = teamJoinNoticeRecipients([
      member({ discordId: "7", discordPseudo: "invérifié", discordVerified: false }),
    ]);
    expect(recipient).toEqual({ discordId: "7", handle: null, label: "Nova" });
  });
});

describe("shouldNotifyTeamJoinRequest", () => {
  it("écrit pour la seule demande de la fenêtre", () => {
    expect(shouldNotifyTeamJoinRequest(1)).toBe(true);
    // Une lecture qui ne verrait pas encore la ligne : prévenir plutôt que taire.
    expect(shouldNotifyTeamJoinRequest(0)).toBe(true);
  });

  it("se tait sur une demande retirée puis redéposée dans la fenêtre", () => {
    expect(shouldNotifyTeamJoinRequest(2)).toBe(false);
    expect(shouldNotifyTeamJoinRequest(10)).toBe(false);
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
