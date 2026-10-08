import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
import frTournament from "@/messages/fr/tournament.json";
import enTournament from "@/messages/en/tournament.json";

/** Messages des fenêtres d'action (lot 8b) : les phrases y vivent, la source les cite par clé. */
const FR_SCORE = frDialogs.score;

/**
 * Câblage du détail map par map (`docs/features/MAP_SCORES.md`) aux endroits
 * que les tests de comportement n'atteignent pas sans monter tout un moteur.
 */
describe("détail map par map — effacé avec ce qu'il documente", () => {
  it.each([
    "lib/server/tournaments/bg-survie/forfeit.ts",
    "lib/server/tournaments/survival.ts",
    "lib/server/tournaments/swiss.ts",
    "lib/server/tournaments/rollback.ts",
  ])("%s efface tout le détail d'un match défait ou abandonné", (path) => {
    expect(readSource(path)).toMatch(/clearMapSets\(.*ALL_MAP_SOURCES\)/);
  });

  it("la clôture efface les propositions, après promotion de celle qui fait foi", () => {
    const scoring = readSource("lib/server/tournaments/scoring.ts");
    expect(scoring).toMatch(/clearMapSets\(connection, \[Number\(match\.id\)\], REPORTED_MAP_SOURCES\)/);
    expect(scoring.indexOf("await promoteReportedMaps(")).toBeLessThan(scoring.lastIndexOf("await finalizeMatch(connection, tournamentId, updated"));
  });
});

describe("détail map par map — entretien de l'instantané", () => {
  it("un interblocage de l'entretien rend l'instantané sur l'état d'avant, sans 500", () => {
    const snapshot = readSource("lib/server/tournaments/snapshot.ts");
    expect(snapshot).toMatch(/if \(isTransactionAborted\(error\)\) return tournamentRow;/);
  });
});

