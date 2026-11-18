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
  DM_TEST_BOT_UNREACHABLE,
  DM_TEST_HOURLY_LIMIT,
  DM_TEST_MESSAGE,
  DM_TEST_NOT_CERTIFIED,
  DM_TEST_NOT_LINKED,
  dmTestOutcome,
  type DmTestOutcome,
} from "@/lib/shared/discord-dm-test";

/**
 * Plafond **par compte du site**, en mémoire : contrôle et décompte en une
 * instruction (`reserveRateLimit`), aucun `await` entre les deux. Il borne le
 * nombre de messages qu'un compte peut faire envoyer à son propre Discord.
 */
export const DISCORD_DM_TEST_RULE: RateLimitRule = {
  name: "discord-dm-test",
  limit: DM_TEST_HOURLY_LIMIT,
  windowMs: 60 * 60_000,
};

/** Étiquette côté bot : journalisée en compte seulement, jamais un nom. */
export const DM_TEST_CONTEXT = "dm-test";

type DmTestRow = RowDataPacket & {
  discord_id: string | null;
  discord_verified_at: Date | null;
  locale?: unknown;
};

/**
 * Envoie le message de test au Discord rattaché de `userId`.
 *
 * @returns L'issue rendue par le bot.
 * @throws `PROFILE_NOT_FOUND` (compte absent ou supprimé), `DISCORD_NOT_LINKED`,
 *   `DISCORD_NOT_CERTIFIED` — rien n'est parti ; `BOT_INTERNAL_UNREACHABLE` —
 *   bot injoignable ou en panne, rien ne dit que le message soit parti.
 */
export async function sendDiscordDmTest(userId: number): Promise<DmTestOutcome> {
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
  const row = rows[0];
  if (!row) throw new Error("PROFILE_NOT_FOUND");
  if (!row.discord_id) throw new Error(DM_TEST_NOT_LINKED);
  if (row.discord_verified_at == null) throw new Error(DM_TEST_NOT_CERTIFIED);

  // Langue du compte ; colonne absente : message bilingue.
  const locale = row.locale === undefined ? null : accountLocaleFromRow(row.locale);
  const report = await pushDiscordDirectMessages(
    renderDm(DM_TEST_MESSAGE, locale),
    [{ discordId: row.discord_id, handle: null, label: DM_TEST_CONTEXT }],
    DM_TEST_CONTEXT,
  );
  if (report === null) throw new Error(DM_TEST_BOT_UNREACHABLE);
  return dmTestOutcome(report);
}
