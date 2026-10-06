import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";

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

  it("l'arbitrage voit le détail des deux propositions en désaccord", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toMatch(/match\.team1Report && match\.team2Report[\s\S]{0,600}<MapResultList maps=\{report\.maps\}/);
  });
});

describe("détail map par map — focus et interblocages", () => {
  it("retirer une map rend le focus à la ligne suivante ou à « Ajouter une map »", () => {
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    expect(list).toContain("focusAfterRemove.current = index;");
    expect(list).toContain("id={`${idPrefix}-map-add`}");
    expect(list).toContain("id={`${idPrefix}-map-${index}-remove`}");
  });

  it("ajouter une map porte le focus sur le code de la nouvelle ligne", () => {
    const list = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");
    expect(list).toContain("focusNewRow.current = true;");
    expect(list).toMatch(/mapFieldId\(idPrefix, maps\.length - 1, "replayCode"\)/);
  });

  it("la modale de détail reste lisible si le détail disparaît, et rend le focus à la carte", () => {
    const details = readSource("app/(secured)/tournois/[id]/_components/MatchMapDetails.tsx");
    expect(details).toContain("if (!hasMaps && !open) return null;");
    expect(details).toContain("document.getElementById(matchAnchorId(match.id))?.focus()");
    expect(details).toMatch(/aria-label=\{`Détail des maps \(\$\{match\.maps\.length\}\) : \$\{team1\} contre \$\{team2\}`\}/);
  });

  it("en désaccord, l'engagé voit le détail adverse", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toMatch(/view\?\.phase === "CONFLICT" && view\.theirs[\s\S]{0,300}<MapResultList/);
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
    expect(list).toMatch(/\{maps\.length > 0 && \(\s*<output className=\{styles\.summary\}>/);
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
    expect(list.match(/<span className="sr-only">Map \{index \+ 1\}, /g)).toHaveLength(3);
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
    expect(dialog).toContain("mais le détail des maps diffère");
  });
});

describe("détail map par map — retours de la revue UI/UX", () => {
  const list = () => readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");

  it("le compteur annonce le format, les maps nulles rejouées en sus", () => {
    expect(list()).toContain("const shownLimit = format ? matchMaxMaps(format) : limit;");
    expect(list()).toContain("({maps.length}/{Math.max(shownLimit, maps.length)})");
    expect(list()).toContain("Une map nulle peut être rejouée (${limit - shownLimit} au plus).");
  });

  it("la liste passe sur deux lignes selon sa propre largeur (modale de 460 px)", () => {
    const css = readSource("app/(secured)/tournois/[id]/_components/MapScoreList.module.css");
    expect(css).toContain("container-type: inline-size;");
    expect(css).toContain("@container (max-width: 560px)");
    expect(css).not.toContain("@media (max-width: 560px)");
  });

  it("l'infobulle d'un bouton actionnable sur une map refusée dit ce refus, pas « score incomplet »", () => {
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(hook).toContain("const resolve = checkMapList(format, game, maps, { decisive: true });");
    expect(hook).toContain("resolve: resolve.error,");
  });

  it("un forfait ou une saisie fermée taisent les refus de map : la liste est masquée et ses maps ne partent pas", () => {
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(hook).toMatch(/const mapsSent =\s*maps\.length > 0 &&\s*options\.scoreEntryClosed !== true &&\s*state\.forfeitTeamId === undefined &&\s*state\.doubleForfeit !== true;/);
    expect(hook).toContain("mapsRefused: mapRefusals(matchFormat, game, mapsSent ? maps : []),");
    expect(hook).toContain("const sendMaps = mapsSent;");
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toContain("if (mapRefusal) return mapListViolationMessage(mapRefusal, matchFormat, form.game);");
    expect(dialog).toContain("title={buttonTitle(form.mapsRefused.save, form.decision.saveBlocker,");
    expect(dialog).toContain("title={buttonTitle(form.mapsRefused.resolve, form.decision.resolveBlocker,");
  });

  it("une proposition adverse sans détail dit quoi saisir au lieu de « Confirme-le »", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toContain("if ((theirs.maps ?? []).length > 0) {");
    expect(dialog).toContain("sans le détail des maps. Pour le confirmer, saisis les maps jouées et leurs codes de replay");
  });

  it("un détail adverse encore en lecture est annoncé comme tel, sans inviter à ressaisir", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toContain("return canRead && proposalsNeedRefresh(match, proposals);");
    expect(dialog).toContain("if (reader.detailLoading) return `${proposed}. Lecture du détail de ses maps…");
    expect(dialog.indexOf("if ((theirs.maps ?? []).length > 0)")).toBeLessThan(dialog.indexOf("if (reader.detailLoading) return"));
  });
});

