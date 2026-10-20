"use client";

import { useState, type ReactNode } from "react";
import { useAppLocale } from "@/components/i18n/locale-context";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useToast } from "@/components/ui/toast";
import {
  deletionConsequencesText,
  deletionErrorText,
  deletionOutcomeText,
  type ProfileText,
} from "@/app/(secured)/profil/_lib/profile-text";
import { RETENTION_UNKNOWN, type AccountDeletionPlan, type ConfirmationSubject } from "@/lib/shared/account-deletion";
import { localeHref } from "@/lib/shared/locales";

/**
 * La suppression du compte connecté, **une seule** pour les deux écrans qui
 * l'offrent : « Mon profil » et la fenêtre bloquante des conditions
 * d'utilisation (qui refuse les conditions doit pouvoir se retirer d'ici,
 * sans les accepter d'abord). Même aperçu (`GET /api/profile/deletion`), même
 * confirmation (`ConfirmActionDialog`), même route (`DELETE /api/profile`,
 * qui ferme la session), même issue (toast puis accueil, rechargé).
 */

/** Ce que la modale annonce (`subject`) et ce que l'aperçu a répondu (`previewed`). */
export interface PendingAccountDeletion {
  subject: ConfirmationSubject;
  previewed: ConfirmationSubject;
}

/** Délai entre le toast de réussite et le retour à l'accueil (le temps de le lire). */
export const ACCOUNT_DELETED_REDIRECT_MS = 1200;

/**
 * Le motif est demandé avant la confirmation : « effacé » et « anonymisé »
 * ne sont pas la même promesse, et « tes statistiques restent » ne veut
 * rien dire à qui n'en a aucune. Le serveur repose la question à l'écriture
 * — ceci informe, cela tranche.
 *
 * Tant que l'aperçu n'a pas répondu, l'écran ne sait **rien** — pas même
 * lequel des deux modes s'appliquera. Il partait d'une hypothèse
 * (`TOURNAMENTS`), qu'il gardait quand la requête échouait : le joueur
 * consentait alors à devenir anonyme et pouvait être effacé entièrement.
 * Sur un geste irréversible, on décrit l'incertitude plutôt que d'inventer
 * la moitié rassurante.
 *
 * `previewed` part de la **même** valeur que `subject`, et non de `null` :
 * sur ce type, `null` n'est pas « je ne sais pas » mais « il ne restera
 * rien ». Initialisé à `null`, un aperçu en échec faisait annoncer un
 * effacement complet dès que la réponse du serveur devenait illisible.
 */
export async function previewAccountDeletion(fetchImpl: typeof fetch = fetch): Promise<PendingAccountDeletion> {
  let subject: ConfirmationSubject = RETENTION_UNKNOWN;
  let previewed: ConfirmationSubject = RETENTION_UNKNOWN;
  try {
    const preview = await fetchImpl("/api/profile/deletion", { cache: "no-store" });
    if (preview.ok) {
      previewed = ((await preview.json()) as AccountDeletionPlan).reason;
      subject = previewed;
    }
  } catch {
    // Injoignable : la phrase qui ne promet ni conservation ni effacement.
  }
  return { subject, previewed };
}

export type AccountDeletionResult = { ok: true; applied: ConfirmationSubject } | { ok: false; code: string };

/**
 * Supprime le compte connecté. Le corps d'un refus porte un **code**, pas une
 * phrase : la traduction vit dans le module de texte, et un code inconnu
 * retombe sur la phrase générique plutôt que de s'afficher tel quel.
 */
