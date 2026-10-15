"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { CyberButton } from "@/components/cyber/CyberButton";
import { useToast } from "@/components/ui/toast";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { DISCORD_VERIFICATION_FIELD_ERRORS } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { formatExpiryTime } from "@/lib/shared/dates";
import { richNodes } from "@/components/i18n/shell-text";
import { useProfileText } from "@/components/i18n/profile-text";
import { DiscordInviteLink } from "./_components/DiscordInviteLink";
import { discordHandleUpdateErrorMessage } from "./discord-errors";
import { ScrollArea } from "@/components/cyber";

const FIELD_IDS = {
  handle: "discord-bot-handle",
  code: "discord-bot-code",
} as const;

/**
 * « Mettre à jour mon pseudo » par le bot Discord, en deux étapes.
 *
 * Le bot ne renvoie jamais le tag d'un compte : le joueur **saisit** son pseudo,
 * le bot lui envoie un code en message privé, et le code prouve que le pseudo
 * est le sien. Le pseudo enregistré est celui que le serveur a retenu sur le
 * défi — la réponse de `PUT` le rend, c'est lui que la page affiche.
 *
 * Le geste ne **certifie** pas : un pseudo changé perd sa certification, qui se
 * redonne ensuite d'un clic (« Certifier mon tag »). La phrase le dit avant le
 * premier envoi.
 */
