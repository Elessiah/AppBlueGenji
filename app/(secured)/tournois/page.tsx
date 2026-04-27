"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { useSetPalette } from "@/lib/palette-context";
import { BgCanvas } from "./BgCanvas";
import { Ticker } from "@/components/cyber/Ticker";
import { formatLocalDateTime } from "@/lib/shared/dates";
import { RunningCard } from "./cards/RunningCard";
import { RegistrationCard } from "./cards/RegistrationCard";
import { UpcomingCard } from "./cards/UpcomingCard";
import { FinishedCard } from "./cards/FinishedCard";
import s from "./tournois.module.css";

const emptyBuckets: TournamentBuckets = {
  upcoming: [],
  registration: [],
  running: [],
  finished: [],
};

function filterBuckets(
  buckets: TournamentBuckets,
  query: string,
  gameFilter: string
): TournamentBuckets {
  const filterTournaments = (tournaments: TournamentCard[]) =>
    tournaments.filter((t) => {
      const lowerQuery = query.toLowerCase();
      const nameMatch = t.name.toLowerCase().includes(lowerQuery);
      const descMatch = (t.description || "").toLowerCase().includes(lowerQuery);
      const matchQuery = !query || nameMatch || descMatch;

      const matchGame =
        gameFilter === "all" ||
        (gameFilter === "ow2" && t.game === "OW2") ||
        (gameFilter === "mr" && t.game === "MR");

      return matchQuery && matchGame;
    });

  return {
    upcoming: filterTournaments(buckets.upcoming),
    registration: filterTournaments(buckets.registration),
    running: filterTournaments(buckets.running),
    finished: filterTournaments(buckets.finished),
  };
}

function buildTickerItems(buckets: TournamentBuckets): string[] {
  const items: string[] = [];

  buckets.running.forEach((t) => {
    items.push(`RÉSULTAT · ${t.name} · ${t.registeredTeams} équipes engagées`);
  });

  buckets.registration.slice(0, 3).forEach((t) => {
    items.push(`INSCRIPTIONS · ${t.name} · ${t.registeredTeams}/${t.maxTeams} équipes`);
  });

  buckets.upcoming.slice(0, 2).forEach((t) => {
    items.push(`À VENIR · ${t.name} · ${formatLocalDateTime(t.startAt)}`);
  });

  if (items.length === 0) {
    items.push("Aucune actualité tournoi pour le moment");
  }

  return items;
}

interface SectionProps {
  ix: string;
  title: string;
  accent?: string;
  count: number;
  defaultOpen?: boolean;
  emptyMsg: string;
  dataCols?: "1" | "2" | "3";
  children: React.ReactNode;
}

function Section({
  ix,
  title,
  accent,
  count,
  defaultOpen = true,
  emptyMsg,
  dataCols,
  children,
}: SectionProps) {
  const [expanded, setExpanded] = useState(defaultOpen);

  return (
    <div className={s.section} data-cols={dataCols}>
      <button
        className={s.sectionHead}
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
      >
        <span className={s.sectionIx}>{ix}</span>
        <h2 className={s.sectionTtl}>
          {title}
          {accent && <span className={s.sectionAccent}> {accent}</span>}
        </h2>
        <span className={s.sectionCount}>{count}</span>
        <svg
          className={s.sectionCaret}
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
        >
          <path d="M10 6L8 9L6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {expanded && (
        count === 0 ? (
          <div className={`${s.sectionBody} ${s.empty}`}>
            <div className={s.emptyTitle}>Vide</div>
            <div className={s.emptyMsg}>{emptyMsg}</div>
          </div>
        ) : (
          <div className={s.sectionBody}>
            {children}
          </div>
        )
      )}
    </div>
  );
}

