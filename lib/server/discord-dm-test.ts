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
import type { RateLimitRule, TokenBucketRule } from "@/lib/server/rate-limit";
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

/** Durée de la fenêtre glissante du plafond par compte. */
export const DM_TEST_WINDOW_MS = 60 * 60_000;

/**
 * Comptes suivis à la fois par le plafond par compte. Une entrée n'existe que
 * pour un compte dont un essai **décompté** (non rendu) date de moins d'une
 * heure : seul un compte réel, lié et certifié, en crée une. Atteint : refus
 * `DISCORD_DM_TEST_BUSY` (jamais un « trop d'essais » faux pour un nouveau venu).
 */
export const DM_TEST_MAX_TRACKED_ACCOUNTS = 10_000;

/**
 * Heures des essais décomptés de chaque compte, de la plus ancienne à la plus
 * récente. La `Map` est rangée par dernier essai (un compte qui réserve passe
 * en fin) : la purge d'une table pleine s'arrête au premier compte encore actif.
 */
const accountTries = new Map<number, number[]>();
/**
 * Un minuteur par compte suivi, armé sur la fin de l'heure de son **dernier**
 * essai décompté : à l'échéance, le compte est effacé **sans condition** — une
 * horloge qui recule ou un minuteur un peu en avance ne le gardent pas en
 * mémoire au-delà des 61 minutes publiées (registre T04).
 */
const expiryTimers = new Map<number, ReturnType<typeof setTimeout>>();

function forgetAccount(userId: number): void {
  accountTries.delete(userId);
  const timer = expiryTimers.get(userId);
  if (timer !== undefined) clearTimeout(timer);
  expiryTimers.delete(userId);
}

/** Retire les essais sortis de la fenêtre ; efface le compte quand il n'en reste aucun. */
function pruneAccountTries(userId: number, now: number): number[] {
  const tries = accountTries.get(userId);
  if (!tries) return [];
  const live = tries.filter((at) => now - at < DM_TEST_WINDOW_MS);
  if (live.length === 0) forgetAccount(userId);
  else accountTries.set(userId, live);
  return live;
}

/** (Ré)arme l'unique minuteur du compte sur la fin de l'heure de son dernier essai. */
function armAccountExpiry(userId: number, lastTryAt: number, now: number): void {
  const previous = expiryTimers.get(userId);
  if (previous !== undefined) clearTimeout(previous);
  const timer = setTimeout(
    () => {
      if (expiryTimers.get(userId) !== timer) return;
      expiryTimers.delete(userId);
      accountTries.delete(userId);
    },
    Math.max(0, lastTryAt + DM_TEST_WINDOW_MS - now),
  );
  timer.unref?.();
  expiryTimers.set(userId, timer);
}

/** Table pleine : retire par la tête les comptes sans essai actif, s'arrête au premier actif. */
function pruneExpiredAccounts(now: number): void {
  for (const [trackedId, tries] of accountTries) {
    const last = tries.at(-1);
    if (last !== undefined && now - last < DM_TEST_WINDOW_MS) break;
    forgetAccount(trackedId);
  }
}

/** Réservation d'un essai : refusée (`retryAfterMs` ou occupé), ou prise avec de quoi la rendre. */
export type DmTestReservation =
  | { refused: "TOO_MANY"; retryAfterMs: number }
  | { refused: "BUSY" }
  | { refused: null; refund: () => void };

/**
 * Plafond **par compte du site**, en mémoire, en **vraie fenêtre glissante** :
 * l'heure de chaque essai décompté est gardée, et un essai n'est accepté que si
 * moins de {@link DM_TEST_HOURLY_LIMIT} datent de la dernière heure — aucune
 * heure glissante n'en porte davantage, sans double rafale à une remise à zéro,
 * et un essai ancien sort de lui-même du compte. Contrôle et décompte en une
 * instruction, aucun `await` entre les deux. `refund` retire **son** essai,
 * une fois au plus, sans rien repousser : un refus rendu ne prolonge ni le
 * plafond ni la durée de garde. Le compte est effacé une heure après son
 * dernier essai décompté (registre T04 : 61 minutes au plus). En mémoire du
 * processus : un redémarrage du site (déploiement) remet tout à zéro.
 */
