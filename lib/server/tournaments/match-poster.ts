import type { RowDataPacket } from "mysql2/promise";

/** Les deux places d'une manche. */
export type Poster = { team1Id: number | null; team2Id: number | null };

/** Ligne `id, team1_id, team2_id` de `bg_matches`. */
export type PosterRow = RowDataPacket & { id: number; team1_id: number | null; team2_id: number | null };

/** Les places d'une ligne lue, en nombres (MySQL peut rendre des chaînes). */
export function toPoster(row: Pick<PosterRow, "team1_id" | "team2_id">): Poster {
  return {
    team1Id: row.team1_id === null ? null : Number(row.team1_id),
    team2Id: row.team2_id === null ? null : Number(row.team2_id),
  };
}

/** L'engagée occupe l'une des deux places. */
export function onPoster(poster: Poster, teamId: number): boolean {
  return poster.team1Id === teamId || poster.team2Id === teamId;
}
