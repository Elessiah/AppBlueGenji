/**
 * Matrice des cas couverts par `npm run seed`.
 *
 * Chaque entrée isole une combinaison état × format × effectif × situation de
 * match ; le seed (`lib/server/seed.ts`) se contente de la dérouler. Le fichier
 * est volontairement sans effet de bord ni accès base pour rester testable.
 */

import type { MatchFormat } from "@/lib/shared/match-format";

export interface ReportStateCounts {
  pendingReports?: number;
  conflicts?: number;
  expiredReports?: number;
}

export type SeedFormat = "SINGLE" | "DOUBLE" | "SWISS" | "SURVIVAL" | "MULTI" | "BG_SURVIE";

export interface SeedPhase {
  // Une phase ne peut pas être un tournoi « BlueGenji Survie » : ce mode porte
  // lui-même ses deux phases (endurance puis play-offs).
  format: Exclude<SeedFormat, "MULTI" | "BG_SURVIE">;
  qualifierMode: "COUNT" | "PERCENT";
  qualifierValue: number;
  swissTotalRounds?: number;
  survivalRoundsBeforeFirstCut?: number;
  survivalRoundsPerCut?: number;
  hasThirdPlaceMatch?: boolean;
}

export interface TournamentDef extends ReportStateCounts {
  name: string;
  game: "OW2" | "MR";
  state: "UPCOMING" | "REGISTRATION" | "RUNNING" | "FINISHED";
  teamCount: number;
  maxTeams: number;
  daysOffset: number; // par rapport à maintenant ; négatif = dans le passé
  format?: SeedFormat;
  hasThirdPlaceMatch?: boolean;
  playWaves?: number; // RUNNING : nb de vagues de matchs joués
  survivalRoundsPerCut?: number; // SURVIVAL : nb de rounds entre les coupes suivantes
  survivalRoundsBeforeFirstCut?: number; // SURVIVAL : nb de rounds avant la 1re coupe
  swissTotalRounds?: number; // SWISS : nb de rondes (défaut : calculé)
  forfeits?: number; // SURVIVAL / BG_SURVIE : équipes déclarant forfait après simulation
  endurancePoints?: number; // BG_SURVIE : capital de départ (défaut 9)
  endurancePlayoffSize?: number; // BG_SURVIE : effectif des play-offs (défaut 8)
  teamOffset?: number; // décale la tranche du pool (rosters variés d'un tournoi à l'autre)
  closesInHours?: number; // REGISTRATION : clôture imminente
  description?: string | null;
  phases?: SeedPhase[]; // MULTI : phases successives du tournoi
  matchFormat?: MatchFormat; // format de match (BO5, FT3…) ; absent = score libre
}


