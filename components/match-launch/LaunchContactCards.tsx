"use client";

/**
 * Fiches d'un match — les deux engagées, l'hôte, leurs contacts, ses casters —
 * partagées par la modale de lancement (`MatchLaunchCenter`) et la modale
 * « Contacts » d'une carte de match (`MatchContactsDialog`). Les données
 * viennent de la même lecture serveur (`match-launch-info.ts`), qui décide
 * seule de ce qui est exposé : ces fiches ne font que le montrer.
 */

import { useEffect, useState } from "react";
import { PlayerLink, TeamLink } from "@/components/entity-link";
import { useLaunchText } from "./launch-text";
import {
  CASTER_ARRIVAL_ANNOUNCE_MS,
  casterCardPending,
  casterHasContacts,
  nextCasterArrival,
  type CasterArrival,
  type CasterArrivalSeen,
  type LaunchCaster,
  type LaunchSideContact,
  type LaunchReferee,
  type LaunchSide,
  type MatchLaunchInfo,
} from "@/lib/shared/match-launch";
import type { TeamRole } from "@/lib/shared/types";
import styles from "./MatchLaunchCenter.module.css";

/** Rôles affichés sur un contact, dans l'ordre de la priorité de choix (`roles.*`). */
const CONTACT_ROLES = ["CAPITAINE", "MANAGER", "OWNER"] as const satisfies readonly TeamRole[];
export type CopyFn = (value: string, label: string) => Promise<void>;

function ReadyChip({ ready, phase }: Readonly<{ ready: boolean; phase: MatchLaunchInfo["phase"] }>) {
  const { t } = useLaunchText();
  if (phase !== "LOBBY") return null;
  return (
    <span className={ready ? styles.chipReady : styles.chipWaiting}>
      {ready ? t("chipReady") : t("chipWaiting")}
    </span>
  );
}

function IdentityLine({
  kind,
  value,
  verified,
  onCopy,
  note,
}: Readonly<{
  kind: "Discord" | "BattleTag";
  value: string | null;
  verified: boolean;
  onCopy: CopyFn;
  /** Ce que le lecteur doit en faire (page du match : « À inviter — obligatoire »). */
  note?: string;
}>) {
  const { t } = useLaunchText();
  return (
    <div className={styles.identity}>
      <span className={styles.identityKind}>{kind}</span>
      {note && value && <span className={styles.identityNote}>{note}</span>}
      {value ? (
        <>
          <span className={`mono ${styles.identityValue}`}>{value}</span>
          {verified ? (
            <span className={styles.verified} title={t("verifiedTitle")}>
              ✓<span className="sr-only"> {t("verified")}</span>
            </span>
          ) : (
            <span className={styles.unverified}>{t("unverified")}</span>
          )}
          <button
            type="button"
            className={`${styles.copy} tap-target`}
            onClick={() => void onCopy(value, kind)}
            aria-label={t("copyAria", { kind, value })}
          >
            {t("copy")}
          </button>
        </>
      ) : (
        <span className={styles.missing}>—</span>
      )}
    </div>
  );
}

function ContactRow({
  contact,
  onCopy,
  linkName,
}: Readonly<{ contact: LaunchSideContact; onCopy: CopyFn; linkName: boolean }>) {
  const { t } = useLaunchText();
  // Dans l'ordre de la priorité de choix (capitaine, manager, propriétaire),
  // pas dans l'ordre de saisie : la pastille la plus parlante vient en tête.
  const roles = CONTACT_ROLES.filter((role) => contact.roles.includes(role)).map((role) => t(`roles.${role}`));
  return (
    <li className={styles.contact}>
      <div className={styles.contactHead}>
        {linkName ? (
          <PlayerLink userId={contact.userId} className={styles.pseudo}>
            {contact.pseudo}
          </PlayerLink>
        ) : (
          <span className={styles.pseudo}>{contact.pseudo}</span>
        )}
        {roles.map((label) => (
          <span key={label} className={styles.role}>
            {label}
          </span>
        ))}
      </div>
      <IdentityLine kind="Discord" value={contact.discordTag} verified={contact.discordTag !== null} onCopy={onCopy} />
      {/* Hors Overwatch, le serveur n'envoie pas le BattleTag (décision 38) : pas de ligne. */}
      {contact.battletag !== undefined && (
        <IdentityLine kind="BattleTag" value={contact.battletag} verified={contact.battletagVerified === true} onCopy={onCopy} />
      )}
    </li>
  );
}

