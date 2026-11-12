import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { ModerationPlayerLink } from "@/app/(secured)/admin/signalements/_components/ModerationPlayerLink";
import { ProfilelessPlayersProvider } from "@/components/profileless-players";
import { PlayerLink } from "@/components/entity-link";
import { ReportTargetCard } from "@/app/(secured)/admin/signalements/_components/ReportTargetCard";
import type { ReportTargetView } from "@/lib/shared/content-reports";

/** Revue #539 : un lien de modération vers un compte sans fiche menait à une page introuvable. */
describe("ModerationPlayerLink", () => {
  it("ModerationPlayerLink_accountWithPage_linksToItInNewTab", () => {
    const html = renderToStaticMarkup(<ModerationPlayerLink userId={7} pseudo="Test_Joueur" />);

    expect(html).toContain('href="/joueurs/7"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('<span class="sr-only"> (nouvel onglet)</span>');
    expect(html).toContain("Test_Joueur");
  });

  it("ModerationPlayerLink_profilelessDeletedAccount_rendersPlainNameWithoutLink", () => {
    const html = renderToStaticMarkup(
      <ProfilelessPlayersProvider ids={[7]}>
        <ModerationPlayerLink userId={7} pseudo="compte_supprime_7" />
      </ProfilelessPlayersProvider>,
    );

    expect(html).not.toContain("href=");
    expect(html).toContain("compte_supprime_7");
  });
});

describe("PlayerLink — nouvel onglet", () => {
  it("playerLink_newTabLabel_opensNewTabWithSrOnlyText", () => {
    const html = renderToStaticMarkup(
      <PlayerLink userId={7} newTabLabel="(new tab)">
        Test_Joueur
      </PlayerLink>,
    );

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain('<span class="sr-only"> (new tab)</span>');
  });

  it("playerLink_noNewTabLabel_noTargetBlank", () => {
    const html = renderToStaticMarkup(<PlayerLink userId={7}>Test_Joueur</PlayerLink>);

    expect(html).not.toContain("target=");
    expect(html).not.toContain("sr-only");
  });
});

describe("ReportTargetCard — cible joueur", () => {
  const noop = () => undefined;
  const card = (target: ReportTargetView) => (
    <ReportTargetCard
      target={target}
      category="OTHER"
      quarantines={[]}
      busy={false}
      onHideLogo={noop}
      onDeleteLogo={noop}
      onRestore={noop}
      onPurge={noop}
      onContestOutcome={noop}
    />
  );
  const player: ReportTargetView = { type: "USER", id: 7, label: "compte_supprime_7", exists: true, imageUrl: null, detail: null };

  it("ReportTargetCard_deletedPlayer_rendersNameWithDeletedMarkWithoutLink", () => {
    // Un compte supprimé, avec ou sans fiche (D13), n'est plus une option vivante : `exists` vaut `false`.
    const deleted: ReportTargetView = { ...player, exists: false };

    const html = renderToStaticMarkup(<ProfilelessPlayersProvider ids={[7]}>{card(deleted)}</ProfilelessPlayersProvider>);

    expect(html).not.toContain('href="/joueurs/7"');
    expect(html).toContain("compte_supprime_7 — supprimé");
  });

  it("ReportTargetCard_playerWithPage_linksToIt", () => {
    expect(renderToStaticMarkup(card(player))).toContain('href="/joueurs/7"');
  });

  it("ReportTargetCard_teamWithSameIdAsProfilelessPlayer_stillLinked", () => {
    const team: ReportTargetView = { ...player, type: "TEAM", label: "Test_Equipe" };

    const html = renderToStaticMarkup(<ProfilelessPlayersProvider ids={[7]}>{card(team)}</ProfilelessPlayersProvider>);

    expect(html).toContain('href="/equipes/7"');
  });
});