describe("détail map par map — affichage", () => {
  it("la carte ouvre le détail dans une modale, jamais dans un volet qui grandit le créneau", () => {
    const details = readSource("app/(secured)/tournois/[id]/_components/MatchMapDetails.tsx");
    expect(details).not.toContain("<details");
    expect(details).toContain("createPortal(");
    expect(details).toContain("useDialogBehavior({ open: true, onClose })");
  });

  it("une map posée sans code dit « Pas de code de replay » au lieu d'un code vide à copier", () => {
    const details = readSource("app/(secured)/tournois/[id]/_components/MatchMapDetails.tsx");
    expect(details).toMatch(/\{map\.replayCode === "" \? \(\s*<span className=\{styles\.noCode\}>\{t\("match\.maps\.noReplayCode"\)\}<\/span>\s*\) : \(/);
    expect(frTournament.match.maps.noReplayCode).toBe("Pas de code de replay");
    expect(enTournament.match.maps.noReplayCode).toBe("No replay code");
    const css = readSource("app/(secured)/tournois/[id]/_components/MatchMapDetails.module.css");
    expect(css).toMatch(/\.noCode \{/);
  });

  it("l'arbitrage voit le détail des deux propositions en désaccord", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toMatch(/match\.team1Report && match\.team2Report[\s\S]{0,600}<MapResultList maps=\{report\.maps\}/);
  });
});

describe("détail map par map — focus et interblocages", () => {
  it("retirer une map rend le focus à la ligne suivante, sinon au code de la ligne vierge", () => {
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    expect(list).toContain("focusAfterRemove.current = index;");
    expect(list).toContain("id={`${idPrefix}-map-${index}-remove`}");
    expect(list).toContain("const index = Math.max(Math.min(target, maps.length - 1), 0);");
    expect(list).toMatch(/document\.getElementById\(`\$\{idPrefix\}-map-\$\{index\}-remove`\) \?\?\s*document\.getElementById\(mapFieldId\(idPrefix, index, "replayCode"\)\)/);
  });

  it("plus de bouton « Ajouter une map » : les lignes viennent seules, au fil du format", () => {
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    expect(list).not.toContain("-map-add");
    expect(list).not.toContain('t("score.maps.add")');
    expect(list).not.toContain("focusNewRow");
    expect(list).not.toContain("const add = () => {");
  });

  it("la modale de détail reste lisible si le détail disparaît, et rend le focus à la carte", () => {
    const details = readSource("app/(secured)/tournois/[id]/_components/MatchMapDetails.tsx");
    expect(details).toContain("if (!hasMaps && !open) return null;");
    expect(details).toContain("document.getElementById(matchAnchorId(match.id))?.focus()");
    expect(details).toContain('aria-label={text.t("match.maps.summaryLabel", { count: String(match.maps.length), match: versusText(text, team1, team2) })}');
  });

  it("en désaccord, l'engagé voit le détail adverse", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toMatch(/\{showTheirMaps && view\?\.theirs && \([\s\S]{0,300}<MapResultList/);
    expect(dialog).toContain('if (phase === "CONFLICT") return true;');
  });

  it("une ligne vierge qu'on vient d'ajouter n'affiche pas de reproche", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toMatch(/const showBlocker = blocker !== null && \(unchangedMine \|\| touched\);/);
  });

  it("le forfait déclaré par une engagée est rejoué sur interblocage", () => {
    const index = readSource("lib/server/tournaments/index.ts");
    expect(index).toMatch(/await retryOnDeadlock\(\(\) =>\s*runPlayerMatchWrite\(tournamentId, matchId, \(connection\) =>\s*forfeitOwnMatch\(/);
  });
});

describe("détail map par map — champs vides", () => {
  it("quitter un score vide sans saisie ne lève pas son refus, et pas de 0 – 0 sans map", () => {
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    expect(list).toContain("if (Object.is(maps[index]?.[field], patch[field])) return;");
    expect(list).toMatch(/\{played > 0 && \(\s*<output className=\{styles\.summary\}>/);
  });
});

describe("détail map par map — arbitrage et relecture", () => {
  it("le refus d'une map passe avant « score incomplet », et le bouton reste actionnable pour le désigner", () => {
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(hook.indexOf("if (sendMaps && refuseMaps(decisive)) return false;")).toBeLessThan(
      hook.indexOf("const blocker = action === \"save\" ? decision.saveBlocker : decision.resolveBlocker;"),
    );
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toContain("disabled={(!form.decision.canResolve && !form.mapsRefused.resolve) || form.submitting || awaitingDetail}");
  });

  it("la relecture du détail adverse se retente tant qu'il manque, au plus trois fois", () => {
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useProposalMaps.ts");
    expect(hook).toContain("const PROPOSAL_REFRESH_ATTEMPTS = 3;");
    expect(hook).toMatch(/if \(tries < PROPOSAL_REFRESH_ATTEMPTS\) timer = setTimeout\(attempt, PROPOSAL_REFRESH_DELAY_MS\);/);
    expect(hook).toContain("if (timer !== null) clearTimeout(timer);");
  });
});

describe("détail map par map — noms accessibles", () => {
  it("chaque champ nomme sa map, et la phrase d'erreur reste hors du label", () => {
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    // Lot 8b : « Map N, » / « Map N, score de » passent par les messages.
    expect(list.match(/<span className="sr-only">\{t\("score\.maps\.(mapPrefix|scoreOf)", \{ index: index \+ 1 \}\)\}<\/span>/g)).toHaveLength(3);
    expect(FR_SCORE.maps.mapPrefix).toBe("Map {index}, ");
    expect(FR_SCORE.maps.scoreOf).toBe("Map {index}, score de ");
    expect(list).not.toMatch(/<FieldErrorText[^>]*\/>\s*<\/label>/);
  });
});

describe("détail map par map — refus rattachés au champ", () => {
  it("le dialogue d'arbitrage rattache un refus de map à son champ", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toMatch(/onMapRefusal: \(field, message\) => mapFieldErrors\.flag\(mapFieldKey\(field\.index, field\.field\), message\)/);
    expect(dialog).toContain("fieldErrors={mapFieldErrors}");
  });

  it("le désaccord à score égal dit que ce sont les maps qui diffèrent", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toContain('text.t("score.player.conflictMaps"');
    expect(FR_SCORE.player.conflictMaps).toContain("mais le détail des maps diffère");
  });
});

describe("détail map par map — retours de la revue UI/UX", () => {
  const list = () => readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");

  it("le compteur annonce le format, les maps nulles rejouées en sus", () => {
    expect(list()).toContain("const shownLimit = format ? matchMaxMaps(format) : limit;");
    expect(list()).toContain("({played}/{Math.max(shownLimit, played)})");
    // La ligne vierge ouverte ne compte pas comme une map jouée.
    expect(list()).toContain("const played = maps.filter(isMapTouched).length;");
    expect(list()).toContain('t("score.maps.replayAllowance", { count: limit - shownLimit })');
    expect(FR_SCORE.maps.replayAllowance).toBe("Une map nulle peut être rejouée ({count} au plus).");
  });

  it("la liste passe sur deux lignes selon sa propre largeur (modale de 460 px)", () => {
    const css = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.module.css");
    expect(css).toContain("container-type: inline-size;");
    expect(css).toContain("@container (max-width: 560px)");
    expect(css).not.toContain("@media (max-width: 560px)");
  });

  it("l'infobulle d'un bouton actionnable sur une map refusée dit ce refus, pas « score incomplet »", () => {
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(hook).toContain("const resolve = checkMapList(format, game, maps, { decisive: true, ...ADMIN_MAP_RULES });");
    expect(hook).toContain("resolve: isStructuralBlocker(decision.resolveBlocker) ? null : resolve.error,");
  });

  it("un forfait ou une saisie fermée taisent les refus de map : la liste est masquée et ses maps ne partent pas", () => {
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(hook).toMatch(/const mapsSent =\s*maps\.some\(isMapTouched\) &&\s*options\.scoreEntryClosed !== true &&\s*state\.forfeitTeamId === undefined &&\s*state\.doubleForfeit !== true;/);
    expect(hook).toContain("mapsRefused: mapRefusals(matchFormat, game, mapsSent ? sentMaps : [], decision),");
    expect(hook).toContain("const sendMaps = mapsSent;");
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toContain("if (input.mapRefusal && input.onBlankRow) return input.idle;");
    expect(dialog).toContain("if (input.mapRefusal) return mapViolationText(text, input.mapRefusal, input.format, input.game);");
    expect(dialog).toContain("title={buttonTitle(form.mapsRefused.save, form.decision.saveBlocker,");
    expect(dialog).toContain("title={buttonTitle(form.mapsRefused.resolve, form.decision.resolveBlocker,");
  });

  it("une proposition adverse dont le détail reste introuvable invite à actualiser au lieu de « Confirme-le »", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toContain('if ((theirs.maps ?? []).length > 0) return text.t("score.player.theirs.withMaps", values);');
    expect(dialog).toContain('return text.t("score.player.theirs.withoutMaps", values);');
    expect(FR_SCORE.player.theirs.withoutMaps).toContain("mais le détail de ses maps n'a pas pu être lu. Actualise la page pour le confirmer");
  });

  it("un détail adverse encore en lecture est annoncé comme tel, sans inviter à ressaisir", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toContain("return canRead && proposalsNeedRefresh(match, proposals);");
    expect(dialog).toContain('if (reader.detailLoading) return text.t("score.player.theirs.loading", values);');
    expect(FR_SCORE.player.theirs.loading).toContain("Lecture du détail de ses maps…");
    expect(dialog.indexOf("if ((theirs.maps ?? []).length > 0)")).toBeLessThan(dialog.indexOf("if (reader.detailLoading) return"));
  });
});

describe("détail map par map — arbitrage pendant la lecture du détail proposé", () => {
  it("les boutons de score attendent le détail de la proposition, pour ne pas en effacer les codes", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toMatch(/const awaitingDetail =\s*proposalsNeedRefresh\(liveMatch, proposals\) &&\s*!form\.maps\.some\(isMapTouched\)/);
    expect(dialog).toContain("|| form.submitting || awaitingDetail}");
    expect(dialog).toContain("!form.submitting && !awaitingDetail) void run(\"resolve\");");
    expect(dialog).toContain('if (input.awaitingDetail) return text.t("score.admin.awaitingDetail");');
  });

  it("la phrase visible suit l'ordre de l'infobulle : détail, map refusée renseignée, puis score", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    const order = [
      'if (input.awaitingDetail) return text.t("score.admin.awaitingDetail");',
      "if (input.mapRefusal) return mapViolationText(text, input.mapRefusal, input.format, input.game);",
      "return input.blocker ? scoreBlockerText(text, input.blocker, input.format) : null;",
    ].map((line) => dialog.indexOf(line, dialog.indexOf("function visibleBlocker(")));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(dialog).toContain("mapRefusal: form.maps.some(isMapTouched) ? mapRefusal : null,");
    // Refus sur une ligne vierge : aucune phrase, ni le refus de map, ni le 0 – 0 dérivé.
    expect(dialog).toContain("blankMaps: mapRefusal !== null && form.mapsRefused.onBlankRow,");
    const visible = dialog.slice(dialog.indexOf("function visibleBlocker("));
    expect(visible.indexOf("if (input.blankMaps) return null;")).toBeLessThan(visible.indexOf("if (input.mapRefusal) return"));
  });

  it("une erreur sous un champ ne décale pas la ligne ; le bouton de détail est en retrait", () => {
    const css = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.module.css");
    expect(css).toContain("align-items: start;");
    expect(css).not.toContain("align-items: end;");
    expect(css).toMatch(/\.remove \{[^}]*margin-top: 20px;/);
    const details = readSource("app/(secured)/tournois/[id]/_components/MatchMapDetails.module.css");
    expect(details).toMatch(/\.summary \{[^}]*margin: 0 12px;/);
    expect(details).not.toContain("margin: 0 0 -6px;");
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toContain("{blockerText && <output");
  });
});

describe("détail map par map — saisie du code et confirmation sans détail", () => {
  it("le code de replay se saisit brut : pas de réécriture qui déplacerait le curseur", () => {
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    expect(list).toContain("onChange={(event) => update(index, { replayCode: event.target.value }, \"replayCode\")}");
    expect(list).not.toContain("event.target.value.toUpperCase()");
    const css = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.module.css");
    expect(css).toContain("text-transform: uppercase;");
  });

  it("seules les mêmes maps confirment la proposition adverse ; sans détail, l'envoi reste une proposition", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toContain("const confirmsAsIs = confirmsTheirs && confirmsProposalMaps(maps, view?.theirs?.maps ?? []);");
    expect(dialog).toContain("return theirMaps.length > 0 && sameMapLists(maps, theirMaps);");
    expect(dialog).not.toContain("if (theirMaps.length === 0) return !detailLoading;");
  });

  it("un détail adverse encore en lecture ne fait pas de l'envoi une confirmation (pas de faux PROPOSAL_STALE)", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog.indexOf("const detailLoading = ")).toBeLessThan(dialog.indexOf("const confirmsAsIs ="));
  });
});