export function SideCard({
  side,
  isHost,
  phase,
  onCopy,
  linkNames = false,
  laterText,
}: Readonly<{
  side: LaunchSide;
  isHost: boolean;
  phase: MatchLaunchInfo["phase"];
  onCopy: CopyFn;
  /**
   * Note des contacts tus : la modale de lancement passe la sienne
   * (`launchSidesLaterText`, qui ne renvoie à l'action « Contacts » qu'à qui
   * elle ouvre déjà quelque chose) ; par défaut, la note neutre de la modale
   * « Contacts » (`contacts.notShown`, sa note d'échec), filet gardé exprès :
   * sa route ne rend aujourd'hui que des matchs aux contacts des engagées
   * ouverts, mais un changement de route n'y ferait jamais renvoyer à elle-même.
   */
  laterText?: string;
  /**
   * Noms cliquables vers leurs fiches — modale « Contacts » seulement : la
   * modale de lancement survit à la navigation et recouvrirait la fiche ouverte.
   */
  linkNames?: boolean;
}>) {
  const { t } = useLaunchText();
  return (
    <section className={styles.side} data-host={isHost ? "true" : undefined} aria-label={side.name}>
      <div className={styles.sideHead}>
        <span className={styles.emblem} aria-hidden="true">
          {side.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- fichier du site, déjà optimisé au téléversement
            <img src={side.logoUrl} alt="" />
          ) : (
            Array.from(side.name.trim())[0]?.toUpperCase() ?? "?"
          )}
        </span>
        <span className={styles.sideName}>
          {linkNames ? <SideName side={side} /> : side.name}
        </span>
        <ReadyChip ready={side.ready} phase={phase} />
      </div>
      {isHost && (
        <p className={styles.hostBadge}>
          <span aria-hidden="true">🏠</span> {t("host")}
        </p>
      )}
      <SideContacts
        side={side}
        onCopy={onCopy}
        linkNames={linkNames}
        laterText={laterText}
      />
    </section>
  );
}

/**
 * Nom de l'engagé, cliquable vers sa fiche (`ENTITY_LINKS.md`) : l'équipe, ou
 * — entrée solo, qui n'a pas de fiche d'équipe — le joueur, connu par son
 * unique contact ; sans contact exposé, le nom reste un nom.
 */
function SideName({ side }: Readonly<{ side: LaunchSide }>) {
  if (!side.isSolo) return <TeamLink teamId={side.teamId}>{side.name}</TeamLink>;
  const player = side.contacts.length === 1 ? side.contacts[0] : null;
  return player ? <PlayerLink userId={player.userId}>{side.name}</PlayerLink> : <>{side.name}</>;
}

function SideContacts({
  side,
  onCopy,
  linkNames,
  laterText,
}: Readonly<{
  side: LaunchSide;
  onCopy: CopyFn;
  linkNames: boolean;
  laterText: string | undefined;
}>) {
  const { t } = useLaunchText();
  if (side.isGhost) return <p className={styles.note}>{t("ghost")}</p>;
  if (!side.contactsShown) {
    return <p className={styles.note}>{laterText ?? t("contacts.notShown")}</p>;
  }
  if (side.contacts.length === 0) return <p className={styles.note}>{t("noContact")}</p>;
  return (
    <ul className={styles.contacts}>
      {side.contacts.map((contact) => (
        <ContactRow key={contact.userId} contact={contact} onCopy={onCopy} linkName={linkNames} />
      ))}
    </ul>
  );
}

/**
 * Les contacts du caster viennent-ils d'arriver ? `nextCasterArrival` sur
 * l'état précédent gardé au rendu ; l'annonce se vide d'elle-même après
 * `CASTER_ARRIVAL_ANNOUNCE_MS`.
 */
