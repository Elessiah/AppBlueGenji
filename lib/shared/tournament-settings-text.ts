/**
 * Réglages d'un tournoi (`?tournoi=<id>` des pages de règles) dans la langue de
 * la page — lot 8a-2, reporté du lot 3.
 *
 * Le français reste celui de `tournament-settings.ts` (`tournamentSettingsGroups`,
 * inchangé, cité par ses tests) ; une autre langue est rédigée ici depuis
 * `tournament.settings` et `labels`, par les mêmes règles. Un test vérifie que
 * le français des messages, passé par cette fonction, égale l'original.
 */
import { matchAllowsDraw, matchFormatNotation, matchMaxMaps, naturalMaxMaps, withoutDraws, type MatchFormat } from "./match-format";
import type { Locale } from "./locales";
import { scopedText, type ScopedText, type Leaves } from "./scoped-text";
import { localizedTournamentLabel } from "./tournament-labels";
import {
  tournamentSettingsGroups,
  type TournamentSetting,
  type TournamentSettingsGroup,
  type TournamentSettingsInput,
} from "./tournament-settings";
import type { TournamentPhase } from "./types";
import type { Messages } from "./i18n-messages";

type SettingsMessages = Pick<Messages["tournament"], "settings" | "matchFormat">;
type SettingsText = ScopedText<Leaves<SettingsMessages>>;
type LabelMessages = Messages["labels"];

function matchFormatSetting(text: SettingsText, format: MatchFormat | null): string {
  let label: string;
  if (format) {
    const base = matchFormatNotation(format);
    const maps = matchMaxMaps(format);
    label = maps === naturalMaxMaps(format) ? base : text.t("matchFormat.withMaps", { base, maps });
  } else {
    label = text.t("matchFormat.free");
  }
  return matchAllowsDraw(format) ? text.t("settings.drawAllowed", { label }) : label;
}

function survivalCadence(text: SettingsText, beforeFirstCut: number | null, perCut: number | null): TournamentSetting[] {
  const settings: TournamentSetting[] = [];
  if (beforeFirstCut !== null) settings.push({ label: text.t("settings.mode.roundsBeforeFirstCut"), value: String(beforeFirstCut) });
  if (perCut !== null) settings.push({ label: text.t("settings.mode.roundsPerCut"), value: String(perCut) });
  return settings;
}

function phaseDetails(text: SettingsText, phase: TournamentPhase): string[] {
  const details: string[] = [];
  if (phase.format === "SWISS" && phase.swissTotalRounds) {
    details.push(text.t("settings.mode.phaseSwissRounds", { count: phase.swissTotalRounds }));
  }
  if (phase.format === "SURVIVAL") {
    if (phase.survivalRoundsBeforeFirstCut !== null) {
      details.push(text.t("settings.mode.phaseFirstCut", { count: phase.survivalRoundsBeforeFirstCut }));
    }
    if (phase.survivalRoundsPerCut !== null) {
      details.push(
        phase.survivalRoundsPerCut === 1
          ? text.t("settings.mode.phaseEveryRound")
          : text.t("settings.mode.phaseEveryN", { count: String(phase.survivalRoundsPerCut) }),
      );
    }
  }
  if (phase.format === "SINGLE" && phase.hasThirdPlaceMatch) details.push(text.t("settings.mode.phaseThirdPlace"));
  return details;
}

function phaseQualification(text: SettingsText, phase: TournamentPhase, isLast: boolean): string {
  if (isLast) return text.t("settings.mode.phaseChampion");
  return phase.qualifierMode === "PERCENT"
    ? text.t("settings.mode.phasePercent", { value: String(phase.qualifierValue) })
    : text.t("settings.mode.phaseCount", { count: phase.qualifierValue });
}

