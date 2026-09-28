/**
 * Réglages **d'un** tournoi, tels que saisis à sa création — affichés en tête
 * des règles de son mode quand on les ouvre depuis sa fiche
 * (`/regles/<mode>?tournoi=<id>`).
 *
 * Les pages de règles décrivent un mode en général (« 9 points par défaut,
 * réglable à la création ») : un joueur qui les consulte pendant un tournoi
 * veut savoir ce qui vaut **pour le sien** — capital de départ, plafond de
 * manches, format des matchs, cadence des coupes. Tout ce qui est listé ici
 * voyage déjà dans l'instantané diffusé à tout lecteur du tournoi : rien n'est
 * exposé qui ne le soit déjà sur sa fiche.
 *
 * Module **pur** : la page ne fait que le mettre en forme.
 */
import { matchAllowsDraw, matchFormatLabel, withoutDraws, type MatchFormat } from "./match-format";
import { PLAYER_REQUIREMENT_LABELS } from "./registration-filters";
import { FORMAT_LABELS, GAME_LABELS } from "./tournament-labels";
import type {
  EnduranceMeta,
  SeedingSource,
  SwissMeta,
  TournamentCard,
  TournamentPhase,
} from "./types";

export type TournamentSetting = { label: string; value: string };

/** Un groupe de réglages : le tournoi en général, son mode, ses conditions. */
export type TournamentSettingsGroup = { title: string; settings: TournamentSetting[] };

export type TournamentSettingsInput = {
  card: Pick<
    TournamentCard,
    | "format"
    | "game"
    | "participantType"
    | "maxTeams"
    | "hasThirdPlaceMatch"
    | "survivalRoundsBeforeFirstCut"
    | "survivalRoundsPerCut"
    | "matchFormat"
    | "endurancePlayoffFormat"
    | "registrationFilters"
  >;
  phases: TournamentPhase[] | null;
  swiss: Pick<SwissMeta, "totalRounds" | "pointsForWin" | "pointsForDraw" | "pointsForLoss" | "pointsForBye"> | null;
  endurance: Pick<EnduranceMeta, "startPoints" | "winDelta" | "lossDelta" | "playoffSize" | "maxRounds"> | null;
  seedingSource: SeedingSource;
};

const SEEDING_LABELS: Record<SeedingSource, string> = {
  MANUAL: "Fixé par l'arbitrage",
  RANKING: "Classement du site",
  REGISTRATION: "Ordre des inscriptions",
};

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

function yesNo(value: boolean): string {
  return value ? "Oui" : "Non";
}

/** « FT3 », suivi de la mention du nul quand le format l'autorise. */
export function matchFormatSettingLabel(format: MatchFormat | null): string {
  const label = matchFormatLabel(format);
  return matchAllowsDraw(format) ? `${label} · match nul possible` : label;
}

function survivalCadence(beforeFirstCut: number | null, perCut: number | null): TournamentSetting[] {
  const settings: TournamentSetting[] = [];
  if (beforeFirstCut !== null) {
    settings.push({ label: "Manches avant la 1ʳᵉ coupe", value: String(beforeFirstCut) });
  }
  if (perCut !== null) {
    settings.push({ label: "Manches entre deux coupes", value: String(perCut) });
  }
  return settings;
}

function phaseQualification(phase: TournamentPhase, isLast: boolean): string {
  if (isLast) return "Désigne la championne";
  return phase.qualifierMode === "PERCENT"
    ? `${phase.qualifierValue} % qualifiées`
    : `${plural(phase.qualifierValue, "qualifiée")}`;
}

function phaseDetails(phase: TournamentPhase): string[] {
  const details: string[] = [];
  if (phase.format === "SWISS" && phase.swissTotalRounds) {
    details.push(plural(phase.swissTotalRounds, "ronde"));
  }
  if (phase.format === "SURVIVAL") {
    if (phase.survivalRoundsBeforeFirstCut !== null) {
      details.push(`1ʳᵉ coupe après ${plural(phase.survivalRoundsBeforeFirstCut, "manche")}`);
    }
    if (phase.survivalRoundsPerCut !== null) {
      details.push(
        phase.survivalRoundsPerCut === 1
          ? "puis à chaque manche"
          : `puis toutes les ${phase.survivalRoundsPerCut} manches`,
      );
    }
  }
  if (phase.format === "SINGLE" && phase.hasThirdPlaceMatch) details.push("petite finale");
  return details;
}

