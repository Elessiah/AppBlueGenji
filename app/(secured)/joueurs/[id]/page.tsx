"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TeamLink } from "@/components/entity-link";
import { DiscordTag } from "@/components/discord-tag";
import { useParams, useRouter } from "next/navigation";
import { UserX } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { formatLocalDate } from "@/lib/shared/dates";
import type { FullProfileResponse } from "@/lib/shared/types";
import {
  PLATFORM_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type PlatformRole,
} from "@/lib/shared/permissions";
import { useToast } from "@/components/ui/toast";
import { useResourceLoader } from "@/lib/shared/hooks/useResourceLoader";
import { StatsPanel } from "@/components/stats/StatsPanel";
import styles from "./player.module.css";
import { formatRate } from "@/lib/shared/stats";

export default function PlayerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  const { status, data, error, refresh } = useResourceLoader<FullProfileResponse>(
    `/api/players/${params.id}`,
    {
      onNotFoundRedirect: () => {
        showError("PLAYER_NOT_FOUND");
        setTimeout(() => router.push("/joueurs"), 1500);
      },
    },
  );
  const [rolesBusy, setRolesBusy] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<PlatformRole[]>([]);

  // Resynchronise la sélection locale à chaque (re)chargement du profil.
  useEffect(() => {
    if (data?.roles) setSelectedRoles(data.roles);
  }, [data?.roles]);

  const toggleRole = (role: PlatformRole) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const saveRoles = async () => {
    setRolesBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${params.id}/roles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roles: selectedRoles }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "ROLES_UPDATE_FAILED");
      showSuccess("Rôles mis à jour.");
      await refresh();
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setRolesBusy(false);
    }
  };

  if (status === "loading")
    return <section className="ds-block" style={{ color: "var(--text-2)" }}>Chargement du profil joueur...</section>;

  if (status === "not-found")
    return (
      <section className="ds-block" style={{ color: "var(--text-2)" }}>
        Joueur non trouvé.{" "}
        <Link href="/joueurs" style={{ color: "var(--blue-100)" }}>
          Retour aux joueurs
        </Link>
      </section>
    );

  if (status === "error") {
    showError(error ?? "PLAYER_LOAD_FAILED");
    return (
      <section className="ds-block" style={{ color: "var(--text-2)" }}>
        Erreur lors du chargement du joueur.{" "}
        <Link href="/joueurs" style={{ color: "var(--blue-100)" }}>
          Retour aux joueurs
        </Link>
      </section>
    );
  }

  if (!data) return null;

  // Un BattleTag masqué au public n'arrive jusqu'ici que pour son titulaire, ou
  // pour un lecteur que la règle d'exposition autorise (même match, arbitrage).
  const battletagHint =
    data.profile.overwatchBattletag && !data.profile.visibility.overwatch
      ? data.isSelf
        ? "Masqué au public : seuls les joueurs de tes matchs et l'arbitrage le lisent, tant que le tournoi n'est pas terminé."
        : "Masqué au public : tu le lis pour jouer ou arbitrer un tournoi qui n'est pas terminé. Ne le diffuse pas."
      : null;

  // Un compte supprimé garde sa fiche — ses résultats appartiennent aussi à
  // ceux qu'il a affrontés —, mais sous un pseudo d'emprunt qui se lit comme
  // un pseudo ordinaire : la fiche doit donc le **dire**, en tête et sans
  // équivoque (couleur, étiquette, avatar éteint), plutôt que de laisser croire
  // à un joueur actif dont tout serait masqué.
  const deleted = Boolean(data.profile.isDeleted);

  // Équipe courante = seule ligne de timeline encore ouverte (leftAt === null).
  const activeTeam = data.teamsTimeline.find((entry) => entry.leftAt === null) ?? null;

  return (
    <section className="fade-in">
      <div className={deleted ? `ds-header ${styles.deletedHeader}` : "ds-header"}>
        <div className="ds-header-body">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              {deleted ? (
                <span className={styles.deletedAvatar} aria-hidden="true">
                  <UserX size={30} />
                </span>
              ) : (
                <UserAvatar
                  src={data.profile.avatarUrl}
                  pseudo={data.profile.pseudo}
                  size={64}
                  borderColor="rgba(89,212,255,0.3)"
                  borderWidth={1}
                  glow
                  decorative
                />
              )}
              <div>
                {deleted && (
                  <span className={styles.deletedBadge}>
                    <UserX size={12} aria-hidden="true" />
                    Compte supprimé
                  </span>
                )}
                <h1
                  className={deleted ? `ds-title ${styles.deletedTitle}` : "ds-title blue"}
                  style={{ fontSize: "clamp(26px, 3vw, 40px)", marginBottom: 6 }}
                >
                  {data.profile.pseudo}
                </h1>
                <div
                  // `group` : un nom n'est admis que sur un élément qui a un rôle
                  // (`aria-prohibited-attr`), et c'en est un — l'équipe et les
                  // rôles du joueur, lus ensemble.
                  role="group"
                  aria-label="Équipe et rôles du joueur"
                  style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 2 }}
                >
                  {activeTeam ? (
                    <Link
                      href={`/equipes/${activeTeam.teamId}`}
                      className="badge"
                      style={{ fontSize: 11 }}
                      title={`Voir la fiche de ${activeTeam.teamName}`}
                    >
                      {activeTeam.teamName}
                    </Link>
                  ) : (
                    <span className="badge" style={{ fontSize: 11, opacity: 0.7 }} title="Ce joueur n'est dans aucune équipe">
                      Sans équipe
                    </span>
                  )}
                  {data.displayRoles.map((role) => (
                    <span
                      key={role}
                      className="pill pill-blue"
                      style={{ fontSize: 11 }}
                      title={ROLE_DESCRIPTIONS[role]}
                    >
                      {ROLE_LABELS[role]}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <Link href="/joueurs" className="btn ghost" style={{ padding: "9px 18px", fontSize: 13, flexShrink: 0 }}>
              ← Joueurs
            </Link>
          </div>

          {deleted && (
            <p className={styles.deletedNotice}>
              Ce joueur a supprimé son compte. Ses informations personnelles ont été effacées et son
              pseudo remplacé par un pseudo d'emprunt ; ses résultats restent, parce qu'ils appartiennent
              aussi aux équipes qu'il a affrontées.
            </p>
          )}

          <div className="ds-stats" style={{ marginTop: 28 }}>
            {[
              { label: "Tournois joués", value: data.stats.tournamentsPlayed },
              { label: "Tournois gagnés", value: data.stats.tournamentsWon },
              { label: "Podiums", value: data.stats.podiums },
              { label: "Victoires", value: data.stats.matchesWon },
              { label: "Défaites", value: data.stats.matchesLost },
              { label: "Ratio de victoires", value: formatRate(data.stats.winRate) },
            ].map((stat) => (
              <div key={stat.label} className="ds-stat">
                <div className="ds-stat-label">{stat.label}</div>
                <div className="ds-stat-value">{stat.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ds-block" style={{ marginBottom: 20 }}>
        <div className="ds-section-title blue">
          <h2>Statistiques</h2>
        </div>
        <StatsPanel stats={data.stats} accent="blue" />
      </div>

      {/* Un compte supprimé n'a plus rien à montrer ici : tags et majorité ont
          été effacés, et quatre « Masqué » laisseraient croire le contraire. */}
      {!deleted && (
        <div className="ds-block" style={{ marginBottom: 20 }}>
          <div className="ds-section-title blue">
            <h2>Informations</h2>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="player-battletag">BattleTag Overwatch</label>
              <input
                id="player-battletag"
                value={data.profile.overwatchBattletag || "Masqué"}
                readOnly
                aria-describedby={battletagHint ? "player-battletag-hint" : undefined}
              />
              {/*
                Un BattleTag masqué qui s'affiche quand même doit le dire : sans
                cette phrase, le lecteur à qui un match l'ouvre le croirait public,
                et le titulaire ne saurait pas qui le lit encore.
              */}
              {battletagHint && (
                <p id="player-battletag-hint" className={styles.hint}>
                  {battletagHint}
                </p>
              )}
            </div>
            <div className="field">
              <label>Tag Marvel Rivals</label>
              <input value={data.profile.marvelRivalsTag || "Masqué"} readOnly />
            </div>
            {/*
              Même convention que ses deux voisins : « Masqué » couvre aussi bien
              le tag filtré que le tag absent, et c'est ce qui le rend sûr — les
              deux cas sont indiscernables, donc l'affichage ne dit rien de plus
              que ce qu'il montre.
  
              La **pastille**, elle, ne dépend pas du tag : elle dit que le joueur
              est joignable par l'organisation, pas comment. C'est ce qui permet à
              un capitaine de voir qui de son roster remplit la condition
              « tous les Discord vérifiés » d'un tournoi.
            */}
            <div className="field">
              <label>Discord</label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  minHeight: 38,
                  padding: "0 2px",
                }}
              >
                <DiscordTag
                  tag={data.profile.discordPseudo}
                  verified={data.profile.discordVerified}
                  fallback="Masqué"
                />
              </div>
            </div>
            <div className="field">
              <label>Majorité</label>
              <input
                value={
                  data.profile.isAdult === null ? "Masqué" : data.profile.isAdult ? "Oui (18+)" : "Non (mineur)"
                }
                readOnly
              />
            </div>
          </div>
        </div>
      )}

      {/* Aucun rôle ne s'attribue à un compte supprimé : la route le refuse. */}
      {data.viewerIsAdmin && !data.isSelf && !deleted && (
        <div className="ds-block" style={{ marginBottom: 20 }}>
          <div className="ds-section-title blue">
            <h2>Rôles &amp; permissions</h2>
          </div>
          <p style={{ color: "var(--text-2)", fontSize: 13, marginBottom: 16 }}>
            Les rôles sont cumulables. Un administrateur dispose de tous les droits, dont l&apos;attribution des rôles.
          </p>
          <div role="group" aria-label="Rôles de permission" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {PLATFORM_ROLES.map((role) => {
              const checked = selectedRoles.includes(role);
              return (
                <label
                  key={role}
                  style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: rolesBusy ? "default" : "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={rolesBusy}
                    onChange={() => toggleRole(role)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <span style={{ display: "block", fontSize: 14, color: "var(--text-0)" }}>{ROLE_LABELS[role]}</span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--text-2)" }}>{ROLE_DESCRIPTIONS[role]}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <button
              type="button"
              className="btn"
              style={{ padding: "9px 18px", fontSize: 13 }}
              disabled={rolesBusy}
              aria-busy={rolesBusy}
              aria-label={`Enregistrer les rôles de ${data.profile.pseudo}`}
              onClick={saveRoles}
            >
              {rolesBusy ? "Enregistrement…" : "Enregistrer les rôles"}
            </button>
          </div>
        </div>
      )}

      <div className="ds-block" style={{ marginBottom: 20 }}>
        <div className="ds-section-title blue">
          <h2>Historique équipes</h2>
        </div>
        <div className="table-like">
          <div className="table-row table-header">
            <span>Équipe</span>
            <span>Rôles</span>
            <span>Début</span>
            <span>Fin</span>
          </div>
          {data.teamsTimeline.map((entry) => (
            <div className="table-row" key={`${entry.teamId}-${entry.joinedAt}`}>
              <TeamLink teamId={entry.teamId}>{entry.teamName}</TeamLink>
              <span>{entry.roles.join(", ")}</span>
              <span>{formatLocalDate(entry.joinedAt)}</span>
              <span>{entry.leftAt ? formatLocalDate(entry.leftAt) : "Actif"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="ds-block">
        <div className="ds-section-title blue">
          <h2>Historique tournois</h2>
        </div>
        <div className="table-like">
          <div className="table-row table-header">
            <span>Tournoi</span>
            <span>Statut</span>
            <span>Bilan</span>
            <span>Rank</span>
          </div>
          {data.tournaments.map((entry) => (
            <div className="table-row" key={`${entry.tournamentId}-${entry.playedAt}`}>
              <Link href={`/tournois/${entry.tournamentId}`}>{entry.tournamentName}</Link>
              <span>{entry.state}</span>
              <span>
                {entry.wins}W / {entry.losses}L
              </span>
              <span>{entry.finalRank ?? "-"}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