describe("détail map par map — refus d'un score de map en cours de correction", () => {
  it("vider un score de map pour le ressaisir retire le refus qui le désigne", () => {
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    expect(list).toContain("onEdit={() => fieldErrors.clear(t1Key)}");
    expect(list).toContain("onEdit={() => fieldErrors.clear(t2Key)}");
  });
});

describe("détail map par map — correction d'un résultat validé", () => {
  it("une map refusée se désigne avant la confirmation de correction, qui couvrirait le champ", () => {
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(hook).toContain('refuseMapsBefore: (action: "save" | "resolve") => mapsSent && refuseMaps(action === "resolve"),');
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    const run = dialog.slice(dialog.indexOf('const run = async (action: "save" | "resolve") => {'));
    expect(run.indexOf("if (form.refuseMapsBefore(action)) return;")).toBeGreaterThan(0);
    expect(run.indexOf("if (form.refuseMapsBefore(action)) return;")).toBeLessThan(run.indexOf("setConfirmingCorrection(action);"));
  });
});

describe("détail map par map — lecteur sans droit de report", () => {
  it("sans droit de report, la phrase n'invente pas une absence de détail et n'invite pas à saisir", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    const fn = dialog.slice(dialog.indexOf("function theirsPendingStatus("));
    expect(fn.indexOf("if (!reader.canReport) return")).toBeGreaterThan(0);
    expect(fn.indexOf("if (!reader.canReport) return")).toBeLessThan(fn.indexOf('"score.player.theirs.withoutMaps"'));
    expect(dialog).toContain("theirsPendingStatus(text, { opponentName, myName }, view.theirs!, { canReport: canReportScore, detailLoading })");
  });
});

