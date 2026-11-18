/**
 * « Tester mes MP » côté serveur (`docs/features/DISCORD_DM_TEST.md`).
 *
 * Réutilise le canal existant `POST /internal/notify/dm` du bot
 * (`pushDiscordDirectMessages`) : un seul destinataire, le compte Discord
 * **rattaché** au compte qui demande — jamais un tag saisi, jamais un autre
 * compte. Le bot ne cherche ce membre que sur le serveur BlueGenji et rend un
 * bilan dont {@link dmTestOutcome} tire l'issue. Pas de `notifyUsers` : ce
 * n'est pas une notification (aucun push, aucun sujet), mais un geste dont le
 * joueur attend le résultat précis.
 */
import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { pushDiscordDirectMessages } from "@/lib/server/bot-integration";
import type { RateLimitRule } from "@/lib/server/rate-limit";
import { accountLocaleFromRow, readWithLocaleColumn } from "@/lib/server/users/account-locale";
import { renderDm } from "@/lib/shared/dm-language";
import {
  DM_TEST_ABORTED,
  DM_TEST_BOT_UNREACHABLE,
  DM_TEST_BUSY,
  DM_TEST_FAILED,
  DM_TEST_HOURLY_LIMIT,
  DM_TEST_MESSAGE,
  DM_TEST_NOT_CERTIFIED,
  DM_TEST_NOT_LINKED,
  dmTestOutcome,
  type DmTestOutcome,
} from "@/lib/shared/discord-dm-test";

/**
 * Plafond **par compte du site**, en mémoire : contrôle et décompte en une
 * instruction (`reserveRateLimit`), aucun `await` entre les deux. Fenêtre
 * **glissante** (`slide`) : chaque essai décompté repousse la fin de la fenêtre
 * d'une heure, si bien qu'aucune heure glissante ne porte plus de
 * {@link DM_TEST_HOURLY_LIMIT} essais (une fenêtre fixe en laissait passer le
 * double de part et d'autre de sa remise à zéro). Seau plein : `refuse` — le
 * saturer ne rend à personne ses essais. La clé vit une heure après le dernier
 * essai, plus un balayage (61 minutes au plus, registre T04).
 */
export const DISCORD_DM_TEST_RULE: RateLimitRule = {
  name: "discord-dm-test",
  limit: DM_TEST_HOURLY_LIMIT,
  windowMs: 60 * 60_000,
  slide: true,
  overflow: "refuse",
};

/**
 * Tous les appels de la route, refus compris, par compte : un refus où rien
 * n'est parti (non lié, non certifié, occupé) rend sa place au plafond
 * ci-dessus ; celui-ci borne la boucle de ces refus (chacun lit la session et
 * le compte). Jamais rendu.
 */
export const DISCORD_DM_TEST_ATTEMPT_RULE: RateLimitRule = {
  name: "discord-dm-test-attempt",
  limit: 30,
  windowMs: 60 * 60_000,
  overflow: "refuse",
};

/** Clé unique du plafond global. */
export const DM_TEST_GLOBAL_KEY = "all";

/**
 * Plafond **tous comptes confondus** : chaque test non remis fait écrire au bot
 * une ligne au journal du staff ; une flotte de comptes ne peut pas en faire
 * une rafale. Au-delà : `DISCORD_DM_TEST_BUSY` (place du compte rendue).
 */
export const DISCORD_DM_TEST_GLOBAL_RULE: RateLimitRule = {
  name: "discord-dm-test-global",
  limit: 120,
  windowMs: 60 * 60_000,
};

/**
 * Tests en cours côté bot, tous comptes confondus : bot en panne, chaque test
 * tient une place jusqu'à la réponse du bot ou son délai — **même si le joueur
 * a quitté la page**, le bot travaillant encore ; au-delà, refus immédiat
 * (`DISCORD_DM_TEST_BUSY`) plutôt qu'une pile de requêtes vers le bot.
 */
export const DM_TEST_MAX_IN_FLIGHT = 8;
let inFlight = 0;

/** Étiquette côté bot : journalisée en compte seulement, jamais un nom. */
export const DM_TEST_CONTEXT = "dm-test";

/**
 * Refus ou échec d'un test. `nothingSent` : rien n'a été demandé au bot — la
 * route rend alors la place réservée ; sinon le message a pu partir, la place
 * reste prise. `message` = le code rendu au client, rien d'autre.
 */