function useCasterArrival(caster: LaunchCaster, pending: boolean): CasterArrival {
  const [seen, setSeen] = useState<CasterArrivalSeen>({ pending, casterId: caster.userId, arrival: null });
  const next = nextCasterArrival(seen, caster, pending);
  if (next) setSeen(next);
  useEffect(() => {
    if (seen.arrival === null) return;
    const timer = setTimeout(() => setSeen((current) => ({ ...current, arrival: null })), CASTER_ARRIVAL_ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [seen.arrival]);
  return seen.arrival;
}

/**
 * Statut hors flux de l'arrivée des contacts du caster, présent dès
 * l'ouverture là où il peut parler : une phrase plutôt que les boutons
 * « Copier » — ou, sans contact, celle qui le dit. Pas un toast : rien n'a été
 * demandé ni n'a réussi, le contenu de la fiche change sous les yeux — une
 * région polie pour lecteur d'écran seulement, invisible à l'écran (la règle
 * des toasts vise les retours d'un geste). Composant à part : la modale de
 * lancement, relue à chaque interrogation, ne porte ni son état ni sa minuterie.
 */
function CasterArrivalStatus({ caster, pending }: Readonly<{ caster: LaunchCaster; pending: boolean }>) {
  const { t } = useLaunchText();
  const arrival = useCasterArrival(caster, pending);
  return (
    <output className="sr-only" aria-live="polite">
      {arrival && t(arrival === "SHOWN" ? "contacts.casterShown" : "contacts.casterShownEmpty")}
    </output>
  );
}

type CasterCardOptions = {
  phase: MatchLaunchInfo["phase"];
  onCopy: CopyFn;
  /** Texte sans caster ; par défaut, celui de la modale de lancement. */
  noCasterText?: string;
  /** Note posée sur le BattleTag (page du match : « À inviter — obligatoire »). */
  battletagNote?: string;
  /**
   * Note des contacts tus ; par défaut, celle de la modale de lancement, dans
   * les mots de la note des engagées juste au-dessus (« au lancement »).
   */
  laterText?: string;
  /** Pseudo cliquable (modale « Contacts » seulement, voir `SideCard`). */
  linkNames?: boolean;
  /**
   * Annoncer l'arrivée des contacts (modale « Contacts » seulement : dans la
   * modale de lancement, ce passage coïncide avec le statut du lancement, qui
   * s'annonce déjà — deux annonces polies s'y empileraient).
   */
  announceArrival?: boolean;
};

/**
 * Les fiches des casters d'un match, une par caster dans l'ordre
 * d'inscription — ou la fiche « sans caster ». Les contacts de tous les casters
 * arrivent ensemble (même phase, même lecteur) : seule la première fiche qui
 * n'est pas celle du lecteur annonce leur arrivée, pour ne pas empiler les
 * annonces polies.
 */
export function CasterCards({
  casters,
  announceArrival = false,
  ...options
}: Readonly<CasterCardOptions & { casters: readonly LaunchCaster[] }>) {
  if (casters.length === 0) return <CasterCard caster={null} {...options} />;
  const announcer = casters.findIndex((caster) => !caster.isViewer);
  return (
    <>
      {casters.map((caster, index) => (
        <CasterCard
          key={caster.userId}
          caster={caster}
          announceArrival={announceArrival && index === announcer}
          {...options}
        />
      ))}
    </>
  );
}

export function CasterCard({
  caster,
  phase,
  onCopy,
  noCasterText,
  laterText,
  linkNames = false,
  announceArrival = false,
  battletagNote,
}: Readonly<
  CasterCardOptions & {
    /**
     * Le caster, `null` sans caster. Que ses contacts sortent, c'est le serveur
     * qui le dit (`caster.contactsShown`) ; la note « au départ » ne s'adresse
     * jamais au caster lui-même (`caster.isViewer`).
     */
    caster: LaunchCaster | null;
  }
>) {
  const { t } = useLaunchText();
  if (!caster) {
    return (
      <section className={styles.caster} aria-label={t("caster")}>
        <p className={styles.note}>
          <span aria-hidden="true">🎙</span> {noCasterText ?? t("noCaster")}
        </p>
      </section>
    );
  }
  const pending = casterCardPending(caster);
  const self = caster.isViewer;
  const hasContacts = casterHasContacts(caster);
  return (
    // Nommée par son caster : à plusieurs, chaque région se distingue.
    <section className={styles.caster} aria-label={`${t("caster")} ${caster.pseudo}`}>
      <div className={styles.sideHead}>
        <span className={styles.emblem} aria-hidden="true">
          🎙
        </span>
        <span className={styles.sideName}>
          <span className={styles.casterLabel}>{t("caster")}</span>{" "}
          {linkNames ? <PlayerLink userId={caster.userId}>{caster.pseudo}</PlayerLink> : caster.pseudo}
        </span>
        <ReadyChip ready={caster.ready} phase={phase} />
      </div>
      {/* Ouverts mais vides : la phrase des engagées sans contact, pas deux
          « — » — sauf au caster lui-même, sa propre fiche n'a rien à lui dire. */}
      {caster.contactsShown && !hasContacts && !self && <p className={styles.note}>{t("noContact")}</p>}
      {caster.contactsShown && hasContacts && (
        <div className={styles.casterIds}>
          <IdentityLine kind="Discord" value={caster.discordTag} verified={caster.discordTag !== null} onCopy={onCopy} />
          {/* Hors Overwatch, le serveur n'envoie pas le BattleTag (`withGameBattletag`) : pas de ligne. */}
          {caster.battletag !== undefined && (
            <IdentityLine
              kind="BattleTag"
              value={caster.battletag}
              verified={caster.battletagVerified === true}
              onCopy={onCopy}
              note={self ? undefined : battletagNote}
            />
          )}
        </div>
      )}
      {/* Contacts tus : une note plutôt que deux « — » qui laisseraient croire
          qu'il n'en a pas — jamais au caster lui-même, dont elle parle. */}
      {pending && <p className={styles.note}>{laterText ?? t("casterContactsAtLaunch")}</p>}
      {announceArrival && <CasterArrivalStatus caster={caster} pending={pending} />}
    </section>
  );
}

/**
 * Fiche de l'arbitre désigné (`docs/features/MATCH_REFEREE.md`) : son pseudo et,
 * en Overwatch seulement, son BattleTag — exposés par le serveur aux deux engagées, aux casters du
 * match et au staff seulement. Sans arbitre, la note d'autogestion, ou rien.
 */
export function RefereeCard({
  referee,
  selfManaged,
  phase,
  onCopy,
  linkNames = false,
  battletagNote,
}: Readonly<{
  referee: LaunchReferee | null;
  selfManaged: boolean;
  phase: MatchLaunchInfo["phase"];
  onCopy: CopyFn;
  linkNames?: boolean;
  /** Note posée sur le BattleTag (page du match : « À ajouter en jeu »). */
  battletagNote?: string;
}>) {
  const { t } = useLaunchText();
  if (!referee) {
    if (!selfManaged) return null;
    return (
      <section className={styles.caster} aria-label={t("referee")}>
        <p className={styles.note}>
          <span aria-hidden="true">🤝</span> {t("selfManaged")}
        </p>
      </section>
    );
  }
  return (
    <section className={styles.caster} aria-label={`${t("referee")} ${referee.pseudo}`}>
      <div className={styles.sideHead}>
        <span className={styles.emblem} aria-hidden="true">
          🧑‍⚖️
        </span>
        <span className={styles.sideName}>
          <span className={styles.casterLabel}>{t("referee")}</span>{" "}
          {linkNames ? <PlayerLink userId={referee.userId}>{referee.pseudo}</PlayerLink> : referee.pseudo}
        </span>
        <ReadyChip ready={referee.ready} phase={phase} />
      </div>
      {!referee.isViewer && referee.battletag != null && (
        <div className={styles.casterIds}>
          <IdentityLine
            kind="BattleTag"
            value={referee.battletag}
            verified={referee.battletagVerified === true}
            onCopy={onCopy}
            note={battletagNote}
          />
        </div>
      )}
    </section>
  );
}
