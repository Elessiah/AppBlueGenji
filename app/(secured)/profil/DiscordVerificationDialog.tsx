"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { CyberButton } from "@/components/cyber/CyberButton";
import { VerifiedBadge } from "@/components/discord-tag";
import { useToast } from "@/components/ui/toast";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import {
  DISCORD_VERIFICATION_EXPOSURE,
  DISCORD_VERIFICATION_PURPOSE,
} from "@/lib/shared/discord-identity";
import { discordVerificationErrorMessage } from "./discord-errors";

/**
 * Certification du tag Discord, en une ou deux étapes.
 *
 * **L'exposition se lit avant le clic, pas après.** La certification ouvre le
 * tag à l'administration et à l'arbitrage : le dialogue l'énonce publiquement
 * par public et par portée (`DISCORD_VERIFICATION_EXPOSURE`, écrit à côté de la
 * règle qui l'applique), et le bouton de confirmation ne vient qu'après. C'est un
 * consentement, pas une formalité.
 *
 * **Une ou deux étapes, selon ce que le compte a déjà prouvé** : un compte né par
 * Discord n'a pas de code à recevoir — il l'a déjà fait en ouvrant sa session —,
 * et le serveur le certifie sur place (`status: "VERIFIED"`). Le dialogue ne
 * décide pas lequel des deux se produit : il envoie le tag et lit la réponse.
 * Rejouer la règle ici aurait fabriqué un second endroit où elle vit.
 */
export type DiscordVerificationDialogProps = {
  /** Tag actuellement saisi dans le formulaire, proposé d'emblée. */
  initialTag: string;
  /** Un identifiant Discord est-il déjà rattaché au compte ? */
  linked: boolean;
  onClose: () => void;
  /** Appelé avec le tag certifié, pour que la page se remette à jour. */
  onVerified: (tag: string) => void;
};

export function DiscordVerificationDialog({
  initialTag,
  linked,
  onClose,
  onVerified,
}: DiscordVerificationDialogProps) {
  const { showError, showSuccess } = useToast();
  const [handle, setHandle] = useState(initialTag);
  const [discordId, setDiscordId] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const requestVerification = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/profile/discord", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const payload = (await response.json()) as {
        error?: string;
        status?: "VERIFIED" | "CODE_SENT";
        tag?: string;
        discordId?: string;
        expiresAt?: string;
      };
      if (!response.ok) throw new Error(discordVerificationErrorMessage(payload.error));

      if (payload.status === "VERIFIED") {
        showSuccess("Tag Discord certifié.");
        onVerified(payload.tag ?? handle);
        return;
      }

      setDiscordId(payload.discordId ?? "");
      showSuccess(
        `Code envoyé en message privé Discord (expiration : ${new Date(
          payload.expiresAt ?? "",
        ).toLocaleTimeString()}).`,
      );
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const confirmVerification = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/profile/discord", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordId, code }),
      });
      const payload = (await response.json()) as { error?: string; tag?: string };
      if (!response.ok) throw new Error(discordVerificationErrorMessage(payload.error));
      showSuccess("Tag Discord certifié.");
      onVerified(payload.tag ?? handle);
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const awaitingCode = discordId !== "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="discord-verify-title"
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
        <span className="eyebrow">CERTIFICATION · DISCORD</span>
        <h2
          id="discord-verify-title"
          className="display"
          style={{ fontSize: 22, margin: "12px 0 8px", display: "flex", alignItems: "center", gap: 8 }}
        >
          Certifier mon tag Discord
          <VerifiedBadge size={20} />
        </h2>

        <p style={{ color: "var(--ink-mute)", fontSize: 13.5, lineHeight: 1.7, margin: "0 0 14px" }}>
          {DISCORD_VERIFICATION_PURPOSE} La certification est <strong>facultative</strong> : sans
          elle, ton tag reste invisible pour tout le monde, administrateurs compris.
        </p>

        <p
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.09em",
            color: "var(--ink-mute)",
            margin: "0 0 8px",
          }}
        >
          Ce que la certification expose
        </p>
        <ul
          style={{
            color: "var(--ink-mute)",
            fontSize: 13,
            lineHeight: 1.7,
            margin: "0 0 16px",
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {DISCORD_VERIFICATION_EXPOSURE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        {!awaitingCode ? (
          <form onSubmit={requestVerification} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field">
              <label htmlFor="discord-verify-handle">Tag Discord</label>
              <input
                id="discord-verify-handle"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="ton_pseudo"
                required
              />
              <p style={{ fontSize: 11, color: "var(--ink-dim)", margin: "6px 0 0", lineHeight: 1.6 }}>
                Le bot doit partager un serveur avec toi pour retrouver ton compte :{" "}
                <Link
                  href={DISCORD_INVITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--blue-300)", textDecoration: "underline" }}
                >
                  rejoins le serveur BlueGenji
                </Link>{" "}
                avant de certifier.{" "}
                {linked
                  ? "Ton compte est déjà relié à Discord : la certification est immédiate, sans code."
                  : "Tu recevras un code à six chiffres en message privé."}
              </p>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <CyberButton variant="ghost" type="button" onClick={onClose}>
                Annuler
              </CyberButton>
              <CyberButton variant="primary" type="submit" disabled={loading}>
                {loading ? "Vérification…" : linked ? "Certifier" : "Recevoir un code →"}
              </CyberButton>
            </div>
          </form>
        ) : (
          <form onSubmit={confirmVerification} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field">
              <label htmlFor="discord-verify-code">Code reçu en message privé</label>
              <input
                id="discord-verify-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                pattern="\d{6}"
                placeholder="123456"
                required
              />
              <p style={{ fontSize: 11, color: "var(--ink-dim)", margin: "6px 0 0" }}>
                Cinq essais, puis le code est brûlé — demande-en un nouveau si tu te trompes.
              </p>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <CyberButton variant="ghost" type="button" onClick={onClose}>
                Annuler
              </CyberButton>
              <CyberButton variant="primary" type="submit" disabled={loading}>
                {loading ? "Certification…" : "Certifier mon tag"}
              </CyberButton>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
