"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { useAppLocale } from "@/components/i18n/locale-context";
import { infoHintLabel, infoHintReaction } from "@/lib/shared/info-hint";
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
 * Se referme par Échap (focus rendu au bouton), par un clic ailleurs — un
 * autre « i » compris —, par un second clic sur le bouton. Le clic donne le
 * focus au bouton (Safari ne le fait pas de lui-même), pour qu'Échap porte.
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
  const locale = useAppLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      const inside = event.target instanceof Node && rootRef.current?.contains(event.target);
      if (infoHintReaction({ kind: inside ? "insideClick" : "outsideClick" }) === "close") setOpen(false);
      // Un clic sur le texte de l'explication donne le focus au conteneur de la
      // modale (`tabIndex={-1}`) : rendu au bouton, Échap replie encore le « i »
      // au lieu de fermer la modale (`data-escape-owner` suit la cible).
      else if (inside && !rootRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
    };
    // Échap écouté sur le composant seul (bouton et explication) : une modale
    // ouverte par-dessus garde le sien, sans que le focus reparte derrière son
    // voile. Posé ici plutôt qu'en `onKeyDown` : le conteneur n'est pas un
    // contrôle.
    const root = rootRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (infoHintReaction({ kind: "key", key: event.key }) !== "closeAndFocus") return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("click", onClick);
    root?.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick);
      root?.removeEventListener("keydown", onKeyDown);
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
export function InfoHintRow({ children }: Readonly<{ children: ReactNode }>): React.ReactElement {
  return <div className={s.row}>{children}</div>;
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
