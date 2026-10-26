import { describe, expect, it } from "@jest/globals";
import {
  BILINGUAL_DM_SEPARATOR,
  DM_MAX_LENGTH,
  bilingualDm,
  localizedSiteUrl,
  renderDm,
  type LocalizedDm,
} from "@/lib/shared/dm-language";
import {
  MATCH_REMINDER_OFFSETS,
  buildMatchReminderMessage,
  buildMatchScheduleAnnouncement,
  buildMatchScheduleClearedNotice,
  buildMatchWithdrawnNotice,
  formatMatchStartIn,
  type MatchReminderContext,
} from "@/lib/shared/discord-notifications";
import { formatSuspensionLiftedNotice, formatSuspensionNotice } from "@/lib/shared/account-suspension";
import { formatTargetNotice } from "@/lib/shared/content-report-categories";
import { formatTeamJoinRequestNotice } from "@/lib/shared/team-join-request-notice";
import {
  formatAvatarHiddenNotice,
  formatAvatarRemovedNotice,
  formatAvatarRestoredNotice,
  formatLogoHiddenNotice,
  formatLogoRemovedNotice,
  formatLogoRestoredNotice,
} from "@/lib/shared/logo-quarantine";
import { discordInline } from "@/lib/shared/discord-text";
import enReports from "@/messages/en/reports.json";

/** BOT-NOTIF-LANG — chaque message privé du site, en français, en anglais et bilingue. */

const SITE = "https://bluegenji.test";
/** Un nom qui porte de la mise en forme Discord : il doit sortir neutralisé dans les deux langues. */
const TEAM = "Les **Loups** @everyone";

const context: MatchReminderContext = {
  tournamentName: "Coupe d'automne",
  tournamentUrl: `${SITE}/tournois/42`,
  matchDmSettingsUrl: `${SITE}/profil#notifications`,
  teamName: TEAM,
  opponentName: "Les Ours",
  roundLabel: "Tableau perdants · manche 2",
  roundLabelEn: "Lower bracket · round 2",
  startAt: "2026-10-30T18:00:00.000Z",
};

describe("bilingualDm / renderDm", () => {
  const dm: LocalizedDm = (locale) => (locale === "fr" ? "Bonjour" : "Hello");

  it("écrit dans la langue du compte quand elle est connue", () => {
    expect(renderDm(dm, "fr")).toBe("Bonjour");
    expect(renderDm(dm, "en")).toBe("Hello");
  });

  it("langue inconnue : un seul message, français d'abord, séparé de l'anglais", () => {
    expect(renderDm(dm, null)).toBe(`Bonjour${BILINGUAL_DM_SEPARATOR}Hello`);
    expect(bilingualDm(dm)).toBe(renderDm(dm, null));
    expect(BILINGUAL_DM_SEPARATOR).toBe("\n\n**— English —**\n");
  });

  it("trop long pour un message : le français part seul, entier, jamais un anglais coupé", () => {
    const long: LocalizedDm = (locale) => (locale === "fr" ? "f".repeat(1000) : "e".repeat(1000));
    expect(bilingualDm(long)).toBe("f".repeat(1000));
    const fits: LocalizedDm = (locale) => (locale === "fr" ? "f".repeat(800) : "e".repeat(800));
    expect(bilingualDm(fits).length).toBeLessThanOrEqual(DM_MAX_LENGTH);
    expect(bilingualDm(fits)).toContain(BILINGUAL_DM_SEPARATOR);
  });
});

describe("localizedSiteUrl", () => {
  it("préfixe /en sur une page traduite, ancre et requête gardées", () => {
    expect(localizedSiteUrl(`${SITE}/profil#notifications`, "en")).toBe(`${SITE}/en/profil#notifications`);
    expect(localizedSiteUrl(`${SITE}/tournois/42?tab=matchs`, "en")).toBe(`${SITE}/en/tournois/42?tab=matchs`);
  });

  it("laisse le français, l'absence d'adresse et un texte qui n'en est pas une", () => {
    expect(localizedSiteUrl(`${SITE}/profil`, "fr")).toBe(`${SITE}/profil`);
    expect(localizedSiteUrl(null, "en")).toBeNull();
    expect(localizedSiteUrl("pas une adresse", "en")).toBe("pas une adresse");
  });

  it("ne double pas un préfixe déjà présent", () => {
    expect(localizedSiteUrl(`${SITE}/en/profil`, "en")).toBe(`${SITE}/en/profil`);
  });
});