export async function requestAccountDeletion(
  previewed: ConfirmationSubject,
  fetchImpl: typeof fetch = fetch,
): Promise<AccountDeletionResult> {
  try {
    const response = await fetchImpl("/api/profile", { method: "DELETE" });
    const payload = (await response.json()) as { error?: string } & Partial<AccountDeletionPlan>;
    if (!response.ok) return { ok: false, code: payload.error || "ACCOUNT_DELETE_FAILED" };
    // `reason` vaut `null` sur un effacement complet : c'est une réponse, pas
    // une absence de réponse. Le `mode` sert donc de témoin — il dit que le
    // serveur a bien répondu, là où un `??` sur le motif retomberait sur
    // l'aperçu au moment précis où le serveur annonce qu'il n'a rien gardé.
    return { ok: true, applied: payload.mode ? payload.reason ?? null : previewed };
  } catch {
    return { ok: false, code: "ACCOUNT_DELETE_FAILED" };
  }
}

interface UseAccountDeletionOptions {
  /** Textes de `/profil` (`profile.deletion`) dans la langue de la page. */
  text: ProfileText;
  /** Joué quand la confirmation est annulée (rendre le focus au bouton). */
  onCancel?: () => void;
  /** `overBlocking` : la confirmation s'empile sur une fenêtre bloquante (conditions). */
  layer?: "default" | "overBlocking";
}

export interface AccountDeletionFlow {
  /** Aperçu en vol ou confirmation ouverte : le bouton est désarmé. */
  deleting: boolean;
  /** Confirmation ouverte. */
  confirming: boolean;
  /** Lance l'aperçu puis ouvre la confirmation (ignoré si déjà en cours). */
  start: () => Promise<void>;
  /** La confirmation, à rendre par l'écran (`null` fermée). */
  dialog: ReactNode;
}

export function useAccountDeletion({ text, onCancel, layer = "default" }: UseAccountDeletionOptions): AccountDeletionFlow {
  const { showError, showSuccess } = useToast();
  // Langue de l'adresse (le texte peut retomber sur le français) : après la suppression, l'accueil de cette langue.
  const pageLocale = useAppLocale();
  const [deleting, setDeleting] = useState(false);
  /** Aperçu reçu, modale de suppression ouverte. */
  const [pendingDeletion, setPendingDeletion] = useState<PendingAccountDeletion | null>(null);

  const start = async () => {
    // Le bouton se ferme **avant** l'aller-retour d'aperçu, et non après la
    // confirmation : un `await` posé devant la question rouvrirait la fenêtre
    // — deux clics, deux confirmations, deux `DELETE`, dont le second échoue
    // en 400 et affiche une erreur juste après le succès. Il ne se rouvre qu'à
    // l'annulation de la modale.
    if (deleting) return;
    setDeleting(true);
    setPendingDeletion(await previewAccountDeletion());
  };

  /** Joué par la modale : rend `false` sur un refus, qui la laisse ouverte. */
  const performAccountDeletion = async (previewed: ConfirmationSubject): Promise<boolean> => {
    const result = await requestAccountDeletion(previewed);
    if (!result.ok) {
      showError(deletionErrorText(text, result.code));
      return false;
    }
    showSuccess(deletionOutcomeText(text, result.applied));
    // La route a fermé la session : l'accueil, rechargé en entier, dans la
    // langue de la page (`/en` sous `/en/profil`), se lit sans compte.
    setTimeout(() => {
      window.location.href = localeHref("/", pageLocale);
    }, ACCOUNT_DELETED_REDIRECT_MS);
    return true;
  };

  const dialog = pendingDeletion ? (
    <ConfirmActionDialog
      title={text.t("deletion.question")}
      confirmLabel={text.t("deletion.confirm")}
      pendingLabel={text.t("deletion.pending")}
      closeOnSuccess={false}
      layer={layer}
      onClose={() => {
        setPendingDeletion(null);
        setDeleting(false);
        onCancel?.();
      }}
      onConfirm={() => performAccountDeletion(pendingDeletion.previewed)}
    >
      <p>{deletionConsequencesText(text, pendingDeletion.subject)}</p>
    </ConfirmActionDialog>
  ) : null;

  return { deleting, confirming: pendingDeletion !== null, start, dialog };
}
