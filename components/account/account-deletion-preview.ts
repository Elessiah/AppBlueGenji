import { RETENTION_UNKNOWN, type AccountDeletionPlan, type ConfirmationSubject } from "@/lib/shared/account-deletion";

/**
 * L'aperçu de la suppression du compte (`GET /api/profile/deletion`), seul dans
 * son module : la fenêtre des conditions (mise en page racine, chaque page) le
 * lance **au clic**, en même temps que le chargement du code de la suppression
 * (`TermsAccountDeletion`), au lieu de l'attendre — sans embarquer ce code.
 * Réexporté par `use-account-deletion.tsx`.
 */

/** Ce que la modale annonce (`subject`) et ce que l'aperçu a répondu (`previewed`). */
export interface PendingAccountDeletion {
  subject: ConfirmationSubject;
  previewed: ConfirmationSubject;
}

/** Au-delà, l'aperçu est abandonné : la confirmation s'ouvre sans lui. */
export const ACCOUNT_DELETION_PREVIEW_TIMEOUT_MS = 8000;

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
  // Borné : un aperçu qui ne répond jamais (réseau mobile instable) laissait
  // la fenêtre bloquante des conditions sans aucune issue — tous ses gestes
  // désarmés le temps de la préparation. Passé le délai, la requête est
  // **coupée** et la confirmation s'ouvre sur la phrase de l'incertitude.
  // `AbortController` + minuterie plutôt que `AbortSignal.timeout`, absent
  // avant Safari 16 : là, chaque essai abandonné laissait une requête ouverte,
  // et quelques essais épuisaient les connexions HTTP/1.1 du site (flux compris).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCOUNT_DELETION_PREVIEW_TIMEOUT_MS);
  try {
    const preview = await fetchImpl("/api/profile/deletion", { cache: "no-store", signal: controller.signal });
    if (preview.ok) {
      previewed = ((await preview.json()) as AccountDeletionPlan).reason;
      subject = previewed;
    }
  } catch {
    // Injoignable ou coupé : la phrase qui ne promet ni conservation ni effacement.
  } finally {
    clearTimeout(timer);
  }
  return { subject, previewed };
}
