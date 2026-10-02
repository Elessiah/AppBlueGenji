/**
 * Rendu figé des dialogues staff de la fiche tournoi. « Avancer le tournoi » et
 * « Retirer un engagé » partagent leur coquille (voile, cadre, titre, boutons)
 * par `TournamentDialogShell` ; suppression, retour en arrière, pénalité,
 * signalement et diffusion partagent le voile et le cadre par
 * `TournamentDialogFrame`. Ces instantanés, pris avant chaque mise en commun,
 * prouvent que le balisage rendu n'a pas bougé — et le gardent.
 *
 * Rendu serveur : le portail est remplacé par son contenu, l'effet qui monte
 * le dialogue s'exécute sur-le-champ (React rejoue alors le rendu), les hooks
 * de comportement — qui touchent au DOM — sont neutralisés, et les dates sont
 * figées hors du fuseau de la machine.
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
// Le premier effet du rendu — celui qui monte le dialogue — s'exécute une
// fois ; le rendu rejoué ne le relance pas, sans quoi il bouclerait.
const effects = { armed: false };
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: (effect: () => void) => {
      if (!effects.armed) return;
      effects.armed = false;
      effect();
    },
  };
});
jest.mock("@/lib/shared/hooks/useDialogBehavior", () => ({ useDialogBehavior: () => ({ current: null }) }));
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showError: () => undefined, showSuccess: () => undefined }),
}));
jest.mock("@/lib/shared/dates", () => ({
  formatLocalDateTime: (date: string) => `«${date}»`,
}));

import { renderToStaticMarkup } from "react-dom/server";
import { AdvanceTournamentDialog } from "@/app/(secured)/tournois/[id]/_components/AdvanceTournamentDialog";
import { RemoveEntrantDialog } from "@/app/(secured)/tournois/[id]/_components/RemoveEntrantDialog";
import { DeleteTournamentDialog } from "@/app/(secured)/tournois/[id]/_components/DeleteTournamentDialog";
import { EndurancePenaltyDialog } from "@/app/(secured)/tournois/[id]/_components/EndurancePenaltyDialog";
import { IssueReportDialog } from "@/app/(secured)/tournois/[id]/_components/IssueReportDialog";
import { MatchLiveDialog } from "@/app/(secured)/tournois/[id]/_components/MatchLiveDialog";
import { RollbackRoundDialog } from "@/app/(secured)/tournois/[id]/_components/RollbackRoundDialog";
import { bracketMatch } from "../helpers/bracket-match";
import { tournamentCard } from "../helpers/tournament-card";

const globalWithDocument = globalThis as { document?: unknown };
const hadDocument = "document" in globalWithDocument;
beforeAll(() => {
  if (!hadDocument) globalWithDocument.document = { body: {} };
  jest.useFakeTimers({ now: new Date("2026-05-05T10:00:00.000Z") });
});
afterAll(() => {
  if (!hadDocument) delete globalWithDocument.document;
  jest.useRealTimers();
});

const noop = () => undefined;

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  effects.armed = true;
  return renderToStaticMarkup(element);
}

// Horloge figée au 5 mai : inscriptions ouvertes (2 → 10 mai), coup d'envoi le 12.
const OPEN = { registrationOpenAt: "2026-05-02T10:00:00.000Z", registrationCloseAt: "2026-05-10T10:00:00.000Z" };
const CLOSED = { registrationOpenAt: "2026-05-01T10:00:00.000Z", registrationCloseAt: "2026-05-04T10:00:00.000Z" };
const NOT_YET = { registrationOpenAt: "2026-05-06T10:00:00.000Z", registrationCloseAt: "2026-05-10T10:00:00.000Z" };

describe("AdvanceTournamentDialog — rendu inchangé", () => {
  it.each<[string, Parameters<typeof tournamentCard>[0]]>([
    ["ouverture des inscriptions", { ...NOT_YET, startVisibilityAt: "2026-05-01T10:00:00.000Z" }],
    ["ouverture d'un tournoi masqué", { ...NOT_YET, startVisibilityAt: "2026-05-07T10:00:00.000Z" }],
    ["clôture des inscriptions", { ...OPEN, registeredTeams: 4 }],
    ["coup d'envoi", { ...CLOSED, registeredTeams: 6 }],
    ["coup d'envoi à un engagé", { ...CLOSED, registeredTeams: 1 }],
    ["coup d'envoi sans engagé, en solo", { ...CLOSED, registeredTeams: 0, participantType: "SOLO" }],
  ])("%s", (_label, overrides) => {
    expect(
      render(
        <AdvanceTournamentDialog card={tournamentCard(overrides)} onClose={noop} onAdvanced={noop} />,
      ),
    ).toMatchSnapshot();
  });
});

describe("DeleteTournamentDialog — rendu inchangé", () => {
  it("demande le nom du tournoi", () => {
    expect(
      render(
        <DeleteTournamentDialog tournamentId={7} tournamentName="Coupe d'hiver" onClose={noop} onDeleted={noop} />,
      ),
    ).toMatchSnapshot();
  });
});

describe("RollbackRoundDialog — rendu inchangé", () => {
  it.each<[string, boolean]>([
    ["tournoi en cours", false],
    ["tournoi terminé", true],
  ])("%s", (_label, tournamentFinished) => {
    expect(
      render(
        <RollbackRoundDialog
          tournamentId={7}
          stageLabel="la manche 2"
          stageKey="R2"
          matches={[
            bracketMatch({ id: 11, team1Name: "Frost Alliance", team2Name: "Nova", team1Score: 2, team2Score: 1 }),
            bracketMatch({ id: 12, team1Name: "Kairos", team2Name: "Zenith" }),
          ]}
          tournamentFinished={tournamentFinished}
          onClose={noop}
          onRolledBack={noop}
        />,
      ),
    ).toMatchSnapshot();
  });
});

describe("EndurancePenaltyDialog — rendu inchangé", () => {
  it.each<[string, number]>([
    ["avant la première manche", 0],
    ["en cours de qualification", 3],
  ])("%s", (_label, round) => {
    expect(
      render(
        <EndurancePenaltyDialog
          tournamentId={7}
          teamId={3}
          teamName="Frost Alliance"
          currentPoints={6}
          round={round}
          onClose={noop}
          onApplied={noop}
        />,
      ),
    ).toMatchSnapshot();
  });
});

describe("IssueReportDialog — rendu inchangé", () => {
  it.each<[string, Parameters<typeof bracketMatch>[0] | null]>([
    ["tout le tournoi", null],
    ["une manche", { id: 11, roundNumber: 2, team1Name: "Frost Alliance", team2Name: "Nova" }],
  ])("%s", (_label, match) => {
    expect(
      render(<IssueReportDialog tournamentId={7} match={match ? bracketMatch(match) : null} onClose={noop} />),
    ).toMatchSnapshot();
  });
});

describe("MatchLiveDialog — rendu inchangé", () => {
  it.each<[string, Parameters<typeof bracketMatch>[0]]>([
    ["sans diffusion", {}],
    ["diffusée en direct", { liveTrigger: "MANUAL", liveUrl: "https://twitch.tv/bluegenji" }],
  ])("%s", (_label, overrides) => {
    expect(
      render(
        <MatchLiveDialog
          match={bracketMatch({ id: 11, team1Name: "Frost Alliance", team2Name: "Nova", ...overrides })}
          onClose={noop}
          onSaved={noop}
        />,
      ),
    ).toMatchSnapshot();
  });
});

describe("RemoveEntrantDialog — rendu inchangé", () => {
  it.each<[string, Parameters<typeof tournamentCard>[0]]>([
    ["inscriptions ouvertes", OPEN],
    ["inscriptions closes", CLOSED],
  ])("%s", (_label, overrides) => {
    expect(
      render(
        <RemoveEntrantDialog
          card={tournamentCard(overrides)}
          teamId={3}
          entrantName="Frost Alliance"
          onClose={noop}
          onRemoved={noop}
        />,
      ),
    ).toMatchSnapshot();
  });
});
