import { fieldErrorId } from "@/lib/shared/field-errors";

/**
 * Phrase d'un refus, rattachée à son champ pour les technologies d'assistance
 * (`aria-describedby`, posé par `fieldAria`).
 *
 * **Masquée à l'œil** (`.sr-only`) : la convention du site fait passer toute
 * erreur par une notification, et le voyant a déjà celle-ci plus le liseré du
 * champ. Le lecteur d'écran, lui, entend la notification une fois, au moment
 * où elle paraît — revenu sur le champ, il lui faut la phrase **là**.
 *
 * Rien n'est rendu sans message : l'`id` n'existe que tant que le champ est
 * signalé, comme la référence qui le vise.
 */
export function FieldErrorText({ fieldId, message }: { fieldId: string; message: string | null }) {
  if (!message) return null;
  return (
    <span id={fieldErrorId(fieldId)} className="sr-only">
      {message}
    </span>
  );
}
