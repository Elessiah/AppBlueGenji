"use client";

import Link from "next/link";
import { CyberButton, Pill } from "@/components/cyber";
import { TournamentImageBanner, TournamentImageEmblem } from "@/components/tournament-image";
import type { RefreshTier } from "@/lib/shared/refresh-tiers";
import type { TournamentDetail } from "@/lib/shared/types";
import { participantWording } from "@/lib/shared/participants";
import { advanceTarget } from "@/lib/shared/tournament-launch";
import { TOURNAMENT_STAGE_META } from "@/lib/shared/tournament-progress";
import type { LiveFailure } from "../_lib/live-state";
import { canShowEditButton } from "../_lib/edit-entry";
import { registerBlockedNotice } from "../_lib/register-entry";
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

const TONE_CLASS: Record<HeaderTone, string> = {
  neutral: s.stateNeutral,
  green: s.stateGreen,
  blue: s.stateBlue,
  muted: s.stateMuted,
};

interface TournamentHeaderProps {
  detail: TournamentDetail;
  /** Le flux temps réel est-il établi ? */
  isLive: boolean;
  tier: RefreshTier;
  fatal: LiveFailure | null;
  /** Suivi arrêté : les actions sont retirées plutôt que laissées à échouer. */
  frozen: boolean;
  onBack: () => void;
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
  fatal,
  frozen,
  onBack,
  onRegister,
  onReportIssue,
  onGuestRegister,
  onAdvance,
  onLiveSaved,
  onEditImage,
}: TournamentHeaderProps) {
  const { card } = detail;
  const wording = participantWording(card.participantType);
  const state = STATE_META[card.state] ?? { label: card.state, tone: "neutral" as HeaderTone };
  const items = headerMetaItems(card, detail.phases, detail.currentPhaseId);
  // Le seul refus d'inscription qui ne se lise pas tout seul sur la page :
  // avoir une équipe sans en avoir la charge (`_lib/register-entry.ts`).
  const registerNotice = frozen ? null : registerBlockedNotice(detail);
  const nextStage = advanceTarget(card);
  const showEdit = canShowEditButton(card, detail.isAdmin);
  // L'image se règle dans tous les états, contrairement au formulaire : elle
  // est décorative et n'engage aucune règle du moteur.
  const showImageEdit = detail.isAdmin && !frozen;

  return (
    <div className="ds-header green">
      <div className={`ds-header-body ${s.shell}`}>
        <div className={s.utility}>
          <button type="button" onClick={onBack} className={s.back}>
            <span aria-hidden="true">←</span> Retour
          </button>
          <div className={s.viewer}>
            {/* Dit que la page se tient à jour seule : sans ce repère, on
                recharge par précaution même quand tout arrive tout seul. */}
            <LiveIndicator isLive={isLive} tier={tier} fatal={fatal} />
            {detail.isAdmin && !frozen && (
              <Pill title="Tu disposes des droits d'organisation sur ce tournoi.">⚙ Admin</Pill>
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
              <span className={`${s.state} ${TONE_CLASS[state.tone]}`}>{state.label}</span>
              <span className={s.identityLine}>{headerIdentityLine(card)}</span>
            </div>
            <h1 className={`ds-title green ${s.title}`}>{card.name}</h1>
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
                  aria-label={card.image ? "Image du tournoi" : undefined}
                  aria-haspopup="dialog"
                  style={{ fontSize: 13, padding: "6px 16px" }}
                >
                  {card.image ? "Image" : "Ajouter une image"}
                </CyberButton>
              )}
              {showEdit && (
                <CyberButton asChild variant="ghost" style={{ fontSize: 13, padding: "6px 16px" }}>
                  <Link href={`/tournois/${card.id}/modifier`}>Modifier</Link>
                </CyberButton>
              )}
            </div>
          )}
        </div>

        <dl className={s.meta}>
          {items.map((item) => (
            <MetaCell key={item.key} item={item} />
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
              {wording.registerCta}
            </CyberButton>
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
              {wording.guestCta}
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
              title={`Passer à l'étape suivante : ${TOURNAMENT_STAGE_META[nextStage].label}.`}
              style={{ fontSize: 13, padding: "8px 18px" }}
            >
              {/* Le chevron est décoratif : le lecteur d'écran doit entendre
                  l'action, pas « triangle pointant vers la droite ». Même
                  traitement que la flèche du bouton « Retour ». */}
              <span aria-hidden="true">▶</span> Avancer le tournoi
            </CyberButton>
          )}
          {/* Signalement : ouvert aux seuls engagés, à toute heure du tournoi —
              un problème d'inscription se signale avant le coup d'envoi comme
              un litige de score se signale après. */}
          {detail.myTeamId !== null && (
            <CyberButton
              variant="ghost"
              onClick={onReportIssue}
              style={{ fontSize: 13, padding: "8px 18px" }}
            >
              ⚠ Signaler un problème
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
function MetaCell({ item }: { item: HeaderMetaItem }) {
  const isNumeric = item.kind === "count";
  const text = item.kind === "date" ? formatHeaderDate(item.value) : item.value;

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
function formatHeaderDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
