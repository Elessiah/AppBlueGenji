"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LocaleLink } from "@/components/i18n/locale-navigation";
import { useTournamentsText } from "@/components/i18n/tournaments-text";
import { tournamentLabel } from "@/lib/shared/tournaments-text";
import { richNodes } from "@/components/i18n/shell-text";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";
import { can, type PlatformRole } from "@/lib/shared/permissions";
import { sameBuckets, sameTournaments } from "@/lib/shared/tournament-schedule";
import { refreshCadenceFor } from "@/lib/shared/refresh-tiers";
import { useAutoRefresh } from "@/lib/shared/hooks/useAutoRefresh";
import { useScheduledBuckets } from "@/lib/shared/hooks/useScheduledBuckets";
import { useToast } from "@/components/ui/toast";
import { BgCanvas } from "../_shared/BgCanvas";
import { CyberButton } from "@/components/cyber/CyberButton";
import { Ticker } from "@/components/cyber/Ticker";
import { RunningCard } from "./cards/RunningCard";
import { RegistrationCard } from "./cards/RegistrationCard";
import { UpcomingCard } from "./cards/UpcomingCard";
import { FinishedCard } from "./cards/FinishedCard";
import { StateCard } from "./cards/StateCard";
import { priorityBannerIds } from "./cards/card-image";
import { Section } from "./Section";
import { useSearchShortcut } from "@/lib/shared/hooks/useSearchShortcut";
import { SEARCH_ARIA_KEYSHORTCUTS } from "@/lib/shared/search-shortcut";
import {
  filterBuckets,
  filterTournamentsByGame,
  filterTournamentsByQuery,
  finishedBeyondList,
  flattenBuckets,
  countByGame,
  needsFinishedArchive,
  sectionEmptyMessage,
  type GameFilter,
} from "./_lib/buckets";
import { buildTickerItems } from "./_lib/ticker";
import {
  DEFAULT_OPEN_SECTIONS,
  pageSectionAnchor,
  pageSections,
  parsePageSectionAnchor,
  splitMyTournaments,
  type PageSectionKey,
} from "./_lib/page-sections";
import { RulesHelpFab } from "@/components/rules/RulesHelpFab";
import s from "./tournois.module.css";

const emptyBuckets: TournamentBuckets = {
  upcoming: [],
  registration: [],
  running: [],
  finished: [],
};

/** Sections dont la liste est bornée par défaut (`_lib/buckets.ts` ne connaît
 * pas cette limite : c'est un choix d'affichage, pas un fait sur les données). */
type LimitedSectionKey = "mine" | "running" | "registration" | "upcoming" | "finished";
const SECTION_DISPLAY_LIMIT = 12;

const GAME_FILTERS: readonly GameFilter[] = ["all", "ow", "mr"];

/**
 * Bouton « Voir plus » / « Voir moins » d'une section : absent tant que tout
 * tient sous la limite, et **réversible** — la version d'origine (section
 * « Terminés » seule) ne savait que déplier, jamais replier.
 *
 * `expanded` est un drapeau, pas un compte figé : la page se rafraîchit de
 * fond en fond, et une section dépliée sur « 46 » ne doit pas se retrouver
 * bornée à ce chiffre quand un rafraîchissement en apporte 50 — elle montre
 * alors les 50 sans qu'on ait besoin de redéplier.
 */
function ShowMoreRow({
  sectionTitle,
  total,
  expanded,
  onToggle,
}: Readonly<{
  /** Nomme la section dans le bouton : jusqu'à quatre « Voir moins »
   * identiques cohabitent sur la page, indistinguables dans une liste de
   * contrôles hors contexte (lecteur d'écran, navigation par éléments). */
  sectionTitle: string;
  total: number;
  expanded: boolean;
  onToggle: () => void;
}>) {
  const { t } = useTournamentsText();
  if (total <= SECTION_DISPLAY_LIMIT) return null;
  const count = String(total - SECTION_DISPLAY_LIMIT);
  return (
    <div className={s.showMoreRow}>
      {expanded ? (
        <button onClick={onToggle} className={s.cardCta} aria-label={t("list.showLessLabel", { section: sectionTitle })}>
          {t("list.showLess")}
        </button>
      ) : (
        <button
          onClick={onToggle}
          className={s.cardCta}
          aria-label={t("list.showMoreLabel", { count, section: sectionTitle })}
        >
          {t("list.showMore", { count })}
        </button>
      )}
    </div>
  );
}

