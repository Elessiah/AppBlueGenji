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
import type { AccountDeletionPlan, ConfirmationSubject } from "@/lib/shared/account-deletion";
import { previewAccountDeletion, type PendingAccountDeletion } from "./account-deletion-preview";
import { localeHref } from "@/lib/shared/locales";

/**
 * La suppression du compte connecté, **une seule** pour les deux écrans qui
 * l'offrent : « Mon profil » et la fenêtre bloquante des conditions
 * d'utilisation (qui refuse les conditions doit pouvoir se retirer d'ici,
 * sans les accepter d'abord). Même aperçu (`GET /api/profile/deletion`), même
 * confirmation (`ConfirmActionDialog`), même route (`DELETE /api/profile`,
 * qui ferme la session), même issue (toast puis accueil, rechargé).
 */

export {
  ACCOUNT_DELETION_PREVIEW_TIMEOUT_MS,
  previewAccountDeletion,
  type PendingAccountDeletion,
} from "./account-deletion-preview";

/** Délai entre le toast de réussite et le retour à l'accueil (le temps de le lire). */
export const ACCOUNT_DELETED_REDIRECT_MS = 1200;

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
  let response: Response;
  try {
    response = await fetchImpl("/api/profile", { method: "DELETE" });
  } catch {
    return { ok: false, code: "ACCOUNT_DELETE_FAILED" };
  }
  let payload: { error?: string; deleted?: boolean } & Partial<AccountDeletionPlan> = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    // Corps illisible : rien ne confirme la suppression (ci-dessous).
  }
  if (!response.ok) return { ok: false, code: payload.error || "ACCOUNT_DELETE_FAILED" };
  // Seule la réponse de la route fait foi (`deleted: true`) : un 200 qui n'est
  // pas le sien (portail captif, proxy) annoncerait une suppression qui n'a pas
  // eu lieu. Une réponse perdue après coup se rattrape à l'essai suivant, que
  // la session fermée refuse (`SESSION_GONE_CODES`).
  if (payload.deleted !== true) return { ok: false, code: "ACCOUNT_DELETE_FAILED" };
  // `reason` vaut `null` sur un effacement complet : c'est une réponse, pas
  // une absence de réponse. Le `mode` sert donc de témoin — il dit que le
  // serveur a bien répondu, là où un `??` sur le motif retomberait sur
  // l'aperçu au moment précis où le serveur annonce qu'il n'a rien gardé.
  return { ok: true, applied: payload.mode ? payload.reason ?? null : previewed };
}

/**
 * Refus qui disent que la session ou le compte n'est plus là — typiquement un
 * nouvel essai après une suppression faite dont la réponse s'est perdue (la
 * route a fermé la session). Réessayer n'y changerait rien : la page se
 * recharge, sans session, au lieu de redire « échec » sous la fenêtre des conditions.
 */
export const SESSION_GONE_CODES: ReadonlySet<string> = new Set(["UNAUTHORIZED", "USER_NOT_FOUND"]);

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
  /**
   * Lance l'aperçu puis ouvre la confirmation (ignoré si déjà en cours).
   * `preview` : un aperçu déjà parti (la fenêtre des conditions le lance au
   * clic, en même temps que le chargement de ce code) — sinon il part ici.
   */
  start: (preview?: Promise<PendingAccountDeletion>) => Promise<void>;
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

  // Textes retombés sur le français sous `/en` (espace `profile` anglais
  // injoignable) : la modale et ses toasts le disent (`lang="fr"`), sa coquille reste française.
  const contentLang = text.locale === "fr" && pageLocale !== "fr" ? "fr" : undefined;

  const start = async (preview?: Promise<PendingAccountDeletion>) => {
    // Le bouton se ferme **avant** l'aller-retour d'aperçu, et non après la
    // confirmation : un `await` posé devant la question rouvrirait la fenêtre
    // — deux clics, deux confirmations, deux `DELETE`, dont le second échoue
    // en 400 et affiche une erreur juste après le succès. Il ne se rouvre qu'à
    // l'annulation de la modale.
    if (deleting) return;
    setDeleting(true);
    setPendingDeletion(await (preview ?? previewAccountDeletion()));
  };

  /** Joué par la modale : rend `false` sur un refus, qui la laisse ouverte. */
  const performAccountDeletion = async (previewed: ConfirmationSubject): Promise<boolean> => {
    const result = await requestAccountDeletion(previewed);
    if (!result.ok && !SESSION_GONE_CODES.has(result.code)) {
      showError(deletionErrorText(text, result.code), { lang: contentLang });
      return false;
    }
    if (result.ok) showSuccess(deletionOutcomeText(text, result.applied), { lang: contentLang });
    else showError(deletionErrorText(text, result.code), { lang: contentLang });
    // La session est fermée (par cette suppression, ou avant elle) : l'accueil,
    // rechargé en entier, dans la langue de la page (`/en` sous `/en/profil`),
    // se lit sans compte. La confirmation reste « en cours » jusque-là.
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
      contentLang={contentLang}
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
