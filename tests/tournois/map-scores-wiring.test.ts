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
    expect(list()).toContain("({played}/{Math.max(shownLimit, played)})");
    // La ligne vierge ouverte ne compte pas comme une map jouée.
    expect(list()).toContain("const played = maps.filter(isMapTouched).length;");
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
    expect(hook).toContain("resolve: isStructuralBlocker(decision.resolveBlocker) ? null : resolve.error,");
  });

  it("un forfait ou une saisie fermée taisent les refus de map : la liste est masquée et ses maps ne partent pas", () => {
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(hook).toMatch(/const mapsSent =\s*maps\.length > 0 &&\s*options\.scoreEntryClosed !== true &&\s*state\.forfeitTeamId === undefined &&\s*state\.doubleForfeit !== true;/);
    expect(hook).toContain("mapsRefused: mapRefusals(matchFormat, game, mapsSent ? sentMaps : [], decision),");
    expect(hook).toContain("const sendMaps = mapsSent;");
    const dialog = readSource("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    expect(dialog).toContain("if (input.mapRefusal && input.onBlankRow) return input.idle;");
    expect(dialog).toContain("if (input.mapRefusal) return mapListViolationMessage(input.mapRefusal, input.format, input.game);");
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

describe("détail map par map — saisie au clavier et au toucher", () => {
  const list = () => readSource("app/(secured)/tournois/[id]/_components/MapScoreList.tsx");

  it("le détail adverse reste visible quand le formulaire ne le reprend pas (saisie commencée)", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(dialog).toContain('return phase === "THEIRS_PENDING" && form.missedProposal && !form.confirmsAsIs;');
    expect(dialog).toContain("setMissedProposal(typing && !sameMapLists(current.current, next));");
    // L'effet ne fait plus d'effet de bord dans un `setMaps(updater)`.
    expect(dialog).not.toContain("setMaps((current) =>");
  });

  it("ajouter une map lève les refus affichés", () => {
    const add = list().slice(list().indexOf("const add = () => {"));
    expect(add.slice(0, add.indexOf("};"))).toContain("fieldErrors.clear();");
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

  it("toute modification passe par l'affichage progressif ; une ligne ajoutée s'annonce sans voler le focus", () => {
    expect(list()).toContain("const rows = progressiveMapRows(format, game, next, minRows);");
    // Seule une croissance due à l'affichage progressif s'annonce (pas une liste reçue).
    expect(list()).toContain("autoGrown.current = rows.length > maps.length;");
    expect(list()).toContain("if (autoGrown.current && !focusNewRow.current) setAnnouncement(");
    expect(list()).toContain('<p className="sr-only" aria-live="polite">');
    // Pas de « Retirer » sur une ligne vierge, et la cible de focus ne survit pas au rendu suivant.
    expect(list()).toContain("{(isMapTouched(map) || (minRows === 0 && maps.length === 1)) && (");
    expect(list()).toContain("}, [maps, idPrefix]);");
    // « Ajouter une map » ne sert plus qu'à ouvrir la première ligne (arbitrage).
    expect(list()).toContain("{maps.length === 0 && (");
  });

  it("l'engagé part d'une ligne ; l'arbitrage d'aucune ; ce qui part retire la ligne vierge", () => {
    const player = readSource("app/(secured)/tournois/[id]/_components/PlayerScoreDialog.tsx");
    expect(player).toContain("progressiveMapRows(matchFormat, game, playerReportInitialMaps(view), 1)");
    expect(player).toContain("const maps = trimTrailingBlankMaps(rows);");
    expect(player).toMatch(/maps=\{rows\}\s*onChange=\{setRows\}\s*minRows=\{1\}/);
    const hook = readSource("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
    expect(hook).toContain("const openingRows = () => progressiveMapRows(matchFormat, game, initialAdminMaps(match), 0);");
    expect(hook).toContain("const sentMaps = trimTrailingBlankMaps(maps);");
    expect(hook).toContain("adminScoreBody(state, sendMaps ? sentMaps : null, decision.scores)");
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
