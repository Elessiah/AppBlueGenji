"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useDialogBehavior } from "@/lib/shared/hooks/useDialogBehavior";
import { CyberButton } from "@/components/cyber/CyberButton";
import { VerifiedBadge } from "@/components/discord-tag";
import { useToast } from "@/components/ui/toast";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import { oauthStartPath } from "@/lib/shared/oauth-providers";
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
 * **Deux parcours, selon ce que le compte a déjà prouvé.** Un compte sans
 * Discord rattaché envoie son tag au bot, qui le retrouve parmi les membres des
 * serveurs qu'il partage avec lui, puis confirme par le code reçu en message
 * privé. Un compte **déjà relié** ne passe plus du tout par le bot : il repart
 * chez Discord (`/api/auth/discord/start?intent=link`), qui nomme lui-même le
 * pseudo de l'identité déjà rattachée, et le rattachement le réécrit certifié.
 *
 * La recherche par le bot était un contresens pour ce second cas : un compte
 * venu par OAuth n'a jamais eu besoin de partager un serveur avec le bot, si
 * bien que la recherche balayait **tous** ses serveurs sans trouver personne —
 * assez longtemps pour dépasser le délai de l'appel, que le site rendait alors en
 * « bot non joignable ». Et même aboutie, elle aurait répondu « tag
 * introuvable ». On demandait au bot de prouver ce que Discord atteste déjà.
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
  // Monté après l'hydratation : le portail vise `document.body`, qui n'existe
  // pas au rendu serveur.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
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
  // Comportement commun des modales du site : `Échap` ferme (sauf pendant une
  // écriture), le défilement de l'arrière-plan est verrouillé, le focus entre
  // dans la boîte et y reste, puis retourne d'où il venait. Le `locked` n'est
  // pas décoratif : une certification en cours d'envoi ne doit pas se faire
  // interrompre par une touche.
  const dialogRef = useDialogBehavior({ open: mounted, onClose, locked: loading });

  if (!mounted) return null;

  return createPortal(
    <div
      role="presentation"
      onClick={() => {
        if (!loading) onClose();
      }}
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
        aria-labelledby="discord-verify-title"
        // Le lecteur d'écran doit entendre **ce que la certification expose**
        // avant d'atteindre le champ : c'est le consentement, pas une
        // décoration.
        aria-describedby="discord-verify-exposure"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
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
          id="discord-verify-exposure"
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

        {linked ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 12, color: "var(--ink-dim)", margin: 0, lineHeight: 1.6 }}>
              Ton compte est déjà relié à Discord : c&apos;est Discord qui confirme ton pseudo. Tu
              passes par sa page d&apos;autorisation, puis tu reviens ici, tag certifié — sans code ni
              serveur commun avec le bot.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <CyberButton variant="ghost" type="button" onClick={onClose}>
                Annuler
              </CyberButton>
              {/* Une navigation et non un appel de fond : l'aller-retour OAuth
                  quitte la page. Un `<a>` plutôt qu'un `<Link>` — la route
                  répond par une redirection vers Discord, rien que le routeur
                  client puisse précharger ou rendre. */}
              <CyberButton variant="primary" asChild>
                <a href={oauthStartPath("DISCORD", { intent: "LINK" })}>Continuer avec Discord →</a>
              </CyberButton>
            </div>
          </div>
        ) : !awaitingCode ? (
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
                avant de certifier. Tu recevras un code à six chiffres en message privé.
              </p>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <CyberButton variant="ghost" type="button" onClick={onClose}>
                Annuler
              </CyberButton>
              <CyberButton variant="primary" type="submit" disabled={loading}>
                {loading ? "Vérification…" : "Recevoir un code →"}
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
    </div>,
    document.body,
  );
}
