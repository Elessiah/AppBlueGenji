"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CyberButton, ScrollArea } from "@/components/cyber";
import { useLocalePathname, useLocaleRouter } from "@/components/i18n/locale-navigation";
import { richNodes, useShellText } from "@/components/i18n/shell-text";
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
import { PRIVACY_CHANGES_ANSWERED_EVENT } from "@/lib/shared/privacy-changes";
import { TERMS_ACCEPTED_EVENT, TERMS_REQUIRED_EVENT } from "@/lib/shared/terms-of-use";
import { visibleText } from "@/lib/shared/visible-text";
import styles from "./DiscordCertifyPrompt.module.css";

/**
 * Groupes du tableau, dans l'ordre affiché (`shell.certifyPrompt.groups.*`) :
 * qui voit le tag, puis les autres effets (`shell.certifyPrompt.rows.*`).
 */
export const CERTIFY_PROMPT_GROUPS = [
  { group: "seen", rows: ["admins", "referees", "match", "players", "visitors"] },
  { group: "effects", rows: ["badge", "dms"] },
] as const;

/** Lignes du tableau, dans l'ordre affiché. */
export const CERTIFY_PROMPT_ROWS = CERTIFY_PROMPT_GROUPS.flatMap(({ rows }) => rows);

/** Refus de `POST /api/profile/discord` qui disent que l'état du tag a changé sous la fenêtre. */
const STATE_CHANGED = new Set(["DISCORD_TAG_CHANGED", "DISCORD_NOT_LINKED", "DISCORD_TAG_MISSING", "DISCORD_TAG_NOT_ATTESTED"]);

/**
 * Refus sans issue depuis la fenêtre — compte supprimé, session close ailleurs :
 * réessayer n'y changerait rien. La fenêtre se ferme, un toast dit pourquoi et
 * la page se relit. `null` : refus ordinaire, la fenêtre reste.
 */
