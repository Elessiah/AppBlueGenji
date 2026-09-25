"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  filterBuckets,
  filterTournamentsByGame,
  filterTournamentsByQuery,
  flattenBuckets,
  countByGame,
  searchShortcutLabel,
  sectionEmptyMessage,
  type GameFilter,
} from "./_lib/buckets";
import { buildTickerItems } from "./_lib/ticker";
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
type LimitedSectionKey = "running" | "registration" | "upcoming" | "finished";
const SECTION_DISPLAY_LIMIT = 12;

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
  total,
  expanded,
  onToggle,
}: {
  total: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (total <= SECTION_DISPLAY_LIMIT) return null;
  return (
    <div className={s.showMoreRow}>
      {expanded ? (
        <button onClick={onToggle} className={s.cardCta}>
          Voir moins
        </button>
      ) : (
        <button onClick={onToggle} className={s.cardCta}>
          Voir plus ({total - SECTION_DISPLAY_LIMIT})
        </button>
      )}
    </div>
  );
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

export default function TournamentsPage() {
  const { showError } = useToast();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState<GameFilter>("all");
  const [buckets, setBuckets] = useState<TournamentBuckets>(emptyBuckets);
  const [hiddenTournaments, setHiddenTournaments] = useState<TournamentCard[]>([]);
  const [expandedSections, setExpandedSections] = useState<ReadonlySet<LimitedSectionKey>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);
  // « Ctrl+K » par défaut (sûr pour le rendu serveur) : la vraie plateforme
  // ne se lit que côté client, une fois montée.
  const [shortcutLabel, setShortcutLabel] = useState("Ctrl+K");

  // `silent` : les rafraîchissements de fond ne doivent pas couvrir l'écran de
  // notifications pour un incident réseau passager. Seul le premier chargement,
  // celui que l'utilisateur attend, signale son échec.
  const load = useCallback(
    async (silent = false, signal?: AbortSignal) => {
      try {
        const all = await fetchBuckets("/api/tournaments", signal);
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
    [showError],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

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
  // presque rien (`lib/server/tournaments/list-cache.ts`).
  useAutoRefresh(
    (signal) => Promise.all([load(true, signal), loadHidden(true, signal)]).then(() => undefined),
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


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    setShortcutLabel(searchShortcutLabel(navigator.platform || navigator.userAgent));
  }, []);

  useEffect(() => {
    setExpandedSections(new Set());
  }, [query, gameFilter]);

  const toggleSection = (key: LimitedSectionKey) =>
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Les cartes portent leur horaire : le client fait basculer « Prochainement »
  // → « Inscriptions » → « En cours » à la seconde dite, sans rien demander au
  // serveur (`lib/shared/tournament-schedule.ts`).
  const scheduledBuckets = useScheduledBuckets(buckets);

  const filteredBuckets = filterBuckets(scheduledBuckets, query, gameFilter);
  const filteredHidden = filterTournamentsByGame(
    filterTournamentsByQuery(hiddenTournaments, query),
    gameFilter,
  );

  const totalHidden = filteredHidden.length;
  const totalRunning = filteredBuckets.running.length;
  const totalRegistration = filteredBuckets.registration.length;
  const totalUpcoming = filteredBuckets.upcoming.length;
  const totalFinished = filteredBuckets.finished.length;

  // La section des invisibles prend la première place quand elle est affichée :
  // les suivantes se décalent pour garder une numérotation continue.
  const showHidden = isAdmin && hiddenTournaments.length > 0;
  const ix = (position: number) => String(position + (showHidden ? 1 : 0)).padStart(2, "0");

  // Bandeaux d'illustration chargés en priorité : les premiers dans l'ordre
  // d'affichage des sections ouvertes d'office (les terminés sont repliés).
  const priorityBanners = priorityBannerIds([
    ...(showHidden ? filteredHidden : []),
    ...filteredBuckets.running,
    ...filteredBuckets.registration,
    ...filteredBuckets.upcoming,
  ]);

  // Les pastilles comptent ce que la page montre : pour le staff, les invisibles
  // en font partie ; la recherche filtre les sections en dessous, les compteurs
  // doivent donc en tenir compte eux aussi (seul le jeu reste libre : chaque
  // pastille dit ce que donnerait SON filtre, pas celui déjà actif).
  const queryFilteredBuckets = filterBuckets(scheduledBuckets, query, "all");
  const queryFilteredHidden = filterTournamentsByQuery(hiddenTournaments, query);
  const countGame = (key: GameFilter) =>
    countByGame(queryFilteredBuckets, key) +
    (showHidden ? filterTournamentsByGame(queryFilteredHidden, key).length : 0);

  const emptyMsg = (whenUnfiltered: string) => sectionEmptyMessage(whenUnfiltered, query, gameFilter);

  return (
    <div className={s.page}>
      <RulesHelpFab />
      <BgCanvas mode="network" />
      <div className={s.fabric} />
      <div className={s.pageInner}>
        <div className="container">
          <header className={s.pageHead}>
          <div>
            <span className="eyebrow">PLATEFORME · TOURNOIS</span>
            <h1 className={s.title}>
              Tournois <em className={s.titleEm}>BlueGenji</em>
            </h1>
            <div className={s.subtitle}>SUIVI TEMPS RÉEL · PHASES MULTIPLES · BRACKETS ARBITRÉS</div>
          </div>
          {isAdmin && (
            <CyberButton asChild variant="primary">
              <Link href="/tournois/creer">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 3v10M3 8h10"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                Créer un tournoi
              </Link>
            </CyberButton>
          )}
        </header>

        <div className={s.metrics}>
          <div className={s.metric}>
            <div className={s.metricNum}>
              <em>{totalRunning}</em> EN DIRECT
            </div>
            <div className={s.metricLbl}>Diffusés sur Twitch</div>
          </div>
          <div className={s.metric}>
            <div className={s.metricNum}>{totalRegistration}</div>
            <div className={s.metricLbl}>Inscriptions ouvertes</div>
          </div>
          <div className={s.metric}>
            <div className={s.metricNum}>{totalUpcoming}</div>
            <div className={s.metricLbl}>Programmés à venir</div>
          </div>
          <div className={s.metric}>
            <div className={s.metricNum}>{isAdmin ? totalHidden : "—"}</div>
            <div className={s.metricLbl}>{isAdmin ? "Invisibles · staff" : "Prizepool · à venir"}</div>
          </div>
        </div>

        <div className={s.toolbar}>
          <div className={s.search}>
            <span className={s.searchIcon}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </span>
            <input
              ref={searchInputRef}
              aria-label="Rechercher un tournoi"
              placeholder="Rechercher un tournoi, un format…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className={s.searchKbd}>{shortcutLabel}</span>
          </div>
          <div className={s.filterRow}>
            {[
              ["all", "Tous"],
              ["ow", "Overwatch"],
              ["mr", "Marvel Rivals"],
            ].map(([key, label]) => {
              const count = countGame(key as GameFilter);
              return (
                <button
                  key={key}
                  className={`${s.chip} ${gameFilter === key ? s.chipOn : ""}`}
                  aria-pressed={gameFilter === key}
                  aria-label={`${label} (${count})`}
                  onClick={() => setGameFilter(key as GameFilter)}
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

        {/* Les paniers reclassés, comme les sections : sinon le bandeau
            annoncerait « À VENIR » un tournoi affiché juste dessous en
            « INSCRIPTIONS » — le genre de doute qui fait recharger la page. */}
        <Ticker items={buildTickerItems(scheduledBuckets)} />

        <div className={s.sections}>
          {showHidden && (
            <Section
              ix="01"
              title="TOURNOIS INVISIBLES"
              accent="· STAFF"
              count={totalHidden}
              defaultOpen={true}
              emptyMsg="Aucun tournoi invisible ne correspond à cette recherche."
            >
              {filteredHidden.map((t) => (
                <div key={t.id} className={s.hiddenCard}>
                  <StateCard t={t} priority={priorityBanners.has(t.id)} />
                </div>
              ))}
            </Section>
          )}

          <Section
            ix={ix(1)}
            title="EN COURS"
            count={totalRunning}
            defaultOpen={true}
            emptyMsg={emptyMsg("Aucun tournoi en cours actuellement.")}
            dataCols="2"
          >
            {filteredBuckets.running
              .slice(0, expandedSections.has("running") ? totalRunning : SECTION_DISPLAY_LIMIT)
              .map((t) => (
                <RunningCard key={t.id} t={t} priority={priorityBanners.has(t.id)} />
              ))}
            <ShowMoreRow
              total={totalRunning}
              expanded={expandedSections.has("running")}
              onToggle={() => toggleSection("running")}
            />
          </Section>

          <Section
            ix={ix(2)}
            title="INSCRIPTIONS OUVERTES"
            count={totalRegistration}
            defaultOpen={true}
            emptyMsg={emptyMsg("Aucun tournoi en phase d'inscription pour le moment.")}
          >
            {filteredBuckets.registration
              .slice(0, expandedSections.has("registration") ? totalRegistration : SECTION_DISPLAY_LIMIT)
              .map((t) => (
                <RegistrationCard key={t.id} t={t} priority={priorityBanners.has(t.id)} />
              ))}
            <ShowMoreRow
              total={totalRegistration}
              expanded={expandedSections.has("registration")}
              onToggle={() => toggleSection("registration")}
            />
          </Section>

          <Section
            ix={ix(3)}
            title="PROCHAINEMENT"
            count={totalUpcoming}
            defaultOpen={true}
            emptyMsg={emptyMsg("Aucun tournoi à venir pour le moment.")}
          >
            {filteredBuckets.upcoming
              .slice(0, expandedSections.has("upcoming") ? totalUpcoming : SECTION_DISPLAY_LIMIT)
              .map((t) => (
                <UpcomingCard key={t.id} t={t} priority={priorityBanners.has(t.id)} />
              ))}
            <ShowMoreRow
              total={totalUpcoming}
              expanded={expandedSections.has("upcoming")}
              onToggle={() => toggleSection("upcoming")}
            />
          </Section>

          <Section
            ix={ix(4)}
            title="TERMINÉS"
            count={totalFinished}
            defaultOpen={false}
            emptyMsg={emptyMsg("Aucun tournoi terminé pour le moment.")}
          >
            <div>
              {filteredBuckets.finished
                .slice(0, expandedSections.has("finished") ? totalFinished : SECTION_DISPLAY_LIMIT)
                .map((t) => (
                  <FinishedCard key={t.id} t={t} />
                ))}
            </div>
            <ShowMoreRow
              total={totalFinished}
              expanded={expandedSections.has("finished")}
              onToggle={() => toggleSection("finished")}
            />
          </Section>
        </div>
        </div>
      </div>
    </div>
  );
}
