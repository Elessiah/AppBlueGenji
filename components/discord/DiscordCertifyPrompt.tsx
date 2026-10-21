"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CyberButton, ScrollArea } from "@/components/cyber";
import { useLocalePathname, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { richNodes } from "@/components/i18n/shell-text";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import {
  CERTIFY_DIALOG_EVENT,
  CERTIFY_PROFILE_HREF,
  DISCORD_CERTIFIED_EVENT,
  type CertifyPrompt,
  type CertifyPromptAction,
} from "@/lib/shared/discord-certify-prompt";
import { certifyPromptOpen } from "@/lib/shared/global-modals";
import { ACCOUNT_DELETED_ERROR } from "@/lib/shared/account-deletion";
import { PRIVACY_CHANGES_ANSWERED_EVENT, privacyFollowedLink } from "@/lib/shared/privacy-changes";
import { TERMS_ACCEPTED_EVENT, TERMS_REQUIRED_EVENT } from "@/lib/shared/terms-of-use";
import { visibleText } from "@/lib/shared/visible-text";
import type { CertifyPromptText } from "./certify-prompt-text";
import styles from "./DiscordCertifyPrompt.module.css";

/**
 * Groupes du tableau, dans l'ordre affiché (`certifyPrompt.groups.*`) :
 * qui voit le tag, puis les autres effets (`certifyPrompt.rows.*`).
 */
export const CERTIFY_PROMPT_GROUPS = [
  { group: "seen", rows: ["admins", "referees", "match", "players", "visitors"] },
  { group: "effects", rows: ["badge", "dms"] },
] as const;

/** Refus de `POST /api/profile/discord` qui disent que l'état du tag a changé sous la fenêtre. */
const STATE_CHANGED = new Set(["DISCORD_TAG_CHANGED", "DISCORD_NOT_LINKED", "DISCORD_TAG_MISSING", "DISCORD_TAG_NOT_ATTESTED"]);

/**
 * Refus sans issue depuis la fenêtre — compte supprimé, session close ailleurs :
 * réessayer n'y changerait rien. La fenêtre se ferme, un toast dit pourquoi et
 * la page se relit. `null` : refus ordinaire, la fenêtre reste.
 */
function deadEndText(code: string): "accountDeleted" | "sessionEnded" | null {
  if (code === ACCOUNT_DELETED_ERROR || code === "PROFILE_NOT_FOUND") return "accountDeleted";
  if (code === "UNAUTHORIZED") return "sessionEnded";
  return null;
}

export type DiscordCertifyPromptProps = {
  /** Parcours offert, décidé par la mise en page racine ; `null` : rien à proposer. */
  prompt: CertifyPrompt | null;
  /** Une modale de confidentialité attend une réponse : celle-ci passe après. */
  privacyPending: boolean;
  /** Les conditions d'utilisation attendent une acceptation : celle-ci passe après. */
  termsPending: boolean;
};

/**
 * Props de la fenêtre elle-même : ses textes (espace `certifyPrompt`) lui sont
 * donnés par `DiscordCertifyPromptLazy`, dans la seule langue de la page.
 */
export type DiscordCertifyPromptViewProps = DiscordCertifyPromptProps & { text: CertifyPromptText };

async function answerPrompt(action: CertifyPromptAction): Promise<void> {
  const response = await fetch("/api/profile/discord/certify-prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
    // « Plus tard » puis un lien qui charge un nouveau document (changement de
    // langue, passage par Discord) : sans `keepalive`, ce départ l'annulerait.
    keepalive: true,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
}

/**
 * « Certifier ton tag Discord ? », proposé une fois par connexion Discord ou
 * Blizzard (`docs/features/DISCORD_CERTIFY_PROMPT.md`).
 *
 * Une **proposition**, jamais un passage obligé : rien n'est précoché, « Plus
 * tard » (bouton, Échap, clic sur le voile) la ferme pour la session, « Ne plus
 * voir » pour le compte. Le bouton principal certifie d'un clic quand Discord a
 * nommé le tag (`ONE_CLICK`, route existante), et mène sinon au dialogue de
 * certification de `/profil` (`DIALOG`), qui garde seul le code et le passage
 * par Discord. Elle attend la confidentialité et les conditions.
 */
export function DiscordCertifyPrompt({ prompt, privacyPending, termsPending, text }: Readonly<DiscordCertifyPromptViewProps>) {
  const { t, rich } = text;
  const { showError, showSuccess } = useToast();
  const router = useLocaleRouter();
  const { path: pathname } = useLocalePathname();
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  const [closed, setClosed] = useState(false);
  const [privacyAnswered, setPrivacyAnswered] = useState(!privacyPending);
  const [termsAccepted, setTermsAccepted] = useState(!termsPending);
  const [busy, setBusy] = useState<"certify" | "never" | null>(null);
  const inFlight = useRef(false);

  useEffect(() => setMounted(true), []);
  // Une proposition qui **apparaît** (rafraîchissement après une connexion par
  // code) rouvre la fenêtre ; un simple changement de parcours (tag modifié sur
  // `/profil`) ne rouvre pas une fenêtre déjà écartée.
  const due = prompt !== null;
  /** Déjà répondue sur ce chargement (« Plus tard », dialogue, « Ne plus voir ») : rien à réécrire. */
  const answered = useRef(false);
  useEffect(() => {
    if (!due) return;
    setClosed(false);
    answered.current = false;
  }, [due]);
  const dueRef = useRef(due);
  dueRef.current = due;

  /**
   * Close pour la session (`LATER`, avec `keepalive`) : fermée tout de suite ;
   * un échec d'écriture la fera seulement revenir au prochain chargement.
   */
  const closeForSession = useCallback(() => {
    setClosed(true);
    answered.current = true;
    answerPrompt("LATER").catch(() => undefined);
  }, []);
  useEffect(() => setPrivacyAnswered(!privacyPending), [privacyPending]);
  useEffect(() => setTermsAccepted(!termsPending), [termsPending]);
  useEffect(() => {
    const onPrivacy = (event: Event) => {
      setPrivacyAnswered(true);
      // Un lien d'action de la modale de confidentialité envoie agir ailleurs
      // (`/profil#confidentialite`…) : ne pas couvrir cet écran. Rien n'est
      // écrit, la proposition revient au prochain chargement.
      if (privacyFollowedLink(event)) setClosed(true);
    };
    const onTermsAccepted = () => setTermsAccepted(true);
    const onTermsRequired = () => setTermsAccepted(false);
    // Certifié — ici d'un clic, ou par le dialogue de `/profil` : close pour
    // la session, qu'un tag changé ensuite ne la fasse pas revenir.
    const onCertified = () => {
      if (dueRef.current && !answered.current) closeForSession();
    };
    window.addEventListener(DISCORD_CERTIFIED_EVENT, onCertified);
    window.addEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onPrivacy);
    window.addEventListener(TERMS_ACCEPTED_EVENT, onTermsAccepted);
    window.addEventListener(TERMS_REQUIRED_EVENT, onTermsRequired);
    return () => {
      window.removeEventListener(DISCORD_CERTIFIED_EVENT, onCertified);
      window.removeEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onPrivacy);
      window.removeEventListener(TERMS_ACCEPTED_EVENT, onTermsAccepted);
      window.removeEventListener(TERMS_REQUIRED_EVENT, onTermsRequired);
    };
  }, [closeForSession]);

  const open =
    mounted &&
    !closed &&
    certifyPromptOpen({
      due: prompt !== null,
      privacyPending: !privacyAnswered,
      termsPending: !termsAccepted,
      pathname,
    });

  /** « Plus tard », Échap, voile. */
  const postpone = () => {
    if (inFlight.current) return;
    closeForSession();
  };

  // Focus d'ouverture sur la fenêtre elle-même : son nom (le titre) est
  // annoncé, Entrée n'y certifie ni ne ferme rien, et à fort zoom, quand la
  // fenêtre défile en entier, elle s'ouvre en haut — titre en vue.
  const dialogRef = useDialogBehavior({ open, onClose: postpone, locked: busy !== null, initialFocus: "container" });
  const backdrop = useBackdropDismiss(postpone, busy !== null);

  if (!open || !prompt) return null;

  /** Refus sans issue (compte supprimé, session close) : fermée, toast, page relue. `false` sinon. */
  const closeOnDeadEnd = (code: string): boolean => {
    const deadEnd = deadEndText(code);
    if (!deadEnd) return false;
    setClosed(true);
    showError(t(deadEnd));
    router.refresh();
    return true;
  };

  const neverShow = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("never");
    try {
      await answerPrompt("NEVER");
      answered.current = true;
      setClosed(true);
      showSuccess(t("neverSaved"));
    } catch (error) {
      if (!closeOnDeadEnd((error as Error).message)) showError(t("neverFailed"));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const certify = async () => {
    if (inFlight.current) return;
    if (prompt.mode === "DIALOG") {
      // Le dialogue de `/profil` fait la suite (code ou passage par Discord) :
      // la proposition est close pour la session, rien n'est certifié ici.
      closeForSession();
      if (pathname === "/profil") window.dispatchEvent(new Event(CERTIFY_DIALOG_EVENT));
      else router.push(CERTIFY_PROFILE_HREF);
      return;
    }
    inFlight.current = true;
    setBusy("certify");
    try {
      const response = await fetch("/api/profile/discord", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: prompt.tag, linkedOnly: true }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!response.ok) throw new Error(payload.error ?? "");
      // Un 2xx sans `VERIFIED` (code envoyé en message privé) : le tag n'est
      // plus celui que Discord a nommé, la suite se fait depuis « Mon profil ».
      if (payload.status !== "VERIFIED") throw new Error("DISCORD_TAG_CHANGED");
      showSuccess(t("certified"));
      // L'événement close la proposition pour la session (`onCertified`) et
      // fait relire son état Discord à un `/profil` ouvert.
      window.dispatchEvent(new Event(DISCORD_CERTIFIED_EVENT));
      router.refresh();
    } catch (error) {
      const code = (error as Error).message;
      if (closeOnDeadEnd(code)) return;
      if (STATE_CHANGED.has(code)) {
        // Le tag montré n'est plus le bon : la fenêtre n'a plus rien à offrir.
        closeForSession();
        showError(t("certifyChanged"));
      } else {
        showError(t("certifyFailed"));
      }
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  // Aucun tag enregistré : la fenêtre propose de l'ajouter, pas de « certifier » un tag absent.
  const noTag = prompt.mode === "DIALOG" && !prompt.hasTag;
  const strong = { strong: (chunks: readonly ReactNode[]) => <strong>{richNodes(chunks)}</strong> };

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */ className={styles.overlay} role="presentation" {...backdrop}>
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-intro`}
        tabIndex={-1}
        className={`${styles.modal} dialog-bounded`}
      >
        <span className="eyebrow">{t("eyebrow")}</span>
        <h2 id={titleId} className={styles.title}>
          {t(noTag ? "titleNoTag" : "title")}
        </h2>
        <ScrollArea orientation="y" className={styles.body} ariaLabel={t("bodyLabel")}>
          <p id={`${titleId}-intro`} className={styles.text}>
            {t(noTag ? "introNoTag" : "intro")}
          </p>
          {prompt.mode === "ONE_CLICK" && (
            <p className={styles.text}>{richNodes(rich("tag", { tag: visibleText(prompt.tag) }, strong))}</p>
          )}
          <table className={styles.table}>
            <caption className={styles.caption}>{t("tableCaption")}</caption>
            <thead>
              <tr>
                <td />
                <th scope="col">{t("colWithout")}</th>
                <th scope="col">{t("colWith")}</th>
              </tr>
            </thead>
            {CERTIFY_PROMPT_GROUPS.map(({ group, rows }) => (
              <tbody key={group}>
                <tr>
                  <th scope="rowgroup" colSpan={3} className={styles.group}>
                    {t(`groups.${group}`)}
                  </th>
                </tr>
                {rows.map((row) => (
                  <tr key={row}>
                    <th scope="row">{t(`rows.${row}.label`)}</th>
                    <td>{t(`rows.${row}.without`)}</td>
                    <td className={styles.with}>{t(`rows.${row}.with`)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          <p className={styles.note}>{t("undo")}</p>
          <p className={styles.note}>{t("later")}</p>
        </ScrollArea>
        <div className={styles.actions}>
          <CyberButton
            variant="ghost"
            type="button"
            aria-disabled={busy !== null || undefined}
            aria-busy={busy === "never" || undefined}
            onClick={() => void neverShow()}
          >
            {busy === "never" ? t("neverSaving") : t("never")}
          </CyberButton>
          <CyberButton variant="ghost" type="button" aria-disabled={busy !== null || undefined} onClick={postpone}>
            {t("postpone")}
          </CyberButton>
          <CyberButton
            variant="primary"
            type="button"
            aria-disabled={busy !== null || undefined}
            aria-busy={busy === "certify" || undefined}
            onClick={() => void certify()}
          >
            {busy === "certify" ? (
              t("certifying")
            ) : (
              <>
                {t(noTag ? "addTag" : "certify")}
                {prompt.mode === "DIALOG" && <span aria-hidden="true"> →</span>}
              </>
            )}
          </CyberButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