describe("messages privés de match", () => {
  const [day] = MATCH_REMINDER_OFFSETS;
  const builders: [string, (locale?: "fr" | "en") => string][] = [
    ["rappel", (locale) => buildMatchReminderMessage(day, context, locale)],
    ["annonce", (locale) => buildMatchScheduleAnnouncement(context, MATCH_REMINDER_OFFSETS, { rescheduled: true, previousStartAt: "2026-10-29T18:00:00.000Z" }, locale)],
    ["horaire retiré", (locale) => buildMatchScheduleClearedNotice(context, locale)],
    ["match retiré", (locale) => buildMatchWithdrawnNotice(context, locale)],
  ];

  it.each(builders)("« %s » : le français par défaut est inchangé", (_label, build) => {
    expect(build()).toBe(build("fr"));
    expect(build("fr")).toContain("(heure de Paris)");
    expect(build("fr")).toContain("Tableau perdants · manche 2");
  });

  it.each(builders)("« %s » : l'anglais dit la manche, l'heure de Paris et mène aux pages anglaises", (_label, build) => {
    const en = build("en");
    expect(en).toContain("(Paris time)");
    expect(en).toContain("Lower bracket · round 2");
    expect(en).toContain(`${SITE}/en/tournois/42`);
    expect(en.split("\n").at(-1)).toBe(
      `You can turn off these direct messages in your profile, Notifications section: <${SITE}/en/profil#notifications>`,
    );
    expect(en).not.toMatch(/heure de Paris|Tu peux|contre/);
  });

  it.each(builders)("« %s » : les noms restent neutralisés en anglais, aucun pseudo ajouté", (_label, build) => {
    const en = build("en");
    expect(en).toContain(discordInline(TEAM));
    expect(en).not.toContain("@everyone");
    const solo = (locale: "fr" | "en") =>
      buildMatchWithdrawnNotice({ ...context, solo: true, teamName: "Pseudo1", opponentName: "Pseudo2" }, locale);
    expect(solo("en")).toContain("**Your match**");
    expect(solo("en")).not.toMatch(/Pseudo1|Pseudo2/);
  });

  it("la date suit la langue, toujours à l'heure de Paris (24 h)", () => {
    expect(formatMatchStartIn(context.startAt, "fr")).toBe("vendredi 30 octobre à 19:00");
    expect(formatMatchStartIn(context.startAt, "en")).toMatch(/^Friday, October 30.*19:00$/);
  });

  it("sans manche anglaise, reprend le libellé reçu", () => {
    expect(buildMatchReminderMessage(day, { ...context, roundLabelEn: undefined }, "en")).toContain(
      "Tableau perdants · manche 2",
    );
  });

  it("un rappel et une annonce anglais disent le palier et le check-in en anglais", () => {
    const [, tenHours] = MATCH_REMINDER_OFFSETS;
    const reminder = buildMatchReminderMessage(tenHours, context, "en");
    expect(reminder).toContain("**Match reminder — in less than 10 hours**");
    expect(reminder).toContain("Check-in: the check-in channel opens 15 minutes before kickoff on Discord");
    const announcement = buildMatchScheduleAnnouncement(context, [tenHours], { rescheduled: false }, "en");
    expect(announcement).toContain("**Match scheduled**");
    expect(announcement).toContain("Next reminder: 10 hours before kickoff.");
  });
});

