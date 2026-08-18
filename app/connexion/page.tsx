"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { CyberButton } from "@/components/cyber/CyberButton";
import { CyberCard } from "@/components/cyber/CyberCard";
import { RgpdConsentModal } from "@/components/cyber/RgpdConsentModal";

const CONSENT_STORAGE_KEY = "bg_rgpd_consent";

function mapDiscordError(errorCode: string): string {
  if (errorCode === "BOT_INTERNAL_UNREACHABLE") return "Connexion Discord indisponible (bot non joignable).";
  if (errorCode === "BOT_INTERNAL_UNAUTHORIZED") return "Connexion Discord indisponible (token interne invalide).";
  if (errorCode === "DISCORD_DM_FAILED") return "Impossible d'envoyer le code en DM Discord.";
  if (errorCode === "CODE_INVALID_OR_EXPIRED") return "Code invalide ou expiré.";
  if (errorCode === "INVALID_DISCORD_ID") return "Identifiant Discord invalide.";
  if (errorCode === "INVALID_DISCORD_HANDLE") return "Renseigne ton tag Discord ou ton ID.";
  if (errorCode === "DISCORD_USER_NOT_FOUND") return "Tag introuvable : le bot doit partager un serveur avec toi. Utilise plutôt ton ID Discord.";
  if (errorCode === "INVALID_CODE") return "Le code doit contenir 6 chiffres.";
  return errorCode || "Une erreur interne est survenue.";
}