function deadEndText(code: string): "certifyPrompt.accountDeleted" | "certifyPrompt.sessionEnded" | null {
  if (code === ACCOUNT_DELETED_ERROR || code === "PROFILE_NOT_FOUND") return "certifyPrompt.accountDeleted";
  if (code === "UNAUTHORIZED") return "certifyPrompt.sessionEnded";
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

async function answerPrompt(action: CertifyPromptAction): Promise<void> {
  const response = await fetch("/api/profile/discord/certify-prompt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
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
export function DiscordCertifyPrompt({ prompt, privacyPending, termsPending }: Readonly<DiscordCertifyPromptProps>) {
  const { t, rich } = useShellText();
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
  // Une nouvelle proposition (rafraîchissement après une connexion par code) rouvre la fenêtre.
  useEffect(() => setClosed(false), [prompt?.mode]);
  useEffect(() => setPrivacyAnswered(!privacyPending), [privacyPending]);
  useEffect(() => setTermsAccepted(!termsPending), [termsPending]);
  useEffect(() => {
    const onPrivacy = () => setPrivacyAnswered(true);
    const onTermsAccepted = () => setTermsAccepted(true);
    const onTermsRequired = () => setTermsAccepted(false);
    window.addEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onPrivacy);
    window.addEventListener(TERMS_ACCEPTED_EVENT, onTermsAccepted);
    window.addEventListener(TERMS_REQUIRED_EVENT, onTermsRequired);
    return () => {
      window.removeEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onPrivacy);
      window.removeEventListener(TERMS_ACCEPTED_EVENT, onTermsAccepted);
      window.removeEventListener(TERMS_REQUIRED_EVENT, onTermsRequired);
    };
  }, []);

  const open =
    mounted &&
    !closed &&
    certifyPromptOpen({
      due: prompt !== null,
      privacyPending: !privacyAnswered,
      termsPending: !termsAccepted,
      pathname,
    });

  /** « Plus tard » : fermée tout de suite ; un échec d'écriture la fera seulement revenir au prochain chargement. */
  const postpone = () => {
    if (inFlight.current) return;
    setClosed(true);
    answerPrompt("LATER").catch(() => undefined);
  };

  const dialogRef = useDialogBehavior({ open, onClose: postpone, locked: busy !== null });
  const backdrop = useBackdropDismiss(postpone, busy !== null);

  if (!open || !prompt) return null;

  const neverShow = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("never");
    try {
      await answerPrompt("NEVER");
      setClosed(true);
      showSuccess(t("certifyPrompt.neverSaved"));
    } catch (error) {
      const deadEnd = deadEndText((error as Error).message);
      if (deadEnd) {
        setClosed(true);
        showError(t(deadEnd));
        router.refresh();
      } else {
        showError(t("certifyPrompt.neverFailed"));
      }
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
      setClosed(true);
      answerPrompt("LATER").catch(() => undefined);
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
      // La proposition est close pour la session : une sauvegarde de tag plus
      // tard (non certifié) ne la ferait pas revenir au rafraîchissement.
      setClosed(true);
      answerPrompt("LATER").catch(() => undefined);
      showSuccess(t("certifyPrompt.certified"));
      window.dispatchEvent(new Event(DISCORD_CERTIFIED_EVENT));
      router.refresh();
    } catch (error) {
      const code = (error as Error).message;
      const deadEnd = deadEndText(code);
      if (deadEnd) {
        setClosed(true);
        showError(t(deadEnd));
        router.refresh();
      } else if (STATE_CHANGED.has(code)) {
        // Le tag montré n'est plus le bon : la fenêtre n'a plus rien à offrir.
        setClosed(true);
        answerPrompt("LATER").catch(() => undefined);
        showError(t("certifyPrompt.certifyChanged"));
      } else {
        showError(t("certifyPrompt.certifyFailed"));
      }
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

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
        className={styles.modal}
      >
        <span className="eyebrow">{t("certifyPrompt.eyebrow")}</span>
        <h2 id={titleId} className={styles.title}>
          {t("certifyPrompt.title")}
        </h2>
        <ScrollArea orientation="y" className={styles.body} ariaLabel={t("certifyPrompt.bodyLabel")}>
          <p id={`${titleId}-intro`} className={styles.text}>
            {t("certifyPrompt.intro")}
          </p>
          {prompt.mode === "ONE_CLICK" && (
            <p className={styles.text}>{richNodes(rich("certifyPrompt.tag", { tag: visibleText(prompt.tag) }, strong))}</p>
          )}
          <table className={styles.table}>
            <caption className={styles.caption}>{t("certifyPrompt.tableCaption")}</caption>
            <thead>
              <tr>
                <td />
                <th scope="col">{t("certifyPrompt.colWithout")}</th>
                <th scope="col">{t("certifyPrompt.colWith")}</th>
              </tr>
            </thead>
            {CERTIFY_PROMPT_GROUPS.map(({ group, rows }) => (
              <tbody key={group}>
                <tr>
                  <th scope="rowgroup" colSpan={3} className={styles.group}>
                    {t(`certifyPrompt.groups.${group}`)}
                  </th>
                </tr>
                {rows.map((row) => (
                  <tr key={row}>
                    <th scope="row">{t(`certifyPrompt.rows.${row}.label`)}</th>
                    <td>{t(`certifyPrompt.rows.${row}.without`)}</td>
                    <td className={styles.with}>{t(`certifyPrompt.rows.${row}.with`)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          <p className={styles.note}>{t("certifyPrompt.undo")}</p>
          <p className={styles.note}>{t("certifyPrompt.later")}</p>
        </ScrollArea>
        <div className={styles.actions}>
          <CyberButton
            variant="ghost"
            type="button"
            aria-disabled={busy !== null || undefined}
            aria-busy={busy === "never" || undefined}
            onClick={() => void neverShow()}
          >
            {busy === "never" ? t("certifyPrompt.neverSaving") : t("certifyPrompt.never")}
          </CyberButton>
          {/* Focus d'ouverture sur le geste sans effet : Entrée ne certifie ni ne ferme pour de bon. */}
          <CyberButton variant="ghost" type="button" aria-disabled={busy !== null || undefined} onClick={postpone} data-autofocus>
            {t("certifyPrompt.postpone")}
          </CyberButton>
          <CyberButton
            variant="primary"
            type="button"
            aria-disabled={busy !== null || undefined}
            aria-busy={busy === "certify" || undefined}
            onClick={() => void certify()}
          >
            {busy === "certify" ? (
              t("certifyPrompt.certifying")
            ) : (
              <>
                {t("certifyPrompt.certify")}
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