export default function TournamentsPage() {
  const { showError } = useToast();
  const setPalette = useSetPalette();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState<"all" | "ow2" | "mr">("all");
  const [buckets, setBuckets] = useState<TournamentBuckets>(emptyBuckets);
  const [finishedDisplayLimit, setFinishedDisplayLimit] = useState(12);

  useEffect(() => {
    setPalette("blue");
  }, [setPalette]);

  useEffect(() => {
    const load = async () => {
      const response = await fetch("/api/tournaments", { cache: "no-store" });
      const payload = (await response.json()) as {
        error?: string;
        buckets?: TournamentBuckets;
      };
      if (!response.ok || !payload.buckets) {
        throw new Error(payload.error || "TOURNAMENT_LIST_FAILED");
      }
      setBuckets(payload.buckets);
    };
    load().catch((e) => showError((e as Error).message));
  }, [showError]);

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
  }, [query, gameFilter]);

  const filteredBuckets = filterBuckets(buckets, query, gameFilter);

  const countByGame = (bracket: "all" | "ow2" | "mr") => {
    const allTournaments = [
      ...buckets.upcoming,
      ...buckets.registration,
      ...buckets.running,
      ...buckets.finished,
    ];
    if (bracket === "all") return allTournaments.length;
    if (bracket === "ow2") return allTournaments.filter((t) => t.game === "OW2").length;
    if (bracket === "mr") return allTournaments.filter((t) => t.game === "MR").length;
    return 0;
  };

  const totalRunning = filteredBuckets.running.length;
  const totalRegistration = filteredBuckets.registration.length;
  const totalUpcoming = filteredBuckets.upcoming.length;
  const totalFinished = filteredBuckets.finished.length;

  return (
    <div className={s.page}>
      <BgCanvas />
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
            <div className={s.metricNum}>—</div>
            <div className={s.metricLbl}>Prizepool · à venir</div>
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
              ["ow2", "Overwatch 2"],
              ["mr", "Marvel Rivals"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={`${s.chip} ${gameFilter === key ? s.chipOn : ""}`}
                onClick={() => setGameFilter(key as "all" | "ow2" | "mr")}
              >
                {label}
                <span className={s.num}>{countByGame(key as "all" | "ow2" | "mr")}</span>
              </button>
            ))}
          </div>
        </div>

        <Ticker items={buildTickerItems(buckets)} />

        <div className={s.sections}>
          <Section
            ix="01"
            title="EN COURS"
            count={totalRunning}
            defaultOpen={true}
            emptyMsg="Aucun tournoi en cours actuellement."
            dataCols="2"
          >
            {filteredBuckets.running.map((t) => (
              <RunningCard key={t.id} t={t} />
            ))}
          </Section>

          <Section
            ix="02"
            title="INSCRIPTIONS OUVERTES"
            count={totalRegistration}
            defaultOpen={true}
            emptyMsg="Aucun tournoi en phase d'inscription pour le moment."
          >
            {filteredBuckets.registration.map((t) => (
              <RegistrationCard key={t.id} t={t} />
            ))}
          </Section>

          <Section
            ix="03"
            title="PROCHAINEMENT"
            count={totalUpcoming}
            defaultOpen={true}
            emptyMsg="Aucun tournoi prévu pour les prochains jours."
          >
            {filteredBuckets.upcoming.map((t) => (
              <UpcomingCard key={t.id} t={t} />
            ))}
          </Section>

          <Section
            ix="04"
            title="TERMINÉS"
            count={totalFinished}
            defaultOpen={false}
            emptyMsg="Aucun tournoi terminé pour le moment."
          >
            <div>
              {filteredBuckets.finished.slice(0, finishedDisplayLimit).map((t) => (
                <FinishedCard key={t.id} t={t} />
              ))}
              {filteredBuckets.finished.length > 12 && finishedDisplayLimit === 12 && (
                <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
                  <button
                    onClick={() => setFinishedDisplayLimit(filteredBuckets.finished.length)}
                    className={s.cardCta}
                    style={{ padding: "10px 18px" }}
                  >
                    Voir tout ({filteredBuckets.finished.length})
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
