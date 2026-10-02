/**
 * Rendu figé des dialogues « Avancer le tournoi » et « Retirer un engagé ».
 * Ils partagent leur coquille (voile, cadre, titre, boutons) par
 * `TournamentDialogShell` : ces instantanés, pris avant la mise en commun,
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