describe("détail map par map — arbitrage pendant la lecture du détail proposé", () => {
  it("les boutons de score attendent le détail de la proposition, pour ne pas en effacer les codes", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toMatch(/const awaitingDetail =\s*proposalsNeedRefresh\(liveMatch, proposals\) &&\s*form\.maps\.length === 0/);
    expect(dialog).toContain("|| form.submitting || awaitingDetail}");
    expect(dialog).toContain("!form.submitting && !awaitingDetail) void run(\"resolve\");");
    expect(dialog).toContain("if (input.awaitingDetail) return AWAITING_DETAIL_MESSAGE;");
  });

  it("la phrase visible suit l'ordre de l'infobulle : détail, map refusée renseignée, puis score", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    const order = [
      "if (input.awaitingDetail) return AWAITING_DETAIL_MESSAGE;",
      "if (input.mapRefusal) return mapListViolationMessage(input.mapRefusal, input.format, input.game);",
      "return input.blocker ? scoreBlockerMessage(input.blocker, input.format) : null;",
    ].map((line) => dialog.indexOf(line));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(dialog).toContain("mapRefusal: form.maps.some(isMapTouched) ? mapRefusal : null,");
    // Refus sur une ligne vierge : aucune phrase, ni le refus de map, ni le 0 – 0 dérivé.
    expect(dialog).toContain("blankMaps: mapRefusal !== null && form.mapsRefused.onBlankRow,");
    expect(dialog.indexOf("if (input.blankMaps) return null;")).toBeLessThan(dialog.indexOf("if (input.mapRefusal) return"));
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

  it("saisir au même score une proposition sans détail la confirme, comme le serveur la compare", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toContain("const confirmsAsIs = confirmsTheirs && confirmsProposalMaps(maps, view?.theirs?.maps ?? [], detailLoading);");
    expect(dialog).toContain("if (theirMaps.length === 0) return !detailLoading;");
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
    expect(fn.indexOf("if (!reader.canReport) return")).toBeLessThan(fn.indexOf("sans le détail des maps"));
    expect(dialog).toContain("theirsPendingStatus({ opponentName, myName }, view.theirs!, { canReport: canReportScore, detailLoading })");
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

describe("détail map par map — steppers verrouillés et libellé de confirmation", () => {
  it("les steppers verrouillés par les maps disent pourquoi, et comment reprendre la main", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toContain("return mapCount > 0 && !mapsSetAside ? DERIVED_SCORE_HINT_ID : undefined;");
    expect(dialog.match(/describedBy=\{derivedHintId\}/g)).toHaveLength(2);
    expect(dialog).toContain("retire toutes les maps pour le saisir à la main.");
    const stepper = readSource("app/(secured)/tournois/[id]/_components/ScoreStepper.tsx");
    expect(stepper).toContain("aria-describedby={describedBy}");
  });

  it("« Confirmer le score » ne se confond pas avec « Confirmer le forfait de … »", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toContain('const submitLabel = confirmsAsIs ? "Confirmer le score" : "Envoyer le score";');
  });
});
