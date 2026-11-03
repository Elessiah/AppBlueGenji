import { describe, expect, it } from "@jest/globals";
import {
  TEAM_INVITATIONS_PATH,
  TEAM_INVITE_NOTICES_DAILY_CAP,
  formatTeamInviteNotice,
  shouldNotifyTeamInvite,
  teamInviteNoticePath,
  teamInviteNoticeRecipient,
  withinTeamInviteNoticeBudget,
  type TeamInviteNoticeAccount,
  type TeamInviteNoticeKind,
  type TeamInviteNoticeTeam,
} from "@/lib/shared/team-invite-notice";
import { teamInvitationPush } from "@/lib/shared/push-messages";
import type { Locale } from "@/lib/shared/locales";
import type { PushContent } from "@/lib/shared/push-notifications";
import { PUSH_TOPICS, canReceivePushTopic, sanitizeDisabledTopics } from "@/lib/shared/push-notifications";
import frPush from "@/messages/fr/push.json";
import enPush from "@/messages/en/push.json";

/** TEAM-INVITE-NOTIFY : le joueur visé par une invitation, une reprise ou une propriété est prévenu. */

const ACTOR_ID = 1;

function account(overrides: Partial<TeamInviteNoticeAccount> = {}): TeamInviteNoticeAccount {
  return {
    userId: 42,
    pseudo: "Nova",
    discordId: "100000000000000042",
    discordPseudo: "nova",
    discordVerified: true,
    deleted: false,
    suspended: false,
    ...overrides,
  };
}

function team(overrides: Partial<TeamInviteNoticeTeam> = {}): TeamInviteNoticeTeam {
  return { name: "Les Glaciers", isGhost: false, soloUserId: null, deleted: false, ...overrides };
}

describe("shouldNotifyTeamInvite", () => {
  it("shouldNotifyTeamInvite_inviteOnRealTeam_returnsTrue", () => {
    expect(shouldNotifyTeamInvite({ kind: "INVITE", actorId: ACTOR_ID, account: account(), team: team() })).toBe(true);
  });

  it("shouldNotifyTeamInvite_recipientIsActor_returnsFalse", () => {
    expect(shouldNotifyTeamInvite({ kind: "GHOST_CLAIM", actorId: 42, account: account(), team: team({ isGhost: true }) })).toBe(false);
  });

  it("shouldNotifyTeamInvite_deletedAccount_returnsFalse", () => {
    expect(shouldNotifyTeamInvite({ kind: "INVITE", actorId: ACTOR_ID, account: account({ deleted: true }), team: team() })).toBe(false);
  });

  it("shouldNotifyTeamInvite_suspendedAccount_returnsFalse", () => {
    expect(shouldNotifyTeamInvite({ kind: "INVITE", actorId: ACTOR_ID, account: account({ suspended: true }), team: team() })).toBe(false);
  });

  it("shouldNotifyTeamInvite_soloEntry_returnsFalse", () => {
    expect(shouldNotifyTeamInvite({ kind: "OWNERSHIP", actorId: ACTOR_ID, account: account(), team: team({ soloUserId: 42 }) })).toBe(false);
  });

  it("shouldNotifyTeamInvite_deletedTeam_returnsFalse", () => {
    expect(shouldNotifyTeamInvite({ kind: "INVITE", actorId: ACTOR_ID, account: account(), team: team({ deleted: true }) })).toBe(false);
  });

  it("shouldNotifyTeamInvite_inviteOnGhostTeam_returnsFalse", () => {
    expect(shouldNotifyTeamInvite({ kind: "INVITE", actorId: ACTOR_ID, account: account(), team: team({ isGhost: true }) })).toBe(false);
  });

  it("shouldNotifyTeamInvite_ghostClaimOnGhost_returnsTrue", () => {
    expect(shouldNotifyTeamInvite({ kind: "GHOST_CLAIM", actorId: ACTOR_ID, account: account(), team: team({ isGhost: true }) })).toBe(true);
  });

  it("shouldNotifyTeamInvite_ghostClaimOnRealTeam_returnsFalse", () => {
    expect(shouldNotifyTeamInvite({ kind: "GHOST_CLAIM", actorId: ACTOR_ID, account: account(), team: team() })).toBe(false);
  });

  it("shouldNotifyTeamInvite_ownershipOnRealTeam_returnsTrue", () => {
    expect(shouldNotifyTeamInvite({ kind: "OWNERSHIP", actorId: ACTOR_ID, account: account(), team: team() })).toBe(true);
  });

  it("shouldNotifyTeamInvite_ownershipOnGhost_returnsFalse", () => {
    expect(shouldNotifyTeamInvite({ kind: "OWNERSHIP", actorId: ACTOR_ID, account: account(), team: team({ isGhost: true }) })).toBe(false);
  });
});

