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
import { CastBattletagField, CastTriggerField, CastUrlField } from "@/app/(secured)/tournois/[id]/_components/CastSettingsFields";
import frErrors from "@/messages/fr/tournamentErrors.json";
import enErrors from "@/messages/en/tournamentErrors.json";
import frModal from "@/messages/fr/launchModal.json";
import enModal from "@/messages/en/launchModal.json";
import { LAUNCH_ERROR_MESSAGES } from "@/lib/shared/match-launch";
import { closedMatchUnchanged, mayEditReplay, offersCasterLinks, matchLiveBody, ownRefusalKey, refusalHasField, saveBlockedReason, streamedBoxReason } from "@/app/(secured)/tournois/[id]/_components/MatchLiveDialog";
import { readSource } from "../helpers/read-source";
import { castIdentityBlock, castSettable } from "@/app/(secured)/tournois/[id]/_components/CastSettingsDialog";
import frActions from "@/messages/fr/tournamentActions.json";
import enActions from "@/messages/en/tournamentActions.json";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
import enDialogs from "@/messages/en/tournamentDialogs.json";

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

describe("CastUrlField / CastBattletagField — une seule phrase de refus", () => {
  it("CastUrlField_serverRefusal_noStaticFormatNote", () => {
    const html = renderToStaticMarkup(
      <CastUrlField id="u" value="x" onChange={() => undefined} invalid fieldError="Ce stream est celui de l'organisation" />,
    );
    expect(html).toContain("Ce stream est celui de l&#x27;organisation");
    expect(html).not.toContain("Lien non reconnu");
    expect(/<input[^>]*aria-describedby="[^"]*u-error/.test(html)).toBe(true);
  });

  it("CastUrlField_clientRefusal_showsFormatNote", () => {
    const html = renderToStaticMarkup(<CastUrlField id="u" value="x" onChange={() => undefined} invalid />);
    expect(html).toContain("Lien non reconnu");
  });

  it("CastUrlField_required_labelAndAriaRequired", () => {
    const html = renderToStaticMarkup(<CastUrlField id="u" value="" onChange={() => undefined} invalid={false} required />);
    expect(html).toContain("Lien de ma chaîne (obligatoire)");
    expect(html).toContain('aria-required="true"');
    const optional = renderToStaticMarkup(<CastUrlField id="u" value="" onChange={() => undefined} invalid={false} />);
    expect(optional).not.toContain("aria-required");
  });

  it("CastBattletagField_serverRefusal_noStaticNote", () => {
    const html = renderToStaticMarkup(
      <CastBattletagField id="bt" value="x" onChange={() => undefined} invalid fieldError="BattleTag refusé" />,
    );
    expect(html).not.toContain("BattleTag invalide");
  });
});

