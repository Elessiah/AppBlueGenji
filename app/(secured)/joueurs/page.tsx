"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicUserProfile, PlayerRole } from "@/lib/shared/types";
import { isFreeAgent } from "@/lib/shared/player-roster-status";
import { useToast } from "@/components/ui/toast";
import { Ticker } from "@/components/cyber/Ticker";
import { BgCanvas } from "../_shared/BgCanvas";
import { AnnuaireSearchField } from "../_shared/AnnuaireSearchField";
import { UserX } from "lucide-react";
import { PlayerCard } from "./cards/PlayerCard";
import s from "../_shared/annuaire.module.css";

const ACCENT_RGB = "90, 200, 255";

type RoleFilter = "all" | "DPS" | "TANK" | "HEAL" | "COACH";
type StatusFilter = "all" | "free";
type SortKey = "pseudo" | "tournaments";

const TICKER_ITEMS = [
  "ANNUAIRE · Profils mis à jour quotidiennement",
  "ROSTER · Inscris-toi dans une équipe pour participer",
  "TOURNOIS · Candidatures ouvertes pour les prochaines saisons",
];

export default function PlayersPage() {
  const { showError } = useToast();
  const [players, setPlayers] = useState<PublicUserProfile[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("pseudo");
  // Les comptes anonymisés sortent de l'annuaire **par défaut** : sous leur
  // pseudo d'emprunt, ils ne sont plus personne, et la ligne n'existe que pour
  // qui remonte un ancien match. Masqués par défaut, donc, mais jamais retirés
  // — c'est le seul moyen de retrouver un adversaire d'un tournoi passé.
  const [showDeleted, setShowDeleted] = useState(false);

  useEffect(() => {
    fetch("/api/players", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: string; players?: PublicUserProfile[] };
        if (!response.ok || !payload.players) {
          throw new Error(payload.error || "PLAYERS_LOAD_FAILED");
        }
        setPlayers(payload.players);
      })
      .catch((e) => showError((e as Error).message));
  }, [showError]);

  // L'annuaire, comptes supprimés compris ou non : tout ce que la page montre
  // ou compte en descend, sinon la case à cocher changerait la liste sans
  // changer les compteurs qui la surmontent.
  const listed = useMemo(
    () => (showDeleted ? players : players.filter((p) => !p.isDeleted)),
    [players, showDeleted],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = listed.filter((p) => {
      if (q && !`${p.pseudo} ${p.team?.name || ""}`.toLowerCase().includes(q)) return false;
      if (roleFilter !== "all" && !(p.roles || []).includes(roleFilter as PlayerRole)) return false;
      // Free agent = sans roster ET ouvert au recrutement : un joueur qui a
      // décoché « ouvert aux propositions » ne veut pas être démarché.
      if (statusFilter === "free" && !isFreeAgent(p)) return false;
      return true;
    });
    r = [...r];
    if (sort === "pseudo") r.sort((a, b) => a.pseudo.localeCompare(b.pseudo, "fr"));
    if (sort === "tournaments") r.sort((a, b) => (b.tournamentsCount || 0) - (a.tournamentsCount || 0));
    return r;
  }, [listed, query, roleFilter, statusFilter, sort]);

  // Le prédicat partagé (#139) posé sur la liste **affichée** (#142) : les deux
  // conditions du compteur venaient de branches différentes et aucune ne
  // remplace l'autre — « free agent » se lit toujours sur l'ouverture au
  // recrutement, et un compteur qui ne suivrait pas la case « comptes
  // supprimés » contredirait la liste qu'il surmonte.
  const freeAgents = listed.filter(isFreeAgent).length;
  const owCount = listed.filter((p) => (p.games || []).includes("OW")).length;
  const mrCount = listed.filter((p) => (p.games || []).includes("MR")).length;
  // Celui-ci se compte sur **tout** l'annuaire : c'est l'étiquette de la case,
  // et elle doit dire combien de comptes elle ferait apparaître.
  const deletedCount = players.filter((p) => p.isDeleted).length;

  const accentStyle = {
    "--g-rgb": ACCENT_RGB,
    "--g-300": "#8fd5ff",
    "--g-500": "#5ac8ff",
  } as React.CSSProperties;

  return (
    <div style={accentStyle}>
      <BgCanvas rgb={ACCENT_RGB} />

      <header className={s.page}>
        <div className="fabric" />
        <div className={`container ${s.pageInner}`}>
          <div className={s.pageHead}>
            <div>
              <span className="eyebrow">COMMUNAUTÉ · ANNUAIRE</span>
              <h1 className={s.title}>
                Joueurs <em>inscrits</em>
              </h1>
              <div className={s.subtitle}>PROFILS · STATISTIQUES · DISPONIBILITÉ</div>
            </div>
            <Link href="/profil" className={s.cta}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 14a6 6 0 0 1 12 0"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Mon profil
            </Link>
          </div>

          <div className={s.metrics}>
            <div className={s.metric}>
              <div className={s.metricNum}>
                <em>{listed.length}</em>
              </div>
              <div className={s.metricLbl}>Profils référencés</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{freeAgents}</div>
              <div className={s.metricLbl}>Free agents · ouverts aux offres</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{owCount}</div>
              <div className={s.metricLbl}>Joueurs Overwatch</div>
            </div>
            <div className={s.metric}>
              <div className={s.metricNum}>{mrCount}</div>
              <div className={s.metricLbl}>Joueurs Marvel Rivals</div>
            </div>
          </div>

          <div className={s.toolbar}>
            <AnnuaireSearchField
              placeholder="Rechercher un pseudo, une équipe…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className={s.filters}>
              {(
                [
                  ["all", "Tous"],
                  ["DPS", "DPS"],
                  ["TANK", "Tank"],
                  ["HEAL", "Heal"],
                  ["COACH", "Coach"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  className={`${s.chip} ${roleFilter === k ? s.chipOn : ""}`}
                  onClick={() => setRoleFilter(k)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className={s.sortRow}>
            <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
              <span>{filtered.length} joueur{filtered.length > 1 ? "s" : ""}</span>
              <span style={{ color: "var(--ink-dim)" }}>·</span>
              <div style={{ display: "flex", gap: 12 }}>
                {(
                  [
                    ["all", "Tous"],
                    ["free", "Free agents"],
                  ] as const
                ).map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => setStatusFilter(k)}
                    className={`${s.sortBtn} ${statusFilter === k ? s.sortBtnOn : ""}`}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className={s.sortOpts}>
              <span style={{ color: "var(--ink-dim)" }}>Trier :</span>
              {(
                [
                  ["pseudo", "Pseudo"],
                  ["tournaments", "Tournois"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  className={`${s.sortBtn} ${sort === k ? s.sortBtnOn : ""}`}
                  onClick={() => setSort(k)}
                >
                  {l}
                </button>
              ))}
              {/* Volontairement effacé : un bouton libellé « Comptes
                  supprimés (N) » en tête d'annuaire invitait à y cliquer, et
                  emmenait le lecteur loin des joueurs qu'il cherchait. Une
                  icône seule, en retrait, au bout de la rangée — son nom
                  accessible et son infobulle disent ce qu'elle fait. */}
              {deletedCount > 0 && (
                <button
                  type="button"
                  className={`${s.deletedToggle} ${showDeleted ? s.deletedToggleOn : ""}`}
                  // Un nom **constant**, l'état porté par `aria-pressed` : une
                  // infobulle qui passerait à « Masquer » contredirait le nom
                  // accessible, et les deux publics liraient deux actions.
                  aria-pressed={showDeleted}
                  aria-label={`Afficher les comptes supprimés (${deletedCount})`}
                  title={`Afficher les comptes supprimés (${deletedCount})`}
                  onClick={() => setShowDeleted((shown) => !shown)}
                >
                  <UserX size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <Ticker items={TICKER_ITEMS} />

      <section className={`container ${s.sections}`}>
        <div className={s.section}>
          <div className={s.sectionHead}>
            <span className={s.sectionIx}>01</span>
            <span className={s.sectionTtl}>
              PROFILS <span className={s.sectionAccent}>· COMMUNAUTÉ ACTIVE</span>
            </span>
            <span className={s.sectionCount}>{filtered.length} JOUEURS</span>
          </div>

          <div style={{ paddingTop: 24 }}>
            <div className={s.plGrid}>
              {filtered.map((p) => (
                <PlayerCard key={p.id} player={p} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
