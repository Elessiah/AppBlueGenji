"use client";

/**
 * Fiches d'un match — les deux engagées, l'hôte, leurs contacts, le caster —
 * partagées par la modale de lancement (`MatchLaunchCenter`) et la modale
 * « Contacts » d'une carte de match (`MatchContactsDialog`). Les données
 * viennent de la même lecture serveur (`match-launch-info.ts`), qui décide
 * seule de ce qui est exposé : ces fiches ne font que le montrer.
 */

import { PlayerLink, TeamLink } from "@/components/entity-link";
import { useLaunchText } from "./launch-text";
import type { LaunchCaster, LaunchContact, LaunchSide, MatchLaunchInfo } from "@/lib/shared/match-launch";
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
  contactsShown = phase !== "SCHEDULED",
  linkNames = false,
}: Readonly<{
  side: LaunchSide;
  isHost: boolean;
  phase: MatchLaunchInfo["phase"];
  onCopy: CopyFn;
  /** Contacts montrés ; par défaut, pas avant le lancement (modale de lancement). */
  contactsShown?: boolean;
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
      <SideContacts side={side} onCopy={onCopy} shown={contactsShown} linkNames={linkNames} />
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
  shown,
  linkNames,
}: Readonly<{
  side: LaunchSide;
  onCopy: CopyFn;
  shown: boolean;
  linkNames: boolean;
}>) {
  const { t } = useLaunchText();
  if (side.isGhost) return <p className={styles.note}>{t("ghost")}</p>;
  if (!shown) return <p className={styles.note}>{t("contactsAtLaunch")}</p>;
  if (side.contacts.length === 0) return <p className={styles.note}>{t("noContact")}</p>;
  return (
    <ul className={styles.contacts}>
      {side.contacts.map((contact) => (
        <ContactRow key={contact.userId} contact={contact} onCopy={onCopy} linkName={linkNames} />
      ))}
    </ul>
  );
}

export function CasterCard({
  caster,
  phase,
  onCopy,
  contactsShown = phase !== "SCHEDULED",
  noCasterText,
  contactsLaterText,
  linkNames = false,
}: Readonly<{
  caster: LaunchCaster | null;
  phase: MatchLaunchInfo["phase"];
  onCopy: CopyFn;
  contactsShown?: boolean;
  /** Texte sans caster ; par défaut, celui de la modale de lancement. */
  noCasterText?: string;
  /**
   * Texte à la place des contacts tus (`contactsShown` faux) : sans lui, la
   * fiche ne montre que le pseudo.
   */
  contactsLaterText?: string;
  /** Pseudo cliquable (modale « Contacts » seulement, voir `SideCard`). */
  linkNames?: boolean;
}>) {
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
      {contactsShown && (
        <div className={styles.casterIds}>
          <IdentityLine kind="Discord" value={caster.discordTag} verified={caster.discordTag !== null} onCopy={onCopy} />
          <IdentityLine kind="BattleTag" value={caster.battletag} verified={caster.battletagVerified} onCopy={onCopy} />
        </div>
      )}
      {!contactsShown && contactsLaterText && <p className={styles.note}>{contactsLaterText}</p>}
    </section>
  );
}