export default function LoginPage() {
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  const [redirect, setRedirect] = useState("/tournois");

  const [handle, setHandle] = useState("");
  const [resolvedId, setResolvedId] = useState("");
  const [pseudo, setPseudo] = useState("");
  const [code, setCode] = useState("");
  const [requested, setRequested] = useState(false);
  // Le champ « pseudo site » ne sert qu'à la création du compte : on ne
  // l'affiche que si le compte Discord n'est pas encore rattaché au site.
  const [isNewAccount, setIsNewAccount] = useState(true);
  const [loading, setLoading] = useState(false);
  // Consentement RGPD requis avant toute création de compte. Tant qu'il n'est
  // pas accordé, la carte de connexion est masquée derrière la popup et aucune
  // requête d'authentification n'est déclenchée.
  const [consentGiven, setConsentGiven] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setConsentGiven(window.localStorage.getItem(CONSENT_STORAGE_KEY) === "1");
  }, []);

  const acceptConsent = () => {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, "1");
    } catch {
      // localStorage indisponible (mode privé) : on continue en mémoire.
    }
    setConsentGiven(true);
  };

  const refuseConsent = () => {
    // Retour en arrière total : aucune donnée n'a été enregistrée.
    router.push("/");
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setRedirect(params.get("redirect") || "/tournois");
    const routeError = params.get("error");
    if (routeError === "google_not_configured") showError("Connexion Google indisponible: configuration manquante.");
    else if (routeError === "google_unavailable") showError("Connexion Google temporairement indisponible.");
    else if (routeError === "oauth") showError("Échec OAuth Google.");
    else if (routeError === "state") showError("Session OAuth expirée ou invalide.");
    else if (routeError === "google") showError("Paramètres OAuth Google invalides.");
  }, [showError]);

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/auth/discord/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const payload = (await response.json()) as {
        error?: string;
        expiresAt?: string;
        discordId?: string;
        isNewAccount?: boolean;
      };
      if (!response.ok) throw new Error(mapDiscordError(payload.error || "FAILED"));
      setResolvedId(payload.discordId || "");
      setIsNewAccount(payload.isNewAccount !== false);
      if (payload.isNewAccount === false) setPseudo("");
      setRequested(true);
      showSuccess(`Code envoyé en DM Discord (expiration : ${new Date(payload.expiresAt || "").toLocaleTimeString()}).`);
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/auth/discord/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordId: resolvedId, code, pseudo: isNewAccount ? pseudo : undefined }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(mapDiscordError(payload.error || "FAILED"));
      router.push(redirect);
      router.refresh();
    } catch (e) {
      showError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", position: "relative" }}>
      {!consentGiven && (
        <RgpdConsentModal onAccept={acceptConsent} onRefuse={refuseConsent} />
      )}
      <div className="fabric" />
      <CyberCard ticks style={{ padding: 48, width: "min(480px, calc(100vw - 32px))" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 className="display" style={{ fontSize: 36, marginTop: 20, marginBottom: 8 }}>
            Connexion
          </h1>
          <p className="mono" style={{ color: "var(--ink-mute)", letterSpacing: "0.18em", fontSize: 11, margin: 0 }}>
            BLUEGENJI · ACCÈS MEMBRE
          </p>
        </div>

        {!requested ? (
          <>
            <CyberButton
              variant="primary"
              asChild
              style={{ width: "100%", marginBottom: 12 }}
            >
              <a href={`/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`}>
                Continuer avec Google
              </a>
            </CyberButton>

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0", color: "var(--ink-dim)" }}>
              <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
              <span className="mono" style={{ fontSize: 10, letterSpacing: "0.2em" }}>OU</span>
              <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
            </div>

            <form onSubmit={requestCode} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field">
                <label>Tag Discord ou ID</label>
                <input
                  type="text"
                  name="handle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="ton_pseudo ou 123456789012345678"
                  required
                />
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-dim)", letterSpacing: "0.08em", marginTop: 4, lineHeight: 1.5 }}>
                  Le tag fonctionne si le bot partage un serveur avec toi, sinon utilise ton ID Discord ou{" "}
                  <Link
                    href="https://discord.gg/VPGZ4eBfwN"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--blue-300)", textDecoration: "underline" }}
                  >
                    rejoins notre serveur
                  </Link>
                  .
                </span>
              </div>
              <CyberButton
                variant="ghost"
                type="submit"
                disabled={loading}
                style={{ width: "100%" }}
              >
                {loading ? "Envoi..." : "Recevoir un code →"}
              </CyberButton>
            </form>
          </>
        ) : (
          <>
            <CyberButton
              variant="primary"
              asChild
              style={{ width: "100%", marginBottom: 12 }}
            >
              <a href={`/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`}>
                Continuer avec Google
              </a>
            </CyberButton>

            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0", color: "var(--ink-dim)" }}>
              <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
              <span className="mono" style={{ fontSize: 10, letterSpacing: "0.2em" }}>OU</span>
              <div style={{ flex: 1, height: 1, background: "var(--line-soft)" }} />
            </div>

            <form onSubmit={verifyCode} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field">
                <label>Compte Discord</label>
                <input
                  type="text"
                  name="handle"
                  value={handle}
                  disabled
                />
              </div>
              <div className="field">
                <label>Code reçu en DM (6 chiffres)</label>
                <input
                  type="text"
                  name="code"
                  maxLength={6}
                  pattern="\d{6}"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="num"
                  style={{ fontSize: 20, letterSpacing: "0.3em", textAlign: "center" }}
                  required
                />
              </div>
              {isNewAccount && (
                <div className="field">
                  <label>Pseudo site <span style={{ color: "var(--ink-mute)", fontWeight: 400 }}>(première connexion)</span></label>
                  <input
                    type="text"
                    name="pseudo"
                    value={pseudo}
                    onChange={(e) => setPseudo(e.target.value)}
                    placeholder="Ton pseudo"
                  />
                </div>
              )}
              <CyberButton
                variant="ghost"
                type="submit"
                disabled={loading}
                style={{ width: "100%" }}
              >
                {loading ? "Vérification..." : "Se connecter"}
              </CyberButton>
            </form>

            <div style={{ marginTop: 16, textAlign: "center" }}>
              <button
                type="button"
                onClick={() => {
                  setRequested(false);
                  setCode("");
                  setIsNewAccount(true);
                }}
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--ink-mute)",
                  letterSpacing: "0.14em",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                ← CHANGER DE COMPTE
              </button>
            </div>
          </>
        )}

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <Link
            href="/"
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-mute)", letterSpacing: "0.14em" }}
          >
            ← RETOUR ACCUEIL
          </Link>
        </div>
      </CyberCard>
    </main>
  );
}