describe("détail map par map — ligne vierge ajoutée et refus corrigé ailleurs", () => {
  it("un refus qui désigne la ligne vierge qu'on vient d'ajouter se tait, dans les deux modales", () => {
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(hook).toContain("onBlankRow: !refusalOnTouchedRow(resolve.error ? resolve : save, maps),");
    const player = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(player).toContain("return maps.some(isMapTouched) && refusalOnTouchedRow(check, maps);");
    expect(player).toContain("const touched = refusalWorthShowing(check, maps);");
  });

  it("toute saisie dans la liste lève les refus, corrigés souvent sur un autre champ", () => {
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    const update = list.slice(list.indexOf("const update = (index: number"));
    expect(update.slice(0, update.indexOf("};"))).toContain("fieldErrors.clear();");
  });
});

describe("détail map par map — saisie du seul détail et libellé de confirmation", () => {
  it("l'arbitrage ne saisit plus de score à la main : ni steppers ni phrase de score dérivé", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).not.toContain("ScoreStepper");
    expect(dialog).not.toContain("derivedHint");
    expect(dialog).not.toContain("DERIVED_SCORE_HINT_ID");
    expect(FR_SCORE.admin).not.toHaveProperty("derivedHint");
    expect(FR_SCORE).not.toHaveProperty("stepper");
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(hook).not.toMatch(/setScore[12]/);
    expect(hook).not.toContain("manualScores");
  });

  it("le code de replay est facultatif pour l'arbitrage seul, et la liste le dit", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toMatch(/<MapScoreList[\s\S]{0,600}replayCodeOptional\s/);
    const player = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(player).not.toContain("replayCodeOptional");
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(hook).toContain("const ADMIN_MAP_RULES: MapEntryRules = { requireReplayCode: false };");
    expect(hook).toContain("const mapCheck = checkMapList(matchFormat, game, sentMaps, { decisive, ...ADMIN_MAP_RULES });");
    expect(hook).toContain("const local = checkMapList(matchFormat, game, sentMaps, { decisive, ...ADMIN_MAP_RULES });");
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    expect(list).toContain("progressiveMapRows(format, game, next, { requireReplayCode: !replayCodeOptional })");
    expect(list).toContain('{replayCodeOptional ? t("score.maps.replayCodeOptional") : t("score.maps.replayCode")}');
    expect(list).toContain('{replayCodeOptional ? ` ${t("score.maps.replayOptionalHint")}` : ""}');
    expect(FR_SCORE.maps.replayCodeOptional).toBe("Code de replay (facultatif)");
    expect(FR_SCORE.maps.replayOptionalHint).toContain("« Pas de code de replay »");
  });

  it("« Confirmer le score » ne se confond pas avec « Confirmer le forfait de … »", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toContain('const submitLabel = confirmsAsIs ? t("score.player.confirm") : t("score.player.send");');
    expect(FR_SCORE.player.confirm).toBe("Confirmer le score");
    expect(FR_SCORE.player.send).toBe("Envoyer le score");
  });
});

