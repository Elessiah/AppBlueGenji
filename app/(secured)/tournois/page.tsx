"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { TournamentBuckets } from "@/lib/shared/types";
import { can, type PlatformRole } from "@/lib/shared/permissions";
import { splitHiddenTournaments } from "@/lib/shared/tournament-visibility";
import { REFRESH_CADENCE, resolveRefreshTier } from "@/lib/shared/refresh-tiers";
import { useAutoRefresh } from "@/lib/shared/hooks/useAutoRefresh";
import { useScheduledBuckets } from "@/lib/shared/hooks/useScheduledBuckets";
import { useToast } from "@/components/ui/toast";
import { BgCanvas } from "../_shared/BgCanvas";
import { Ticker } from "@/components/cyber/Ticker";
import { RunningCard } from "./cards/RunningCard";
import { RegistrationCard } from "./cards/RegistrationCard";
import { UpcomingCard } from "./cards/UpcomingCard";
import { FinishedCard } from "./cards/FinishedCard";
import { StateCard } from "./cards/StateCard";
import { Section } from "./Section";
import { filterBuckets, countByGame, type GameFilter } from "./_lib/buckets";
import { buildTickerItems } from "./_lib/ticker";
import { RulesHelpFab } from "@/components/rules/RulesHelpFab";
import s from "./tournois.module.css";

const emptyBuckets: TournamentBuckets = {
  upcoming: [],
  registration: [],
  running: [],
  finished: [],
};

/** Onglet actif : tout le plateau, ou les seuls tournois créés par l'utilisateur. */
type Tab = "all" | "mine";

const TABS: { key: Tab; id: string; label: string }[] = [
  { key: "all", id: "tournaments-tab-all", label: "Tous les tournois" },
  { key: "mine", id: "tournaments-tab-mine", label: "Mes tournois" },
];