describe("messages privés de modération", () => {
  const termsUrl = `${SITE}/conditions-utilisation#comportement`;

  it("suspension : l'anglais garde les faits tels que saisis, la décision et le recours", () => {
    const input = { id: 7, reason: "Insultes répétées", ground: "BEHAVIOR" as const, endsAt: "2026-11-02T13:00:00.000Z", termsUrl };
    expect(formatSuspensionNotice(input)).toBe(formatSuspensionNotice(input, "fr"));
    const en = formatSuspensionNotice(input, "en");
    expect(en).toContain("suspended until November 2, 2026 at 14:00 (Paris time) (decision S-7)");
    expect(en).toContain("Facts found: Insultes répétées.");
    expect(en).toContain(`“Conduct” — ${SITE}/en/conditions-utilisation#comportement`);
    expect(en).toContain("competent court");
    expect(formatSuspensionNotice({ ...input, endsAt: null }, "en")).toContain("suspended indefinitely");
  });

  it("levée d'une suspension : en anglais aussi", () => {
    expect(formatSuspensionLiftedNotice(7, "en")).toBe(
      "✅ BlueGenji — The suspension of your account (decision S-7) has been lifted: you can log in to the site again.",
    );
    expect(formatSuspensionLiftedNotice(7)).toContain("a été levée");
  });

  it("signalement visé : libellé anglais de la catégorie, lien anglais, aucun nom", () => {
    const url = `${SITE}/signalements/12`;
    const en = formatTargetNotice({ category: "MODERATION", url, labelEn: enReports.categories.MODERATION.label }, "en");
    expect(en).toContain(`A report (${enReports.categories.MODERATION.label}) concerns you or your team.`);
    expect(en).toContain("no decision has been made");
    expect(formatTargetNotice({ category: "MODERATION", url })).toContain("Un signalement");
  });

  it("demande d'adhésion à une équipe : le nom d'équipe neutralisé, jamais le demandeur", () => {
    const en = formatTeamJoinRequestNotice({ teamName: TEAM, url: `${SITE}/equipes/les-loups` }, "en");
    expect(en).toContain(`A player is asking to join your team “${discordInline(TEAM)}”.`);
    // La fiche d'équipe n'est pas encore traduite : le lien reste celui de la page française.
    expect(en).toContain(`page: ${SITE}/equipes/les-loups`);
    expect(formatTeamJoinRequestNotice({ teamName: TEAM, url: `${SITE}/equipes/les-loups` })).toContain("Un joueur demande");
  });

  const purgeAfter = new Date("2027-04-26T10:00:00.000Z");
  const contentTerms = `${SITE}/conditions-utilisation#contenus`;
  const notices: [string, (locale?: "fr" | "en") => string, RegExp][] = [
    ["logo masqué", (l) => formatLogoHiddenNotice({ teamName: TEAM, purgeAfter, url: `${SITE}/signalements/3`, grounds: "SITE_RULES", termsUrl: contentTerms }, l), /permanently deleted on April 26, 2027/],
    ["logo supprimé", (l) => formatLogoRemovedNotice({ teamName: TEAM, url: null, grounds: "THIRD_PARTY_RIGHTS", termsUrl: contentTerms, staffReason: "Marque déposée" }, l), /Marque déposée \(a moderation finding/],
    ["logo rétabli", (l) => formatLogoRestoredNotice({ teamName: TEAM }, l), /has been restored: the appeal was accepted/],
    ["avatar masqué", (l) => formatAvatarHiddenNotice({ purgeAfter, url: `${SITE}/signalements/4`, grounds: "SITE_RULES", termsUrl: contentTerms }, l), /Your avatar has been hidden/],
    ["avatar supprimé", (l) => formatAvatarRemovedNotice({ url: `${SITE}/signalements/5`, grounds: "SITE_RULES", termsUrl: contentTerms }, l), /following a report/],
    ["avatar rétabli", (l) => formatAvatarRestoredNotice(l), /Your avatar has been restored/],
  ];

  it.each(notices)("« %s » : français inchangé par défaut, anglais complet", (_label, build, english) => {
    expect(build()).toBe(build("fr"));
    expect(build("fr")).toContain("BlueGenji —");
    const en = build("en");
    expect(en).toMatch(english);
    expect(en).not.toMatch(/ à la suite | a été | Recours/);
    expect(en).not.toContain("@everyone");
  });

  it("les décisions anglaises mènent aux conditions et au signalement en anglais", () => {
    const en = formatLogoHiddenNotice(
      { teamName: TEAM, purgeAfter, url: `${SITE}/signalements/3`, grounds: "SITE_RULES", termsUrl: contentTerms },
      "en",
    );
    expect(en).toContain(`${SITE}/en/conditions-utilisation#contenus`);
    expect(en).toContain(`appeal the decision here: ${SITE}/en/signalements/3`);
  });
});
