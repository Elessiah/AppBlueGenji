"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useBackdropDismiss } from "@/lib/shared/hooks/useBackdropDismiss";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { CyberButton } from "@/components/cyber/CyberButton";
import { useToast } from "@/components/ui/toast";
import { FieldErrorText } from "@/components/ui/field-error-text";
import { DISCORD_VERIFICATION_FIELD_ERRORS } from "@/lib/shared/field-errors";
import { useFieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import { discordHandleUpdateErrorMessage } from "./discord-errors";

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
}: {
  /** `UPDATE` : compte déjà rattaché ; `LINK` : rattacher Discord par code. */
  mode: "UPDATE" | "LINK";
  onClose: () => void;
  onUpdated: (tag: string) => void;
}) {
  const { showError, showSuccess } = useToast();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [handle, setHandle] = useState("");
  const [discordId, setDiscordId] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const fieldErrors = useFieldErrors(
    DISCORD_VERIFICATION_FIELD_ERRORS,
    FIELD_IDS,
  );

  const refuse = (e: unknown) => {
    const reason = (e as Error).message;
    const message = discordHandleUpdateErrorMessage(reason);
    showError(message);
    fieldErrors.report(reason, message);
  };

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
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
        discordId?: string;
        expiresAt?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "");
      setDiscordId(payload.discordId ?? "");
      showSuccess(
        `Code envoyé en message privé Discord (expiration : ${new Date(
          payload.expiresAt ?? "",
        ).toLocaleTimeString()}).`,
      );
    } catch (e) {
      refuse(e);
    } finally {
      setLoading(false);
    }
  };

  const confirmCode = async (event: FormEvent) => {
    event.preventDefault();
    fieldErrors.clear();
    setLoading(true);
    try {
      const response = await fetch("/api/profile/discord/handle", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordId, code }),
      });
      const payload = (await response.json()) as {
        error?: string;
        tag?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "");
      showSuccess(
        mode === "LINK"
          ? "Discord rattaché par code."
          : "Pseudo Discord mis à jour.",
      );
      onUpdated(payload.tag ?? "");
    } catch (e) {
      // Deux refus du code ne se lèvent pas en retapant : le compte a changé de
      // Discord entre la demande et la confirmation, ou le défi n'avait aucun
      // pseudo. Ils désignent le **pseudo** — on revient donc à sa saisie avant
      // de les dire, sans quoi le champ marqué ne serait pas à l'écran.
      const reason = (e as Error).message;
      if (reason === "DISCORD_ID_MISMATCH" || reason === "INVALID_DISCORD_HANDLE") restart();
      refuse(e);
    } finally {
      setLoading(false);
    }
  };

  const awaitingCode = discordId !== "";
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
    setDiscordId("");
    setCode("");
    fieldErrors.clear();
  };

  const dialogRef = useDialogBehavior({
    open: mounted,
    onClose,
    locked: loading,
  });
  const backdrop = useBackdropDismiss(onClose, loading);
  if (!mounted) return null;

  const title =
    mode === "LINK"
      ? "Rattacher Discord par code"
      : "Mettre à jour mon pseudo Discord";

  return createPortal(
    <div
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
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="discord-bot-title"
        aria-describedby="discord-bot-intro"
        tabIndex={-1}
        style={{
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          background: "var(--cyber-bg-1)",
          border: "1px solid var(--line-strong-cy)",
          borderRadius: "var(--r-cy-lg)",
          padding: 28,
        }}
      >
        <span className="eyebrow">BOT DISCORD · CODE PAR MESSAGE PRIVÉ</span>
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
          Saisis ton pseudo Discord : le bot BlueGenji t&apos;envoie un code à
          six chiffres en message privé, et le code prouve que ce pseudo est le
          tien.{" "}
          {mode === "UPDATE"
            ? "Seul le pseudo du compte Discord déjà rattaché est accepté. "
            : ""}
          Un pseudo qui change perd sa certification : tu pourras la redonner
          d&apos;un clic avec « Certifier mon tag ».
        </p>

        {!awaitingCode ? (
          <form
            onSubmit={requestCode}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div className="field">
              <label htmlFor={FIELD_IDS.handle}>Pseudo Discord</label>
              <input
                id={FIELD_IDS.handle}
                value={handle}
                onChange={(e) => {
                  setHandle(e.target.value);
                  fieldErrors.clear("handle");
                }}
                placeholder="ton_pseudo"
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
                Le bot doit partager un serveur avec toi :{" "}
                <Link
                  href={DISCORD_INVITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "var(--blue-300)",
                    textDecoration: "underline",
                  }}
                >
                  rejoins le serveur BlueGenji
                </Link>{" "}
                si ce n&apos;est pas déjà fait.
              </p>
            </div>
            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}
            >
              {/* Fermé pendant un envoi : fermer perdrait l'identifiant du code
                  déjà parti, et en redemander un consomme le quota. */}
              <CyberButton variant="ghost" type="button" disabled={loading} onClick={onClose}>
                Annuler
              </CyberButton>
              <CyberButton variant="primary" type="submit" disabled={loading}>
                {loading ? "Envoi…" : "Recevoir un code →"}
              </CyberButton>
            </div>
          </form>
        ) : (
          <form
            onSubmit={confirmCode}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div className="field">
              <label htmlFor={FIELD_IDS.code}>Code reçu en message privé</label>
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
                placeholder="123456"
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
                Cinq essais, puis le code est brûlé — demande-en un nouveau si
                tu te trompes.
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
              <CyberButton variant="ghost" type="button" disabled={loading} onClick={onClose}>
                Annuler
              </CyberButton>
              <CyberButton
                variant="ghost"
                type="button"
                disabled={loading}
                onClick={restart}
              >
                Nouveau code
              </CyberButton>
              <CyberButton variant="primary" type="submit" disabled={loading}>
                {loading ? "Vérification…" : "Valider le code"}
              </CyberButton>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