describe("détail map par map — saisie au clavier et au toucher", () => {
  const list = () => readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");

  it("le détail adverse reste visible quand le formulaire ne le reprend pas (saisie commencée)", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toContain('return phase === "THEIRS_PENDING" && form.missedProposal && !form.confirmsAsIs;');
    expect(dialog).toContain("setMissedProposal(typing && !sameMapLists(current.current, next));");
    // L'effet ne fait plus d'effet de bord dans un `setMaps(updater)`.
    expect(dialog).not.toContain("setMaps((current) =>");
  });

  it("retirer une map lève les refus affichés", () => {
    const remove = list().slice(list().indexOf("const remove = (index: number) => {"));
    expect(remove.slice(0, remove.indexOf("};"))).toContain("fieldErrors.clear();");
  });

  it("chaque colonne de score porte l'emblème de son engagé", () => {
    expect(list().match(/<EntrantLogo teamId=\{team[12]Id\}/g)).toHaveLength(2);
    for (const dialog of ["AdminScoreDialog", "PlayerScoreDialog"]) {
      expect(readSource(`app/(secured)/tournois/[id]/_components/${dialog}.tsx`)).toContain("team1Id={match.team1Id}");
    }
  });

  it("les scores de map ouvrent le pavé numérique", () => {
    expect(list().match(/inputMode="numeric"/g)).toHaveLength(2);
  });

  it("un champ désactivé le dit par ses couleurs, jamais par l'opacité", () => {
    const css = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.module.css");
    expect(css).toMatch(/\.scoreInput:disabled \{[^}]*color: var\(--ink-dim/);
    expect(css).not.toMatch(/opacity\s*:/);
  });

  it("Entrée dans un champ de map ne soumet pas le formulaire", () => {
    expect(list()).toContain('if (event.key === "Enter") event.preventDefault();');
    // Sur chaque champ (code et deux scores), pas sur le `<fieldset>` (S6847).
    expect(list().match(/onKeyDown=\{keepEnterInList\}/g)).toHaveLength(3);
    expect(list()).not.toContain("disabled={disabled} onKeyDown");
  });
});

