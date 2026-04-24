import type { RowDataPacket } from "mysql2/promise";
import { getDatabase } from "@/lib/server/database";
import { fail, ok } from "@/lib/server/http";

export const revalidate = 60;
export const dynamic = "force-dynamic";

type TickerEntry = {
  text: string;
  sortAt: number;
};

type MatchResultRow = RowDataPacket & {
  updated_at: Date;
  tournament_name: string;
  team1_name: string | null;
  team2_name: string | null;
  team1_score: number | null;
  team2_score: number | null;
};

type RegistrationRow = RowDataPacket & {
  start_at: Date;
  registration_open_at: Date;
  name: string;
  registered_teams: number;
  max_teams: number;
};

type WinnerRow = RowDataPacket & {
  finished_at: Date | null;
  name: string;
  winner_name: string | null;
};

function pushEntries(target: TickerEntry[], entries: TickerEntry[]): void {
  target.push(...entries);
}

async function loadNewsEntries(db: Awaited<ReturnType<typeof getDatabase>>): Promise<TickerEntry[]> {
  try {
    const [rows] = await db.execute<
      (RowDataPacket & {
        title: string;
        created_at: Date;
      })[]
    >(
      `SELECT title, created_at
       FROM bg_news
       ORDER BY created_at DESC
       LIMIT 3`,
    );

    return rows.map((row) => ({
      text: `NEWS · ${row.title}`,
      sortAt: new Date(row.created_at).getTime(),
    }));
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const db = await getDatabase();
    const entries: TickerEntry[] = [];

    const [resultRows] = await db.execute<MatchResultRow[]>(
      `SELECT
        m.updated_at,
        t.name AS tournament_name,
        t1.name AS team1_name,
        t2.name AS team2_name,
        m.team1_score,
        m.team2_score,
        m.team1_id,
        m.team2_id
       FROM bg_matches m
       JOIN bg_tournaments t ON t.id = m.tournament_id
       LEFT JOIN bg_teams t1 ON t1.id = m.team1_id
       LEFT JOIN bg_teams t2 ON t2.id = m.team2_id
       WHERE m.status = 'COMPLETED'
       ORDER BY m.updated_at DESC
       LIMIT 3`,
    );

    pushEntries(
      entries,
      resultRows.map((row) => ({
        text: `RÉSULTAT · ${row.tournament_name} · ${(row.team1_name ?? `Equipe #${row.team1_id}`)} ${Number(row.team1_score ?? 0)} — ${(row.team2_name ?? `Equipe #${row.team2_id}`)} ${Number(row.team2_score ?? 0)}`,
        sortAt: new Date(row.updated_at).getTime(),
      })),
    );

    const [registrationRows] = await db.execute<RegistrationRow[]>(
      `SELECT
        t.start_at,
        t.registration_open_at,
        t.name,
        COUNT(r.id) AS registered_teams,
        t.max_teams
       FROM bg_tournaments t
       LEFT JOIN bg_tournament_registrations r ON r.tournament_id = t.id
       WHERE t.state = 'REGISTRATION'
       GROUP BY t.id, t.start_at, t.registration_open_at, t.name, t.max_teams
       ORDER BY t.registration_open_at DESC`,
    );

    pushEntries(
      entries,
      registrationRows.map((row) => ({
        text: `INSCRIPTIONS · ${row.name} · ${Number(row.registered_teams)}/${Number(row.max_teams)} équipes`,
        sortAt: new Date(row.registration_open_at).getTime(),
      })),
    );

    const [winnerRows] = await db.execute<WinnerRow[]>(
      `SELECT
        t.finished_at,
        t.name,
        COALESCE(w.name, CONCAT('Equipe #', r.team_id)) AS winner_name
       FROM bg_tournaments t
       LEFT JOIN bg_tournament_registrations r
         ON r.tournament_id = t.id
        AND r.final_rank = 1
       LEFT JOIN bg_teams w ON w.id = r.team_id
       WHERE t.state = 'FINISHED'
       ORDER BY t.finished_at DESC
       LIMIT 2`,
    );

    pushEntries(
      entries,
      winnerRows.map((row) => ({
        text: `VAINQUEUR · ${row.name} · ${row.winner_name ?? "Champion inconnu"}`,
        sortAt: new Date(row.finished_at ?? Date.now()).getTime(),
      })),
    );

    pushEntries(entries, await loadNewsEntries(db));

    const items = entries
      .sort((left, right) => right.sortAt - left.sortAt)
      .slice(0, 10)
      .map((entry) => entry.text);

    return ok({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LANDING_TICKER_FAILED";
    return fail(message || "LANDING_TICKER_FAILED", 500);
  }
}
