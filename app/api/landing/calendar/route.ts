import { NextResponse } from "next/server";
import type { TournamentCard } from "@/lib/shared/types";
import { fail, ok } from "@/lib/server/http";
import { listTournamentBuckets } from "@/lib/server/tournaments-service";

export const revalidate = 300;
export const dynamic = "force-dynamic";

type CalendarEvent = {
  tournamentId: number;
  name: string;
  startAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  state: "UPCOMING" | "REGISTRATION" | "RUNNING" | "FINISHED";
  maxTeams: number;
  registeredTeams: number;
};

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? "5");
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(50, Math.max(1, Math.trunc(parsed)));
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatIcsDate(value: string | Date): string {
  const date = new Date(value);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function toCalendarEvent(card: TournamentCard): CalendarEvent {
  return {
    tournamentId: card.id,
    name: card.name,
    startAt: card.startAt,
    registrationOpenAt: card.registrationOpenAt,
    registrationCloseAt: card.registrationCloseAt,
    state: card.state,
    maxTeams: card.maxTeams,
    registeredTeams: card.registeredTeams,
  };
}

function buildIcs(events: CalendarEvent[]): string {
  const appUrl = process.env.APP_URL?.trim() || "http://localhost:3000";
  const now = formatIcsDate(new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BlueGenji//Arena//FR",
    "CALSCALE:GREGORIAN",
  ];

  for (const event of events) {
    const start = new Date(event.startAt);
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);

    lines.push(
      "BEGIN:VEVENT",
      `UID:bg-tournament-${event.tournamentId}@bluegenji-esport.fr`,
      `DTSTAMP:${now}`,
      `DTSTART:${formatIcsDate(start)}`,
      `DTEND:${formatIcsDate(end)}`,
      `SUMMARY:${escapeIcsText(event.name)}`,
      `DESCRIPTION:${escapeIcsText(`Inscriptions : ${event.registrationOpenAt} -> ${event.registrationCloseAt}`)}`,
      `URL:${appUrl.replace(/\/$/, "")}/tournois/${event.tournamentId}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const format = (url.searchParams.get("format") ?? "json").trim();
    const limit = parseLimit(url.searchParams.get("limit"));
    const buckets = await listTournamentBuckets(null);
    const events = [...buckets.upcoming, ...buckets.registration, ...buckets.running]
      .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime())
      .slice(0, limit)
      .map(toCalendarEvent);

    if (format === "ics") {
      return new NextResponse(buildIcs(events), {
        status: 200,
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": 'attachment; filename="bluegenji.ics"',
        },
      });
    }

    return ok({ events });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LANDING_CALENDAR_FAILED";
    return fail(message || "LANDING_CALENDAR_FAILED", 500);
  }
}
