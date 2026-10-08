"use client";

import { useState, type MouseEvent } from "react";
import { LocaleLink, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useTournamentPageText } from "@/components/i18n/tournament-page-text";
import { useTournamentsText } from "@/components/i18n/tournaments-text";
import { tournamentLabel } from "@/lib/shared/tournaments-text";
import type { Locale } from "@/lib/shared/locales";
import { INTL_LOCALE } from "@/lib/shared/locales";
import { CyberButton, Pill } from "@/components/cyber";
import { TournamentImageBanner, TournamentImageEmblem } from "@/components/tournament-image";
import { useSpectatorView } from "@/components/spectator-view";
import type { RefreshTier } from "@/lib/shared/refresh-tiers";
import type { TournamentDetail } from "@/lib/shared/types";
import { isViewerEntrant } from "@/lib/shared/match-card-viewer";
import { toParticipantType } from "@/lib/shared/participants";
import { canReturnInSite, isPlainLeftClick, previousSitePathname } from "@/lib/shared/site-back";
import { advanceTarget } from "@/lib/shared/tournament-launch";
import { STREAM_NOTICE_PRIVACY_PATH } from "@/lib/shared/stream-notice";
import type { LiveFailure } from "../_lib/live-state";
import { canShowEditButton } from "../_lib/edit-entry";
import { registerBlockedNotice } from "../_lib/register-entry";
import { useActionsText } from "../_lib/actions-text";
import { useErrorsText } from "../_lib/error-map";
import {
  headerIdentityLine,
  headerMetaItems,
  STATE_META,
  type HeaderMetaItem,
  type HeaderTone,
} from "../_lib/header-meta";
import { LiveIndicator } from "./LiveIndicator";
import { TournamentLiveLink } from "./TournamentLiveLink";
import s from "./TournamentHeader.module.css";

/** Ce que `canReturnInSite` a besoin de lire du navigateur, à l'instant. */
function readSiteBackInput() {
  return {
    previousPath: previousSitePathname(),
    referrer: document.referrer,
    origin: window.location.origin,
    currentPath: window.location.pathname,
    historyLength: window.history.length,
  };
}

const TONE_CLASS: Record<HeaderTone, string> = {
  accent: s.stateAccent,
  highlight: s.stateHighlight,
  info: s.stateInfo,
  success: s.stateSuccess,
};

interface TournamentHeaderProps {
  detail: TournamentDetail;
  /** Le flux temps réel est-il établi ? */
  isLive: boolean;
  tier: RefreshTier;
  /** Cadence de relecture de la page sans compte (`TournamentSheetSource.cadenceMs`). */
  cadenceMs?: number | null;
  fatal: LiveFailure | null;
  /** Suivi arrêté : les actions sont retirées plutôt que laissées à échouer. */
  frozen: boolean;
  onRegister: () => void;
  onReportIssue: () => void;
  onGuestRegister: () => void;
  /** Abréger le calendrier et démarrer sur-le-champ (staff `tournaments`). */
  onAdvance: () => void;
  onLiveSaved: () => void;
  /** Ouvre le réglage de l'image (illustration ou logo) (staff `tournaments`). */
  onEditImage: () => void;
}

/**
 * En-tête de la fiche tournoi.
 *
 * Il portait huit pastilles bleues identiques sur une seule ligne : le témoin de
 * flux (« À jour »), le jeu, l'état, le format — deux fois, dont une fausse —,
 * l'effectif et le rôle du lecteur, sans un intitulé pour dire lequel était
 * lequel. La refonte range chaque information là où elle veut dire quelque
 * chose :
 *
 * 1. **Ce qui parle du lecteur** (témoin de flux, rôle) part en haut à droite,
 *    avec le retour : « À jour » décrit la page, pas le tournoi.
 * 2. **L'identité** — état, jeu, nom, description — occupe le haut, seule.
 * 3. **Les faits** passent en grille étiquetée (`_lib/header-meta.ts`) : format,
 *    format des matchs, effectif avec sa jauge, dates. Une valeur sans intitulé
 *    n'est lisible que par qui la connaît déjà.
 * 4. **Les actions** se rassemblent en bas, hors du flux de lecture.
 *
 * L'état du tournoi ne prend jamais le rouge : celui-ci est réservé à ce qui est
 * réellement à l'antenne (voir CLAUDE.md, « trois sens de live »).
 */
