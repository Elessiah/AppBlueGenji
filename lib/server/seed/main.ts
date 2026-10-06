import "dotenv/config";
// `dotenv/config` et non `../script-env`, à dessein : ce script **écrase** des
// données, et son incapacité à lire `.env.production` a longtemps été sa seule
// protection contre une exécution sur le serveur — une protection accidentelle,
// qu'un `.env` posé là un jour ferait disparaître sans bruit. Le refus
// ci-dessous la rend explicite, et l'import reste étroit pour ne pas la
// reprendre d'une main après l'avoir donnée de l'autre.
import type { Pool } from "mysql2/promise";
import { getDatabase } from "../database";
import { NamedLockUnavailableError } from "../named-lock";
import { TOURNAMENTS, type SeedFormat, type TournamentDef } from "./cases";
import { clearDatabase } from "./cleanup";
import { SEED_LOCK_TIMEOUT_SECONDS, withSeedLock } from "./lock";
import { applyMatchLaunchCases } from "./match-states";
import {
  FICTIONAL_BUREAU,
  FICTIONAL_RECRUITMENT_ADS,
  FICTIONAL_SPONSORS,
  createBureau,
  createRecruitmentAds,
  createSponsors,
} from "./showcase";
import { createBulkTeams, createGhostTeams, createSoloEntries, createTeams } from "./teams";
import { createTournament } from "./tournaments";
import {
  acceptTermsForSeededAccounts,
  attachDeletedAccountToPlayedTeam,
  createSpecialUsers,
  createUsers,
} from "./users";

async function main(): Promise<void> {
  console.log("🚀 Seed BlueGenji Esport\n");

  // Ce script commence par **effacer**, et `clearDatabase` ne demande rien à
  // personne. En production il ne viderait pas grand-chose (aucune donnée n'y
  // porte les préfixes de test) mais il **créerait** la matrice entière — une
  // centaine d'équipes de remplissage et des dizaines de tournois, dans la base
  // que le site sert. Le refus porte sur `NODE_ENV` et non sur `DB_HOST` : la
  // base écoute sur `127.0.0.1` des deux côtés, l'hôte ne distingue donc rien.
  if (process.env.NODE_ENV === "production") {
    console.error(
      "Refus: NODE_ENV=production. Le jeu de test ne se pose jamais sur la production.",
    );
    process.exit(1);
  }

  try {
    const db = await getDatabase();

    // Deux seeds concurrents sur la même base s'effacent l'un l'autre en cours
    // de route : le second attend la fin du premier (voir `lock.ts`).
    await withSeedLock(
      db,
      () => seed(db),
      () => console.log("⏳ Un autre seed tourne sur cette base, attente de sa fin…"),
    );
    process.exit(0);
  } catch (error) {
    if (error instanceof NamedLockUnavailableError) {
      console.error(
        `❌ Seed abandonné : un autre seed occupe la base depuis plus de ${SEED_LOCK_TIMEOUT_SECONDS} s.`,
      );
    } else {
      console.error("❌ Seed échoué:", error);
    }
    process.exit(1);
  }
}

/** Efface le jeu de test précédent puis régénère toute la matrice. */
async function seed(db: Pool): Promise<void> {
  await clearDatabase(db);
  console.log();

  const userIds = await createUsers(db);
  console.log();

  const specialUserIds = await createSpecialUsers(db);
  console.log();

  const namedTeamIds = await createTeams(db, userIds);
  console.log();

  // Hors du pool de tournois : elles servent à exercer l'administration des
  // équipes fantômes (badge, attribution, inscription manuelle par le staff).
  await createGhostTeams(db);
  console.log();

  // Pool d'équipes étendu pour alimenter les gros brackets (jusqu'à 128) avec
  // de la marge, afin que teamOffset puisse décaler les tranches.
  const TEAM_POOL_TARGET = 160;
  const bulkTeamIds = await createBulkTeams(
    db,
    Math.max(0, TEAM_POOL_TARGET - namedTeamIds.length)
  );
  const teamIds = [...namedTeamIds, ...bulkTeamIds];
  console.log();

  // Engagés des tournois individuels : une entrée solo par joueur nommé.
  const soloEntryIds = await createSoloEntries(db, userIds);
  console.log();

  await createSponsors(db);
  console.log();

  await createBureau(db);
  console.log();

  await createRecruitmentAds(db);
  console.log();

  const organizerId = specialUserIds.get("Admin") ?? userIds[0];

  console.log("🎮 Création des tournois...");
  for (let i = 0; i < TOURNAMENTS.length; i++) {
    await createTournament(db, organizerId, teamIds, soloEntryIds, TOURNAMENTS[i], i);
  }
  await applyMatchLaunchCases(db, specialUserIds.get("Caster") ?? null);
  await attachDeletedAccountToPlayedTeam(db, specialUserIds.get("CompteSupprime") ?? null);
  await acceptTermsForSeededAccounts(db);

  const byState = (state: TournamentDef["state"]) =>
    TOURNAMENTS.filter((t) => t.state === state).length;
  const byFormat = (format: SeedFormat) =>
    TOURNAMENTS.filter((t) => (t.format ?? "DOUBLE") === format).length;

  console.log("\n✅ Seed terminé avec succès !");
  console.log(`\n  Récap :`);
  console.log(`  · ${userIds.length} joueurs + ${specialUserIds.size} comptes de test (Test_*)`);
  console.log(`  · ${teamIds.length} équipes (Test - *), dont solo / staff / roster complet`);
  console.log(`  · ${FICTIONAL_SPONSORS.length} sponsors (dont 1 inactif) · ${FICTIONAL_BUREAU.length} membres du bureau`);
  console.log(`  · ${FICTIONAL_RECRUITMENT_ADS.length} annonces de recrutement (longues descriptions, trois statuts, plusieurs prioritaires, brouillon, une sans anglais)`);
  console.log(`  · ${TOURNAMENTS.length} tournois :`);
  console.log(`    - états : ${byState("UPCOMING")} à venir · ${byState("REGISTRATION")} inscriptions · ${byState("RUNNING")} en cours · ${byState("FINISHED")} terminés`);
  console.log(`    - formats : ${byFormat("SINGLE")} simple · ${byFormat("DOUBLE")} double · ${byFormat("SWISS")} suisse · ${byFormat("SURVIVAL")} survie · ${byFormat("MULTI")} multi-phase · ${byFormat("BG_SURVIE")} BG Survie`);
  console.log(`    - effectifs : 0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 21, 64, 128`);
  console.log(`    - individuel : ${TOURNAMENTS.filter((t) => t.participantType === "SOLO").length} tournois solo (${soloEntryIds.length} entrées disponibles)`);
  console.log(`    - survie : barrage impair (3/5/7/9/11/15/21), cadences 1/2/3, forfaits`);
  console.log(`    - matchs : reports en attente, conflits de score, délais expirés`);
  console.log(`\n  Admin de test : DEV_AUTH_USER_ID=${organizerId}\n`);
}

await main();
