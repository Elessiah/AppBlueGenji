import type { toNotificationRecipient } from "@/lib/server/notify";
import type { RowColumns, RowOverrides } from "./row-overrides";

/** La ligne `bg_users` que lit `loadNotificationRecipients` (type interne au module). */
export type RecipientRow = Parameters<typeof toNotificationRecipient>[0];

/**
 * Une ligne de destinataire **complète** : compte sans Discord ni langue,
 * surchargé colonne par colonne. Remplace les littéraux passés en `as unknown as`.
 */
export function recipientRow(overrides: RowOverrides<RecipientRow> = {}): RecipientRow {
  const columns: RowColumns<RecipientRow> = {
    id: 1,
    pseudo: "Joueur",
    discord_id: null,
    discord_pseudo: null,
    discord_verified_at: null,
  };
  return { ...columns, ...overrides } as RecipientRow;
}
