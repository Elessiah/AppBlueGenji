"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { TournamentBuckets } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { BgCanvas } from "../_shared/BgCanvas";
import { Ticker } from "@/components/cyber/Ticker";
import { RunningCard } from "./cards/RunningCard";
import { RegistrationCard } from "./cards/RegistrationCard";
import { UpcomingCard } from "./cards/UpcomingCard";
import { FinishedCard } from "./cards/FinishedCard";
import { Section } from "./Section";
import { filterBuckets, countByGame, type GameFilter } from "./_lib/buckets";
import { buildTickerItems } from "./_lib/ticker";
import s from "./tournois.module.css";

const emptyBuckets: TournamentBuckets = {
  upcoming: [],
  registration: [],
  running: [],
  finished: [],
};

export default function TournamentsPage() {
  const { showError } = useToast();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [gameFilter, setGameFilter] = useState<GameFilter>("all");
  const [buckets, setBuckets] = useState<TournamentBuckets>(emptyBuckets);
  const [finishedDisplayLimit, setFinishedDisplayLimit] = useState(12);
  const [isAdmin, setIsAdmin] = useState(false);

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
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { user?: { isAdmin?: boolean } }) : null))
      .then((p) => setIsAdmin(Boolean(p?.user?.isAdmin)))
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
  }, [query, gameFilter]);

  const filteredBuckets = filterBuckets(buckets, query, gameFilter);

  const totalRunning = filteredBuckets.running.length;
  const totalRegistration = filteredBuckets.registration.length;
  const totalUpcoming = filteredBuckets.upcoming.length;
  const totalFinished = filteredBuckets.finished.length;

  return (
    <div className={s.page}>
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
                onClick={() => setGameFilter(key as GameFilter)}
              >
                {label}
                <span className={s.num}>{countByGame(buckets, key as GameFilter)}</span>
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
