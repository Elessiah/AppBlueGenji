/**
 * Fichier « .ics » de l'accueil : la description de chaque événement suit la
 * langue de la page qui l'a proposé (`lang=en` sous `/en`), le français
 * restant la valeur par défaut.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { LandingCalendarEvent } from "@/lib/shared/landing";

jest.mock("@/lib/server/api-guard", () => ({
  enforceRateLimit: () => null,
  LANDING_READ_RULE: {},
  requestClientIp: () => "127.0.0.1",
}));

const event: LandingCalendarEvent = {
  tournamentId: 42,
  name: "Coupe d'automne",
  game: "OW",
  startAt: "2026-10-12T18:00:00.000Z",
  registrationOpenAt: "2026-10-01T18:00:00.000Z",
  registrationCloseAt: "2026-10-11T18:00:00.000Z",
  state: "REGISTRATION",
  maxTeams: 16,
  registeredTeams: 4,
};

jest.mock("@/lib/server/landing-service", () => ({
  getLandingCalendar: async () => [event],
}));

import { GET } from "@/app/api/landing/calendar/route";

async function ics(query: string): Promise<string> {
  const res = await GET(new Request(`http://localhost/api/landing/calendar?${query}`));
  expect(res.headers.get("content-type")).toContain("text/calendar");
  return res.text();
}

describe("GET /api/landing/calendar?format=ics", () => {
  it("rédige la description en français par défaut", async () => {
    const body = await ics("format=ics");
    expect(body).toContain("DESCRIPTION:Inscriptions : 2026-10-01T18:00:00.000Z -> 2026-10-11T18:00:00.000Z");
  });

  it("la rédige en anglais pour la page anglaise", async () => {
    const body = await ics("format=ics&lang=en");
    expect(body).toContain("DESCRIPTION:Registration: 2026-10-01T18:00:00.000Z -> 2026-10-11T18:00:00.000Z");
    expect(body).not.toContain("Inscriptions");
  });

  it("ignore une langue inconnue et garde le français", async () => {
    expect(await ics("format=ics&lang=de")).toContain("DESCRIPTION:Inscriptions : ");
  });
});