/**
 * Tournois (en cours ou à venir) où le lecteur est engagé. Complément
 * décoratif de la liste : en cas d'échec la page retombe sur ses sections
 * habituelles, sans « Mes tournois » — rien à signaler au lecteur.
 */
async function fetchMyTournamentIds(signal?: AbortSignal): Promise<number[]> {
  const response = await fetch("/api/me/tournaments", { cache: "no-store", signal });
  const payload = (await response.json()) as { tournamentIds?: unknown };
  if (!response.ok || !Array.isArray(payload.tournamentIds)) {
    throw new Error("MY_TOURNAMENTS_READ_FAILED");
  }
  return payload.tournamentIds.filter((id): id is number => Number.isInteger(id));
}

async function fetchBuckets(url: string, signal?: AbortSignal): Promise<TournamentBuckets> {
  const response = await fetch(url, { cache: "no-store", signal });
  const payload = (await response.json()) as {
    error?: string;
    buckets?: TournamentBuckets;
  };
  if (!response.ok || !payload.buckets) {
    throw new Error(payload.error || "TOURNAMENT_LIST_FAILED");
  }
  return payload.buckets;
}

/** Le titre de la page : « BlueGenji » en accent (`<em>` du message). */
const titleEm = (children: ReadonlyArray<ReactNode>) => <em className={s.titleEm}>{richNodes(children)}</em>;