describe("withinTeamInviteNoticeBudget", () => {
  it("withinTeamInviteNoticeBudget_firstInviteAtCap_returnsTrue", () => {
    expect(withinTeamInviteNoticeBudget({ toThisPlayer: 1, toAnyPlayer: TEAM_INVITE_NOTICES_DAILY_CAP })).toBe(true);
  });

  it("withinTeamInviteNoticeBudget_reinviteWithinWindow_returnsFalse", () => {
    expect(withinTeamInviteNoticeBudget({ toThisPlayer: 2, toAnyPlayer: 1 })).toBe(false);
  });

  it("withinTeamInviteNoticeBudget_overCap_returnsFalse", () => {
    expect(withinTeamInviteNoticeBudget({ toThisPlayer: 1, toAnyPlayer: TEAM_INVITE_NOTICES_DAILY_CAP + 1 })).toBe(false);
  });
});

describe("teamInviteNoticeRecipient", () => {
  it("teamInviteNoticeRecipient_discordId_recipientWithDiscordIdOnly", () => {
    expect(teamInviteNoticeRecipient(account({ discordVerified: false }))).toEqual({
      userId: 42,
      discord: { discordId: "100000000000000042", handle: null, label: "Nova" },
    });
  });

  it("teamInviteNoticeRecipient_verifiedHandleOnly_usesHandle", () => {
    expect(teamInviteNoticeRecipient(account({ discordId: null }))).toEqual({
      userId: 42,
      discord: { discordId: null, handle: "nova", label: "Nova" },
    });
  });

  it("teamInviteNoticeRecipient_unverifiedHandleOnly_pushOnly", () => {
    expect(teamInviteNoticeRecipient(account({ discordId: null, discordVerified: false }))).toEqual({ userId: 42, discord: null });
  });
});

describe("teamInviteNoticePath", () => {
  it("teamInviteNoticePath_invite_profileInvitations", () => {
    expect(teamInviteNoticePath("INVITE", 7)).toBe(TEAM_INVITATIONS_PATH);
  });

  it("teamInviteNoticePath_ghostClaim_profileInvitations", () => {
    expect(teamInviteNoticePath("GHOST_CLAIM", 7)).toBe("/profil#invitations");
  });

  it("teamInviteNoticePath_ownership_teamPage", () => {
    expect(teamInviteNoticePath("OWNERSHIP", 7)).toBe("/equipes/7");
  });
});

type NoticeCase = { name: string; kind: TeamInviteNoticeKind; locale: Locale; url: string; expected: string };

const PROFILE_URL = "https://site.test/profil#invitations";
const TEAM_URL = "https://site.test/equipes/7";

const NOTICE_CASES: NoticeCase[] = [
  {
    name: "formatTeamInviteNotice_inviteFr_namesTeamOnly",
    kind: "INVITE",
    locale: "fr",
    url: PROFILE_URL,
    expected: "📨 BlueGenji — L'équipe « Les Glaciers » t'invite à la rejoindre. Accepte ou refuse depuis ton profil : https://site.test/profil#invitations",
  },
  {
    name: "formatTeamInviteNotice_ghostClaimFr_offersTakeover",
    kind: "GHOST_CLAIM",
    locale: "fr",
    url: PROFILE_URL,
    expected: "📨 BlueGenji — Le staff te propose de reprendre l'équipe « Les Glaciers » comme propriétaire. Accepte ou refuse depuis ton profil : https://site.test/profil#invitations",
  },
  {
    name: "formatTeamInviteNotice_ownershipFr_linksTeamPage",
    kind: "OWNERSHIP",
    locale: "fr",
    url: TEAM_URL,
    expected: "👑 BlueGenji — La propriété de ton équipe « Les Glaciers » vient de t'être transférée. Tu gères désormais son nom, son sigle et ses membres : https://site.test/equipes/7",
  },
  {
    name: "formatTeamInviteNotice_inviteEn_localizedUrl",
    kind: "INVITE",
    locale: "en",
    url: PROFILE_URL,
    expected: "📨 BlueGenji — The team “Les Glaciers” invites you to join it. Accept or decline from your profile: https://site.test/en/profil#invitations",
  },
  {
    name: "formatTeamInviteNotice_ghostClaimEn_offersTakeover",
    kind: "GHOST_CLAIM",
    locale: "en",
    url: PROFILE_URL,
    expected: "📨 BlueGenji — The staff offers you to take over the team “Les Glaciers” as its owner. Accept or decline from your profile: https://site.test/en/profil#invitations",
  },
  {
    name: "formatTeamInviteNotice_ownershipEn_localizedTeamPage",
    kind: "OWNERSHIP",
    locale: "en",
    url: TEAM_URL,
    expected: "👑 BlueGenji — Ownership of your team “Les Glaciers” has just been transferred to you. You now manage its name, tag and members: https://site.test/en/equipes/7",
  },
];

