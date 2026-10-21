"use client";

/**
 * Fiches d'un match — les deux engagées, l'hôte, leurs contacts, le caster —
 * partagées par la modale de lancement (`MatchLaunchCenter`) et la modale
 * « Contacts » d'une carte de match (`MatchContactsDialog`). Les données
 * viennent de la même lecture serveur (`match-launch-info.ts`), qui décide
 * seule de ce qui est exposé : ces fiches ne font que le montrer.
 */

import { useEffect, useState } from "react";
import { PlayerLink, TeamLink } from "@/components/entity-link";
import { useLaunchText } from "./launch-text";
import {
  casterContactsArrived,
  casterContactsPending,
  viewerIsCaster,
  type LaunchCaster,
  type LaunchContact,
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
}: Readonly<{
  kind: "Discord" | "BattleTag";
  value: string | null;
  verified: boolean;
  onCopy: CopyFn;
}>) {
  const { t } = useLaunchText();
  return (
    <div className={styles.identity}>
      <span className={styles.identityKind}>{kind}</span>
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
}: Readonly<{ contact: LaunchContact; onCopy: CopyFn; linkName: boolean }>) {
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
      <IdentityLine kind="BattleTag" value={contact.battletag} verified={contact.battletagVerified} onCopy={onCopy} />
    </li>
  );
}

export function SideCard({
  side,
  isHost,
  phase,
  onCopy,
  linkNames = false,
  viewer,
}: Readonly<{
  side: LaunchSide;
  isHost: boolean;
  phase: MatchLaunchInfo["phase"];
  onCopy: CopyFn;
  /**
   * Le lecteur : au caster, la note des contacts tus ne renvoie pas à l'action
   * « Contacts », qui ne lui ouvre rien avant le départ.
   */
  viewer?: Pick<MatchLaunchInfo["viewer"], "role" | "isCaster">;
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
      <SideContacts side={side} onCopy={onCopy} linkNames={linkNames} forCaster={viewer !== undefined && viewerIsCaster({ viewer })} />
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
  forCaster,
}: Readonly<{
  side: LaunchSide;
  onCopy: CopyFn;
  linkNames: boolean;
  forCaster: boolean;
}>) {
  const { t } = useLaunchText();
  if (side.isGhost) return <p className={styles.note}>{t("ghost")}</p>;
  if (!side.contactsShown) {
    return <p className={styles.note}>{t(forCaster ? "contactsAtLaunchCaster" : "contactsAtLaunch")}</p>;
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

/** Durée de l'annonce d'arrivée : lue, elle ne reste pas en statut périmé. */
export const CASTER_ARRIVAL_ANNOUNCE_MS = 10_000;

/**
 * Les contacts du caster viennent-ils d'arriver ? Vrai au seul passage « en
 * attente → montrés » d'un même caster (état précédent gardé au rendu), jamais
 * à l'ouverture ; un autre caster, ou plus de caster, l'efface, et l'annonce
 * se vide d'elle-même après `CASTER_ARRIVAL_ANNOUNCE_MS`.
 */
function useCasterArrival(caster: LaunchCaster | null, pending: boolean, enabled: boolean): boolean {
  const casterId = caster?.userId ?? null;
  const [seen, setSeen] = useState({ pending, casterId, arrived: false });
  if (seen.pending !== pending || seen.casterId !== casterId) {
    const arrived = enabled && caster !== null && seen.casterId === casterId && casterContactsArrived(seen.pending, caster);
    setSeen({ pending, casterId, arrived });
  }
  useEffect(() => {
    if (!seen.arrived) return;
    const timer = setTimeout(() => setSeen((current) => ({ ...current, arrived: false })), CASTER_ARRIVAL_ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [seen.arrived]);
  return seen.arrived;
}

export function CasterCard({
  caster,
  phase,
  onCopy,
  viewer,
  noCasterText,
  linkNames = false,
  announceArrival = false,
}: Readonly<{
  caster: LaunchCaster | null;
  phase: MatchLaunchInfo["phase"];
  onCopy: CopyFn;
  /**
   * Le lecteur : la note « au départ » ne s'adresse jamais au caster lui-même.
   * Que ses contacts sortent, c'est le serveur qui le dit (`caster.contactsShown`).
   */
  viewer: Pick<MatchLaunchInfo["viewer"], "role" | "isCaster">;
  /** Texte sans caster ; par défaut, celui de la modale de lancement. */
  noCasterText?: string;
  /** Pseudo cliquable (modale « Contacts » seulement, voir `SideCard`). */
  linkNames?: boolean;
  /**
   * Annoncer l'arrivée des contacts (modale « Contacts » seulement : dans la
   * modale de lancement, ce passage coïncide avec le statut du lancement, qui
   * s'annonce déjà — deux annonces polies s'y empileraient).
   */
  announceArrival?: boolean;
}>) {
  const { t } = useLaunchText();
  const pending = casterContactsPending({ caster, viewer });
  const arrived = useCasterArrival(caster, pending, announceArrival);
  if (!caster) {
    return (
      <section className={styles.caster} aria-label={t("caster")}>
        <p className={styles.note}>
          <span aria-hidden="true">🎙</span> {noCasterText ?? t("noCaster")}
        </p>
      </section>
    );
  }
  return (
    <section className={styles.caster} aria-label={t("caster")}>
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
      {caster.contactsShown && (
        <div className={styles.casterIds}>
          <IdentityLine kind="Discord" value={caster.discordTag} verified={caster.discordTag !== null} onCopy={onCopy} />
          <IdentityLine kind="BattleTag" value={caster.battletag} verified={caster.battletagVerified} onCopy={onCopy} />
        </div>
      )}
      {/* Contacts tus : une note plutôt que deux « — » qui laisseraient croire
          qu'il n'en a pas — jamais au caster lui-même, dont elle parle. */}
      {pending && <p className={styles.note}>{t("contacts.casterLater")}</p>}
      {/* Statut toujours présent, hors flux : la phrase plutôt que les boutons
          « Copier » ; muet si le caster n'a aucun contact à montrer. */}
      <output className="sr-only" aria-live="polite">
        {arrived ? t("contacts.casterShown") : ""}
      </output>
    </section>
  );
}