describe("détail map par map — blocages qui ne tiennent pas aux maps", () => {
  it("un résultat tranché, un double forfait ou une saisie fermée gardent le bouton fermé malgré un refus de map", () => {
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    for (const blocker of ["ALREADY_DECIDED", "DOUBLE_FORFEIT", "NOT_IN_LAUNCH"]) {
      expect(hook).toContain(`"${blocker}",`);
    }
    expect(hook).toContain("save: isStructuralBlocker(decision.saveBlocker) ? null : save.error,");
  });
});

describe("détail map par map — lignes progressives dans les modales", () => {
  const list = () => readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");

  it("toute modification passe par l'affichage progressif ; une ligne ajoutée s'annonce", () => {
    expect(list()).toContain("const rows = progressiveMapRows(format, game, next, { requireReplayCode: !replayCodeOptional });");
    // Seule une croissance due à l'affichage progressif s'annonce (pas une liste reçue).
    expect(list()).toContain("autoGrown.current = rows.length > maps.length;");
    expect(list()).toContain('if (autoGrown.current) setAnnouncement(t("score.maps.added", { index: maps.length }));');
    expect(list()).toContain('<p className="sr-only" aria-live="polite">');
    // Pas de « Retirer » sur une ligne vierge, et la cible de focus ne survit pas au rendu suivant.
    expect(list()).toContain("{isMapTouched(map) && (");
    expect(list()).toContain("}, [maps, idPrefix]);");
    expect(list()).not.toContain("minRows");
  });

  it("engagé comme arbitrage partent d'une ligne vierge ; ce qui part la retire", () => {
    const player = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(player).toContain("progressiveMapRows(matchFormat, game, playerReportInitialMaps(view))");
    expect(player).toContain("const maps = trimTrailingBlankMaps(rows);");
    expect(player).toMatch(/maps=\{rows\}\s*onChange=\{setRows\}\s*format=\{matchFormat\}/);
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(hook).toContain("const openingRows = () => progressiveMapRows(matchFormat, game, initialAdminMaps(match), ADMIN_MAP_RULES);");
    expect(hook).toContain("const sentMaps = trimTrailingBlankMaps(maps);");
    // Plus de score à la main : sans map renseignée, rien ne part.
    expect(hook).toContain("const body = adminScoreBody(state, sendMaps ? sentMaps : null);");
    expect(hook).toContain("return maps ? { maps } : null;");
    expect(hook).not.toContain("team1Score: scores.team1");
  });
});

describe("détail map par map — refus désignant la ligne ouverte", () => {
  it("les deux modales désignent le champ par les lignes affichées", () => {
    const player = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(player).toContain("const target = refusalFieldOnRows(local, rows);");
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(hook).toContain("const target = refusalFieldOnRows(local, maps);");
  });

  it("une ligne retirée vide l'annonce, pour qu'une ligne qui revient s'annonce", () => {
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    expect(list).toContain('else if (!autoGrown.current) setAnnouncement("");');
  });
});

describe("détail map par map — formulaire vierge", () => {
  it("la ligne vierge d'ouverture n'est pas une proposition : bouton fermé, rien d'« envoyé »", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toContain("const nothingEntered = !maps.some(isMapTouched);");
    expect(dialog).toContain("disabled={nothingEntered || unchangedMine || submitting}");
    expect(dialog).not.toContain("disabled={maps.length === 0 ||");
  });
});

describe("détail map par map — premier report sans verrou d'intervalle", () => {
  it("le report d'une engagée sans report antérieur n'efface rien avant d'insérer", () => {
    const scoring = readSource("lib/server/tournaments/scoring.ts");
    expect(scoring).toContain("const hadReport = (isTeam1Reporter ? match.team1_reported_at : match.team2_reported_at) != null;");
    expect(scoring).toContain("await replaceMatchMaps(connection, matchId, reporterSource, maps, userId, { knownEmpty: !hadReport });");
  });
});
