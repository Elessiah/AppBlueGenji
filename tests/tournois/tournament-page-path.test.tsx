import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { TournamentLoading } from "@/app/(secured)/tournois/[id]/_components/TournamentLoading";
import { FIRST_SNAPSHOT_TIMEOUT_MS } from "@/app/(secured)/tournois/[id]/_lib/live-state";
import { participantWording } from "@/lib/shared/participants";
import { readSource } from "../helpers/read-source";

/**
 * Parcours de la fiche tournoi : arrivée (flux muet, squelette), retour,
 * position de la frise et confirmations (`docs/features/TOURNAMENT_PAGE_PATH.md`).
 * Sans DOM dans cette suite, les minuteurs du hook ne tournent pas : on tient le
 * rendu statique, et la forme du code là où elle est la règle.
 */

const DIR = "app/(secured)/tournois/[id]";
const hook = readSource(`${DIR}/_hooks/useTournamentLive.ts`);
const page = readSource(`${DIR}/page.tsx`);
const header = readSource(`${DIR}/_components/TournamentHeader.tsx`);
const launchStrip = readSource(`${DIR}/_components/MatchLaunchStrip.tsx`);
const dialog = readSource(`${DIR}/_components/ConfirmActionDialog.tsx`);

/** Tranche de `source` qui s'ouvre sur `start` et se ferme au premier `end` qui suit. */
function block(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  return source.slice(from, source.indexOf(end, from));
}

const handler = (name: string) => block(hook, `source.${name} = `, "\n      };");

