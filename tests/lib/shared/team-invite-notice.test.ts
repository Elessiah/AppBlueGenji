import { describe, expect, it } from "@jest/globals";
import {
  TEAM_INVITATIONS_PATH,
  TEAM_INVITE_NOTICES_DAILY_CAP,
  TEAM_INVITE_NOTICES_PER_PLAYER_CAP,
  formatTeamInviteNotice,
  shouldNotifyTeamInvite,
  teamInviteNoticePath,
  teamInviteNoticeRecipient,
  withinGhostClaimNoticeBudget,
  withinTeamInviteNoticeBudget,
  type GhostClaimNoticeBudget,
  type TeamInviteNoticeBudget,
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
  /** Toutes les bornes juste satisfaites : seul le champ surchargé les franchit. */
  function budget(overrides: Partial<TeamInviteNoticeBudget> = {}): TeamInviteNoticeBudget {
    return {
      toThisPlayer: 1,
      toAnyPlayer: TEAM_INVITE_NOTICES_DAILY_CAP,
      byActor: TEAM_INVITE_NOTICES_DAILY_CAP,
      teamsToThisPlayer: TEAM_INVITE_NOTICES_PER_PLAYER_CAP,
      ...overrides,
    };
  }

  it("withinTeamInviteNoticeBudget_allCountersAtCap_returnsTrue", () => {
    expect(withinTeamInviteNoticeBudget(budget())).toBe(true);
  });

  it("withinTeamInviteNoticeBudget_reinviteWithinWindow_returnsFalse", () => {
    expect(withinTeamInviteNoticeBudget(budget({ toThisPlayer: 2 }))).toBe(false);
  });

  it("withinTeamInviteNoticeBudget_teamOverCap_returnsFalse", () => {
    expect(withinTeamInviteNoticeBudget(budget({ toAnyPlayer: TEAM_INVITE_NOTICES_DAILY_CAP + 1 }))).toBe(false);
  });

  it("withinTeamInviteNoticeBudget_actorOverCap_returnsFalse", () => {
    expect(withinTeamInviteNoticeBudget(budget({ byActor: TEAM_INVITE_NOTICES_DAILY_CAP + 1 }))).toBe(false);
  });

  it("withinTeamInviteNoticeBudget_playerOverTeamCap_returnsFalse", () => {
    expect(withinTeamInviteNoticeBudget(budget({ teamsToThisPlayer: TEAM_INVITE_NOTICES_PER_PLAYER_CAP + 1 }))).toBe(false);
  });
});