async function fetchBuckets(url: string): Promise<TournamentBuckets> {
  const response = await fetch(url, { cache: "no-store" });
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
  const [myBuckets, setMyBuckets] = useState<TournamentBuckets>(emptyBuckets);
  const [tab, setTab] = useState<Tab>("all");
  const [finishedDisplayLimit, setFinishedDisplayLimit] = useState(12);
  const [isAdmin, setIsAdmin] = useState(false);

  // `silent` : les rafraîchissements de fond ne doivent pas couvrir l'écran de
  // notifications pour un incident réseau passager. Seul le premier chargement,
  // celui que l'utilisateur attend, signale son échec.
  const load = useCallback(
    async (silent = false) => {
      // Les deux listes partent ensemble : celle de l'onglet « Mes tournois »
      // est la seule à porter les tournois pas encore visibles, et c'est elle
      // qui dit si l'onglet doit exister. Elles se règlent en revanche
      // séparément — l'onglet est un complément, son échec ne doit pas emporter
      // la liste que tout le monde vient voir.
      const [all, mine] = await Promise.allSettled([
        fetchBuckets("/api/tournaments"),
        fetchBuckets("/api/tournaments?scope=mine"),
      ]);
      if (all.status === "fulfilled") setBuckets(all.value);
      if (mine.status === "fulfilled") setMyBuckets(mine.value);

      // Une seule notification : les deux listes sortent de la même route, un
      // incident les touche presque toujours ensemble.
      const failure =
        all.status === "rejected" ? all.reason : mine.status === "rejected" ? mine.reason : null;
      if (failure && !silent) showError((failure as Error).message);
    },
    [showError],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Aucun flux SSE sur cette page : elle se tient à jour toute seule par le
  // retour sur l'onglet — ce qui remplace le F5 — doublé d'une relecture de
  // fond, rare pour les spectateurs, plus fréquente pour le staff. Côté
  // serveur, la liste publique est mutualisée : ces relectures ne coûtent
  // presque rien (`lib/server/tournaments/list-cache.ts`).
  useAutoRefresh(() => load(true), {
    intervalMs: REFRESH_CADENCE[resolveRefreshTier({ isStaff: isAdmin })].listIntervalMs,
  });

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
    setFinishedDisplayLimit(12);
  }, [query, gameFilter, tab]);

  const ownedCount = countByGame(myBuckets, "all");
  // L'onglet n'existe que pour qui a créé au moins un tournoi.
  const hasOwnTournaments = ownedCount > 0;
  const isMine = tab === "mine" && hasOwnTournaments;

  // Les cartes portent leur horaire : le client fait basculer « Prochainement »
  // → « Inscriptions » → « En cours » à la seconde dite, sans rien demander au
  // serveur (`lib/shared/tournament-schedule.ts`).
  const scheduledBuckets = useScheduledBuckets(buckets);
  const scheduledMyBuckets = useScheduledBuckets(myBuckets);

  const sourceBuckets = isMine ? scheduledMyBuckets : scheduledBuckets;
  const filteredBuckets = filterBuckets(sourceBuckets, query, gameFilter);

  // Hors de « Mes tournois », le serveur a déjà écarté les tournois masqués :
  // on n'ouvre le tiroir que là où il peut contenir quelque chose.
  const { hidden, visible } = splitHiddenTournaments(filteredBuckets);
  const shownBuckets = isMine ? visible : filteredBuckets;

  const totalHidden = isMine ? hidden.length : 0;
  const totalRunning = shownBuckets.running.length;
  const totalRegistration = shownBuckets.registration.length;
  const totalUpcoming = shownBuckets.upcoming.length;
  const totalFinished = shownBuckets.finished.length;

  // Les sections gardent une numérotation continue : le tiroir des masqués
  // prend la première place quand il est affiché.
  const ix = (position: number) => String(position + (isMine ? 1 : 0)).padStart(2, "0");

  const onTabKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = TABS[(TABS.findIndex((t) => t.key === tab) + 1) % TABS.length];
    setTab(next.key);
    document.getElementById(next.id)?.focus();
  };

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
            <Link href="/tournois/creer">
              <button className={s.create}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 3v10M3 8h10"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                Créer un tournoi
              </button>
            </Link>
          )}
        </header>

        {hasOwnTournaments && (
          <div
            className={s.tabs}
            role="tablist"
            aria-label="Vue des tournois"
            onKeyDown={onTabKeyDown}
          >
            {TABS.map((t) => {
              const selected = t.key === "mine" ? isMine : !isMine;
              return (
                <button
                  key={t.key}
                  id={t.id}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  aria-controls="tournaments-panel"
                  tabIndex={selected ? 0 : -1}
                  className={`${s.tab} ${selected ? s.tabOn : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {t.key === "mine" && <span className={s.num}>{ownedCount}</span>}
                </button>
              );
            })}
          </div>
        )}

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
            <div className={s.metricNum}>{isMine ? totalHidden : "—"}</div>
            <div className={s.metricLbl}>{isMine ? "Pas encore visibles" : "Prizepool · à venir"}</div>
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
              placeholder="Rechercher un tournoi, une équipe, un format…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className={s.searchKbd}>⌘K</span>
          </div>
          <div className={s.filterRow}>
            {[
              ["all", "Tous"],
              ["ow2", "Overwatch"],
              ["mr", "Marvel Rivals"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={`${s.chip} ${gameFilter === key ? s.chipOn : ""}`}
                onClick={() => setGameFilter(key as GameFilter)}
              >
                {label}
                <span className={s.num}>{countByGame(sourceBuckets, key as GameFilter)}</span>
              </button>
            ))}
          </div>
        </div>

        <Ticker items={buildTickerItems(buckets)} />

        <div
          className={s.sections}
          id="tournaments-panel"
          role={hasOwnTournaments ? "tabpanel" : undefined}
          aria-labelledby={
            hasOwnTournaments ? (isMine ? "tournaments-tab-mine" : "tournaments-tab-all") : undefined
          }
        >
          {isMine && (
            <Section
              ix="01"
              title="PAS ENCORE VISIBLES"
              accent="· VOUS SEUL"
              count={totalHidden}
              defaultOpen={true}
              emptyMsg="Tous vos tournois sont visibles par les joueurs."
            >
              {hidden.map((t) => (
                <StateCard key={t.id} t={t} />
              ))}
            </Section>
          )}

          <Section
            ix={ix(1)}
            title="EN COURS"
            count={totalRunning}
            defaultOpen={true}
            emptyMsg="Aucun tournoi en cours actuellement."
            dataCols="2"
          >
            {shownBuckets.running.map((t) => (
              <RunningCard key={t.id} t={t} />
            ))}
          </Section>

          <Section
            ix={ix(2)}
            title="INSCRIPTIONS OUVERTES"
            count={totalRegistration}
            defaultOpen={true}
            emptyMsg="Aucun tournoi en phase d'inscription pour le moment."
          >
            {shownBuckets.registration.map((t) => (
              <RegistrationCard key={t.id} t={t} />
            ))}
          </Section>

          <Section
            ix={ix(3)}
            title="PROCHAINEMENT"
            count={totalUpcoming}
            defaultOpen={true}
            emptyMsg="Aucun tournoi prévu pour les prochains jours."
          >
            {shownBuckets.upcoming.map((t) => (
              <UpcomingCard key={t.id} t={t} />
            ))}
          </Section>

          <Section
            ix={ix(4)}
            title="TERMINÉS"
            count={totalFinished}
            defaultOpen={false}
            emptyMsg="Aucun tournoi terminé pour le moment."
          >
            <div>
              {shownBuckets.finished.slice(0, finishedDisplayLimit).map((t) => (
                <FinishedCard key={t.id} t={t} />
              ))}
              {shownBuckets.finished.length > 12 && finishedDisplayLimit === 12 && (
                <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
                  <button
                    onClick={() => setFinishedDisplayLimit(shownBuckets.finished.length)}
                    className={s.cardCta}
                    style={{ padding: "10px 18px" }}
                  >
                    Voir tout ({shownBuckets.finished.length})
                  </button>
                </div>
              )}
            </div>
          </Section>
        </div>
        </div>
      </div>
    </div>
  );
}
