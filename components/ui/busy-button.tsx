import type { ButtonHTMLAttributes, MouseEvent } from "react";

export type BusyButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "disabled" | "aria-disabled" | "aria-busy" | "type"
> & {
  /** Un envoi est en cours : bouton indisponible **et** annoncé en attente. */
  busy: boolean;
  /** Autre raison de refus (rien à enregistrer, choix plus proposé, manche figée…). */
  blocked?: boolean;
  type?: "button" | "submit";
  /**
   * Activation d'un bouton désarmé par `blocked` (jamais par `busy`) : un geste
   * qui **explique** le refus (toast), rien de plus. Sans lui, l'activation est
   * annulée.
   */
  onBlockedClick?: (event: MouseEvent<HTMLButtonElement>) => void;
};

/**
 * Bouton d'un écran qui envoie (`docs/features/BUSY_BUTTONS.md`) : jamais
 * `disabled` natif (le focus clavier tomberait sur la page), mais
 * `aria-disabled` + `aria-busy`, et la garde **par construction** : le même
 * état (`busy || blocked`) pose `aria-disabled` et annule l'activation — une
 * raison de refus ne peut plus être oubliée dans un gestionnaire.
 *
 * Annuler le `click` suffit pour un bouton `submit` : la soumission implicite
 * (Entrée dans un champ) passe par un clic synthétique sur ce bouton, annulé
 * de même. Le `onSubmit` du formulaire garde ses propres refus (défense en
 * profondeur), la garde synchrone (`useBusyGuard().run`) écarte le second geste
 * parti avant le rendu, et le serveur autorise chaque geste : tout ceci n'est
 * que de l'ergonomie.
 */
export function BusyButton({
  busy,
  blocked = false,
  onClick,
  onBlockedClick,
  type = "button",
  ...rest
}: Readonly<BusyButtonProps>) {
  const off = busy || blocked;
  const activate = (event: MouseEvent<HTMLButtonElement>) => {
    if (!off) {
      onClick?.(event);
      return;
    }
    event.preventDefault();
    if (!busy) onBlockedClick?.(event);
  };
  return <button {...rest} type={type} aria-disabled={off || undefined} aria-busy={busy || undefined} onClick={activate} />;
}