export function TournamentHeader({
  detail,
  isLive,
  tier,
  cadenceMs,
  fatal,
  frozen,
  onRegister,
  onReportIssue,
  onGuestRegister,
  onAdvance,
  onLiveSaved,
  onEditImage,
}: Readonly<TournamentHeaderProps>) {
  const { card } = detail;
  const text = useTournamentPageText();
  const labels = useTournamentsText();
  const { t } = text;
  // Inscription, signalement et gestes du staff : lot 8b / D4, restés français.
  // Gestes (lot 8b) : inscription, signalement, outils du staff de l'en-tête.
  const actionText = useActionsText();
  const a = actionText.t;
  const errorsText = useErrorsText();
  const entrantType = toParticipantType(card.participantType);
  const state = STATE_META[card.state] ?? { label: card.state, tone: "info" as HeaderTone };
  const stateLabel = tournamentLabel(labels, "state", card.state);
  const items = headerMetaItems(card, detail.phases, detail.currentPhaseId, Date.now(), text, labels);
  // Le seul refus d'inscription qui ne se lise pas tout seul sur la page :
  // avoir une équipe sans en avoir la charge (`_lib/register-entry.ts`).
  const registerNotice = frozen ? null : registerBlockedNotice(detail, errorsText, actionText);
  const nextStage = advanceTarget(card);
  const showEdit = canShowEditButton(card, detail.isAdmin);
  // L'image se règle dans tous les états, contrairement au formulaire : elle
  // est décorative et n'engage aucune règle du moteur.
  const showImageEdit = detail.isAdmin && !frozen;
  const router = useLocaleRouter();
  // Sans compte, la liste des tournois est derrière la connexion : le lien
  // mène à l'accueil, dont le tableau des tournois tient lieu de liste.
  const spectator = useSpectatorView();
  const backHref = spectator ? "/" : "/tournois";
  const backFallback = spectator ? t("header.backHome") : t("header.allTournaments");
  // Figé au premier rendu : l'en-tête n'est rendu que côté client (la page
  // attend le flux), et la page précédente ne change pas tant qu'on reste ici.
  const [backInSite] = useState(() => canReturnInSite(readSiteBackInput()));

  // Un vrai lien vers la liste — atteignable, ouvrable dans un onglet —, qui ne
  // cède au retour dans l'historique que lorsque celui-ci reste sur le site
  // (`lib/shared/site-back.ts`) : on y retrouve alors la page quittée, défilement
  // compris. Relu au clic, la navigation ayant pu changer depuis le rendu.
  const onBackClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(event) || !canReturnInSite(readSiteBackInput())) return;
    event.preventDefault();
    router.back();
  };

  return (
    <div className={`ds-header ${s.header}`}>
      <div className={`ds-header-body ${s.shell}`}>
        <div className={s.utility}>
          <LocaleLink href={backHref} onClick={onBackClick} className={`${s.back} tap-target`}>
            <span aria-hidden="true">←</span> {backInSite ? t("header.back") : backFallback}
          </LocaleLink>
          <div className={s.viewer}>
            {/* Dit que la page se tient à jour seule : sans ce repère, on
                recharge par précaution même quand tout arrive tout seul. */}
            <LiveIndicator isLive={isLive} tier={tier} cadenceMs={cadenceMs} fatal={fatal} />
            {detail.isAdmin && !frozen && (
              <Pill variant="accent" title={t("header.adminTitle")}>{t("header.admin")}</Pill>
            )}
            {/* Dit pourquoi aucun bouton n'apparaît, sans en ajouter un vers la
                connexion : la page sans compte est faite pour regarder. */}
            {spectator && (
              // L'explication aussi hors écran : `title` seul échappe au toucher,
              // au clavier et aux lecteurs d'écran (comme `MetaCell`).
              <Pill variant="neutral" title={t("header.spectatorTitle")}>
                {t("header.spectator")}
                <span className="sr-only"> — {t("header.spectatorTitle")}</span>
              </Pill>
            )}
          </div>
        </div>

        {/* Illustration : un bandeau entre les outils du lecteur et l'identité,
            à sa place d'affiche. Un logo, lui, se met à côté du nom. */}
        <TournamentImageBanner
          image={card.image}
          sizes="(max-width: 1280px) 100vw, 1200px"
          className={s.banner}
          fade={false}
          priority
        />

        <div className={s.identity}>
          <TournamentImageEmblem image={card.image} size={88} className={s.emblem} priority />
          <div className={s.identityText}>
            <div className={s.eyebrow}>
              <span className={`${s.state} ${TONE_CLASS[state.tone]}`}>{stateLabel}</span>
              <span className={s.identityLine}>{headerIdentityLine(card, text, labels)}</span>
            </div>
            <h1 className={`ds-title ${s.title}`}>{card.name}</h1>
            {card.description && <p className={s.description}>{card.description}</p>}
          </div>

          {(showEdit || showImageEdit) && (
            <div className={s.identityActions}>
              {showImageEdit && (
                <CyberButton
                  variant="ghost"
                  onClick={onEditImage}
                  // « Image » seul ne dit pas de quoi, hors contexte ; le nom
                  // accessible commence par le texte affiché (WCAG 2.5.3).
                  aria-label={card.image ? a("header.imageAria") : undefined}
                  aria-haspopup="dialog"
                  style={{ fontSize: 13, padding: "6px 16px" }}
                >
                  {card.image ? a("header.image") : a("header.addImage")}
                </CyberButton>
              )}
              {showEdit && (
                <CyberButton asChild variant="ghost" style={{ fontSize: 13, padding: "6px 16px" }}>
                  <LocaleLink href={`/tournois/${card.id}/modifier`}>
                    {a("header.edit")}
                  </LocaleLink>
                </CyberButton>
              )}
            </div>
          )}
        </div>

        <dl className={s.meta}>
          {items.map((item) => (
            <MetaCell key={item.key} item={item} locale={text.locale} />
          ))}
        </dl>

        <div className={s.actions}>
          {/* Chaîne officielle : antenne permanente du tournoi, distincte de
              l'état « en direct » qui, lui, se joue au niveau des matchs. */}
          <TournamentLiveLink
            tournamentId={card.id}
            liveUrl={card.liveUrl}
            canEdit={detail.isAdmin}
            onSaved={onLiveSaved}
          />
          {detail.canRegister && !frozen && (
            <CyberButton
              variant="primary"
              onClick={onRegister}
              style={{ fontSize: 13, padding: "8px 18px" }}
            >
              {a(`wording.${entrantType}.registerCta`)}
            </CyberButton>
          )}
          {/* Information sur la retransmission, à l'endroit où l'on s'engage —
              sans case à cocher : la base est l'intérêt légitime, le joueur
              garde son droit d'opposition (`lib/shared/stream-notice.ts`). */}
          {detail.canRegister && !frozen && (
            <p className={s.registerNotice}>
              {a(`register.streamNotice.${entrantType}`)}{" "}
              <LocaleLink href={STREAM_NOTICE_PRIVACY_PATH}>{a("register.streamNoticeLink")}</LocaleLink>
            </p>
          )}
          {/* À la place du bouton, et non à côté : le lecteur cherche là où
              l'action devrait être. */}
          {registerNotice && <p className={s.registerNotice}>{registerNotice}</p>}
          {detail.isAdmin && !frozen && card.state === "REGISTRATION" && (
            <CyberButton
              variant="ghost"
              onClick={onGuestRegister}
              style={{ fontSize: 13, padding: "8px 18px" }}
            >
              {a(`wording.${entrantType}.guestCta`)}
            </CyberButton>
          )}
          {/* Avancée anticipée : fait franchir l'étape suivante (inscriptions,
              clôture, coup d'envoi). Le bouton n'apparaît que là où il mène
              quelque part — même principe que « Modifier » : pas de bouton grisé
              sur un tournoi déjà en cours. La règle vient du module pur partagé,
              que le serveur rejoue sous verrou (`lib/shared/tournament-launch.ts`). */}
          {detail.isAdmin && !frozen && nextStage !== null && (
            <CyberButton
              variant="ghost"
              onClick={onAdvance}
              title={a("header.advanceTitle", { stage: t(`progress.stages.${nextStage}.label`) })}
              style={{ fontSize: 13, padding: "8px 18px" }}
            >
              {/* Le chevron est décoratif : le lecteur d'écran doit entendre
                  l'action, pas « triangle pointant vers la droite ». Même
                  traitement que la flèche du bouton « Retour ». */}
              <span aria-hidden="true">▶</span> {a("header.advance")}
            </CyberButton>
          )}
          {/* Signalement : ouvert aux seuls engagés (inscrits, pas seulement dotés
              d'une équipe), à toute heure du tournoi —
              un problème d'inscription se signale avant le coup d'envoi comme
              un litige de score se signale après. */}
          {isViewerEntrant(detail.myTeamId, detail.registrations) && (
            <CyberButton
              variant="ghost"
              onClick={onReportIssue}
              style={{ fontSize: 13, padding: "8px 18px" }}
            >
              ⚠ {a("header.reportIssue")}
            </CyberButton>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Une case de la grille. Les dates ne sont mises en forme qu'ici : leur rendu
 * dépend du fuseau du lecteur, que le module pur n'a pas à connaître.
 */
function MetaCell({ item, locale }: Readonly<{ item: HeaderMetaItem; locale: Locale }>) {
  const isNumeric = item.kind === "count";
  const text = item.kind === "date" ? formatHeaderDate(item.value, locale) : item.value;

  return (
    <div className={s.metaItem}>
      <dt className={s.metaLabel}>{item.label}</dt>
      <dd className={`${s.metaValue} ${isNumeric ? s.metaValueNum : ""}`} style={{ margin: 0 }}>
        {item.hint ? (
          // `title` seul se perd pour les lecteurs d'écran : l'explication est
          // donc aussi écrite dans le texte, hors écran. Pas d'`aria-label` —
          // interdit sur un `<span>` sans rôle (`aria-prohibited-attr`), et
          // ignoré de certains lecteurs —, ni de `tabIndex` : un repère
          // focusable qui ne fait rien est un arrêt de tabulation pour rien, et
          // l'infobulle n'apparaît de toute façon pas au focus clavier.
          <span className={s.metaHint} title={item.hint}>
            {text}
            <span className="sr-only"> — {item.hint}</span>
          </span>
        ) : (
          text
        )}
        {item.ratio !== undefined && (
          <div className={s.gauge} aria-hidden="true">
            <div className={s.gaugeFill} style={{ width: `${Math.round(item.ratio * 100)}%` }} />
          </div>
        )}
      </dd>
    </div>
  );
}

/** « 14 sept. 2025, 18:00 » — même forme que les cartes de `/tournois`. */
function formatHeaderDate(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  // 24 h dans les deux langues (le français l'applique de lui-même) ; jour sans
  // zéro initial en anglais (« Oct 7, 2026 »), comme `formatCardDate`.
  return date.toLocaleString(INTL_LOCALE[locale], {
    day: locale === "fr" ? "2-digit" : "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}