describe("formatTeamInviteNotice", () => {
  it.each(NOTICE_CASES)("$name", ({ kind, locale, url, expected }) => {
    expect(formatTeamInviteNotice({ kind, teamName: "Les Glaciers", url }, locale)).toBe(expected);
  });

  it("formatTeamInviteNotice_mentionInTeamName_neutralized", () => {
    const text = formatTeamInviteNotice({ kind: "INVITE", teamName: "@everyone <@123>", url: PROFILE_URL }, "fr");

    expect(text).not.toContain("@everyone");
    expect(text).not.toContain("<@123>");
  });
});

type PushCase = { name: string; kind: TeamInviteNoticeKind; locale: Locale; expected: PushContent };

const PUSH_CASES: PushCase[] = [
  {
    name: "teamInvitationPush_inviteFr_profileLinkAndInviteTag",
    kind: "INVITE",
    locale: "fr",
    expected: {
      title: "Invitation d'équipe",
      body: "Les Glaciers t'invite à la rejoindre. Accepte ou refuse depuis ton profil.",
      url: "/profil#invitations",
      tag: "team-7-invite",
    },
  },
  {
    name: "teamInvitationPush_ghostClaimEn_englishProfileLink",
    kind: "GHOST_CLAIM",
    locale: "en",
    expected: {
      title: "Team takeover offered",
      body: "The staff offers you to take over Les Glaciers as its owner. Accept or decline from your profile.",
      url: "/en/profil#invitations",
      tag: "team-7-invite",
    },
  },
  {
    name: "teamInvitationPush_ownershipFr_teamPageAndOwnerTag",
    kind: "OWNERSHIP",
    locale: "fr",
    expected: {
      title: "Tu es propriétaire de ton équipe",
      body: "La propriété de Les Glaciers vient de t'être transférée. Tu gères désormais son nom, son sigle et ses membres.",
      url: "/equipes/7",
      tag: "team-7-owner",
    },
  },
];

describe("teamInvitationPush", () => {
  it.each(PUSH_CASES)("$name", ({ kind, locale, expected }) => {
    expect(teamInvitationPush({ kind, teamId: 7, teamName: "Les Glaciers" }, locale)).toEqual(expected);
  });

  it("teamInvitationPush_bidiControlsInTeamName_stripped", () => {
    const { body } = teamInvitationPush({ kind: "INVITE", teamId: 7, teamName: "‮nimda​" }, "fr");

    expect(body).toBe("nimda t'invite à la rejoindre. Accepte ou refuse depuis ton profil.");
  });

  it("teamInvitationPush_ownershipEn_englishTeamPage", () => {
    expect(teamInvitationPush({ kind: "OWNERSHIP", teamId: 7, teamName: "Les Glaciers" }, "en").url).toBe("/en/equipes/7");
  });
});

describe("sujet TEAM_INVITATION", () => {
  it("pushTopics_teamInvitation_openToEveryPlayer", () => {
    expect(PUSH_TOPICS.TEAM_INVITATION.audience).toBeNull();
    expect(canReceivePushTopic({ roles: [] }, "TEAM_INVITATION")).toBe(true);
  });

  it("pushTopics_teamInvitation_canBeTurnedOff", () => {
    expect(sanitizeDisabledTopics(["TEAM_INVITATION"])).toEqual(["TEAM_INVITATION"]);
  });

  it("pushTopics_teamInvitation_labelledInFrenchAndEnglish", () => {
    expect(frPush.topics.TEAM_INVITATION.label).toBe("Invitations d'équipe");
    expect(enPush.topics.TEAM_INVITATION.label).toBe("Team invitations");
  });
});