describe("Raisons visibles et refus précis des fenêtres de cast", () => {
  const closed = { status: "COMPLETED" as const, liveTrigger: "AUTO" as const, liveStartedAt: null, launchedAt: null };

  it("refusalHasField_notStreamedUnderLockedMode_false", () => {
    expect(refusalHasField("MATCH_NOT_STREAMED", true)).toBe(false);
    expect(refusalHasField("MATCH_NOT_STREAMED", false)).toBe(true);
    expect(refusalHasField("INVALID_STREAM_URL", true)).toBe(true);
  });

  it("saveBlockedReason_closedLockedMode_locked", () => {
    expect(saveBlockedReason(closed, true, true, false)).toBe("locked");
  });

  it("saveBlockedReason_closedStillTicked_unchanged", () => {
    expect(saveBlockedReason(closed, false, true, false)).toBe("unchanged");
  });

  it("saveBlockedReason_closedWithLinkEdit_null", () => {
    expect(saveBlockedReason(closed, false, true, true)).toBeNull();
  });

  it("saveBlockedReason_openMatch_null", () => {
    expect(saveBlockedReason({ ...closed, status: "READY" }, false, true, false)).toBeNull();
  });

  it("CastUrlField_missing_showsCalmEmptyNoteWithoutInvalidState", () => {
    const html = renderToStaticMarkup(<CastUrlField id="u" value="" onChange={() => undefined} invalid={false} missing required />);
    expect(html).toContain("obligatoire : remets-le");
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("hintInvalid");
  });

  it("CastUrlField_staffStream_helpSaysWhyNotRequired", () => {
    const html = renderToStaticMarkup(
      <CastUrlField id="u" value="" onChange={() => undefined} invalid={false} readOnlyNote="Note staff" />,
    );
    expect(html).not.toContain("Obligatoire : sans lui");
  });

  it("ownRefusalKey_sessionAndStream_ownTexts", () => {
    expect(ownRefusalKey("UNAUTHORIZED")).toBe("live.sessionExpired");
    expect(ownRefusalKey("STREAM_NOT_FOUND")).toBe("live.casterStreamGone");
    expect(ownRefusalKey("INVALID_STREAM_URL")).toBeNull();
    expect(frDialogs.live.sessionExpired).toContain("session a expiré");
    expect(enDialogs.live.sessionExpired).toContain("session has expired");
    expect(frModal.errors.UNAUTHORIZED).toContain("session a expiré");
    expect(enModal.errors.UNAUTHORIZED).toContain("session has expired");
  });

  it("CastUrlField_staffNote_behindInfoHintNotPermanentParagraph", () => {
    const html = renderToStaticMarkup(
      <CastUrlField id="u" value="" onChange={() => undefined} invalid={false} readOnlyNote="Note staff" />,
    );
    expect(html.match(/Note staff/g)).toHaveLength(1);
    expect(html).not.toMatch(/<p id="[^"]*" class="[^"]*">Note staff/);
  });

  it("CastTriggerField_legend_plainTextHelpOutsideLegend", () => {
    const html = renderToStaticMarkup(<CastTriggerField trigger="AUTO" startAt={null} onChange={() => undefined} />);
    expect(html).toMatch(/<legend class="sr-only">[^<]+<\/legend>/);
  });

  it("MatchLiveDialog_source_noHardcodedTbdAndLegendPlain", () => {
    const live = readSource("app/(secured)/tournois/[id]/_components/MatchLiveDialog.tsx");
    expect(live).not.toContain('"TBD"');
    expect(live).toContain('t("schedule.tbd")');
    expect(live).toContain('<legend className="sr-only">{t("live.casterLinks")}</legend>');
    expect(live).toContain("aria-describedby={saveHintId(saveReason)}");
    expect(live).toContain("<SaveBlockedHint reason={saveReason} />");
  });

  it("CastSettingsDialog_playedMatch_closeInsteadOfDeadSaveAndHintedNote", () => {
    const settings = readSource(`${DIR}/_components/CastSettingsDialog.tsx`);
    expect(settings).toContain('played ? t("cardActions.castSettings.close") : t("cardActions.castSettings.cancel")');
    expect(settings).toContain("{!played && (");
    expect(settings).toContain('t("cardActions.castSettings.playedTitle")');
    expect(settings).toContain("missing={urlMissing}");
  });

  it("launchErrorText_castCodes_preciseFrAndEn", () => {
    for (const code of ["MATCH_CAST_CLAIM_FAILED", "MATCH_CAST_RELEASE_FAILED", "INVALID_CAST_TARGET"]) {
      expect(Object.keys(LAUNCH_ERROR_MESSAGES)).toContain(code);
      expect(frErrors.codes).toHaveProperty(code);
      expect(enErrors.codes).toHaveProperty(code);
      expect(frModal.errors).toHaveProperty(code);
      expect(enModal.errors).toHaveProperty(code);
    }
    expect(frActions.launch.sessionExpired).toContain("session a expiré");
    expect(enActions.launch.sessionExpired).toContain("session has expired");
    const text = readSource("app/(secured)/tournois/[id]/_lib/actions-text.ts");
    expect(text).toContain('if (code === "UNAUTHORIZED") return text.t("launch.sessionExpired");');
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
    expect(settings).toContain("requestJson<OwnCast>(");
    expect(readSource(`${DIR}/_lib/request-json.ts`)).toContain("response.json().catch(() => ({}))");
  });

  it("CastSettingsDialog_noLivePermission_hidesSettingsAndSaveShowsHint", () => {
    expect(settings).toContain("const settable = castSettable(controls);");
    expect(castSettable({ canManage: true, castBlock: null })).toBe(true);
    expect(castSettable({ canManage: false, castBlock: null })).toBe(false);
    expect(castSettable({ canManage: true, castBlock: "CASTER_DISCORD_REQUIRED" })).toBe(false);
    expect(settings).toContain("{cast !== null && settable && (");
    expect(settings).toContain("{!played && settable && (");
    expect(settings).toContain('t("cardActions.castSettings.noLive")');
  });

  it("castSettingsTexts_noLive_presentInFrAndEn", () => {
    expect(frActions.cardActions.castSettings.noLiveTitle).toBe("Permission de diffusion retirée");
    expect(enActions.cardActions.castSettings.noLiveTitle).toBe("Streaming permission removed");
    expect(frActions.cardActions.castSettings.noLive).toContain("te retirer");
    expect(enActions.cardActions.castSettings.noLive).toContain("withdraw");
  });

  it("CastSettingsDialog_triggerChanged_sendsSeenTrigger", () => {
    // Le mode vu au premier choix, jamais celui que le flux a livré depuis.
    expect(settings).toContain("settings.expectedTrigger = seenTrigger.current;");
    expect(settings).toContain("if (pickedTrigger === null) seenTrigger.current = liveTrigger;");
    expect(settings).toContain("onChange={pickTrigger}");
    expect(settings).not.toContain("settings.expectedTrigger = match.liveTrigger;");
  });

  it("CastSettingsDialog_identityBlock_hidesSettingsAndExplainsWhy", () => {
    // Identité de caster incomplète : réglages refusés par le serveur, seul le retrait reste.
    expect(settings).toContain("const identityBlock = castIdentityBlock(controls.castBlock);");
    expect(settings).toContain("<NotSettableHint titleId={titleId} identityBlock={identityBlock} identityText={fail} />");
    expect(settings).toContain("<p>{identityText(identityBlock)}</p>");
    expect(castIdentityBlock(null)).toBeNull();
    expect(castIdentityBlock("NOT_CASTER")).toBeNull();
    expect(castIdentityBlock("CASTER_IDENTITY_REQUIRED")).toBe("CASTER_IDENTITY_REQUIRED");
    expect(castIdentityBlock("CASTER_DISCORD_REQUIRED")).toBe("CASTER_DISCORD_REQUIRED");
  });

  it("castSettingsTexts_identityTitle_presentInFrAndEn", () => {
    expect(frActions.cardActions.castSettings.identityTitle).toBe("Identité de caster incomplète");
    expect(enActions.cardActions.castSettings.identityTitle).toBe("Caster identity incomplete");
    for (const code of ["CASTER_IDENTITY_REQUIRED", "CASTER_DISCORD_REQUIRED"] as const) {
      expect(frModal.errors[code]).toBeTruthy();
      expect(enModal.errors[code]).toBeTruthy();
    }
  });

  it("castErrors_liveTriggerChanged_presentFrEn", () => {
    expect(frErrors.codes.LIVE_TRIGGER_CHANGED).toContain("a changé pendant que la fenêtre était ouverte");
    expect(enErrors.codes.LIVE_TRIGGER_CHANGED).toContain("changed while the window was open");
    expect(frModal.errors.LIVE_TRIGGER_CHANGED).toBe(frErrors.codes.LIVE_TRIGGER_CHANGED);
    expect(enModal.errors.LIVE_TRIGGER_CHANGED).toBe(enErrors.codes.LIVE_TRIGGER_CHANGED);
    expect(LAUNCH_ERROR_MESSAGES.LIVE_TRIGGER_CHANGED).toBe(frErrors.codes.LIVE_TRIGGER_CHANGED);
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

describe("MatchLiveDialog — la seule `live` (revue sécurité #564)", () => {
  const live = readSource(`${DIR}/_components/MatchLiveDialog.tsx`);

  it("MatchLiveDialog_liveOnlyViewer_staffLinkReadOnly", () => {
    // Le serveur refuse ce lien (`STAFF_STREAM_FORBIDDEN`) : le champ ne l'invite pas.
    expect(live).toContain("const linkLocked = staffLinkLocked(triggerLocked, match) || !staffSide;");
    expect(live).toContain('if (!staffSide) return <p>{t("live.urlStaffOnly")}</p>;');
  });

  it("MatchLiveDialog_liveOnlyNonCaster_hidesReplayButton", () => {
    expect(live).toContain("canEditReplay(match, mayEditReplay(match, controls))");
    const controls = { canManage: true, canSchedule: false, viewerUserId: 12 };
    expect(mayEditReplay({ casters: [] }, controls)).toBe(false);
    expect(mayEditReplay({ casters: [{ userId: 12 }] }, controls)).toBe(true);
    expect(mayEditReplay({ casters: [] }, { ...controls, canSchedule: true })).toBe(true);
  });

  it("urlStaffOnly_frAndEn", () => {
    for (const messages of [frDialogs, enDialogs]) {
      expect(messages.live.urlStaffOnly).toEqual(expect.any(String));
    }
  });
});

describe("MatchLiveDialog — match joué (ERREUR.txt EF-29 #528, CAST-FOLLOWUP cycle 19 c)", () => {
  const played = { status: "COMPLETED" as const, liveTrigger: "AUTO" as const, liveStartedAt: null, launchedAt: null };
  const open = { ...played, status: "READY" as const };
  const link = [{ streamId: 3, liveUrl: "https://twitch.tv/b" }];

  it("closedMatchUnchanged_playedStillMarkedNoLinkEdit_true", () => {
    expect(closedMatchUnchanged(played, true, false)).toBe(true);
  });

  it("closedMatchUnchanged_playedUnmarked_false", () => {
    expect(closedMatchUnchanged(played, false, false)).toBe(false);
  });

  it("closedMatchUnchanged_playedWithCasterLinkEdit_false", () => {
    expect(closedMatchUnchanged(played, true, true)).toBe(false);
  });

  it("closedMatchUnchanged_playedNeverCast_true", () => {
    expect(closedMatchUnchanged({ ...played, liveTrigger: null }, false, false)).toBe(true);
  });

  it("closedMatchUnchanged_playedNeverCastWithCasterLinkEdit_true", () => {
    // Fermé au serveur (`MATCH_NOT_CASTABLE`) : rien à enregistrer, liens de casters compris.
    expect(closedMatchUnchanged({ ...played, liveTrigger: null }, false, true)).toBe(true);
  });

  it("offersCasterLinks_playedNeverMarked_false", () => {
    expect(offersCasterLinks({ ...played, liveTrigger: null }, true)).toBe(false);
  });

  it("offersCasterLinks_playedStillMarked_true", () => {
    expect(offersCasterLinks(played, true)).toBe(true);
  });

  it("offersCasterLinks_castableUnmarked_true", () => {
    expect(offersCasterLinks({ ...open, liveTrigger: null }, true)).toBe(true);
  });

  it("offersCasterLinks_notReferee_false", () => {
    expect(offersCasterLinks(played, false)).toBe(false);
  });

  it("streamedBoxReason_enabledBox_null", () => {
    expect(streamedBoxReason({ liveTrigger: null, liveTriggerCasterId: null }, false, true)).toBeNull();
  });

  it("streamedBoxReason_closedNeverCast_closed", () => {
    expect(streamedBoxReason({ liveTrigger: null, liveTriggerCasterId: null }, true, false)).toBe("closed");
  });

  it("streamedBoxReason_ownerlessMode_orphan", () => {
    expect(streamedBoxReason({ liveTrigger: "AUTO", liveTriggerCasterId: null }, true, true)).toBe("orphan");
  });

  it("closedMatchUnchanged_castableMatch_false", () => {
    expect(closedMatchUnchanged(open, true, false)).toBe(false);
  });

  it("matchLiveBody_playedKeptMarked_sendsOnlyCasterLinks", () => {
    expect(matchLiveBody({ castable: false, trigger: "AUTO", liveUrl: "https://twitch.tv/a", organisationLink: true, streamLinks: link })).toEqual({
      streamLinks: link,
    });
  });

  it("matchLiveBody_playedUnmarked_sendsNullTriggerAndLink", () => {
    expect(matchLiveBody({ castable: false, trigger: null, liveUrl: "https://twitch.tv/a", organisationLink: undefined, streamLinks: undefined })).toEqual({
      trigger: null,
      liveUrl: null,
    });
  });

  it("matchLiveBody_castable_sendsTrimmedLinkAndOrigin", () => {
    expect(matchLiveBody({ castable: true, trigger: "MANUAL", liveUrl: "  https://twitch.tv/a ", organisationLink: false, streamLinks: undefined })).toEqual({
      trigger: "MANUAL",
      liveUrl: "https://twitch.tv/a",
      organisationLink: false,
    });
  });

  it("matchLiveBody_castableEmptyLink_sendsNullLink", () => {
    expect(matchLiveBody({ castable: true, trigger: "AUTO", liveUrl: " ", organisationLink: undefined, streamLinks: undefined })).toEqual({
      trigger: "AUTO",
      liveUrl: null,
    });
  });

  it("matchLiveBody_castableEmptyLinkWithOrigin_omitsOrganisationLink", () => {
    expect(matchLiveBody({ castable: true, trigger: "AUTO", liveUrl: " ", organisationLink: true, streamLinks: undefined })).toEqual({
      trigger: "AUTO",
      liveUrl: null,
    });
  });

  it("matchLiveBody_unmarkedWithOrigin_omitsOrganisationLink", () => {
    expect(matchLiveBody({ castable: true, trigger: null, liveUrl: "https://twitch.tv/a", organisationLink: true, streamLinks: undefined })).toEqual({
      trigger: null,
      liveUrl: null,
    });
  });

  it("MatchLiveDialog_staffLink_resyncedWhenUntouchedAndNoInlineStyle", () => {
    const live = readSource("app/(secured)/tournois/[id]/_components/MatchLiveDialog.tsx");
    expect(live).toContain("if (liveUrl === seen) setLiveUrl(current);");
    expect(live).not.toContain("style={{");
    expect(live).not.toMatch(/var\(--[a-z-]+, #/);
  });

  it("MatchLiveDialog_notStreamedRefusal_attachedToTheStreamedCheckbox", () => {
    const live = readSource("app/(secured)/tournois/[id]/_components/MatchLiveDialog.tsx");
    expect(live).toContain('MATCH_NOT_STREAMED: "streamed"');
    expect(live).toContain("{...fieldAria(STREAMED_INPUT_ID, invalid, reason !== null && STREAMED_HINT_ID)}");
    expect(live).toContain('<FieldErrorText fieldId={STREAMED_INPUT_ID} message={error} />');
    // Sous un mode verrouillé la case n'existe pas : le refus n'y est pas rattaché.
    expect(live).toContain("refusalHasField(code, triggerLocked && match.liveTrigger !== null)");
  });

  it("MatchLiveDialog_neverCastClosedMatch_checkboxDisabled", () => {
    const live = readSource("app/(secured)/tournois/[id]/_components/MatchLiveDialog.tsx");
    expect(live).toContain("streamedBoxDisabled(match, viewer, castable)");
    expect(live).toContain("(!castable && match.liveTrigger === null)");
  });

  it("MatchLiveDialog_modeChange_resetsLinkThroughTheHook", () => {
    const live = readSource("app/(secured)/tournois/[id]/_components/MatchLiveDialog.tsx");
    expect(live).toContain("resetLiveUrl();");
    expect(live).not.toContain("setLiveUrl(currentStaffUrl)");
  });

  it("MATCH_NOT_STREAMED_enText_quotesTheDialogLabel", () => {
    const enErrors = JSON.parse(readSource("messages/en/tournamentErrors.json")) as { errors?: Record<string, string> } & Record<string, unknown>;
    const text = JSON.stringify(enErrors);
    expect(text).toContain(`“${enDialogs.live.streamed}”`);
  });
});