describe("flux ouvert sans premier instantané", () => {
  it("accorde quelques secondes, pas davantage", () => {
    expect(FIRST_SNAPSHOT_TIMEOUT_MS).toBeGreaterThanOrEqual(2_000);
    expect(FIRST_SNAPSHOT_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it("arme le guet à l'ouverture du flux", () => {
    const onopen = handler("onopen");
    // Armé **après** la coupure du sondage : l'ouverture ne vaut plus livraison.
    expect(onopen.indexOf("watchFirstSnapshot();")).toBeGreaterThan(onopen.indexOf("stopFallback();"));
    expect(onopen.indexOf("stopFallback();")).toBeGreaterThan(-1);
  });

  it("passé le délai, lit par REST et sonde en secours sans fermer le flux", () => {
    const body = block(hook, "const watchFirstSnapshot = () => {", "\n    };");
    expect(body).toContain("if (stateRef.current.detail) return;");
    expect(body).toContain("FIRST_SNAPSHOT_TIMEOUT_MS");
    expect(body).toContain("setIsLive(false);");
    expect(body).toContain("void load(true)");
    expect(body).toContain("giveUp(failure)");
    expect(body).toContain("startFallback();");
    expect(body).not.toContain("source?.close()");
  });

  it("un message lève le guet et le sondage", () => {
    const onmessage = handler("onmessage");
    expect(onmessage).toContain("stopFirstSnapshotWatch();");
    expect(onmessage).toContain("stopFallback();");
  });

  it("aucun guet ne survit à une erreur, une reconnexion, un abandon ou au démontage", () => {
    expect(handler("onerror")).toContain("stopFirstSnapshotWatch();");
    expect(block(hook, "reconnectRef.current = () => {", "\n    };")).toContain("stopFirstSnapshotWatch();");
    expect(block(hook, "const giveUp = ", "\n    };")).toContain("stopFirstSnapshotWatch();");
    expect(block(hook, "    return () => {\n      cancelled = true;", "\n    };")).toContain(
      "stopFirstSnapshotWatch();",
    );
  });
});

describe("squelette de chargement", () => {
  const html = renderToStaticMarkup(<TournamentLoading />);

  it("annonce l'attente aux technologies d'assistance", () => {
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('<span class="sr-only">Chargement du tournoi…</span>');
  });

  it("garde ses formes et sa légende visible hors de l'arbre d'accessibilité", () => {
    // Deux `aria-hidden` : les formes, et la légende que la phrase `sr-only` double.
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
  });

  it("remplace le texte nu de la page", () => {
    expect(page).toContain("return <TournamentLoading />;");
  });
});

describe("retour", () => {
  it("est un lien vers la liste, qui ne revient dans l'historique que sur le site", () => {
    expect(header).toContain('<Link href="/tournois" onClick={onBackClick} className={`${s.back} tap-target`}>');
    expect(header).toContain(
      "if (!isPlainLeftClick(event) || !canReturnInSite(readSiteBackInput())) return;",
    );
    expect(header).toContain("router.back();");
    expect(header).toContain('{backInSite ? "Retour" : "Tous les tournois"}');
  });

  it("n'est plus un bouton piloté par la page", () => {
    expect(header).not.toContain("onBack:");
    expect(page).not.toContain("router.back()");
  });

  it("relève la navigation interne sur toutes les pages", () => {
    expect(readSource("app/layout.tsx")).toContain("<SiteNavigationTracker />");
    expect(readSource("components/site-navigation-tracker.tsx")).toContain(
      "recordSitePathname(pathname)",
    );
  });
});

describe("frise de progression", () => {
  it("suit directement l'en-tête", () => {
    const headerEnd = page.indexOf("onEditImage={() => setImageDialogOpen(true)}");
    const progress = page.indexOf("<TournamentProgress detail={detail} />");
    expect(headerEnd).toBeGreaterThan(-1);
    expect(progress).toBeGreaterThan(headerEnd);
    // Rien d'affiché entre les deux : seul un commentaire les sépare.
    const between = page.slice(page.indexOf("/>", headerEnd) + 2, progress);
    expect(between.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").trim()).toBe("");
    expect(page.match(/<TournamentProgress /g)).toHaveLength(1);
  });
});

describe("confirmations des gestes sans retour", () => {
  it("aucune boîte système sur la fiche", () => {
    expect(page).not.toContain("window.confirm(");
    expect(launchStrip).not.toContain("window.confirm(");
  });

  it("passent par la modale commune", () => {
    expect(page).toContain("<ConfirmActionDialog");
    expect(page).toContain("run: () => performForfeit(teamId, teamName, true)");
    expect(page).toContain("run: () => performForfeit(teamId, teamName, false)");
    expect(page).toContain("run: () => performLiftPenalty(penalty)");
    expect(launchStrip).toContain("<ConfirmActionDialog");
    expect(launchStrip).toContain("onClick={() => setConfirmForce(true)}");
  });

  it("se referment quand l'action n'est plus offerte", () => {
    expect(page).toContain("{pendingConfirm !== null && !frozen && (");
    expect(launchStrip).toContain("{confirmForce && showForce && (");
  });

  it("ne se ferment que sur un geste abouti, et s'ouvrent sur « Annuler »", () => {
    expect(dialog).toContain('role="alertdialog"');
    expect(dialog).toContain("useDialogBehavior({ open: mounted, onClose, locked: busy })");
    expect(dialog).toContain("useBackdropDismiss(onClose, busy)");
    expect(dialog).toContain("createPortal(");
    expect(dialog).toContain("if (ok) onClose();\n    else setBusy(false);");
    expect(dialog).toMatch(/onClick=\{onClose\} disabled=\{busy\} data-autofocus/);
  });

  it("les gestes rendent leur issue plutôt que de l'avaler", () => {
    for (const fn of ["performForfeit", "performLiftPenalty"]) {
      const body = block(page, `const ${fn} = async`, "\n  };");
      expect(body).toContain("return true;");
      expect(body).toContain("return false;");
    }
    expect(launchStrip).toContain(
      "const run = async (action: () => Promise<void>, success: string): Promise<boolean> => {",
    );
  });

  it("la conséquence de l'abandon ne repose plus la question du titre", () => {
    for (const type of ["TEAM", "SOLO"] as const) {
      const text = participantWording(type).forfeitSelfConfirm;
      expect(text).not.toContain("?");
      expect(text).toMatch(/définitivement le tournoi\.$/);
    }
  });
});