export default function TournamentsList() {
  const text = useTournamentsText();
  const { t } = text;
  const { showError } = useToast();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState<GameFilter>("all");
  const [buckets, setBuckets] = useState<TournamentBuckets>(emptyBuckets);
  const [hiddenTournaments, setHiddenTournaments] = useState<TournamentCard[]>([]);
  const [myTournamentIds, setMyTournamentIds] = useState<ReadonlySet<number>>(new Set());
  const [expandedSections, setExpandedSections] = useState<ReadonlySet<LimitedSectionKey>>(new Set());
  const [openSections, setOpenSections] = useState<ReadonlySet<PageSectionKey>>(
    () => new Set(DEFAULT_OPEN_SECTIONS),
  );
  const [isAdmin, setIsAdmin] = useState(false);
  // L'archive entière des terminés n'est demandée qu'une fois le lecteur allé
  // la chercher (`needsFinishedArchive`), puis gardée : la relâcher au premier
  // filtre effacé ferait recharger la liste à chaque frappe.
  const [wantFinishedArchive, setWantFinishedArchive] = useState(false);
  // Lu **après** la réponse : une relecture de fond partie avant la demande
  // d'archive rapporterait la liste tronquée, et l'appliquer effacerait
  // l'archive arrivée entre-temps.
  const wantFinishedArchiveRef = useRef(wantFinishedArchive);
  wantFinishedArchiveRef.current = wantFinishedArchive;

  // `silent` : les rafraîchissements de fond ne doivent pas couvrir l'écran de
  // notifications pour un incident réseau passager. Seul le premier chargement,
  // celui que l'utilisateur attend, signale son échec.
  const load = useCallback(
    async (silent = false, signal?: AbortSignal) => {
      try {
        const all = await fetchBuckets(
          wantFinishedArchive ? "/api/tournaments?finished=all" : "/api/tournaments",
          signal,
        );
        if (wantFinishedArchive !== wantFinishedArchiveRef.current) return;
        // On garde la référence précédente quand rien n'a changé : sinon chaque
        // relecture de fond redessinerait toute la liste et réarmerait le
        // minuteur de bascule, pour un contenu identique.
        setBuckets((previous) => (sameBuckets(previous, all) ? previous : all));
      } catch (e) {
        // Une requête abandonnée (démontage, rafraîchissement suivant) n'est pas
        // un incident : la page n'a plus rien à afficher de toute façon.
        if (signal?.aborted || silent) return;
        showError((e as Error).message);
      }
    },
    [showError, wantFinishedArchive],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  // Les tournois du lecteur arrivent par une lecture à part : la liste publique
  // est la même pour tous (et mutualisée côté serveur), elle ne peut pas savoir
  // qui la lit. Un échec ne dit rien — la page garde ses sections habituelles.
  const loadMine = useCallback(async (signal?: AbortSignal) => {
    try {
      const ids = await fetchMyTournamentIds(signal);
      setMyTournamentIds((previous) =>
        previous.size === ids.length && ids.every((id) => previous.has(id)) ? previous : new Set(ids),
      );
    } catch {
      // Silencieux, premier chargement compris : voir `fetchMyTournamentIds`.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadMine(controller.signal);
    return () => controller.abort();
  }, [loadMine]);

  // Les tournois pas encore visibles ne sont servis qu'au staff `tournaments` :
  // inutile d'aller les demander pour se faire répondre 403. Leur échec ne doit
  // pas emporter la liste publique, d'où un chargement à part — mais qui suit la
  // même cadence, sans quoi la seule section réservée à ceux qui vivent sur
  // cette page serait aussi la seule à exiger un F5.
  const loadHidden = useCallback(
    async (silent = false, signal?: AbortSignal) => {
      if (!isAdmin) {
        // Un tableau neuf ne serait jamais égal au précédent : la page se
        // redessinerait à chaque passage, pour tous ceux qui n'ont même pas
        // cette section.
        setHiddenTournaments((previous) => (previous.length === 0 ? previous : []));
        return;
      }
      try {
        const hidden = flattenBuckets(await fetchBuckets("/api/tournaments?scope=hidden", signal));
        setHiddenTournaments((previous) =>
          sameTournaments(previous, hidden) ? previous : hidden,
        );
      } catch (e) {
        if (signal?.aborted || silent) return;
        showError((e as Error).message);
      }
    },
    [isAdmin, showError],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadHidden(false, controller.signal);
    return () => controller.abort();
  }, [loadHidden]);

  // Aucun flux SSE sur cette page : elle se tient à jour toute seule par le
  // retour sur l'onglet — ce qui remplace le F5 — doublé d'une relecture de
  // fond, rare pour les spectateurs, plus fréquente pour le staff. Côté
  // serveur, la liste publique est mutualisée : ces relectures ne coûtent
  // presque rien (`lib/server/tournaments/list-cache.ts`). « Mes tournois »
  // suit la même cadence : s'inscrire depuis une fiche puis revenir sur
  // l'onglet suffit à voir le tournoi remonter en tête.
  useAutoRefresh(
    (signal) =>
      Promise.all([load(true, signal), loadHidden(true, signal), loadMine(signal)]).then(
        () => undefined,
      ),
    { intervalMs: refreshCadenceFor({ isStaff: isAdmin }).listIntervalMs },
  );

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (r) =>
        r.ok ? ((await r.json()) as { user?: { isAdmin?: boolean; roles?: PlatformRole[] } }) : null,
      )
      .then((p) => setIsAdmin(can(p?.user, "tournaments")))
      .catch(() => setIsAdmin(false));
  }, []);

  const shortcutLabel = useSearchShortcut(searchInputRef);

  useEffect(() => {
    setExpandedSections(new Set());
  }, [query, gameFilter]);

  const finishedExpanded = expandedSections.has("finished");
  useEffect(() => {
    if (needsFinishedArchive(query, gameFilter, finishedExpanded)) setWantFinishedArchive(true);
  }, [query, gameFilter, finishedExpanded]);

  const toggleSection = (key: LimitedSectionKey) =>
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setSectionOpen = (key: PageSectionKey, open: boolean) =>
    setOpenSections((prev) => {
      if (prev.has(key) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });

  // Les cartes portent leur horaire : le client fait basculer « Prochainement »
  // → « Inscriptions » → « En cours » à la seconde dite, sans rien demander au
  // serveur (`lib/shared/tournament-schedule.ts`).
  const scheduledBuckets = useScheduledBuckets(buckets);

  // La recherche (le passage coûteux : nom, description, format sur chaque
  // tournoi) n'est faite qu'une fois — le filtre de jeu, lui, ne fait que
  // comparer une chaîne déjà connue, appliqué séparément pour le panier
  // affiché (`gameFilteredBuckets`) et pour les pastilles, qui veulent le compte
  // de CHAQUE jeu sans se soucier de celui déjà choisi (`queryFilteredBuckets`).
  // Le format se cherche sous le nom que la carte affiche (« Swiss » sous `/en`).
  const formatName = (format: string) => tournamentLabel(text, "format", format);
  const queryFilteredBuckets = filterBuckets(scheduledBuckets, query, "all", formatName);
  const queryFilteredHidden = filterTournamentsByQuery(hiddenTournaments, query, formatName);

  const gameFilteredBuckets: TournamentBuckets =
    gameFilter === "all"
      ? queryFilteredBuckets
      : {
          upcoming: filterTournamentsByGame(queryFilteredBuckets.upcoming, gameFilter),
          registration: filterTournamentsByGame(queryFilteredBuckets.registration, gameFilter),
          running: filterTournamentsByGame(queryFilteredBuckets.running, gameFilter),
          finished: filterTournamentsByGame(queryFilteredBuckets.finished, gameFilter),
        };
  const filteredHidden = filterTournamentsByGame(queryFilteredHidden, gameFilter);

  // Les tournois du lecteur quittent leur section d'origine pour passer en
  // tête : chacun n'apparaît qu'une fois. Le découpage suit les paniers déjà
  // reclassés par l'horloge, pour qu'un tournoi qui démarre reste en tête.
  const { mine: myTournaments, others: filteredBuckets } = splitMyTournaments(
    gameFilteredBuckets,
    myTournamentIds,
  );
  // Jugé avant filtre : une recherche qui vide « Mes tournois » laisse son
  // entrée au sommaire (à zéro) au lieu de la faire disparaître.
  const hasMyTournaments = splitMyTournaments(scheduledBuckets, myTournamentIds).mine.length > 0;

  const totalHidden = filteredHidden.length;
  const totalMine = myTournaments.length;
  const totalRunning = filteredBuckets.running.length;
  const totalRegistration = filteredBuckets.registration.length;
  const totalUpcoming = filteredBuckets.upcoming.length;
  // Sans recherche, les terminés que la liste tronquée ne porte pas comptent
  // quand même : « Voir plus » et le sommaire annoncent l'archive entière.
  const finishedBeyond = (key: GameFilter) => (query.trim() ? 0 : finishedBeyondList(buckets, key));
  const totalFinished = filteredBuckets.finished.length + finishedBeyond(gameFilter);
  // Section dépliée, archive demandée mais pas encore reçue : la liste en main
  // est encore la liste tronquée.
  const finishedArchiveLoading =
    finishedExpanded && wantFinishedArchive && buckets.finishedTotals !== undefined;

  const showHidden = isAdmin && hiddenTournaments.length > 0;

  // Toutes les sections que ce lecteur peut avoir, zéros compris : le
  // sommaire les montre toutes (un zéro répond à « y a-t-il un tournoi en
  // cours ? »), la page ne rend que celles qui contiennent quelque chose.
  const sections = pageSections(
    {
      hidden: totalHidden,
      mine: totalMine,
      running: totalRunning,
      registration: totalRegistration,
      upcoming: totalUpcoming,
      finished: totalFinished,
    },
    { hidden: showHidden, mine: hasMyTournaments },
    text,
  );
  const sectionTitle = (key: PageSectionKey) => t(`list.sections.${key}`);
  const shownSections = sections.filter((entry) => entry.count > 0);
  // Numérotation continue des seules sections affichées : un « 03 » qui suit
  // un « 01 » ferait chercher la section manquante.
  const ix = (key: PageSectionKey) =>
    String(shownSections.findIndex((entry) => entry.key === key) + 1).padStart(2, "0");
  const isOpen = (key: PageSectionKey) => openSections.has(key);

  // Une ancre du sommaire reste dans l'URL : au rechargement (ou sur un lien
  // partagé), la section visée n'existe pas encore — elle naît avec la liste —
  // et « Terminés » est repliée d'office. On attend donc qu'elle soit rendue,
  // on la déplie puis on y mène, une seule fois par chargement.
  const pendingAnchorRef = useRef<PageSectionKey | null | undefined>(undefined);
  const anchorTargetShown = shownSections.some((entry) => entry.key === pendingAnchorRef.current);
  useEffect(() => {
    if (pendingAnchorRef.current === undefined) {
      pendingAnchorRef.current = parsePageSectionAnchor(window.location.hash);
    }
    const key = pendingAnchorRef.current;
    if (!key || !shownSections.some((entry) => entry.key === key)) return;
    pendingAnchorRef.current = null;
    setSectionOpen(key, true);
    // Après le rendu de la section dépliée, pas avant.
    window.setTimeout(() => {
      document.getElementById(pageSectionAnchor(key))?.scrollIntoView({ block: "start" });
    }, 0);
    // `shownSections` est recalculée à chaque rendu : seul compte le moment où
    // la section visée apparaît.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorTargetShown]);

  // Bandeaux d'illustration chargés en priorité : les premiers dans l'ordre
  // d'affichage des sections ouvertes d'office (les terminés sont repliés).
  const priorityBanners = priorityBannerIds([
    ...(showHidden ? filteredHidden : []),
    ...myTournaments,
    ...filteredBuckets.running,
    ...filteredBuckets.registration,
    ...filteredBuckets.upcoming,
  ]);

  // Les pastilles comptent ce que la page montre : pour le staff, les invisibles
  // en font partie ; la recherche filtre les sections en dessous, les compteurs
  // doivent donc en tenir compte eux aussi (seul le jeu reste libre : chaque
  // pastille dit ce que donnerait SON filtre, pas celui déjà actif).
  const countGame = (key: GameFilter) =>
    countByGame(queryFilteredBuckets, key) +
    finishedBeyond(key) +
    (showHidden ? filterTournamentsByGame(queryFilteredHidden, key).length : 0);

  // Une section dépliée montre le total réel, jamais un compte figé au clic.
  const visibleSlice = (key: LimitedSectionKey, list: TournamentCard[]) =>
    list.slice(0, expandedSections.has(key) ? list.length : SECTION_DISPLAY_LIMIT);

  return (
    <div className={s.page}>
      <RulesHelpFab />
      <BgCanvas mode="network" />
      <div className={s.fabric} />
      <div className={s.pageInner}>
        <div className="container">
          <header className={s.pageHead}>
            <div>
              <span className="eyebrow">{t("list.eyebrow")}</span>
              <h1 className={s.title}>{richNodes(text.rich("list.title", {}, { em: titleEm }))}</h1>
              <div className={s.subtitle}>{t("list.subtitle")}</div>
            </div>
            {isAdmin && (
              <CyberButton asChild variant="primary">
                <LocaleLink href="/tournois/creer">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M8 3v10M3 8h10"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                  {t("list.create")}
                </LocaleLink>
              </CyberButton>
            )}
          </header>

          <div className={s.toolbar}>
            <div className={s.search}>
              <span className={s.searchIcon}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </span>
              <input
                ref={searchInputRef}
                aria-label={t("list.searchLabel")}
                aria-keyshortcuts={SEARCH_ARIA_KEYSHORTCUTS}
                placeholder={t("list.searchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className={s.searchKbd} aria-hidden="true">
                {shortcutLabel}
              </span>
            </div>
            <div className={s.filterRow}>
              {GAME_FILTERS.map((key) => {
                const label = t(`list.filters.${key}`);
                const count = countGame(key);
                return (
                  <button
                    key={key}
                    className={`${s.chip} ${gameFilter === key ? s.chipOn : ""}`}
                    aria-pressed={gameFilter === key}
                    aria-label={t("list.countLabel", { label, count: String(count) })}
                    onClick={() => setGameFilter(key)}
                  >
                    {label}
                    <span className={s.num} aria-hidden="true">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sommaire : remplace le bandeau de chiffres, qui répétait les
              comptes des sections sans mener nulle part. Une section vide y
              reste, grisée, au lieu d'occuper un grand cadre « Vide » plus bas. */}
          <nav className={s.sectionNav} aria-label={t("list.sectionsNav")}>
            {sections.map((entry) =>
              entry.count > 0 ? (
                <a
                  key={entry.key}
                  href={`#${pageSectionAnchor(entry.key)}`}
                  className={s.sectionNavLink}
                  data-tone={entry.key}
                  // Mène parfois à une section repliée (« Terminés ») : on la
                  // déplie, sans quoi le lien aboutirait sur un en-tête vide.
                  onClick={() => setSectionOpen(entry.key, true)}
                  // Libellé et compte sont deux éléments sans séparateur : le
                  // nom accessible les collerait (« Mes tournois34 »). Il
                  // commence par le texte visible (WCAG 2.5.3).
                  aria-label={t("list.countLabel", { label: entry.navLabel, count: String(entry.count) })}
                >
                  {entry.navLabel}
                  <span className={s.num} aria-hidden="true">
                    {entry.count}
                  </span>
                </a>
              ) : (
                <span key={entry.key} className={`${s.sectionNavLink} ${s.sectionNavEmpty}`}>
                  {entry.navLabel}
                  <span className={s.num} aria-hidden="true">
                    0
                  </span>
                  <span className="sr-only"> {t("list.navNone")}</span>
                </span>
              ),
            )}
          </nav>

          {/* Les paniers reclassés, comme les sections : sinon le bandeau
              annoncerait « À VENIR » un tournoi affiché juste dessous en
              « INSCRIPTIONS » — le genre de doute qui fait recharger la page. */}
          <Ticker
            items={buildTickerItems(scheduledBuckets, text)}
            labels={text.tickerLabels}
          />

          <div className={s.sections}>
            {shownSections.length === 0 && (
              <div className={s.emptyAll}>
                <div className={s.emptyTitle}>{t("list.emptyTitle")}</div>
                <div className={s.emptyMsg}>
                  {sectionEmptyMessage(t("list.emptyUnfiltered"), query, gameFilter, t("list.emptyFiltered"))}
                </div>
              </div>
            )}

            {showHidden && totalHidden > 0 && (
              <Section
                id={pageSectionAnchor("hidden")}
                ix={ix("hidden")}
                title={sectionTitle("hidden")}
                accent={t("list.staffAccent")}
                count={totalHidden}
                open={isOpen("hidden")}
                onOpenChange={(open) => setSectionOpen("hidden", open)}
              >
                {filteredHidden.map((t) => (
                  <div key={t.id} className={s.hiddenCard}>
                    <StateCard t={t} priority={priorityBanners.has(t.id)} />
                  </div>
                ))}
              </Section>
            )}

            {totalMine > 0 && (
              <Section
                id={pageSectionAnchor("mine")}
                ix={ix("mine")}
                title={sectionTitle("mine")}
                count={totalMine}
                tone="mine"
                open={isOpen("mine")}
                onOpenChange={(open) => setSectionOpen("mine", open)}
              >
                {visibleSlice("mine", myTournaments).map((t) => (
                  <div key={t.id} className={s.mineCard}>
                    <StateCard t={t} priority={priorityBanners.has(t.id)} />
                  </div>
                ))}
                <ShowMoreRow
                  sectionTitle={sectionTitle("mine")}
                  total={totalMine}
                  expanded={expandedSections.has("mine")}
                  onToggle={() => toggleSection("mine")}
                />
              </Section>
            )}

            {totalRunning > 0 && (
              <Section
                id={pageSectionAnchor("running")}
                ix={ix("running")}
                title={sectionTitle("running")}
                tone="running"
                count={totalRunning}
                open={isOpen("running")}
                onOpenChange={(open) => setSectionOpen("running", open)}
                dataCols="2"
              >
                {visibleSlice("running", filteredBuckets.running).map((t) => (
                  <RunningCard key={t.id} t={t} priority={priorityBanners.has(t.id)} />
                ))}
                <ShowMoreRow
                  sectionTitle={sectionTitle("running")}
                  total={totalRunning}
                  expanded={expandedSections.has("running")}
                  onToggle={() => toggleSection("running")}
                />
              </Section>
            )}

            {totalRegistration > 0 && (
              <Section
                id={pageSectionAnchor("registration")}
                ix={ix("registration")}
                title={sectionTitle("registration")}
                tone="registration"
                count={totalRegistration}
                open={isOpen("registration")}
                onOpenChange={(open) => setSectionOpen("registration", open)}
              >
                {visibleSlice("registration", filteredBuckets.registration).map((t) => (
                  <RegistrationCard key={t.id} t={t} priority={priorityBanners.has(t.id)} />
                ))}
                <ShowMoreRow
                  sectionTitle={sectionTitle("registration")}
                  total={totalRegistration}
                  expanded={expandedSections.has("registration")}
                  onToggle={() => toggleSection("registration")}
                />
              </Section>
            )}

            {totalUpcoming > 0 && (
              <Section
                id={pageSectionAnchor("upcoming")}
                ix={ix("upcoming")}
                title={sectionTitle("upcoming")}
                tone="upcoming"
                count={totalUpcoming}
                open={isOpen("upcoming")}
                onOpenChange={(open) => setSectionOpen("upcoming", open)}
              >
                {visibleSlice("upcoming", filteredBuckets.upcoming).map((t) => (
                  <UpcomingCard key={t.id} t={t} priority={priorityBanners.has(t.id)} />
                ))}
                <ShowMoreRow
                  sectionTitle={sectionTitle("upcoming")}
                  total={totalUpcoming}
                  expanded={expandedSections.has("upcoming")}
                  onToggle={() => toggleSection("upcoming")}
                />
              </Section>
            )}

            {totalFinished > 0 && (
              <Section
                id={pageSectionAnchor("finished")}
                ix={ix("finished")}
                title={sectionTitle("finished")}
                tone="finished"
                count={totalFinished}
                open={isOpen("finished")}
                onOpenChange={(open) => setSectionOpen("finished", open)}
              >
                {/* Les cartes sont les items de la grille, comme dans les autres
                    sections : une enveloppe les empilait dans une seule cellule, et
                    `.card { height: 100% }` étirait chacune à la hauteur de la pile. */}
                {visibleSlice("finished", filteredBuckets.finished).map((t) => (
                  <FinishedCard key={t.id} t={t} />
                ))}
                {/* L'archive arrive après le clic : sans ce mot, « Voir moins »
                    s'afficherait sur les douze mêmes cartes, comme si le clic
                    n'avait rien donné. */}
                {finishedArchiveLoading && (
                  <div /* NOSONAR S6819 — région live d'état, pas le résultat d'un formulaire */ className={s.showMoreRow} role="status">
                    {t("list.finishedLoading")}
                  </div>
                )}
                <ShowMoreRow
                  sectionTitle={sectionTitle("finished")}
                  total={totalFinished}
                  expanded={expandedSections.has("finished")}
                  onToggle={() => toggleSection("finished")}
                />
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