function modeSettings(input: TournamentSettingsInput): TournamentSetting[] {
  const { card } = input;
  switch (card.format) {
    case "SINGLE":
      return [{ label: "Petite finale", value: yesNo(card.hasThirdPlaceMatch) }];
    case "DOUBLE":
      return [];
    case "SURVIVAL":
      return survivalCadence(card.survivalRoundsBeforeFirstCut, card.survivalRoundsPerCut);
    case "SWISS": {
      if (!input.swiss) return [];
      const { totalRounds, pointsForWin, pointsForDraw, pointsForLoss, pointsForBye } = input.swiss;
      return [
        {
          label: "Nombre de rondes",
          value: totalRounds > 0 ? String(totalRounds) : "Fixé au lancement",
        },
        {
          label: "Barème",
          value: `Victoire ${pointsForWin} · nul ${pointsForDraw} · défaite ${pointsForLoss} · exemption ${pointsForBye}`,
        },
      ];
    }
    case "BG_SURVIE": {
      const settings: TournamentSetting[] = [];
      if (input.endurance) {
        const { startPoints, winDelta, lossDelta, playoffSize, maxRounds } = input.endurance;
        settings.push(
          { label: "Capital de départ", value: plural(startPoints, "point") },
          { label: "Barème", value: `+${winDelta} par map gagnée · −${lossDelta} par map perdue` },
          { label: "Qualifiées pour les play-offs", value: String(playoffSize) },
          {
            label: "Plafond de manches qualificatives",
            value: maxRounds === null ? "Aucun" : String(maxRounds),
          },
        );
      }
      settings.push({
        label: "Format des play-offs",
        value: matchFormatSettingLabel(card.endurancePlayoffFormat ?? withoutDraws(card.matchFormat)),
      });
      return settings;
    }
    case "MULTI": {
      const phases = [...(input.phases ?? [])].sort((a, b) => a.position - b.position);
      return phases.map((phase, index) => {
        const isLast = index === phases.length - 1;
        const name = phase.name ? ` — ${phase.name}` : "";
        const parts = [FORMAT_LABELS[phase.format], ...phaseDetails(phase), phaseQualification(phase, isLast)];
        return { label: `Phase ${phase.position}${name}`, value: parts.join(" · ") };
      });
    }
  }
}

/**
 * Les réglages d'un tournoi, groupés. Un groupe vide n'est pas rendu : un mode
 * sans réglage propre (double élimination) n'annonce pas de section vide.
 */
export function tournamentSettingsGroups(input: TournamentSettingsInput): TournamentSettingsGroup[] {
  const { card } = input;
  const solo = card.participantType === "SOLO";
  const filters = card.registrationFilters;

  const general: TournamentSetting[] = [
    { label: "Jeu", value: GAME_LABELS[card.game] ?? card.game },
    { label: "Mode", value: FORMAT_LABELS[card.format] ?? card.format },
    { label: "Participants", value: solo ? "Joueurs (tournoi individuel)" : "Équipes" },
    { label: "Effectif maximal", value: plural(card.maxTeams, solo ? "joueur" : "équipe") },
    { label: "Format des matchs", value: matchFormatSettingLabel(card.matchFormat) },
    { label: "Ordre de départ", value: SEEDING_LABELS[input.seedingSource] },
  ];

  const conditions: TournamentSetting[] = [];
  // L'effectif minimal ne s'applique pas en individuel, où un engagé est une
  // personne : l'afficher y annoncerait une règle que le moteur ne joue pas.
  if (!solo) {
    conditions.push({
      label: "Effectif minimal du roster",
      value: filters.minPlayers <= 1 ? "Aucun" : plural(filters.minPlayers, "joueur"),
    });
  }
  conditions.push(
    { label: "Tag Discord certifié", value: PLAYER_REQUIREMENT_LABELS[filters.discordRequirement] },
    { label: "Compte Battle.net rattaché", value: PLAYER_REQUIREMENT_LABELS[filters.blizzardRequirement] },
  );

  return [
    { title: "Tournoi", settings: general },
    { title: FORMAT_LABELS[card.format] ?? card.format, settings: modeSettings(input) },
    { title: "Conditions d'inscription", settings: conditions },
  ].filter((group) => group.settings.length > 0);
}

/**
 * Lit l'identifiant de tournoi passé aux règles (`?tournoi=12`) : un entier
 * positif en base 10, rien d'autre — la valeur vient de l'URL.
 */
export function parseRulesTournamentParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^[1-9]\d{0,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/** Lien vers les règles d'un mode, portant le tournoi dont afficher les réglages. */
export function rulesHrefWithTournament(baseHref: string, tournamentId: number): string {
  return `${baseHref}?tournoi=${tournamentId}`;
}