function modeSettings(text: SettingsText, labels: LabelMessages, input: TournamentSettingsInput): TournamentSetting[] {
  const { card } = input;
  const yesNo = (value: boolean) => (value ? text.t("settings.yes") : text.t("settings.no"));
  switch (card.format) {
    case "SINGLE":
      return [{ label: text.t("settings.mode.thirdPlace"), value: yesNo(card.hasThirdPlaceMatch) }];
    case "DOUBLE":
      return [];
    case "SURVIVAL":
      return survivalCadence(text, card.survivalRoundsBeforeFirstCut, card.survivalRoundsPerCut);
    case "SWISS": {
      if (!input.swiss) return [];
      const { totalRounds, pointsForWin, pointsForDraw, pointsForLoss, pointsForBye } = input.swiss;
      return [
        {
          label: text.t("settings.mode.swissRounds"),
          value: totalRounds > 0 ? String(totalRounds) : text.t("settings.mode.swissRoundsAtLaunch"),
        },
        {
          label: text.t("settings.mode.scoring"),
          value: text.t("settings.mode.swissScoring", {
            win: String(pointsForWin),
            draw: String(pointsForDraw),
            loss: String(pointsForLoss),
            bye: String(pointsForBye),
          }),
        },
      ];
    }
    case "BG_SURVIE": {
      const settings: TournamentSetting[] = [];
      if (input.endurance) {
        const { startPoints, winDelta, lossDelta, playoffSize, maxRounds } = input.endurance;
        settings.push(
          { label: text.t("settings.mode.startPoints"), value: text.t("settings.mode.startPointsValue", { count: startPoints }) },
          { label: text.t("settings.mode.scoring"), value: text.t("settings.mode.enduranceScoring", { win: String(winDelta), loss: String(lossDelta) }) },
          { label: text.t("settings.mode.playoffSize"), value: String(playoffSize) },
          { label: text.t("settings.mode.maxRounds"), value: maxRounds === null ? text.t("settings.none") : String(maxRounds) },
        );
      }
      settings.push({
        label: text.t("settings.mode.playoffFormat"),
        value: matchFormatSetting(text, card.endurancePlayoffFormat ?? withoutDraws(card.matchFormat)),
      });
      return settings;
    }
    case "MULTI": {
      const phases = [...(input.phases ?? [])].sort((a, b) => a.position - b.position);
      return phases.map((phase, index) => {
        const isLast = index === phases.length - 1;
        const position = String(phase.position);
        const parts = [
          localizedTournamentLabel(labels, "format", phase.format),
          ...phaseDetails(text, phase),
          phaseQualification(text, phase, isLast),
        ];
        const label = phase.name
          ? text.t("settings.mode.phaseNamed", { position, name: phase.name })
          : text.t("settings.mode.phase", { position });
        return { label, value: parts.join(" · ") };
      });
    }
  }
}

/** Groupes de réglages d'un tournoi dans la langue de la page. */
export function localizedTournamentSettingsGroups(
  input: TournamentSettingsInput,
  locale: Locale,
  messages: Pick<Messages, "tournament" | "labels">,
): TournamentSettingsGroup[] {
  if (locale === "fr") return tournamentSettingsGroups(input);
  return settingsGroupsFrom(input, locale, messages);
}

/** Rédaction depuis les messages, quelle que soit la langue (testée contre le français d'origine). */
export function settingsGroupsFrom(
  input: TournamentSettingsInput,
  locale: Locale,
  messages: Pick<Messages, "tournament" | "labels">,
): TournamentSettingsGroup[] {
  const text: SettingsText = scopedText(locale, { settings: messages.tournament.settings, matchFormat: messages.tournament.matchFormat });
  const { card } = input;
  const { labels } = messages;
  const solo = card.participantType === "SOLO";
  const filters = card.registrationFilters;

  const general: TournamentSetting[] = [
    { label: text.t("settings.general.game"), value: localizedTournamentLabel(labels, "game", card.game) },
    { label: text.t("settings.general.mode"), value: localizedTournamentLabel(labels, "format", card.format) },
    {
      label: text.t("settings.general.participants"),
      value: solo ? text.t("settings.general.participantsSolo") : text.t("settings.general.participantsTeam"),
    },
    {
      label: text.t("settings.general.maxLabel"),
      value: text.t(solo ? "settings.general.maxSolo" : "settings.general.maxTeam", { count: card.maxTeams }),
    },
    { label: text.t("settings.general.matchFormat"), value: matchFormatSetting(text, card.matchFormat) },
    { label: text.t("settings.general.seeding"), value: text.t(`settings.seeding.${input.seedingSource}`) },
  ];

  const conditions: TournamentSetting[] = [];
  if (!solo) {
    conditions.push({
      label: text.t("settings.conditions.minRoster"),
      value: filters.minPlayers <= 1 ? text.t("settings.none") : text.t("settings.conditions.minRosterValue", { count: filters.minPlayers }),
    });
  }
  conditions.push(
    { label: text.t("settings.conditions.discord"), value: text.t(`settings.requirement.${filters.discordRequirement}`) },
    { label: text.t("settings.conditions.blizzard"), value: text.t(`settings.requirement.${filters.blizzardRequirement}`) },
  );

  return [
    { title: text.t("settings.groups.tournament"), settings: general },
    { title: localizedTournamentLabel(labels, "format", card.format), settings: modeSettings(text, labels, input) },
    { title: text.t("settings.groups.conditions"), settings: conditions },
  ].filter((group) => group.settings.length > 0);
}
