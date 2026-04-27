import { NextResponse } from "next/server";
import { ok } from "@/lib/server/http";
import { getLandingCalendar } from "@/lib/server/landing-service";
import type { LandingCalendarEvent } from "@/lib/shared/landing";

export const revalidate = 300;
export const dynamic = "force-dynamic";

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

function buildIcs(events: LandingCalendarEvent[]): string {
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
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "json").trim();
  const limit = parseLimit(url.searchParams.get("limit"));
  const events = await getLandingCalendar(limit);

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
}
