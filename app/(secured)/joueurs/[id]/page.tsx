"use client";

import { TeamLink } from "@/components/entity-link";
import { PlayerPodiumName } from "@/components/podium-tiers";
import { DiscordTag, VerifiedBadge } from "@/components/discord-tag";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { UserX } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { formatLocalDate } from "@/lib/shared/dates";
import type { FullProfileResponse } from "@/lib/shared/types";
import { useToast } from "@/components/ui/toast";
import { useResourceLoader } from "@/lib/shared/hooks/useResourceLoader";
import { StatsPanel } from "@/components/stats/StatsPanel";
import { PlayerModerationBar } from "./_components/PlayerModerationBar";
import { PlayerRolesPanel } from "./_components/PlayerRolesPanel";
import { LocaleLink, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { richNodes } from "@/components/i18n/shell-text";
import { usePlayersText, type PlayersText } from "@/components/i18n/players-text";
import { useStatsPanelI18n } from "@/components/i18n/stats-panel-i18n";
import { formatTeamRoles } from "@/lib/shared/team-role-display";
import { finalRankLabel } from "@/lib/shared/ordinal";
import type { TeamRole, TournamentState } from "@/lib/shared/types";
import { playerErrorMessage } from "../_lib/player-errors";
import { AudienceList, InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { hiddenBattletagAudienceLines } from "@/lib/shared/identity-audience";
import styles from "./player.module.css";

/** Majorité telle que la fiche l'affiche : `null` est une donnée masquée (ou absente). */
function adultLabel(text: PlayersText, isAdult: boolean | null): string {
  if (isAdult === null) return text.t("page.hidden");
  return isAdult ? text.t("page.adultYes") : text.t("page.adultNo");
}

/** Tout état du type partagé : un état ajouté sans libellé ne compile pas. */
const TOURNAMENT_STATE_KEYS = {
  UPCOMING: true,
  REGISTRATION: true,
  RUNNING: true,
  FINISHED: true,
} as const satisfies Record<TournamentState, true>;

function isTournamentState(state: string): state is TournamentState {
  return Object.hasOwn(TOURNAMENT_STATE_KEYS, state);
}

/** État d'un tournoi de l'historique : il s'affichait en code brut (`FINISHED`). */
function tournamentStateLabel(text: PlayersText, state: string): string {
  return isTournamentState(state) ? text.t(`page.state.${state}`) : state;
}

/**
 * Indication sous un BattleTag masqué, pour son seul titulaire : une ligne
 * visible, le détail (qui le lit encore) derrière le « i ». La phrase sur la
 * pastille ne vient que si la pastille est là (`badge`) : un BattleTag saisi à
 * la main n'en a pas.
 */
function battletagHiddenHint(
  text: PlayersText,
  data: FullProfileResponse,
  verified: boolean,
): { status: string; badge: boolean } | null {
  if (!data.isSelf || !data.profile.overwatchBattletag || data.profile.visibility.overwatch) return null;
  return { status: text.t("page.battletagHiddenSelf"), badge: verified };
}

/** `aria-describedby` des seuls identifiants présents, ou rien. */
function describedBy(ids: Record<string, boolean>): string | undefined {
  const present = Object.keys(ids).filter((id) => ids[id]);
  return present.length > 0 ? present.join(" ") : undefined;
}

function HistoryEmpty({ empty, message }: { empty: boolean; message: string }) {
  return empty ? <p className={styles.historyEmpty}>{message}</p> : null;
}

export default function PlayerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useLocaleRouter();
  const { showError } = useToast();
  const text = usePlayersText();
  const { t, locale } = text;
  const statsI18n = useStatsPanelI18n();
  const { status, data, error, refresh } = useResourceLoader<FullProfileResponse>(
    `/api/players/${params.id}`,
    {
      onNotFoundRedirect: () => {
        showError(playerErrorMessage(text, "PLAYER_NOT_FOUND"));
        setTimeout(() => router.push("/joueurs"), 1500);
      },
    },
  );
  // Une notification par échec, pas à chaque rendu de l'état d'erreur.
  // La page et la notification disent la même raison (session expirée…).
  const failure = status === "error" ? playerErrorMessage(text, error, "PLAYER_LOAD_FAILED") : null;
  useEffect(() => {
    if (failure) showError(failure);
  }, [failure, showError]);
  if (status === "loading")
    return <section className="ds-block" style={{ color: "var(--ink-quiet)" }}>{t("page.loading")}</section>;

  if (status === "not-found")
    return (
      <section className="ds-block" style={{ color: "var(--ink-quiet)" }}>
        {t("page.notFound")}{" "}
        <LocaleLink href="/joueurs" style={{ color: "var(--blue-100)" }}>
          {t("page.backToPlayers")}
        </LocaleLink>
      </section>
    );

  if (status === "error") {
    return (
      <section className="ds-block" style={{ color: "var(--ink-quiet)" }}>
        {failure}{" "}
        <LocaleLink href="/joueurs" style={{ color: "var(--blue-100)" }}>
          {t("page.backToPlayers")}
        </LocaleLink>
      </section>
    );
  }

  if (!data) return null;

  // Un BattleTag masqué n'arrive jusqu'ici que pour son titulaire : pour tout
  // autre lecteur, il ne se lit que dans la fenêtre « Contacts » d'un match
  // (`lib/shared/battletag-visibility.ts`).
  const battletagVerified = Boolean(data.profile.battletagVerified);
  const battletagHint = battletagHiddenHint(text, data, battletagVerified);
  const battletagDescribedBy = describedBy({
    "player-battletag-verified": battletagVerified,
    "player-battletag-hint": Boolean(battletagHint),
    "player-battletag-more": Boolean(battletagHint),
  });

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
          {/* Même gabarit que la fiche d'équipe : sous 640 px, le retour passe
              au-dessus du titre au lieu d'être rogné par `.ds-header`. */}
          <div className={styles.top}>
            <div className={styles.identity}>
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
              <div className={styles.titles}>
                {deleted && (
                  <span className={styles.deletedBadge}>
                    <UserX size={12} aria-hidden="true" />
                    {t("page.deletedBadge")}
                  </span>
                )}
                <h1
                  className={
                    deleted ? `ds-title ${styles.name} ${styles.deletedTitle}` : `ds-title blue ${styles.name}`
                  }
                  style={{ fontSize: "clamp(26px, 3vw, 40px)", marginBottom: 6 }}
                >
                  {deleted ? (
                    data.profile.pseudo
                  ) : (
                    <PlayerPodiumName userId={data.profile.id}>{data.profile.pseudo}</PlayerPodiumName>
                  )}
                </h1>
                <fieldset
                  // `<fieldset>` (rôle `group`) : un nom n'est admis que sur un
                  // élément qui a un rôle (`aria-prohibited-attr`), et c'en est
                  // un — l'équipe et les rôles du joueur, lus ensemble.
                  className="native-group"
                  aria-label={t("page.teamAndRoles")}
                  style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 2 }}
                >
                  {activeTeam ? (
                    <TeamLink
                      teamId={activeTeam.teamId}
                      podiumTier={deleted ? null : undefined}
                      className="badge"
                      style={{ fontSize: 11 }}
                      title={t("page.viewTeam", { name: activeTeam.teamName })}
                    >
                      {activeTeam.teamName}
                    </TeamLink>
                  ) : (
                    <span className="badge" style={{ fontSize: 11, opacity: 0.7 }} title={t("page.noTeamTitle")}>
                      {t("page.noTeam")}
                    </span>
                  )}
                  {data.displayRoles.map((role) => (
                    <span
                      key={role}
                      className="pill pill-accent"
                      style={{ fontSize: 11 }}
                      title={t(`platformRoles.${role}.description`)}
                    >
                      {t(`platformRoles.${role}.label`)}
                    </span>
                  ))}
                </fieldset>
              </div>
            </div>
            <LocaleLink href="/joueurs" className={`btn ghost ${styles.back}`}>
              {t("page.back")}
            </LocaleLink>
          </div>

          {deleted && (
            <p className={styles.deletedNotice}>{t("page.deletedNotice")}</p>
          )}
          {/* Pas de rangée de chiffres ici : elle recopiait les tuiles du bloc
              « Statistiques » juste dessous (≈ 500 px de doublon sur mobile),
              et « Victoires / Défaites » y comptaient des matchs sans le dire
              — le bloc les range sous « Bilan des matchs ». */}
        </div>
      </div>

      <PlayerModerationBar profile={data} deleted={deleted} onChanged={refresh} />

      <div className="ds-block" style={{ marginBottom: 20 }}>
        <div className="ds-section-title blue">
          <h2>{t("page.statsTitle")}</h2>
        </div>
        <StatsPanel stats={data.stats} accent="blue" i18n={statsI18n} />
      </div>

      {/* Un compte supprimé n'a plus rien à montrer ici : tags et majorité ont
          été effacés, et quatre « Masqué » laisseraient croire le contraire. */}
      {!deleted && (
        <div className="ds-block" style={{ marginBottom: 20 }}>
          <div className="ds-section-title blue">
            <h2>{t("page.infoTitle")}</h2>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="player-battletag">{t("page.battletag")}</label>
              {/* La pastille ne suit pas le tag : « Masqué ✅ » dit qu'un
                  BattleTag est prouvé par Battle.net sans dire lequel. Le
                  lecteur d'écran l'entend avec le champ (`aria-describedby`) :
                  l'image, elle, devient décorative pour ne pas la dire deux fois. */}
              <div className={styles.taggedInput}>
                <input
                  id="player-battletag"
                  value={data.profile.overwatchBattletag || t("page.hidden")}
                  readOnly
                  style={battletagVerified ? { paddingRight: 34 } : undefined}
                  aria-describedby={battletagDescribedBy}
                />
                {battletagVerified ? (
                  <span className={styles.taggedBadge}>
                    <VerifiedBadge labels={{ alt: "", title: t("page.battletagVerifiedTitle") }} />
                    <span id="player-battletag-verified" className="sr-only">
                      {t("page.battletagVerifiedAlt")}
                    </span>
                  </span>
                ) : null}
              </div>
              {/*
                Un BattleTag masqué qui s'affiche quand même doit le dire : sans
                cette phrase, le lecteur à qui un match l'ouvre le croirait public,
                et le titulaire ne saurait pas qui le lit encore.
              */}
              {battletagHint && (
                <div className={styles.hintRow}>
                  <InfoHintRow inline>
                    <p id="player-battletag-hint" className={styles.hint}>
                      {battletagHint.status}
                    </p>
                    <InfoHint id="player-battletag-more" subject={t("page.battletag")}>
                      <AudienceList lines={hiddenBattletagAudienceLines(t)} />
                      {battletagHint.badge ? <p>{t("page.battletagHiddenSelfBadge")}</p> : null}
                    </InfoHint>
                  </InfoHintRow>
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="player-marvel-rivals-tag">{t("page.marvelRivalsTag")}</label>
              <input id="player-marvel-rivals-tag" value={data.profile.marvelRivalsTag || t("page.hidden")} readOnly />
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
              <span className="field-label">{t("page.discord")}</span>
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
                  fallback={t("page.hidden")}
                  badgeLabels={{ alt: t("page.verifiedAlt"), title: t("page.verifiedTitle") }}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="player-adult">{t("page.adult")}</label>
              <input
                id="player-adult"
                value={adultLabel(text, data.profile.isAdult)}
                readOnly
              />
            </div>
          </div>
        </div>
      )}

      {/* Aucun rôle ne s'attribue à un compte supprimé : la route le refuse. */}
      {data.viewerIsAdmin && !data.isSelf && !deleted && (
        <PlayerRolesPanel userId={params.id} pseudo={data.profile.pseudo} roles={data.roles} onSaved={refresh} />
      )}

      <div className="ds-block" style={{ marginBottom: 20 }}>
        <div className="ds-section-title blue">
          <h2>{t("page.teamsTitle")}</h2>
        </div>
        <div className="table-like">
          <div className="table-row table-header">
            <span>{t("page.teamsColumn.team")}</span>
            <span>{t("page.teamsColumn.roles")}</span>
            <span>{t("page.teamsColumn.start")}</span>
            <span>{t("page.teamsColumn.end")}</span>
          </div>
          {data.teamsTimeline.map((entry) => (
            <div className="table-row" key={`${entry.teamId}-${entry.joinedAt}`}>
              <TeamLink teamId={entry.teamId} podiumTier={deleted ? null : undefined}>{entry.teamName}</TeamLink>
              <span data-label={t("page.teamsColumn.roles")}>{formatTeamRoles(entry.roles as TeamRole[], locale)}</span>
              <span data-label={t("page.teamsColumn.start")}>{formatLocalDate(entry.joinedAt, locale)}</span>
              <span data-label={t("page.teamsColumn.end")}>
                {entry.leftAt ? formatLocalDate(entry.leftAt, locale) : t("page.active")}
              </span>
            </div>
          ))}
          <HistoryEmpty empty={data.teamsTimeline.length === 0} message={t("page.teamsEmpty")} />
        </div>
      </div>

      <div className="ds-block">
        <div className="ds-section-title blue">
          <h2>{t("page.tournamentsTitle")}</h2>
        </div>
        <div className="table-like">
          <div className="table-row table-header">
            <span>{t("page.tournamentsColumn.tournament")}</span>
            <span>{t("page.tournamentsColumn.state")}</span>
            <span>{t("page.tournamentsColumn.record")}</span>
            <span>{t("page.tournamentsColumn.rank")}</span>
          </div>
          {data.tournaments.map((entry) => (
            <div className="table-row" key={`${entry.tournamentId}-${entry.playedAt}`}>
              <LocaleLink href={`/tournois/${entry.tournamentId}`}>{entry.tournamentName}</LocaleLink>
              <span data-label={t("page.tournamentsColumn.state")}>{tournamentStateLabel(text, entry.state)}</span>
              <span data-label={t("page.tournamentsColumn.record")}>
                {richNodes(
                  text.rich("page.record", { wins: entry.wins, losses: entry.losses }, {
                    loss: (chunks) => <span className="result-loss">{chunks}</span>,
                  }),
                )}
              </span>
              <span data-label={t("page.tournamentsColumn.rank")}>{finalRankLabel(locale, entry.finalRank, (form, rank) => t(`page.rank.${form}`, { rank }))}</span>
            </div>
          ))}
          <HistoryEmpty empty={data.tournaments.length === 0} message={t("page.tournamentsEmpty")} />
        </div>
      </div>
    </section>
  );
}
