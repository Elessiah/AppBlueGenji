import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

// La page est un composant client sans rendu testable ici (mêmes contraintes
// que la section « Tournois invisibles », cf. hidden-tournaments-section.test.ts) :
// on vérifie le câblage au niveau source.
const page = read("app/(secured)/tournois/TournamentsList.tsx");
const css = read("app/(secured)/tournois/tournois.module.css");
import frTournaments from "@/messages/fr/tournaments.json";

describe("page tournois — barre de recherche et filtres", () => {
  it("le champ de recherche a un nom accessible, indépendant du placeholder", () => {
    expect(page).toContain('aria-label={t("list.searchLabel")}');
    expect(frTournaments.list.searchLabel).toBe("Rechercher un tournoi");
  });

  it("le placeholder ne promet plus une recherche par équipe, non filtrable", () => {
    expect(page).toContain('placeholder={t("list.searchPlaceholder")}');
    expect(frTournaments.list.searchPlaceholder).toBe("Rechercher un tournoi, un format…");
    expect(JSON.stringify(frTournaments.list)).not.toContain("une équipe");
  });

  it("le raccourci affiché suit la plateforme, plus un « ⌘K » figé", () => {
    expect(page).toContain("useSearchShortcut(searchInputRef)");
    expect(page).toContain("aria-keyshortcuts={SEARCH_ARIA_KEYSHORTCUTS}");
    expect(page).toMatch(/<span className=\{s\.searchKbd\} aria-hidden="true">\s*\{shortcutLabel\}/);
    expect(page).not.toContain(">⌘K<");
  });

  it("les pastilles de jeu annoncent leur état et leur compte au lecteur d'écran", () => {
    expect(page).toContain("aria-pressed={gameFilter === key}");
    expect(page).toContain('aria-label={listLoaded ? t("list.countLabel", { label, count: String(count) }) : undefined}');
    expect(frTournaments.list.countLabel).toBe("{label} ({count})");
    // Le nombre visible ne double pas ce que l'aria-label dit déjà.
    expect(page).toMatch(/<span className=\{s\.num\} aria-hidden="true">/);
  });

  it("les pastilles comptent selon la recherche en cours, pas seulement le jeu", () => {
    expect(page).toContain('filterBuckets(scheduledBuckets, deferredQuery, "all", formatName)');
    expect(page).toContain("countByGame(queryFilteredBuckets, key)");
  });

  it("une page vidée par un filtre le dit, distinctement d'une page réellement vide", () => {
    expect(page).toContain('sectionEmptyMessage(t("list.emptyUnfiltered"), deferredQuery, gameFilter, t("list.emptyFiltered"))');
    expect(frTournaments.list.emptyUnfiltered).toBe("Aucun tournoi publié pour le moment.");
  });

  it("avant la première liste : un squelette, ni état vide, ni compteurs à zéro, ni bandeau « Aucune actualité », sans saut de mise en page", () => {
    expect(page).toMatch(/setBuckets\(\(previous\) => \(sameBuckets\(previous, all\) \? previous : all\)\);\s*setListFetched\(true\);/);
    // « Mes tournois » attendu aussi (échec compris), sans quoi sa section
    // naissait au sommet après coup et poussait la liste vers le bas.
    expect(page).toContain("const listLoaded = isListGateOpen({ listFetched, mineSettled, hiddenSettled });");
    // Une seule porte sur les données : ni section ni invisible sous le
    // squelette, même quand la liste arrive avant « Mes tournois ».
    expect(page).toContain("const viewBuckets = listLoaded ? buckets : emptyBuckets;");
    expect(page).toContain("const viewHidden = listLoaded ? hiddenTournaments : NO_TOURNAMENTS;");
    expect(page).toContain("useScheduledBuckets(viewBuckets)");
    expect(page).toContain("finishedBeyondList(viewBuckets, key)");
    expect(page).toContain("isAdmin && viewHidden.length > 0");
    expect(page.match(/\bhiddenTournaments\b/g)).toHaveLength(2);
    expect(page).toMatch(/fetchMyTournamentIds[\s\S]*?\} catch \{[\s\S]*?\}\s*if \(!signal\?\.aborted\) setMineSettled\(true\);/);
    expect(page).toContain('{!listLoaded && <SecuredLoadingView label={t("list.loading")} cardsOnly />}');
    expect(page).toContain("{listLoaded && shownSections.length === 0 && (");
    // Sommaire, pastilles et bandeau gardent leur place (pas de saut de mise
    // en page à l'arrivée de la liste) : entrées sans compte, bandeau vide.
    expect(page).toMatch(/<nav className=\{s\.sectionNav\}[^>]*>\s*\{sections\.map\(\(entry\) => \{[\s\S]*?if \(!listLoaded\) \{[\s\S]*?\{COUNT_PENDING\}/);
    expect(page).toContain("{listLoaded ? count : COUNT_PENDING}");
    expect(page).toContain("<Ticker items={tickerItems} labels={text.tickerLabels} />");
    expect(page).not.toMatch(/\{listLoaded && \(\s*<(nav|Ticker)/);
    // Le drapeau ne repasse jamais à faux : un échec de relecture garde la liste.
    expect(page.match(/setListFetched\(/g)).toHaveLength(1);
    // Deux portes pour « Mes tournois » : sa réponse, ou son délai maximal.
    expect(page.match(/setMineSettled\(/g)).toHaveLength(2);
    expect(frTournaments.list.loading).toBe("Chargement des tournois…");
  });

  it("la lecture « Mes tournois » ne retient pas l'affichage au-delà de son délai maximal", () => {
    expect(page).toContain("const MINE_SETTLE_MAX_MS = 2500;");
    expect(page).toMatch(
      /window\.setTimeout\(\(\) => setMineSettled\(true\), MINE_SETTLE_MAX_MS\);\s*return \(\) => window\.clearTimeout\(timer\);/,
    );
  });

  it("le droit staff vient du serveur : plus de lecture `/api/auth/me` ni d'état `isAdmin`", () => {
    expect(page).toContain("const isAdmin = canManage;");
    expect(page).not.toContain('fetch("/api/auth/me"');
    expect(page).not.toContain("setIsAdmin");
    // La première lecture des invisibles fait partie de la porte, échec compris.
    expect(page).toContain("const [hiddenSettled, setHiddenSettled] = useState(!isAdmin);");
    expect(page).toMatch(/\} finally \{[\s\S]*?if \(!signal\?\.aborted\) setHiddenSettled\(true\);/);
  });

  it("les entrées d'attente du sommaire gardent leur teinte et réservent « Mes tournois »", () => {
    expect(page).toMatch(/<span key=\{entry\.key\} className=\{s\.sectionNavLink\} data-tone=\{entry\.key\}>/);
    expect(page).toContain(": myTournamentIds.size > 0,");
  });

  it("la zone des sections garde une hauteur minimale pendant le chargement", () => {
    expect(page).toContain('data-loading={listLoaded ? undefined : "true"}');
    expect(css).toMatch(/\.sections\[data-loading="true"\]\s*\{\s*min-height:/);
    expect(css).toMatch(/\.sectionNavLink \.num \{[^}]*min-width: 2ch;/);
  });

  it("la recherche est différée et le filtrage mémoïsé", () => {
    expect(page).toContain("const deferredQuery = useDeferredValue(query);");
    expect(page).toContain("value={query}");
    for (const memo of ["queryFilteredBuckets", "queryFilteredHidden", "gameFilteredBuckets", "filteredHidden", "hasMyTournaments"]) {
      expect(page).toMatch(new RegExp(`const ${memo} = useMemo`));
    }
    expect(page).toMatch(/const \{ mine: myTournaments, others: filteredBuckets \} = useMemo/);
  });

  it("« Créer un tournoi » est un seul contrôle interactif, pas un bouton dans un lien", () => {
    expect(page).toMatch(/<CyberButton asChild variant="primary">\s*<LocaleLink href="\/tournois\/creer"[^>]*>/);
    expect(page).not.toMatch(/<LocaleLink href="\/tournois\/creer">\s*<button/);
  });

  it("la recherche (coûteuse) ne s'exécute qu'une fois par rendu, le filtre de jeu par-dessus", () => {
    // `filteredBuckets` dérive de `queryFilteredBuckets` plutôt que de relire
    // la recherche une seconde fois avec `filterBuckets(..., gameFilter)` :
    // sur ~150 tournois, ça évite de repasser deux fois sur nom/description/
    // format à chaque frappe.
    expect(page).not.toMatch(/filterBuckets\(scheduledBuckets, query, gameFilter\)/);
    expect(page).toMatch(/gameFilter === "all"\s*\?\s*queryFilteredBuckets/);
  });
});

describe("page tournois — sommaire des sections", () => {
  it("le nom accessible d'un lien ne colle pas le libellé et le compte", () => {
    expect(page).toContain('aria-label={t("list.countLabel", { label: entry.navLabel, count: String(entry.count) })}');
    expect(page).toMatch(/<span className=\{s\.num\} aria-hidden="true">\s*\{entry\.count\}/);
  });

  it("une ancre restée dans l'URL déplie et rejoint sa section une fois rendue", () => {
    expect(page).toContain("parsePageSectionAnchor(window.location.hash)");
    expect(page).toMatch(/setSectionOpen\(key, true\);[\s\S]{0,200}scrollIntoView/);
  });
});

describe("page tournois — volume des sections", () => {
  it("chaque section bornée peut se déplier puis se replier", () => {
    for (const key of ["mine", "running", "registration", "upcoming", "finished"]) {
      expect(page).toContain(`expanded={expandedSections.has("${key}")}`);
      expect(page).toContain(`onToggle={() => toggleSection("${key}")}`);
    }
  });

  it("l'état déplié se remet à zéro à chaque changement de filtre", () => {
    expect(page).toMatch(
      /setExpandedSections\(\(previous\) => \(previous\.size === 0 \? previous : new Set\(\)\)\);\s*\}, \[deferredQuery, gameFilter\]\);/,
    );
  });

  it("une section dépliée montre le total réel, jamais un compte figé au moment du clic", () => {
    // `displayLimits` capturait le total au clic : un rafraîchissement de fond
    // qui fait grossir la section le laissait périmé, cachant les arrivées
    // récentes derrière un « Voir plus » qui semblait pourtant déplié.
    expect(page).not.toContain("displayLimits");
    expect(page).toContain("list.slice(0, expandedSections.has(key) ? list.length : SECTION_DISPLAY_LIMIT)");
  });

  it("chaque bouton « Voir plus »/« Voir moins » nomme sa section", () => {
    // Jusqu'à quatre boutons « Voir moins » identiques cohabitent sur la
    // page : sans le nom de la section, une navigation par liste de contrôles
    // (lecteur d'écran) ne peut pas les distinguer.
    for (const key of ["mine", "running", "registration", "upcoming", "finished"]) {
      expect(page).toMatch(new RegExp(`sectionTitle=\\{sectionTitle\\("${key}"\\)\\}[\\s\\S]{0,80}total=\\{total${key[0].toUpperCase()}${key.slice(1)}\\}`));
    }
  });
});
