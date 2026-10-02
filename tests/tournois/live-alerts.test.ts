import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/shared/viewer-alerts");
jest.mock("@/app/(secured)/tournois/[id]/_lib/sounds");
jest.mock("@/app/(secured)/tournois/[id]/_lib/attention");

import { announceViewerChanges } from "@/app/(secured)/tournois/[id]/_lib/live-alerts";
import { raiseAttention } from "@/app/(secured)/tournois/[id]/_lib/attention";
import { playAlertChime } from "@/app/(secured)/tournois/[id]/_lib/sounds";
import { MATCH_LAUNCH_REFRESH_EVENT } from "@/lib/shared/match-launch";
import { isPersonalAlert, viewerAlert, viewerLaunchChanged } from "@/lib/shared/viewer-alerts";
import { tournamentDetail } from "../helpers/tournament-detail";

/**
 * Annonces au lecteur sur l'état **reçu** (`_lib/live-alerts.ts`) : la règle
 * de chaque annonce vit dans `lib/shared/viewer-alerts.ts` (testée à part) ;
 * on tient ici ce que l'annonce déclenche.
 */

const previous = tournamentDetail();
const next = tournamentDetail();
let win: EventTarget;
let launches: number;

beforeEach(() => {
  win = new EventTarget();
  launches = 0;
  win.addEventListener(MATCH_LAUNCH_REFRESH_EVENT, () => {
    launches += 1;
  });
  Object.assign(globalThis, { window: win });
  jest.mocked(viewerAlert).mockReturnValue(null);
  jest.mocked(isPersonalAlert).mockReturnValue(false);
  jest.mocked(viewerLaunchChanged).mockReturnValue(false);
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  jest.resetAllMocks();
});

describe("annonces au lecteur", () => {
  it("ne dit rien quand rien ne change pour lui", () => {
    announceViewerChanges(previous, next);
    expect(viewerAlert).toHaveBeenCalledWith(previous, next);
    expect(playAlertChime).not.toHaveBeenCalled();
    expect(raiseAttention).not.toHaveBeenCalled();
    expect(launches).toBe(0);
  });

  it("sonne et appelle l'attention sur une annonce personnelle", () => {
    jest.mocked(viewerAlert).mockReturnValue("MATCH_READY");
    jest.mocked(isPersonalAlert).mockReturnValue(true);
    announceViewerChanges(previous, next);
    expect(playAlertChime).toHaveBeenCalledWith("MATCH_READY");
    expect(raiseAttention).toHaveBeenCalledWith("MATCH_READY");
  });

  it("appelle l'attention sans sonner pour une annonce générale", () => {
    jest.mocked(viewerAlert).mockReturnValue("ROUND_STARTED");
    announceViewerChanges(previous, next);
    expect(playAlertChime).not.toHaveBeenCalled();
    expect(raiseAttention).toHaveBeenCalledWith("ROUND_STARTED");
  });

  it("signale à la modale de lancement chaque changement d'une rencontre du lecteur", () => {
    jest.mocked(viewerLaunchChanged).mockReturnValue(true);
    announceViewerChanges(null, next);
    expect(viewerLaunchChanged).toHaveBeenCalledWith(null, next);
    expect(launches).toBe(1);
  });
});