// La matrice de cas : chaque ligne isole une combinaison état × format × effectif
// × situation de match. Les commentaires disent ce que la ligne couvre.
export const TOURNAMENTS: TournamentDef[] = [
  // ---- UPCOMING : annoncés, inscriptions pas encore ouvertes ---------------
  { name: "Vitrine Automne (à venir)", game: "OW2", state: "UPCOMING", format: "SINGLE", teamCount: 0, maxTeams: 16, daysOffset: 30 },
  { name: "Annonce Double (à venir)", game: "MR", state: "UPCOMING", format: "DOUBLE", teamCount: 0, maxTeams: 32, daysOffset: 45, description: null },
  { name: "Survie Hiver (à venir)", game: "OW2", state: "UPCOMING", format: "SURVIVAL", teamCount: 0, maxTeams: 16, daysOffset: 38, survivalRoundsPerCut: 2 },
  { name: "Ronde Suisse (à venir)", game: "MR", state: "UPCOMING", format: "SWISS", teamCount: 0, maxTeams: 16, daysOffset: 52, swissTotalRounds: 5 },

  // ---- REGISTRATION : remplissage de 0 à complet --------------------------
  { name: "Inscriptions Vides", game: "OW2", state: "REGISTRATION", format: "DOUBLE", teamCount: 0, maxTeams: 16, daysOffset: 21 },
  { name: "Inscriptions Une Seule", game: "MR", state: "REGISTRATION", format: "SINGLE", teamCount: 1, maxTeams: 8, daysOffset: 12 },
  { name: "OW2 Open Cup S1", game: "OW2", state: "REGISTRATION", format: "SINGLE", teamCount: 5, maxTeams: 8, daysOffset: 10, teamOffset: 2 },
  { name: "Marvel Rivals Cup S1", game: "MR", state: "REGISTRATION", format: "DOUBLE", teamCount: 3, maxTeams: 8, daysOffset: 14, teamOffset: 5 },
  { name: "Inscriptions Complètes 8/8", game: "OW2", state: "REGISTRATION", format: "SINGLE", teamCount: 8, maxTeams: 8, daysOffset: 9, teamOffset: 3 },
  { name: "Clôture Imminente", game: "MR", state: "REGISTRATION", format: "DOUBLE", teamCount: 7, maxTeams: 8, daysOffset: 2, closesInHours: 3, teamOffset: 7 },
  { name: "11 Équipes + Petite Finale", game: "OW2", state: "REGISTRATION", format: "SINGLE", hasThirdPlaceMatch: true, teamCount: 11, maxTeams: 16, daysOffset: 18 },
  { name: "Survie Inscriptions Impaires", game: "MR", state: "REGISTRATION", format: "SURVIVAL", teamCount: 9, maxTeams: 16, daysOffset: 16, survivalRoundsPerCut: 2 },
  { name: "Suisse Inscriptions", game: "OW2", state: "REGISTRATION", format: "SWISS", teamCount: 10, maxTeams: 16, daysOffset: 20, swissTotalRounds: 4 },
  { name: "BG Survie Inscriptions", game: "MR", state: "REGISTRATION", format: "BG_SURVIE", teamCount: 12, maxTeams: 16, daysOffset: 22 },

  // ---- RUNNING · élimination simple (couverture des byes) ------------------
  { name: "Finale Sèche (2 équipes)", game: "OW2", state: "RUNNING", format: "SINGLE", teamCount: 2, maxTeams: 2, daysOffset: -1, playWaves: 0 },
  { name: "3 Équipes (1 bye)", game: "MR", state: "RUNNING", format: "SINGLE", teamCount: 3, maxTeams: 4, daysOffset: -1, playWaves: 1, teamOffset: 4 },
  { name: "5 Équipes (3 byes)", game: "OW2", state: "RUNNING", format: "SINGLE", teamCount: 5, maxTeams: 8, daysOffset: -2, playWaves: 1, teamOffset: 6 },
  { name: "8 Équipes + Petite Finale", game: "MR", state: "RUNNING", format: "SINGLE", hasThirdPlaceMatch: true, teamCount: 8, maxTeams: 8, daysOffset: -2, playWaves: 2 },
  { name: "16 Équipes (conflits de score)", game: "OW2", state: "RUNNING", format: "SINGLE", teamCount: 16, maxTeams: 16, daysOffset: -3, playWaves: 1, conflicts: 2, pendingReports: 2, expiredReports: 1 },
  { name: "17 Équipes (bracket 32)", game: "MR", state: "RUNNING", format: "SINGLE", teamCount: 17, maxTeams: 32, daysOffset: -2, playWaves: 1, teamOffset: 20 },

  // ---- RUNNING · double élimination ---------------------------------------
  { name: "6 Équipes Double", game: "MR", state: "RUNNING", format: "DOUBLE", teamCount: 6, maxTeams: 8, daysOffset: -2, playWaves: 2, teamOffset: 9 },
  { name: "11 Équipes Double", game: "OW2", state: "RUNNING", format: "DOUBLE", teamCount: 11, maxTeams: 16, daysOffset: -3, playWaves: 3 },
  { name: "12 Équipes Double (reports)", game: "MR", state: "RUNNING", format: "DOUBLE", teamCount: 12, maxTeams: 16, daysOffset: -4, playWaves: 2, pendingReports: 3, teamOffset: 12 },
  { name: "OW2 Champions League", game: "OW2", state: "RUNNING", format: "DOUBLE", teamCount: 8, maxTeams: 8, daysOffset: -1, playWaves: 1 },

  // ---- RUNNING · BlueGenji Survie (endurance puis play-offs) ---------------
  // Capital réduit pour que des éliminations tombent vite, et petit plateau de
  // play-offs pour atteindre la phase finale en quelques vagues.
  { name: "BG Survie 12 Équipes", game: "OW2", state: "RUNNING", format: "BG_SURVIE", teamCount: 12, maxTeams: 16, daysOffset: -3, endurancePoints: 3, endurancePlayoffSize: 8, playWaves: 2, teamOffset: 9 },
  { name: "BG Survie Play-offs", game: "MR", state: "RUNNING", format: "BG_SURVIE", teamCount: 10, maxTeams: 16, daysOffset: -5, endurancePoints: 2, endurancePlayoffSize: 8, playWaves: 4, teamOffset: 21 },
  { name: "BG Survie Impaire + Forfait", game: "OW2", state: "RUNNING", format: "BG_SURVIE", teamCount: 11, maxTeams: 16, daysOffset: -4, endurancePoints: 3, endurancePlayoffSize: 8, playWaves: 2, forfeits: 1, teamOffset: 33 },
  { name: "BG Survie Terminée", game: "MR", state: "FINISHED", format: "BG_SURVIE", teamCount: 9, maxTeams: 16, daysOffset: -20, endurancePoints: 2, endurancePlayoffSize: 8, teamOffset: 45 },

  // ---- RUNNING · ronde suisse ---------------------------------------------
  { name: "Suisse 8 Équipes", game: "OW2", state: "RUNNING", format: "SWISS", teamCount: 8, maxTeams: 8, daysOffset: -2, swissTotalRounds: 3, playWaves: 1 },
  { name: "Suisse 9 Équipes (bye)", game: "MR", state: "RUNNING", format: "SWISS", teamCount: 9, maxTeams: 16, daysOffset: -3, swissTotalRounds: 4, playWaves: 2, teamOffset: 14 },
  { name: "Suisse 16 Équipes (reports)", game: "OW2", state: "RUNNING", format: "SWISS", teamCount: 16, maxTeams: 16, daysOffset: -4, swissTotalRounds: 4, playWaves: 1, pendingReports: 2, conflicts: 1 },

  // ---- RUNNING · survie : matrice effectif impair (barrage) × cadence ------
  { name: "Survie 3 Équipes (barrage)", game: "MR", state: "RUNNING", format: "SURVIVAL", teamCount: 3, maxTeams: 4, daysOffset: -1, survivalRoundsPerCut: 1, playWaves: 1 },
  { name: "Survie 5 Équipes (barrage)", game: "OW2", state: "RUNNING", format: "SURVIVAL", teamCount: 5, maxTeams: 8, daysOffset: -1, survivalRoundsPerCut: 2, playWaves: 2, teamOffset: 3 },
  { name: "Survie 7 Équipes (barrage)", game: "MR", state: "RUNNING", format: "SURVIVAL", teamCount: 7, maxTeams: 8, daysOffset: -2, survivalRoundsPerCut: 1, playWaves: 2 },
  { name: "Survie 9 Équipes (cadence 3)", game: "OW2", state: "RUNNING", format: "SURVIVAL", teamCount: 9, maxTeams: 16, daysOffset: -2, survivalRoundsPerCut: 3, playWaves: 3, teamOffset: 8 },
  { name: "Survie 11 Équipes (barrage)", game: "MR", state: "RUNNING", format: "SURVIVAL", teamCount: 11, maxTeams: 16, daysOffset: -3, survivalRoundsPerCut: 2, playWaves: 3 },
  { name: "Survie 15 Équipes (barrage)", game: "OW2", state: "RUNNING", format: "SURVIVAL", teamCount: 15, maxTeams: 16, daysOffset: -3, survivalRoundsPerCut: 2, playWaves: 2, teamOffset: 11 },
  { name: "Survie 21 Équipes (barrage)", game: "MR", state: "RUNNING", format: "SURVIVAL", teamCount: 21, maxTeams: 32, daysOffset: -4, survivalRoundsPerCut: 1, playWaves: 2, teamOffset: 25 },
  // Effectifs pairs : aucun barrage, coupe classique par deux
  { name: "Survie 8 Équipes (pair)", game: "OW2", state: "RUNNING", format: "SURVIVAL", teamCount: 8, maxTeams: 8, daysOffset: -2, survivalRoundsPerCut: 1, playWaves: 2 },
  { name: "Survie 10 Équipes (reports)", game: "MR", state: "RUNNING", format: "SURVIVAL", teamCount: 10, maxTeams: 16, daysOffset: -2, survivalRoundsPerCut: 2, playWaves: 2, pendingReports: 2, conflicts: 1, teamOffset: 30 },
  // Cadence en deux temps : première coupe retardée, puis intervalle plus court
  { name: "Survie 1re Coupe Tardive", game: "OW2", state: "RUNNING", format: "SURVIVAL", teamCount: 12, maxTeams: 16, daysOffset: -3, survivalRoundsBeforeFirstCut: 4, survivalRoundsPerCut: 1, playWaves: 3, teamOffset: 40 },
  { name: "Survie 1re Coupe Immédiate", game: "MR", state: "RUNNING", format: "SURVIVAL", teamCount: 10, maxTeams: 16, daysOffset: -2, survivalRoundsBeforeFirstCut: 1, survivalRoundsPerCut: 3, playWaves: 2, teamOffset: 52 },
  // Forfaits : rééquilibrage à la coupe suivante
  { name: "Survie 12 Équipes (1 forfait)", game: "OW2", state: "RUNNING", format: "SURVIVAL", teamCount: 12, maxTeams: 16, daysOffset: -3, survivalRoundsPerCut: 2, playWaves: 2, forfeits: 1 },
  { name: "Survie 16 Équipes (2 forfaits)", game: "MR", state: "RUNNING", format: "SURVIVAL", teamCount: 16, maxTeams: 16, daysOffset: -4, survivalRoundsPerCut: 2, playWaves: 3, forfeits: 2, teamOffset: 18 },

  // ---- RUNNING · gros brackets (perf + scroll) ----------------------------
  { name: "64 Équipes Simple (en cours)", game: "OW2", state: "RUNNING", format: "SINGLE", teamCount: 64, maxTeams: 64, daysOffset: -2, playWaves: 3 },
  { name: "64 Équipes Double (en cours)", game: "MR", state: "RUNNING", format: "DOUBLE", teamCount: 64, maxTeams: 64, daysOffset: -2, playWaves: 4 },
  { name: "128 Équipes Simple (en cours)", game: "OW2", state: "RUNNING", format: "SINGLE", teamCount: 128, maxTeams: 128, daysOffset: -3, playWaves: 4 },
  { name: "128 Équipes Double (en cours)", game: "MR", state: "RUNNING", format: "DOUBLE", teamCount: 128, maxTeams: 128, daysOffset: -3, playWaves: 5 },

  // ---- FINISHED : palmarès, leaderboard, ticker ---------------------------
  { name: "OW2 Spring Clash", game: "OW2", state: "FINISHED", format: "SINGLE", teamCount: 8, maxTeams: 8, daysOffset: -30 },
  { name: "Marvel Rivals Open", game: "MR", state: "FINISHED", format: "SINGLE", hasThirdPlaceMatch: true, teamCount: 4, maxTeams: 4, daysOffset: -20, teamOffset: 4 },
  { name: "OW2 Winter Cup", game: "OW2", state: "FINISHED", format: "DOUBLE", teamCount: 8, maxTeams: 8, daysOffset: -60, teamOffset: 6 },
  { name: "Marvel Rivals Pro Series", game: "MR", state: "FINISHED", format: "DOUBLE", teamCount: 16, maxTeams: 16, daysOffset: -45 },
  { name: "Legacy 11 Équipes (byes)", game: "OW2", state: "FINISHED", format: "SINGLE", teamCount: 11, maxTeams: 16, daysOffset: -75, teamOffset: 10 },
  { name: "Suisse Finale 8", game: "MR", state: "FINISHED", format: "SWISS", teamCount: 8, maxTeams: 8, daysOffset: -35, swissTotalRounds: 3, teamOffset: 2 },
  { name: "Survie Championnat 12", game: "OW2", state: "FINISHED", format: "SURVIVAL", teamCount: 12, maxTeams: 16, daysOffset: -40, survivalRoundsPerCut: 2 },
  { name: "Survie Last Stand 8", game: "MR", state: "FINISHED", format: "SURVIVAL", teamCount: 8, maxTeams: 8, daysOffset: -28, survivalRoundsPerCut: 1, teamOffset: 8 },
  { name: "Survie Barrage 7 (terminé)", game: "OW2", state: "FINISHED", format: "SURVIVAL", teamCount: 7, maxTeams: 8, daysOffset: -15, survivalRoundsPerCut: 2, teamOffset: 13 },

  // ---- MULTI : tournois multi-phases -------------------------------------------
  {
    name: "Multi Inscriptions (Suisse → Survie → Double)",
    game: "OW2",
    state: "REGISTRATION",
    format: "MULTI",
    teamCount: 32,
    maxTeams: 32,
    daysOffset: 5,
    teamOffset: 60,
    phases: [
      {
        format: "SWISS",
        qualifierMode: "PERCENT",
        qualifierValue: 50,
        swissTotalRounds: 3,
      },
      {
        format: "SURVIVAL",
        qualifierMode: "COUNT",
        qualifierValue: 8,
        survivalRoundsPerCut: 2,
      },
      {
        format: "DOUBLE",
        qualifierMode: "COUNT",
        qualifierValue: 8,
      },
    ],
  },
  {
    name: "Multi En Cours Phase 1 (Suisse)",
    game: "MR",
    state: "RUNNING",
    format: "MULTI",
    teamCount: 24,
    maxTeams: 24,
    daysOffset: -2,
    playWaves: 2,
    teamOffset: 70,
    phases: [
      {
        format: "SWISS",
        qualifierMode: "PERCENT",
        qualifierValue: 50,
        swissTotalRounds: 3,
      },
      {
        format: "SURVIVAL",
        qualifierMode: "COUNT",
        qualifierValue: 8,
        survivalRoundsPerCut: 2,
      },
      {
        format: "DOUBLE",
        qualifierMode: "COUNT",
        qualifierValue: 8,
      },
    ],
  },
  {
    name: "Multi En Cours Phase Finale (Double)",
    game: "OW2",
    state: "RUNNING",
    format: "MULTI",
    teamCount: 8,
    maxTeams: 8,
    daysOffset: -3,
    playWaves: 1,
    teamOffset: 80,
    phases: [
      {
        format: "SWISS",
        qualifierMode: "PERCENT",
        qualifierValue: 50,
        swissTotalRounds: 3,
      },
      {
        format: "SURVIVAL",
        qualifierMode: "COUNT",
        qualifierValue: 8,
        survivalRoundsPerCut: 2,
      },
      {
        format: "DOUBLE",
        qualifierMode: "COUNT",
        qualifierValue: 8,
      },
    ],
  },
  {
    name: "Multi Terminé (3 phases)",
    game: "MR",
    state: "FINISHED",
    format: "MULTI",
    teamCount: 20,
    maxTeams: 20,
    daysOffset: -25,
    teamOffset: 90,
    phases: [
      {
        format: "SWISS",
        qualifierMode: "PERCENT",
        qualifierValue: 50,
        swissTotalRounds: 3,
      },
      {
        format: "SURVIVAL",
        qualifierMode: "COUNT",
        qualifierValue: 10,
        survivalRoundsPerCut: 2,
      },
      {
        format: "DOUBLE",
        qualifierMode: "COUNT",
        qualifierValue: 10,
      },
    ],
  },
  {
    name: "Multi Phase Zéro Sautée (COUNT > pool)",
    game: "OW2",
    state: "REGISTRATION",
    format: "MULTI",
    teamCount: 12,
    maxTeams: 12,
    daysOffset: 8,
    teamOffset: 100,
    phases: [
      {
        format: "SWISS",
        qualifierMode: "COUNT",
        qualifierValue: 64,
        swissTotalRounds: 3,
      },
      {
        format: "DOUBLE",
        qualifierMode: "COUNT",
        qualifierValue: 12,
      },
    ],
  },

  // ---- Formats de match (BO / FT) -----------------------------------------
  // Trois tournois pour vérifier que la contrainte de score suit le tournoi et
  // pas le format de bracket : elle s'applique aussi bien à un arbre qu'à une
  // ronde suisse ou à la survie, et cohabite avec les tournois en score libre.
  { name: "BO5 Élimination", game: "OW2", state: "RUNNING", format: "SINGLE", teamCount: 8, maxTeams: 8, daysOffset: -2, playWaves: 2, teamOffset: 30, matchFormat: { type: "BO", value: 5 } },
  { name: "FT3 Ronde Suisse", game: "MR", state: "RUNNING", format: "SWISS", teamCount: 8, maxTeams: 8, daysOffset: -3, playWaves: 2, swissTotalRounds: 3, teamOffset: 44, matchFormat: { type: "FT", value: 3 } },
  { name: "BO3 Survie (terminé)", game: "OW2", state: "FINISHED", format: "SURVIVAL", teamCount: 8, maxTeams: 8, daysOffset: -20, survivalRoundsPerCut: 2, teamOffset: 58, matchFormat: { type: "BO", value: 3 } },
];
