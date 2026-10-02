/**
 * Rendu figé des quatre cartes de `/tournois`. Elles partagent leur cadre
 * (plaque, bandeau, ruban, en-tête, titre), leurs cases d'informations et leur
 * jauge par `cards/CardParts.tsx` : ces instantanés, pris avant la mise en
 * commun, prouvent que le balisage rendu n'a pas bougé — et le gardent.
 *
 * Les dates passent par un double fixe : leur mise en forme dépend du fuseau de
 * la machine, que ces instantanés n'ont pas à figer.
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/app/(secured)/tournois/_lib/card-display", () => {
  const actual = jest.requireActual<typeof import("@/app/(secured)/tournois/_lib/card-display")>(
    "@/app/(secured)/tournois/_lib/card-display",
  );
  return {
    ...actual,
    formatCardDate: (iso: string | null, withTime: boolean) => `«${iso}${withTime ? " +h" : ""}»`,
  };
});

import { renderToStaticMarkup } from "react-dom/server";
import { FinishedCard } from "@/app/(secured)/tournois/cards/FinishedCard";
import { RegistrationCard } from "@/app/(secured)/tournois/cards/RegistrationCard";
import { RunningCard } from "@/app/(secured)/tournois/cards/RunningCard";
import { StateCard } from "@/app/(secured)/tournois/cards/StateCard";
import { UpcomingCard } from "@/app/(secured)/tournois/cards/UpcomingCard";
import { tournamentCard } from "../helpers/tournament-card";

beforeAll(() => {
  jest.useFakeTimers({ now: new Date("2026-05-05T10:00:00.000Z") });
});
afterAll(() => {
  jest.useRealTimers();
});

const DATES = {
  startVisibilityAt: "2026-05-01T10:00:00.000Z",
  registrationOpenAt: "2026-05-02T10:00:00.000Z",
  registrationCloseAt: "2026-05-10T10:00:00.000Z",
  startAt: "2026-05-12T10:00:00.000Z",
};

type Overrides = Parameters<typeof tournamentCard>[0];

describe("RunningCard — rendu inchangé", () => {
  it.each<[string, Overrides]>([
    ["déroulement connu, avec description", { runningProgress: 0.576, description: "Saison 3" }],
    ["déroulement inconnu, en solo", { runningProgress: null, participantType: "SOLO" }],
    ["ronde suisse", { format: "SWISS", runningProgress: 0.25 }],
  ])("%s", (_label, overrides) => {
    expect(
      renderToStaticMarkup(<RunningCard t={tournamentCard({ ...DATES, state: "RUNNING", ...overrides })} priority />),
    ).toMatchSnapshot();
  });
});

describe("RegistrationCard — rendu inchangé", () => {
  it.each<[string, Overrides]>([
    ["places libres", { registeredTeams: 3, maxTeams: 8 }],
    ["complet", { registeredTeams: 8, maxTeams: 8, description: "Places limitées" }],
  ])("%s", (_label, overrides) => {
    expect(
      renderToStaticMarkup(<RegistrationCard t={tournamentCard({ ...DATES, state: "REGISTRATION", ...overrides })} />),
    ).toMatchSnapshot();
  });
});

describe("UpcomingCard — rendu inchangé", () => {
  it.each<[string, Overrides]>([
    ["inscriptions bientôt", { registrationOpenAt: "2026-05-06T10:00:00.000Z" }],
    ["inscriptions closes", { registrationCloseAt: "2026-05-04T10:00:00.000Z" }],
  ])("%s", (_label, overrides) => {
    expect(
      renderToStaticMarkup(<UpcomingCard t={tournamentCard({ ...DATES, state: "UPCOMING", ...overrides })} />),
    ).toMatchSnapshot();
  });
});

describe("FinishedCard — rendu inchangé", () => {
  it.each<[string, Overrides]>([
    ["avec vainqueur", { finishedAt: "2026-05-13T18:00:00.000Z", champion: { teamId: 4, name: "Nova" } }],
    ["sans vainqueur ni date de clôture", { finishedAt: null, champion: null }],
  ])("%s", (_label, overrides) => {
    expect(
      renderToStaticMarkup(<FinishedCard t={tournamentCard({ ...DATES, state: "FINISHED", ...overrides })} />),
    ).toMatchSnapshot();
  });
});

describe("StateCard — aiguillage inchangé", () => {
  it("rend la carte de l'état", () => {
    expect(renderToStaticMarkup(<StateCard t={tournamentCard({ ...DATES, state: "RUNNING" })} />)).toBe(
      renderToStaticMarkup(<RunningCard t={tournamentCard({ ...DATES, state: "RUNNING" })} />),
    );
  });
});
