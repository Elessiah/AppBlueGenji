"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { useAppLocale } from "@/components/i18n/locale-context";
import {
  infoHintLabel,
  infoHintLocale,
  infoHintOwnsEscape,
  infoHintReaction,
  infoHintRefocusAfterEscape,
  isInteractivePointerTarget,
  topOpenModal,
} from "@/lib/shared/info-hint";
import s from "./info-hint.module.css";

/**
 * Le bouton « i » : une explication repliée derrière un petit bouton rond,
 * posé juste après le libellé qu'elle explique (`docs/features/INFO_HINTS.md`).
 *
 * Motif de **divulgation**, pas de modale : `aria-expanded` + `aria-controls`,
 * et l'explication s'ouvre **dans le flux**, sous la rangée du libellé. Une
 * bulle superposée aurait été rognée par les blocs `.ds-block`
 * (`overflow: hidden`) et recouverte par les sections voisines (contextes
 * d'empilement des `.fade-in`).
 *
 * Fermée, l'explication reste dans le DOM (`hidden`) avec son `id` : un champ
 * qui la cite dans son `aria-describedby` garde sa description entière — le
 * lecteur d'écran l'entend, l'œil voit le « i ». Une erreur de champ ne s'y
 * met jamais (`FieldErrorText`).
 *
 * Se referme par Échap (écouté sur `document` tant qu'il est ouvert, focus
 * rendu au bouton s'il n'est pas sur un champ), par un clic ailleurs — un
 * autre « i » compris, et au toucher le relâchement sur du texte, que Safari
 * iOS ne transmet pas en `click` —, par un second clic sur le bouton.
 *
 * Le parent pose le libellé et ce composant dans une rangée qui passe à la
 * ligne (`InfoHintRow`) : l'explication y prend toute la largeur, sous eux.
 */
export function InfoHint({
  id,
  subject,
  children,
}: Readonly<{
  /** Identifiant de l'explication — celui que cite un `aria-describedby`. */
  id: string;
  /** Ce que l'explication explique, pour le nom du bouton (« Plus d'infos : BattleTag »). */
  subject: string;
  children: ReactNode;
}>): React.ReactElement {
  const pageLocale = useAppLocale();
  // La langue du nom du bouton suit l'élément ambiant qui en déclare une : une
  // modale de personnel `lang="fr"` sous `/en` garde « Plus d'infos », lu en
  // français avec son sujet. Lue après le montage (le DOM seul la porte).
  const [locale, setLocale] = useState(pageLocale);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setLocale(infoHintLocale(rootRef.current?.closest("[lang]")?.getAttribute("lang"), pageLocale));
  }, [pageLocale]);

  useEffect(() => {
    if (!open) return;
    const isOutside = (event: Event) => !(event.target instanceof Node && rootRef.current?.contains(event.target));
    const onClick = (event: MouseEvent) => {
      const kind = isOutside(event) ? "outsideClick" : "insideClick";
      if (infoHintReaction({ kind }) === "close") setOpen(false);
    };
    // Safari iOS n'envoie pas `click` au `document` pour un élément non
    // cliquable (texte, fond) : le relâchement referme, sauf sur un contrôle,
    // qui referme à son `click`. Un défilement tactile finit en `pointercancel`.
    const onPointerUp = (event: PointerEvent) => {
      // Un clic de souris referme au `click` : le relâchement qui finit une
      // sélection de texte à la souris ne doit pas replier le panneau.
      if (event.pointerType === "mouse" || !isOutside(event)) return;
      const interactive = isInteractivePointerTarget(event.target as Element | null);
      if (infoHintReaction({ kind: "outsidePointerUp", interactive }) === "close") setOpen(false);
    };
    // Échap écouté sur `document` tant que l'explication est ouverte : le focus
    // peut être ailleurs (texte cliqué, champ voisin atteint par Tab) sans que
    // la touche cesse de la replier. Une modale ouverte **par-dessus** garde la
    // sienne ; une modale qui porte le « i » laisse la touche passer
    // (`escapeBelongsElsewhere`, `data-escape-owner`).
    const onKeyDown = (event: KeyboardEvent) => {
      if (infoHintReaction({ kind: "key", key: event.key }) !== "closeAndFocus") return;
      if (!infoHintOwnsEscape(rootRef.current, topOpenModal(document))) return;
      event.stopPropagation();
      setOpen(false);
      if (infoHintRefocusAfterEscape(rootRef.current, document.activeElement, document.body)) buttonRef.current?.focus();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    // `data-escape-owner` : déplié, Échap le replie sans fermer la modale qui le porte (`escapeBelongsElsewhere`).
    <div ref={rootRef} className={s.root} data-escape-owner={open ? "" : undefined}>
      <button
        ref={buttonRef}
        type="button"
        className={s.trigger}
        aria-expanded={open}
        aria-controls={id}
        aria-label={infoHintLabel(locale, subject)}
        onClick={(event) => {
          // Safari (macOS, iOS) ne donne pas le focus à un bouton cliqué : sans
          // lui, Échap — écouté sur le composant — ne l'atteindrait jamais.
          event.currentTarget.focus();
          setOpen((value) => !value);
        }}
      >
        <Info aria-hidden="true" size={16} strokeWidth={2} />
      </button>
      <div id={id} className={s.panel} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/** La rangée « libellé + bouton i » : passe à la ligne, l'explication dessous sur toute la largeur. */
export function InfoHintRow({
  children,
  inline = false,
  separated = false,
}: Readonly<{
  children: ReactNode;
  /**
   * La phrase qui précède est une **phrase en clair** (note, aide) : le « i »
   * se pose à sa suite, en ligne, et passe à la ligne avec elle au lieu de
   * tomber seul dessous. Pour un libellé court, la rangée suffit.
   */
  inline?: boolean;
  /**
   * Le libellé qui précède est celui d'une **case enregistrée au changement** :
   * un écart plus large, pour qu'un toucher un peu à côté du « i » n'en
   * bascule pas le réglage.
   */
  separated?: boolean;
}>): React.ReactElement {
  const className = [s.row, inline ? s.rowInline : "", separated ? s.rowSeparated : ""].filter(Boolean).join(" ");
  return <div className={className}>{children}</div>;
}

/**
 * Une liste « qui le voit » : une phrase d'entrée, les lecteurs, une phrase de
 * fin — la forme commune des explications de visibilité (tag Discord certifié,
 * BattleTag masqué).
 */
export type AudienceLines = { title: string; items: readonly string[]; footer: string };

export function AudienceList({ lines }: Readonly<{ lines: AudienceLines }>): React.ReactElement {
  return (
    <>
      <p>{lines.title}</p>
      <ul>
        {lines.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p>{lines.footer}</p>
    </>
  );
}