export function reserveDmTestTry(userId: number, now: number = Date.now()): DmTestReservation {
  const tries = pruneAccountTries(userId, now);
  if (tries.length >= DM_TEST_HOURLY_LIMIT) {
    return { refused: "TOO_MANY", retryAfterMs: Math.max(1, (tries[0] ?? now) + DM_TEST_WINDOW_MS - now) };
  }
  if (tries.length === 0 && accountTries.size >= DM_TEST_MAX_TRACKED_ACCOUNTS) {
    pruneExpiredAccounts(now);
    if (accountTries.size >= DM_TEST_MAX_TRACKED_ACCOUNTS) return { refused: "BUSY" };
  }
  // Replacé en fin : la `Map` reste rangée par dernier essai.
  accountTries.delete(userId);
  accountTries.set(userId, [...tries, now]);
  armAccountExpiry(userId, now, now);
  // Horloge réelle de la réservation : `now` peut être fourni (tests), le
  // temps écoulé jusqu'au rendu se mesure, lui, sur `Date.now()`.
  const reservedAt = Date.now();
  let refunded = false;
  return {
    refused: null,
    refund: () => {
      if (refunded) return;
      refunded = true;
      const current = accountTries.get(userId);
      const index = current?.indexOf(now) ?? -1;
      if (!current || index < 0) return;
      current.splice(index, 1);
      const last = current.at(-1);
      if (last === undefined) forgetAccount(userId);
      else armAccountExpiry(userId, last, now + (Date.now() - reservedAt));
    },
  };
}

/** Comptes suivis par le plafond par compte. Réservé aux tests. */
export function trackedDmTestAccounts(): number {
  return accountTries.size;
}

/** Vide le plafond par compte et ses minuteurs. Réservé aux tests. */
export function resetDmTestTries(): void {
  accountTries.clear();
  for (const timer of expiryTimers.values()) clearTimeout(timer);
  expiryTimers.clear();
}

/** Minuteurs d'expiration vivants (un par compte suivi au plus). Réservé aux tests. */
export function dmTestExpiryTimerCount(): number {
  return expiryTimers.size;
}

/**
 * Tous les appels de la route, refus compris, par compte : un refus où rien
 * n'est parti (non lié, non certifié, occupé) rend sa place au plafond
 * ci-dessus ; celui-ci borne la boucle de ces refus (chacun lit la session et
 * le compte). Jamais rendu. Seau plein : il **refuse** les nouveaux venus et
 * garde les plafonds en cours (une flotte de sessions qui le remplit ne rend
 * pas 30 appels à chacun) ; la route sert alors `DISCORD_DM_TEST_BUSY` à un
 * compte sans fenêtre ouverte, jamais un « trop d'essais » faux.
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
 * Plafond **tous comptes confondus** des tests **non remis**, en seau à
 * jetons : chacun fait écrire au bot une ligne au journal du staff ; une
 * flotte de comptes ne peut pas en faire une rafale (30 d'un coup, puis un
 * toutes les 30 s). Un test remis (`SENT`, aucune ligne) rend son jeton —
 * même quand le joueur a quitté la page pendant l'appel —, comme un test où
 * rien n'est parti : des joueurs qui testent normalement ne l'épuisent pas.
 * Vide : `DISCORD_DM_TEST_BUSY` (place du compte rendue), pour 30 s au plus
 * par jeton.
 */
export const DISCORD_DM_TEST_GLOBAL_RULE: TokenBucketRule = {
  name: "discord-dm-test-global",
  capacity: 30,
  refillMs: 30_000,
};

/**
 * Plafond **tous comptes confondus** de **tous** les tests demandés au bot,
 * remis compris : le seau ci-dessus rend le jeton d'un test remis, celui-ci
 * non (seul un test où rien n'est parti rend le sien) — il borne le volume de
 * messages privés que le bot envoie pour ce bouton (60 d'un coup, puis un
 * toutes les 10 s, soit 360 par heure au plus), quel que soit le nombre de
 * comptes. Vide : `DISCORD_DM_TEST_BUSY` (place du compte rendue).
 */
export const DISCORD_DM_TEST_VOLUME_RULE: TokenBucketRule = {
  name: "discord-dm-test-volume",
  capacity: 60,
  refillMs: 10_000,
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
 * @param onLateOutcome Appelé avec l'issue rendue par le bot **après** que la
 *   route a cessé d'attendre (`DM_TEST_ABORTED` pendant l'appel) : la route y
 *   rend ce qu'un test remis ne coûte pas.
 */
export async function sendDiscordDmTest(
  userId: number,
  signal?: AbortSignal,
  onLateOutcome?: (outcome: DmTestOutcome) => void,
): Promise<DmTestOutcome> {
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
    let stoppedWaiting = false;
    const onAbort = () => {
      if (!progress.botCalled) return;
      stoppedWaiting = true;
      reject(new DmTestError(DM_TEST_ABORTED, false));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work
      .then((outcome) => {
        if (stoppedWaiting) onLateOutcome?.(outcome);
        resolve(outcome);
      }, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
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
