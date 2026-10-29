/**
 * EF-12 (ERREUR.txt) : correctifs de « i », de navigation et d'accessibilité
 * transverse — leur câblage et leurs textes, lus dans les sources.
 */
import { describe, expect, it } from "@jest/globals";
import { refusalNeedsServerInvite } from "@/app/connexion/_lib/login-errors";
import frLogin from "@/messages/fr/login.json";
import enLogin from "@/messages/en/login.json";
import frReports from "@/messages/fr/reports.json";
import enReports from "@/messages/en/reports.json";
import { readSource } from "../helpers/read-source";

describe("refusalNeedsServerInvite", () => {
  it.each(["DISCORD_USER_NOT_FOUND", "DISCORD_DM_FAILED"])("%s affiche le lien d'invitation", (code) => {
    expect(refusalNeedsServerInvite(code)).toBe(true);
  });

  it.each(["INVALID_CODE", "TOO_MANY_CODE_REQUESTS", "", null, undefined])("%p ne l'affiche pas", (code) => {
    expect(refusalNeedsServerInvite(code)).toBe(false);
  });

  it("la phrase existe en français et en anglais, avec son lien", () => {
    expect(frLogin.page.inviteAfterRefusal).toContain("<join>");
    expect(enLogin.page.inviteAfterRefusal).toContain("<join>");
    expect(readSource("app/connexion/_components/LoginForm.tsx")).toContain("inviteAfterRefusal &&");
  });
});

describe("page d'un signalement : panne passagère", () => {
  const page = readSource("app/(secured)/signalements/[id]/page.tsx");

  it("distingue l'échec réseau / 5xx du « introuvable » et propose de réessayer", () => {
    expect(page).toContain("concernedReportLoadFailure(response.status)");
    expect(page).toContain("concernedReportLoadFailure(null)");
    expect(page).toContain('t("concerned.retry")');
  });

  it("porte les trois textes en français et en anglais", () => {
    for (const reports of [frReports, enReports]) {
      expect(reports.concerned.errorTitle).not.toBe("");
      expect(reports.concerned.errorBody).not.toBe("");
      expect(reports.concerned.retry).not.toBe("");
    }
  });
});

describe("boutons en attente : aria-disabled, pas disabled", () => {
  it.each([
    "components/reports/ReportProblemDialog.tsx",
    "components/notifications/PushNotificationsPanel.tsx",
    "app/(secured)/profil/OtherSessionsPanel.tsx",
    "components/account-menu.tsx",
  ])("%s ne pose plus `disabled` sur un bouton lié à une requête", (file) => {
    const source = readSource(file);
    expect(source).not.toMatch(/(?<!aria-)disabled=\{(busy|push\.busy|leaving)/);
    expect(source).toContain("aria-disabled=");
  });

  it("le profil (avatar, suppression du compte) garde le focus et garde le clic", () => {
    const profile = readSource("app/(secured)/profil/page.tsx");
    expect(profile).not.toMatch(/(?<!aria-)disabled=\{(avatarBusy|accountDeletion\.deleting)\}/);
    expect(profile).toContain("!avatarBusy && fileInputRef.current?.click()");
    expect(profile).toContain("!accountDeletion.deleting && void accountDeletion.start()");
  });

  it("le menu du compte éteint l'entrée occupée par ses couleurs", () => {
    expect(readSource("components/account-menu.module.css")).toMatch(/\.logout\[aria-disabled="true"\] \{\s*cursor: progress;/);
  });
});

describe("mises en page", () => {
  it("sujets push : alignés en haut, écart de 16 px", () => {
    const css = readSource("components/notifications/PushNotificationsPanel.module.css");
    expect(css).toMatch(/\.topic \{[^}]*align-items: flex-start;[^}]*column-gap: 16px;/);
  });

  it("applications connectées : deux colonnes sur ordinateur", () => {
    expect(readSource("app/(secured)/profil/profil.module.css")).toMatch(
      /@media \(min-width: 921px\) \{\s*\.connectionRow \{\s*grid-template-columns: minmax\(0, 1fr\) auto;/,
    );
    expect(readSource("app/(secured)/profil/ConnectedAppsSection.tsx")).toContain("s.connectionRow");
  });

  it("annuaire des joueurs et barre de navigation suivent la colonne élargie", () => {
    expect(readSource("app/(secured)/joueurs/PlayersList.tsx")).toContain('className="page-wide"');
    expect(readSource("app/globals.css")).toMatch(/body:has\(\.page-wide\) \[data-sticky-header\] \.container \{/);
  });

  it("phrases avec « i » en ligne : /connexion et fiche joueur", () => {
    expect(readSource("app/connexion/_components/OAuthButtons.tsx")).toContain("<InfoHintRow inline>");
    expect(readSource("app/connexion/_components/LoginForm.tsx")).toContain("<InfoHintRow inline>");
    expect(readSource("app/(secured)/joueurs/[id]/page.tsx")).toContain("<InfoHintRow inline>");
  });

  it("cases enregistrées au changement : rangée séparée", () => {
    expect(readSource("app/(secured)/profil/_components/MatchDmField.tsx")).toContain("<InfoHintRow separated>");
    expect(readSource("app/(secured)/profil/_components/RecruitmentModalField.tsx")).toContain("<InfoHintRow separated>");
  });

  it("explication du format : majuscule initiale à l'affichage", () => {
    expect(readSource("app/(secured)/tournois/[id]/_components/TournamentHeader.tsx")).toContain(
      "capitalizeFirst(item.hint, locale)",
    );
  });
});
