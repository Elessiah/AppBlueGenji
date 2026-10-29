/**
 * Lot « textes explicatifs » des pages de compte (`docs/features/INFO_HINTS.md`) :
 * `/connexion`, `/profil` et `/joueurs/[id]` gardent une ligne visible courte
 * pour l'essentiel et passent le détail derrière le bouton « i », que le champ
 * cite toujours dans son `aria-describedby`.
 */
import { describe, expect, it } from "@jest/globals";
import frProfile from "@/messages/fr/profile.json";
import enProfile from "@/messages/en/profile.json";
import frLogin from "@/messages/fr/login.json";
import enLogin from "@/messages/en/login.json";
import frPlayers from "@/messages/fr/players.json";
import enPlayers from "@/messages/en/players.json";
import frPush from "@/messages/fr/push.json";
import enPush from "@/messages/en/push.json";
import { readSource } from "../helpers/read-source";

/** Ce qui reste affiché en permanence, dans chaque langue. */
function visibleLines(profile: typeof frProfile, login: typeof frLogin, players: typeof frPlayers, push: typeof frPush): Record<string, string> {
  return {
    "identity.pseudoHint": profile.identity.pseudoHint,
    "games.gameTagNotice": profile.games.gameTagNotice,
    ...Object.fromEntries(
      (["pending", "unknown", "tagged"] as const).map((key) => [`battletagLock.${key}`, profile.battletagLock[key]]),
    ),
    ...Object.fromEntries(
      (["pending", "unknown", "noTag", "unverified", "verified"] as const).map((key) => [`discord.lock.${key}`, profile.discord.lock[key]]),
    ),
    "discord.unverifiedHint": profile.discord.unverifiedHint,
    "privacy.discordPending": profile.privacy.discordPending,
    "privacy.discordNoTag": profile.privacy.discordNoTag,
    "connections.intro": profile.connections.intro,
    "connections.notes.BLIZZARD": profile.connections.notes.BLIZZARD,
    "connections.bot.linkedByButton": profile.connections.bot.linkedByButton,
    "connections.bot.linkedElsewhere": profile.connections.bot.linkedElsewhere,
    "connections.bot.notLinked": profile.connections.bot.notLinked,
    "matchDms.notCertified": profile.matchDms.notCertified,
    "sections.notifications.lead": profile.sections.notifications.lead,
    "oauth.discordNote": login.oauth.discordNote,
    "oauth.blizzardNote": login.oauth.blizzardNote,
    "page.tagNotice": login.page.tagNotice.replace(/<\/?strong>/g, ""),
    "players.page.battletagHiddenSelf": players.page.battletagHiddenSelf,
    "push.panel.discordHint": push.panel.discordHint,
  };
}

describe("lignes visibles : courtes, en français comme en anglais", () => {
  it.each([
    ["fr", visibleLines(frProfile, frLogin, frPlayers, frPush)],
    ["en", visibleLines(enProfile, enLogin, enPlayers, enPush)],
  ])("%s : aucune ligne permanente au-delà de 140 caractères", (_locale: string, lines: Record<string, string>) => {
    for (const [key, line] of Object.entries(lines)) {
      expect(`${key}: ${line.length}`).toBe(`${key}: ${Math.min(line.length, 140)}`);
    }
  });

  it("n'a plus de paragraphe « qui le voit » recopié : chaque espace porte la même liste", () => {
    expect(frLogin.audience.discord).toEqual(frProfile.audience.discord);
    expect(enLogin.audience.discord).toEqual(enProfile.audience.discord);
    expect(frLogin.audience.battletag).toEqual(frProfile.audience.battletag);
    expect(frPlayers.audience.battletag).toEqual(frProfile.audience.battletag);
    expect(enPlayers.audience.battletag).toEqual(enProfile.audience.battletag);
    for (const messages of [frProfile, enProfile]) {
      expect(messages.games).not.toHaveProperty("hiddenWarning");
      expect(messages.discord).not.toHaveProperty("audience");
    }
    for (const messages of [frLogin, enLogin]) expect(messages.oauth).not.toHaveProperty("tagAudience");
  });
});

describe("le détail derrière le « i », toujours cité par son champ", () => {
  it("/profil : BattleTag, tag Discord, visibilité, recrutement", () => {
    const page = readSource("app/(secured)/profil/page.tsx");
    expect(page).toContain('<InfoHint id="profile-battletag-more" subject={t("games.battletag")}>');
    expect(page).toContain('fieldErrors.aria("battletag", "profile-battletag-hint", "profile-battletag-more")');
    expect(page).toContain('<InfoHint id="profile-discord-more" subject={text.t("discord.label")}>');
    expect(page).toContain('fieldErrors.aria("discord", "profile-discord-hint", discordHasMore && "profile-discord-more")');
    expect(page).toContain('<InfoHint id="profile-visibility-more" subject={t("privacy.visibleTitle")}>');
    expect(page).toContain('<InfoHint id="profile-recruitment-more" subject={t("privacy.recruitmentTitle")}>');
    // L'avertissement d'un tag non certifié reste visible : c'est l'état du joueur.
    expect(page).toContain("{discordWarning ? <p className={s.hint}>{discordWarning}</p> : null}");
  });

  it("/profil : cases et champ des notifications", () => {
    for (const file of ["MatchDmField", "RecruitmentModalField", "AccountLocaleField"]) {
      expect(readSource(`app/(secured)/profil/_components/${file}.tsx`)).toMatch(/<InfoHint id=\{HINT_ID\} subject=\{t\("[a-zA-Z.]+"\)\}>/);
    }
    const panel = readSource("components/notifications/PushNotificationsPanel.tsx");
    expect(panel).toContain("<InfoHint id={`${id}-desc`} subject={pushTopicLabel(text, topic)}>");
    expect(panel).toContain("aria-describedby={`${id}-desc`}");
  });

  it("/profil : ligne Blizzard des applications connectées", () => {
    const apps = readSource("app/(secured)/profil/ConnectedAppsSection.tsx");
    expect(apps).toContain('if (provider !== "BLIZZARD") return null;');
    expect(apps).toContain("<ProviderHint provider={connection.provider} />");
    expect(apps).toContain("<InfoHint id={`connection-more-${OAUTH_PROVIDER_SLUGS[provider]}`} subject={OAUTH_PROVIDER_LABELS[provider]}>");
  });

  it("/connexion : notes des portes, aide du code, annonce du tag", () => {
    const buttons = readSource("app/connexion/_components/OAuthButtons.tsx");
    expect(buttons).toContain("note ? moreId : null");
    expect(buttons).toContain("<InfoHint id={moreId} subject={OAUTH_PROVIDER_LABELS[provider]}>");
    const form = readSource("app/connexion/_components/LoginForm.tsx");
    expect(form).toContain('<InfoHint id="login-discord-handle-help" subject={t("page.handleLabel")}>');
    expect(form).toContain('fieldErrors.aria("handle", "login-discord-handle-help")');
  });

  it("/joueurs/[id] : BattleTag masqué du titulaire", () => {
    const page = readSource("app/(secured)/joueurs/[id]/page.tsx");
    expect(page).toContain('<InfoHint id="player-battletag-more" subject={t("page.battletag")}>');
    expect(page).toContain('"player-battletag-more": Boolean(battletagHint),');
  });
});
