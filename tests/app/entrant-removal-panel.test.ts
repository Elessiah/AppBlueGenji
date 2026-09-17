import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ERROR_MESSAGES, mapError } from "@/app/(secured)/tournois/[id]/_lib/error-map";
import { ENTRANT_REMOVAL_BLOCK_MESSAGES } from "@/lib/shared/entrant-removal";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const PANEL = "app/(secured)/tournois/[id]/_components/RegistrationsPanel.tsx";
const PANEL_CSS = "app/(secured)/tournois/[id]/_components/RegistrationsPanel.module.css";
const DIALOG = "app/(secured)/tournois/[id]/_components/RemoveEntrantDialog.tsx";

/**
 * Retrait d'un engagé — le câblage de l'interface.
 *
 * La règle elle-même est pure et tenue ailleurs
 * (`tests/lib/shared/entrant-removal.test.ts`). Ce qui se joue ici est le
 * branchement, et il porte quatre pannes, toutes muettes :
 *
 * 1. le bouton **accroché à la mauvaise condition** — les flèches de seeding
 *    survivent au coup d'envoi (jusqu'au premier score), pas le retrait : les
 *    coller à `reorderable` offrirait un geste que le serveur refuse en 409 ;
 * 2. la **grille désaccordée** — une cellule d'actions rendue sans colonne pour
 *    l'accueillir, ou l'inverse ;
 * 3. une **seconde formulation** du refus, recopiée dans l'interface au lieu
 *    d'être reprise du module pur ;
 * 4. trente boutons « Retirer » **indistinguables** au lecteur d'écran.
 *
 * On garde donc la structure au niveau source, comme `seeding-drag-handle.test.ts`
 * et `entity-links.test.ts` : ces composants sont clients, leur JSX est
 * présentationnel, et c'est l'invariant qui compte, pas l'apparence.
 */

/** Retire commentaires de bloc et de ligne : ils citent les balises en prose. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * Corps d'une règle CSS, commentaires retirés.
 *
 * Le sélecteur est échappé **en entier** : `:not(:disabled)` contient des
 * parenthèses, qu'un échappement du seul premier caractère laisserait passer
 * pour des groupes de capture — la règle serait alors introuvable, et le test
 * vert le jour où elle disparaît.
 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(stripComments(css));
  expect(match).not.toBeNull();
  return match![1];
}

/** Colonnes déclarées par un gabarit de grille, `minmax()` comptant pour une. */
function columnCount(css: string, selector: string): number {
  return /grid-template-columns:([^;]*);/
    .exec(ruleBody(css, selector))![1]
    .trim()
    .replace(/\([^)]*\)/g, "()")
    .split(/\s+/).length;
}

