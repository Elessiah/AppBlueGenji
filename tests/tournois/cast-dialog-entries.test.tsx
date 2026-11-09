/**
 * Fenêtres du cast (`docs/features/CAST_SETTINGS.md`) : refus du BattleTag
 * rattaché au champ, mode d'antenne non offert sur un match au score saisi,
 * « Configurer ma diffusion » sur un match joué ou sans changement, bascule
 * d'antenne partagée (`useOnAirToggle`) et styles hors ligne.
 */
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

jest.mock("react-dom", () => {
  const actual = jest.requireActual<typeof import("react-dom")>("react-dom");
  return { ...actual, createPortal: (node: unknown) => node };
});
jest.mock("@/lib/shared/hooks/useDialogBehavior", () => ({ useDialogBehavior: () => ({ current: null }) }));

import { renderToStaticMarkup } from "react-dom/server";
import { CastBattletagField, CastTriggerField } from "@/app/(secured)/tournois/[id]/_components/CastSettingsFields";
import { castLinkOrigin } from "@/app/(secured)/tournois/[id]/_components/CastSettingsDialog";
import { readSource } from "../helpers/read-source";
import frActions from "@/messages/fr/tournamentActions.json";
import enActions from "@/messages/en/tournamentActions.json";

const globalWithDocument = globalThis as { document?: unknown };
const hadDocument = "document" in globalWithDocument;
beforeAll(() => {
  if (!hadDocument) globalWithDocument.document = { body: {} };
});
afterAll(() => {
  if (!hadDocument) delete globalWithDocument.document;
});

const DIR = "app/(secured)/tournois/[id]";

describe("CastBattletagField — refus du serveur rattaché au champ", () => {
  it("CastBattletagField_serverRefusal_rendersFieldErrorAndDescribesInput", () => {
    const html = renderToStaticMarkup(
      <CastBattletagField id="bt" value="x" onChange={() => undefined} invalid fieldError="BattleTag refusé" />,
    );
    expect(html).toContain("BattleTag refusé");
    expect(html).toContain('aria-invalid="true"');
    expect(/<input[^>]*aria-describedby="[^"]*bt-error/.test(html)).toBe(true);
  });

  it("CastBattletagField_noRefusal_rendersNoError", () => {
    const html = renderToStaticMarkup(<CastBattletagField id="bt" value="" onChange={() => undefined} invalid={false} />);
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain('role="alert"');
  });
});

describe("CastTriggerField — match démarqué", () => {
  it("CastTriggerField_nullTriggerUnlocked_noRadioChecked", () => {
    const html = renderToStaticMarkup(<CastTriggerField trigger={null} startAt={null} onChange={() => undefined} />);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).not.toContain("checked");
  });

  it("CastTriggerField_nullTriggerLocked_rendersNothing", () => {
    expect(renderToStaticMarkup(<CastTriggerField trigger={null} startAt={null} onChange={() => undefined} locked />)).toBe("");
  });
});

describe("CastClaimDialog — mode d'antenne d'un match encore castable seulement", () => {
  it("CastClaimDialog_battletagRefusal_isAFieldError", () => {
    const claim = readSource(`${DIR}/_components/CastClaimDialog.tsx`);
    expect(claim).toContain('INVALID_CAST_BATTLETAG: "battletag"');
    expect(claim).toContain('fieldError={fieldErrors.message("battletag")}');
    expect(claim).toContain("trigger: triggerLocked || !castable ? undefined : trigger");
  });
});

describe("CastSettingsDialog — match joué, rien de changé, lecture", () => {
  const settings = readSource(`${DIR}/_components/CastSettingsDialog.tsx`);

  it("CastSettingsDialog_playedMatch_hidesLinkAndBattletag", () => {
    expect(settings).toContain('const played = match.status === "COMPLETED";');
    expect(settings).toContain("const streamEditable = cast !== null && !cast.staffStream && !played;");
    expect(settings).toContain("{!played && game !== null && battletagRelevantFor(game) && (");
    expect(settings).toContain('t("cardActions.castSettings.played")');
  });

  it("CastSettingsDialog_nothingChanged_saveDisarmed", () => {
    expect(settings).toContain("const blocked = !dirty ||");
  });

  it("CastSettingsDialog_linkUntouched_notRequired", () => {
    expect(settings).toContain('const urlMissing = streamEditable && urlChanged && url.trim() === "";');
  });

  it("CastSettingsDialog_loading_saysSoAndNonJsonErrorTolerated", () => {
    expect(settings).toContain('t("cardActions.castSettings.loading")');
    expect(settings).toContain("(await response.json().catch(() => ({}))) as OwnCast");
  });

  it("CastSettingsDialog_unmarkedMatch_noModePreselected", () => {
    expect(settings).toContain("(pickedTrigger ?? match.liveTrigger)");
  });

  it("CastDialogs_deadHintRules_removed", () => {
    expect(readSource(`${DIR}/_components/CastSettingsDialog.module.css`)).not.toContain(".hint");
    expect(readSource(`${DIR}/_components/CastClaimDialog.module.css`)).not.toContain(".hint");
  });

  it("CastSettingsDialog_and_MatchLiveDialog_shareOnAirToggle", () => {
    const live = readSource(`${DIR}/_components/MatchLiveDialog.tsx`);
    for (const source of [settings, live]) {
      expect(source).toContain("useOnAirToggle(match.id, onAir, { setBusy, onDone: onSaved })");
    }
    expect(live).not.toContain('style={{ margin: "0 0 14px" }}');
    expect(live).toContain("styles.sectionButton");
  });
});

describe("Textes ajoutés — FR et EN", () => {
  it("castSettings_loadingAndPlayed_frAndEn", () => {
    for (const messages of [frActions, enActions]) {
      expect(messages.cardActions.castSettings.loading).toEqual(expect.any(String));
      expect(messages.cardActions.castSettings.played).toEqual(expect.any(String));
    }
  });
});

describe("castLinkOrigin — la case « lien de l'organisation » (décision du 2026-11-09)", () => {
  it("castLinkOrigin_checkedAloneOnOwnLink_offeredAndChanged", () => {
    expect(castLinkOrigin({ organisationLink: false }, true, "https://twitch.tv/voix", true)).toEqual({ offered: true, changed: true });
  });

  it("castLinkOrigin_sameAsStored_notChanged", () => {
    expect(castLinkOrigin({ organisationLink: true }, true, "https://twitch.tv/voix", true)).toEqual({ offered: true, changed: false });
  });

  it("castLinkOrigin_emptyLink_notOffered", () => {
    expect(castLinkOrigin({ organisationLink: false }, true, "  ", true)).toEqual({ offered: false, changed: false });
  });

  it("castLinkOrigin_notAllowed_notOffered", () => {
    expect(castLinkOrigin({ organisationLink: false }, false, "https://twitch.tv/voix", true)).toEqual({ offered: false, changed: false });
  });
});