describe("withinGhostClaimNoticeBudget", () => {
  const ghostBudget = (over: Partial<GhostClaimNoticeBudget> = {}): GhostClaimNoticeBudget => ({
    toThisPlayer: 1,
    byActor: 1,
    teamsToThisPlayer: 1,
    ...over,
  });

  it("withinGhostClaimNoticeBudget_firstOffer_returnsTrue", () => {
    expect(withinGhostClaimNoticeBudget(ghostBudget())).toBe(true);
  });

  it("withinGhostClaimNoticeBudget_reOfferWithinWindow_returnsFalse", () => {
    expect(withinGhostClaimNoticeBudget(ghostBudget({ toThisPlayer: 2 }))).toBe(false);
  });

  it("withinGhostClaimNoticeBudget_actorAtDailyCap_returnsTrue", () => {
    expect(withinGhostClaimNoticeBudget(ghostBudget({ byActor: TEAM_INVITE_NOTICES_DAILY_CAP }))).toBe(true);
  });

  it("withinGhostClaimNoticeBudget_actorOverDailyCap_returnsFalse", () => {
    expect(withinGhostClaimNoticeBudget(ghostBudget({ byActor: TEAM_INVITE_NOTICES_DAILY_CAP + 1 }))).toBe(false);
  });

  it("withinGhostClaimNoticeBudget_playerAtTeamsCap_returnsTrue", () => {
    expect(withinGhostClaimNoticeBudget(ghostBudget({ teamsToThisPlayer: TEAM_INVITE_NOTICES_PER_PLAYER_CAP }))).toBe(true);
  });

  it("withinGhostClaimNoticeBudget_playerOverTeamsCap_returnsFalse", () => {
    expect(
      withinGhostClaimNoticeBudget(ghostBudget({ teamsToThisPlayer: TEAM_INVITE_NOTICES_PER_PLAYER_CAP + 1 })),
    ).toBe(false);
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
    expected: "📨 BlueGenji — Tu peux reprendre l'équipe [Les Glaciers](https://site.test/profil#invitations). Accepte ou refuse depuis ton profil.",
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
    expected: "📨 BlueGenji — You can take over the team [Les Glaciers](https://site.test/en/profil#invitations). Accept or decline from your profile.",
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

  it.each(["fr", "en"] as Locale[])("formatTeamInviteNotice_ghostClaim_%s_bracketsCannotCloseTheLink", (locale) => {
    const text = formatTeamInviteNotice({ kind: "GHOST_CLAIM", teamName: "x](https://evil.test) [y", url: PROFILE_URL }, locale);
    // Crochets et parenthèses du nom échappés : un seul lien actif, vers le profil.
    expect(text).toContain(String.raw`x\]`);
    expect(text).toContain(String.raw`\[y`);
    const activeLinks = text.split("](").filter((before, index, all) => index < all.length - 1 && !before.endsWith("\\"));
    expect(activeLinks).toHaveLength(1);
    expect(text).toContain(`](${locale === "en" ? "https://site.test/en/profil#invitations" : PROFILE_URL}).`);
  });

  it.each(["fr", "en"] as Locale[])("formatTeamInviteNotice_ghostClaim_%s_namesNoPerson", (locale) => {
    const text = formatTeamInviteNotice({ kind: "GHOST_CLAIM", teamName: "Les Glaciers", url: PROFILE_URL }, locale);
    // Décision D4 : le nom de l'équipe seul, ni « un admin » ni personne.
    expect(text).toMatch(locale === "fr" ? /^📨 BlueGenji — Tu peux reprendre l'équipe \[Les Glaciers\]/ : /^📨 BlueGenji — You can take over the team \[Les Glaciers\]/);
    expect(text).not.toMatch(/admin/i);
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
      body: "L'équipe «\u00a0Les Glaciers\u00a0» t'invite à la rejoindre. Accepte ou refuse depuis ton profil.",
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
      body: "You can take over the team “Les Glaciers”. Accept or decline from your profile.",
      url: "/en/profil#invitations",
      tag: "team-7-ghost",
    },
  },
  {
    name: "teamInvitationPush_ownershipFr_teamPageAndOwnerTag",
    kind: "OWNERSHIP",
    locale: "fr",
    expected: {
      title: "Tu es propriétaire de ton équipe",
      body: "La propriété de ton équipe «\u00a0Les Glaciers\u00a0» vient de t'être transférée. Tu gères désormais son nom, son sigle et ses membres.",
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
    const { body } = teamInvitationPush({ kind: "INVITE", teamId: 7, teamName: "\u202Enimda\u200B" }, "fr");

    expect(body).toBe("L'équipe «\u00a0nimda\u00a0» t'invite à la rejoindre. Accepte ou refuse depuis ton profil.");
  });

  it("teamInvitationPush_compatibilityCharsInTeamName_normalizedLikeTheDirectMessage", () => {
    // ERREUR.txt (revue sécurité #544) : NFKC et espaces resserrés, comme `discordInline`.
    const { body } = teamInvitationPush({ kind: "INVITE", teamId: 7, teamName: "  Ｌｅｓ   Glaciers " }, "fr");

    expect(body).toBe("L'équipe «\u00a0Les Glaciers\u00a0» t'invite à la rejoindre. Accepte ou refuse depuis ton profil.");
  });

  it("teamInvitationPush_quoteMarksInTeamName_cannotCloseTheQuotation", () => {
    const { body } = teamInvitationPush({ kind: "OWNERSHIP", teamId: 7, teamName: "A » B" }, "fr");

    expect(body).toContain('«\u00a0A " B\u00a0»');
  });

  it("teamInvitationPush_inviteThenGhostClaimSameTeam_distinctTags", () => {
    // ERREUR.txt (revue UI/UX #544) : une reprise ne remplace pas l'invitation affichée.
    const invite = teamInvitationPush({ kind: "INVITE", teamId: 7, teamName: "Les Glaciers" }, "fr");
    const ghost = teamInvitationPush({ kind: "GHOST_CLAIM", teamId: 7, teamName: "Les Glaciers" }, "fr");

    expect(invite.tag).not.toBe(ghost.tag);
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
    // Distinct du titre de la section « Invitations d'équipe » de Mon profil.
    expect(frPush.topics.TEAM_INVITATION.label).toBe("Invitations et propriété d'équipe");
    expect(enPush.topics.TEAM_INVITATION.label).toBe("Team invitations and ownership");
    expect(PUSH_TOPICS.TEAM_INVITATION.label).toBe(frPush.topics.TEAM_INVITATION.label);
  });

  it("pushTopics_teamInvitation_saysTheDirectMessageStillGoes", () => {
    // Seulement s'il peut partir (compte Discord rattaché ou tag certifié, plafonds) : jamais promis sans condition.
    expect(frPush.topics.TEAM_INVITATION.description).toContain("le message privé Discord, s'il peut t'être envoyé, part quand même");
    expect(enPush.topics.TEAM_INVITATION.description).toContain("the Discord direct message, when one can be sent to you, still goes out");
  });
});