export class DmTestError extends Error {
  constructor(
    code: string,
    readonly nothingSent: boolean,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "DmTestError";
  }
}

type DmTestRow = RowDataPacket & {
  discord_id: string | null;
  discord_verified_at: Date | null;
  locale?: unknown;
};

/**
 * Envoie le message de test au Discord rattaché de `userId`.
 *
 * L'appel au bot **n'est pas** interrompu quand le joueur quitte la page : le
 * bot, qui a reçu la demande, travaille encore ; seule l'attente de la route
 * s'arrête (`DM_TEST_ABORTED`), la place en vol restant prise jusqu'à la
 * réponse du bot ou son délai.
 *
 * @returns L'issue rendue par le bot.
 * @throws {DmTestError} `PROFILE_NOT_FOUND`, `DISCORD_NOT_LINKED`,
 *   `DISCORD_NOT_CERTIFIED`, `DISCORD_DM_TEST_BUSY`, `DISCORD_DM_TEST_FAILED`
 *   (lecture du compte impossible) et `DM_TEST_ABORTED` avant l'appel — rien
 *   n'est parti ; `BOT_INTERNAL_UNREACHABLE`, `DISCORD_DM_TEST_FAILED` (bilan
 *   illisible) et `DM_TEST_ABORTED` pendant l'appel — le message a pu partir.
 * @param signal Abandon quand le joueur quitte la page.
 */
export async function sendDiscordDmTest(userId: number, signal?: AbortSignal): Promise<DmTestOutcome> {
  if (inFlight >= DM_TEST_MAX_IN_FLIGHT) throw new DmTestError(DM_TEST_BUSY, true);
  inFlight += 1;
  const progress = { botCalled: false };
  const work = sendDiscordDmTestNow(userId, signal, progress).finally(() => {
    inFlight -= 1;
  });
  if (!signal) return work;
  return new Promise<DmTestOutcome>((resolve, reject) => {
    // Avant l'appel au bot, la lecture du compte s'achève et refuse d'elle-même
    // (rien n'est parti) ; pendant, la route cesse d'attendre.
    const onAbort = () => {
      if (progress.botCalled) reject(new DmTestError(DM_TEST_ABORTED, false));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function readDmTestRow(userId: number): Promise<DmTestRow | undefined> {
  try {
    const db = await getDatabase();
    const [rows] = await readWithLocaleColumn((withLocale) =>
      db.execute<DmTestRow[]>(
        `SELECT discord_id, discord_verified_at${withLocale ? ", locale" : ""}
         FROM bg_users
         WHERE id = ? AND is_deleted = 0
         LIMIT 1`,
        [userId],
      ),
    );
    return rows[0];
  } catch (error) {
    throw new DmTestError(DM_TEST_FAILED, true, { cause: error });
  }
}

async function sendDiscordDmTestNow(
  userId: number,
  signal: AbortSignal | undefined,
  progress: { botCalled: boolean },
): Promise<DmTestOutcome> {
  const row = await readDmTestRow(userId);
  if (!row) throw new DmTestError("PROFILE_NOT_FOUND", true);
  if (!row.discord_id) throw new DmTestError(DM_TEST_NOT_LINKED, true);
  if (row.discord_verified_at == null) throw new DmTestError(DM_TEST_NOT_CERTIFIED, true);
  // Joueur parti pendant la lecture : rien n'est demandé au bot.
  if (signal?.aborted) throw new DmTestError(DM_TEST_ABORTED, true);

  // Langue du compte ; colonne absente : message bilingue.
  const locale = row.locale === undefined ? null : accountLocaleFromRow(row.locale);
  progress.botCalled = true;
  const report = await pushDiscordDirectMessages(
    renderDm(DM_TEST_MESSAGE, locale),
    [{ discordId: row.discord_id, handle: null, label: DM_TEST_CONTEXT }],
    DM_TEST_CONTEXT,
    // Geste explicite d'un joueur qui attend la réponse : il ignore le
    // coupe-circuit des flux d'arrière-plan, comme `pushRefereeAlert`.
    { honourCircuit: false },
  );
  if (report === null) throw new DmTestError(DM_TEST_BOT_UNREACHABLE, false);
  const outcome = dmTestOutcome(report);
  if (outcome === null) throw new DmTestError(DM_TEST_FAILED, false);
  return outcome;
}