describe("Bouton de retrait dans la liste des inscrites", () => {
  const panel = stripComments(read(PANEL));

  it("suit sa propre fenêtre, et non celle du réordonnancement", () => {
    // `removable` descend du module pur appliqué à la carte du tournoi, jamais
    // de `lockReason` : l'ordre de départ reste réglable jusqu'au premier score,
    // le retrait s'arrête au coup d'envoi.
    expect(panel).toMatch(/const removalBlock = entrantRemovalBlockReason\(detail\.card, now\);/);
    // Et l'heure vient d'un minuteur posé sur la prochaine bascule d'état, non
    // d'un `Date.now()` au rendu : la fenêtre se ferme au coup d'envoi, une
    // seconde connue d'avance qu'aucune écriture n'annonce.
    expect(panel).toMatch(/const now = useTournamentNow\(detail\.card\);/);
    expect(panel).toMatch(/const removable = staff && removalBlock === null;/);
    expect(panel).toMatch(/\{removable && \(/);
    expect(panel).not.toMatch(/removable\s*=\s*reorderable/);
  });

  it("exige la qualité de staff, comme les flèches", () => {
    // `staff` = permission `tournaments` **et** suivi du tournoi vivant : un
    // bouton rendu pendant une panne de flux écrirait sur un état qu'on ne voit
    // plus bouger.
    expect(panel).toMatch(/const staff = detail\.isAdmin && canAct;/);
  });

  it("n'écrit rien sans confirmation : le clic ouvre un dialogue", () => {
    // Le bouton voisine les flèches à trente-deux pixels d'un geste anodin.
    expect(panel).toMatch(/onClick=\{\(\) => setRemoving\(\{ teamId: reg\.teamId, teamName: reg\.teamName \}\)\}/);
    // Et le composant lui-même n'appelle la route nulle part : le seul `fetch`
    // qu'il contient est celui du réordonnancement.
    expect(panel.match(/fetch\(/g)).toHaveLength(1);
    expect(panel).not.toContain("/registrations/");
    expect(panel).toMatch(/<RemoveEntrantDialog/);
  });

  it("nomme l'engagé dans le libellé accessible du bouton", () => {
    // Trente boutons « Retirer » identiques ne se distinguent ni à la voix ni
    // au lecteur d'écran.
    expect(panel).toMatch(/aria-label=\{`Retirer \$\{reg\.teamName\} du tournoi`\}/);
  });

  it("met la phrase du refus là où le bouton aurait été", () => {
    // Rien sur la ligne ne dirait pourquoi la commande a disparu.
    expect(panel).toMatch(/\{removalNotice !== null && rows\.length > 0 && \(/);
    expect(panel).toMatch(/entrantRemovalBlockMessage\(removalNotice\)/);
  });

  it("ne répète pas le verrou du seeding quand les deux disent la même chose", () => {
    // Sur un tournoi terminé, « l'ordre n'a plus d'effet » et « la liste est un
    // palmarès » énoncent le même fait : trois paragraphes empilés au-dessus
    // d'une liste ne se lisent plus. Le verrou de l'ordre parle le premier.
    expect(panel).toMatch(
      /lockReason === "FINISHED" && removalBlock === "ENTRANT_REMOVAL_TOURNAMENT_FINISHED"/,
    );
  });

  it("annonce le retrait à l'oreille, comme le réordonnancement", () => {
    expect(panel).toMatch(/setAnnouncement\(`\$\{removing\.teamName\} ne figure plus/);
  });
});

describe("Cellule d'actions partagée", () => {
  const panel = stripComments(read(PANEL));
  const css = read(PANEL_CSS);

  it("s'ouvre dès que l'une des deux commandes est là", () => {
    expect(panel).toMatch(/const showActions = reorderable \|\| removable;/);
    expect(panel).toMatch(/\{showActions && \(\s*<span className=\{styles\.actions\}>/);
  });

  it("choisit un gabarit de grille exclusif", () => {
    // Deux classes de même poids posant `grid-template-columns` se
    // départageraient par l'ordre de la feuille : le ternaire garantit qu'une
    // seule s'applique.
    expect(panel).toMatch(
      /const gridClass = reorderable \? styles\.reorderable : removable \? styles\.withActions : "";/,
    );
    // Et le même gabarit coiffe l'en-tête et les lignes, sinon les colonnes
    // seraient décalées de l'un à l'autre.
    expect(panel.match(/\$\{gridClass\}|gridClass,/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("compte autant de colonnes que de cellules rendues", () => {
    // rang, engagé, inscription, classement final, actions
    expect(columnCount(css, ".withActions")).toBe(5);
    // la poignée en plus
    expect(columnCount(css, ".reorderable")).toBe(6);
  });

  it("nomme la colonne d'après ce qu'elle contient", () => {
    expect(panel).toMatch(
      /const actionsLabel = reorderable && removable \? "Actions" : reorderable \? "Ordre" : "Retrait";/,
    );
  });

  it("distingue le bouton de retrait des flèches", () => {
    // Un geste qu'on ne défait pas d'un clic n'a pas à ressembler à un geste
    // qu'on répète : un mot plutôt qu'une flèche, du rouge au survol, une marge.
    const remove = ruleBody(css, ".remove");
    expect(remove).toMatch(/margin-left/);
    expect(ruleBody(css, ".remove:hover:not(:disabled)")).toMatch(/--red-live/);
    // Mais pas de rouge au repos : une liste d'inscriptions n'est pas une liste
    // d'avertissements.
    expect(remove).not.toMatch(/--red-live/);
  });

  it("garde le curseur « saisi » sur le bouton pendant un glissement", () => {
    // Le pointeur a quitté la poignée dès le premier centimètre : un curseur qui
    // redevient flèche donne à croire que le geste est terminé.
    const body = stripComments(css);
    const grabbing = /\.dragging \.grip,[\s\S]*?\{([^}]*)\}/.exec(body);
    expect(grabbing).not.toBeNull();
    expect(/\.dragging \.remove/.test(body)).toBe(true);
  });

  it("annule le fondu du bouton sous `prefers-reduced-motion`", () => {
    // Une media query n'ajoute aucune spécificité : la règle doit venir **après**
    // celle qu'elle annule.
    const body = stripComments(css);
    const reduced = body.indexOf("prefers-reduced-motion");
    expect(reduced).toBeGreaterThan(body.lastIndexOf("\n.remove {"));
    expect(body.slice(reduced)).toMatch(/\.remove/);
  });
});

describe("Dialogue de confirmation", () => {
  const dialog = stripComments(read(DIALOG));

  it("appelle la route de retrait, en DELETE", () => {
    expect(dialog).toMatch(
      /fetch\(\s*`\/api\/admin\/tournaments\/\$\{card\.id\}\/registrations\/\$\{teamId\}`,\s*\{\s*method: "DELETE"/,
    );
  });

  it("nomme l'engagé et traduit le refus", () => {
    expect(dialog).toMatch(/Retirer \{entrantName\} du tournoi/);
    expect(dialog).toMatch(/mapError\(\(e as Error\)\.message\)/);
  });

  it("dit si la place libérée pourra être reprise", () => {
    // La seule conséquence qui dépend de l'étape : `registerTeam` exige l'état
    // `REGISTRATION`, donc un retrait fait après la clôture ne se défait plus —
    // ni par l'engagé, ni par le staff — sans rouvrir les inscriptions. C'est
    // exactement le moment où l'on retire un désistement de dernière minute.
    expect(dialog).toMatch(
      /const \[registrationOpen\] = useState\(\(\) => computeTournamentState\(card\) === "REGISTRATION"\);/,
    );
    expect(dialog).toMatch(/\{registrationOpen \? \(/);
    expect(dialog).toMatch(/Les inscriptions sont ouvertes/);
    expect(dialog).toMatch(/Les inscriptions sont closes/);
    // L'ambre est la seule chose qui distingue l'avertissement du paragraphe
    // voisin : il ne dit rien à qui ne le voit pas.
    expect(dialog).toMatch(/role="note"/);
  });

  it("est une modale dans les règles de la page", () => {
    // Portail sur `document.body` (`.page-shell` enferme son contenu), fermeture
    // par Échap et verrou de défilement partagés.
    expect(dialog).toMatch(/createPortal\(/);
    expect(dialog).toMatch(/useDialogBehavior\(\{ open: mounted, onClose, locked: busy \}\)/);
    expect(dialog).toMatch(/aria-modal="true"/);
    expect(dialog).toMatch(/aria-labelledby="remove-entrant-title"/);
    expect(dialog).toMatch(/aria-describedby="remove-entrant-summary"/);
  });
});

describe("Registre des refus", () => {
  it("reprend les phrases du module pur, sans les recopier", () => {
    for (const [code, message] of Object.entries(ENTRANT_REMOVAL_BLOCK_MESSAGES)) {
      expect(ERROR_MESSAGES[code]).toBe(message);
    }
  });

  it.each([
    "ENTRANT_REMOVAL_TOURNAMENT_STARTED",
    "ENTRANT_REMOVAL_TOURNAMENT_FINISHED",
    "ENTRANT_REMOVAL_FAILED",
    "TEAM_NOT_IN_TOURNAMENT",
    "TOURNAMENT_NOT_FOUND",
    "INVALID_TOURNAMENT_ID",
    "INVALID_TEAM",
    "UNAUTHORIZED",
    "FORBIDDEN",
  ])("traduit %s plutôt que de l'afficher brut", (code) => {
    // Tout ce que la route peut rendre a sa phrase : un code sans traduction
    // s'affiche en capitales dans le toast.
    const message = mapError(code);

    expect(message).not.toBe(code);
    expect(/^[A-Z][A-Z0-9_]*$/.test(message)).toBe(false);
  });
});