export function DiscordBotHandleDialog({
  mode,
  onClose,
  onUpdated,
}: Readonly<{
  /** `UPDATE` : compte déjà rattaché ; `LINK` : rattacher Discord par code. */
  mode: "UPDATE" | "LINK";
  onClose: () => void;
  onUpdated: (tag: string) => void;
}>) {
  const { showError, showSuccess } = useToast();
  const text = useProfileText();
  const { t } = text;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [handle, setHandle] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const fieldErrors = useFieldErrors(
    DISCORD_VERIFICATION_FIELD_ERRORS,
    FIELD_IDS,
  );

  const refuse = (e: unknown) => {
    const reason = (e as Error).message;
    const message = discordHandleUpdateErrorMessage(reason, text);
    showError(message);
    fieldErrors.report(reason, message);
  };

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    // Bouton en `aria-disabled` pendant l'envoi (le focus reste dans la modale) : la garde est ici,
    // par une référence lue sans attendre de rendu — Entrée puis clic dans le même instant
    // enverraient sinon deux demandes (un essai du code brûlé ; revue de sécurité du lot 9-2).
    if (inFlight.current) return;
    inFlight.current = true;
    fieldErrors.clear();
    setLoading(true);
    try {
      const response = await fetch("/api/profile/discord/handle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const payload = (await response.json()) as {
        error?: string;
        challenge?: string;
        expiresAt?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "");
      setChallenge(payload.challenge ?? "");
      showSuccess(
        t("botHandle.codeSent", {
          time: formatExpiryTime(payload.expiresAt, text.locale),
        }),
      );
    } catch (e) {
      refuse(e);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const confirmCode = async (event: FormEvent) => {
    event.preventDefault();
    // Bouton en `aria-disabled` pendant l'envoi (le focus reste dans la modale) : la garde est ici,
    // par une référence lue sans attendre de rendu — Entrée puis clic dans le même instant
    // enverraient sinon deux demandes (un essai du code brûlé ; revue de sécurité du lot 9-2).
    if (inFlight.current) return;
    inFlight.current = true;
    fieldErrors.clear();
    setLoading(true);
    try {
      const response = await fetch("/api/profile/discord/handle", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge, code }),
      });
      const payload = (await response.json()) as {
        error?: string;
        tag?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "");
      showSuccess(
        mode === "LINK" ? t("botHandle.linked") : t("botHandle.updated"),
      );
      onUpdated(payload.tag ?? "");
    } catch (e) {
      // Trois refus du code ne se lèvent pas en retapant : le compte a changé de
      // Discord entre la demande et la confirmation, ce Discord est rattaché à
      // un autre compte (dit ici et non à la demande, qui ne doit rien révéler
      // d'un tiers), ou le défi n'avait aucun pseudo. Ils désignent le
      // **pseudo** — on revient donc à sa saisie avant de les dire, sans quoi le
      // champ marqué ne serait pas à l'écran.

      const reason = (e as Error).message;
      if (
        reason === "DISCORD_ID_MISMATCH" ||
        reason === "DISCORD_ALREADY_LINKED" ||
        reason === "INVALID_DISCORD_HANDLE"
      )
        restart();
      refuse(e);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const awaitingCode = challenge !== "";
  // Changer d'étape démonte le bouton activé : le focus suit le champ suivant.
  const previousStep = useRef(awaitingCode);
  useEffect(() => {
    if (previousStep.current === awaitingCode) return;
    previousStep.current = awaitingCode;
    document
      .getElementById(awaitingCode ? FIELD_IDS.code : FIELD_IDS.handle)
      ?.focus();
  }, [awaitingCode]);

  const restart = () => {
    setChallenge("");
    setCode("");
    fieldErrors.clear();
  };

  const dialogRef = useDialogBehavior({
    open: mounted,
    onClose,
    locked: loading,
  });
  const backdrop = useBackdropDismiss(onClose, loading);
  // Les boutons, sans `disabled` : le focus n'en tombe pas hors de la modale
  // pendant l'envoi (`aria-disabled`, clic ignoré).
  const cancel = () => {
    if (!loading) onClose();
  };
  if (!mounted) return null;

  const title = mode === "LINK" ? t("botHandle.titleLink") : t("botHandle.titleUpdate");

  return createPortal(
    <div /* NOSONAR S6819 — voile de modale, sans équivalent natif */
      role="presentation"
      {...backdrop}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(4, 8, 14, 0.78)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div /* NOSONAR S6819 — modale portée dans body (useDialogBehavior) : `<dialog>` changerait couche, Échap et ::backdrop */
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="discord-bot-title"
        aria-describedby="discord-bot-intro"
        tabIndex={-1}
        style={{
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 32px)",
          display: "flex",
          flexDirection: "column",
          background: "var(--cyber-bg-1)",
          border: "1px solid var(--line-strong-cy)",
          borderRadius: "var(--r-cy-lg)",
        }}
      >
        {/* Zone défilante nommée (CLAUDE.md) : le corps défile, pas la boîte. */}
        <ScrollArea orientation="y" ariaLabel={t("botHandle.bodyLabel")} style={{ padding: 28, minHeight: 0 }}>
        <span className="eyebrow">{t("botHandle.eyebrow")}</span>
        <h2
          id="discord-bot-title"
          className="display"
          style={{ fontSize: 22, margin: "12px 0 8px" }}
        >
          {title}
        </h2>
        <p
          id="discord-bot-intro"
          style={{
            color: "var(--ink-mute)",
            fontSize: 13.5,
            lineHeight: 1.7,
            margin: "0 0 16px",
          }}
        >
          {t("botHandle.intro")} {mode === "UPDATE" ? `${t("botHandle.introUpdate")} ` : ""}
          {t("botHandle.introOutro")} {t("botHandle.matchDms")}
        </p>

        {!awaitingCode ? (
          <form
            onSubmit={requestCode}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div className="field">
              <label htmlFor={FIELD_IDS.handle}>{t("botHandle.handle")}</label>
              <input
                id={FIELD_IDS.handle}
                value={handle}
                onChange={(e) => {
                  setHandle(e.target.value);
                  fieldErrors.clear("handle");
                }}
                placeholder={t("botHandle.handlePlaceholder")}
                autoComplete="off"
                required
                {...fieldErrors.aria("handle", "discord-bot-handle-help")}
              />
              <FieldErrorText
                fieldId={FIELD_IDS.handle}
                message={fieldErrors.message("handle")}
              />
              <p
                id="discord-bot-handle-help"
                style={{
                  fontSize: 12,
                  color: "var(--ink-mute)",
                  margin: "6px 0 0",
                  lineHeight: 1.6,
                }}
              >
                {richNodes(
                  text.rich("botHandle.handleHelp", {}, {
                    join: (chunks) => <DiscordInviteLink>{richNodes(chunks)}</DiscordInviteLink>,
                  }),
                )}
              </p>
            </div>
            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}
            >
              {/* Fermé pendant un envoi : fermer perdrait l'identifiant du code
                  déjà parti, et en redemander un consomme le quota. */}
              <CyberButton variant="ghost" type="button" aria-disabled={loading || undefined} onClick={cancel}>
                {t("botHandle.cancel")}
              </CyberButton>
              <CyberButton variant="primary" type="submit" aria-disabled={loading || undefined} aria-busy={loading || undefined}>
                {loading ? t("botHandle.sending") : t("botHandle.requestCode")}
              </CyberButton>
            </div>
          </form>
        ) : (
          <form
            onSubmit={confirmCode}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div className="field">
              <label htmlFor={FIELD_IDS.code}>{t("botHandle.code")}</label>
              <input
                id={FIELD_IDS.code}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  fieldErrors.clear("code");
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                placeholder={t("botHandle.codePlaceholder")}
                required
                {...fieldErrors.aria("code", "discord-bot-code-help")}
              />
              <FieldErrorText
                fieldId={FIELD_IDS.code}
                message={fieldErrors.message("code")}
              />
              <p
                id="discord-bot-code-help"
                style={{
                  fontSize: 12,
                  color: "var(--ink-mute)",
                  margin: "6px 0 0",
                }}
              >
                {t("botHandle.codeHelp")}
              </p>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "flex-end",
                gap: 10,
              }}
            >
              {/* Fermé pendant un envoi : fermer perdrait l'identifiant du code
                  déjà parti, et en redemander un consomme le quota. */}
              <CyberButton variant="ghost" type="button" aria-disabled={loading || undefined} onClick={cancel}>
                {t("botHandle.cancel")}
              </CyberButton>
              <CyberButton
                variant="ghost"
                type="button"
                aria-disabled={loading || undefined}
                onClick={() => !loading && restart()}
              >
                {t("botHandle.newCode")}
              </CyberButton>
              <CyberButton variant="primary" type="submit" aria-disabled={loading || undefined} aria-busy={loading || undefined}>
                {loading ? t("botHandle.checking") : t("botHandle.validate")}
              </CyberButton>
            </div>
          </form>
        )}
      </ScrollArea>
      </div>
    </div>,
    document.body,
  );
}
