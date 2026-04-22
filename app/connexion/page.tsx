"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

function mapDiscordError(errorCode: string): string {
  if (errorCode === "BOT_INTERNAL_UNREACHABLE") return "Connexion Discord indisponible (bot non joignable).";
  if (errorCode === "BOT_INTERNAL_UNAUTHORIZED") return "Connexion Discord indisponible (token interne invalide).";
  if (errorCode === "DISCORD_DM_FAILED") return "Impossible d'envoyer le code en DM Discord.";
  if (errorCode === "CODE_INVALID_OR_EXPIRED") return "Code invalide ou expiré.";
  if (errorCode === "INVALID_DISCORD_ID") return "Identifiant Discord invalide.";
  if (errorCode === "INVALID_CODE") return "Le code doit contenir 6 chiffres.";
  return errorCode || "Une erreur interne est survenue.";
}

export default function LoginPage() {
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  const [redirect, setRedirect] = useState("/tournois");

  const [discordId, setDiscordId] = useState("");
  const [pseudo, setPseudo] = useState("");
  const [code, setCode] = useState("");
  const [requested, setRequested] = useState(false);
  const [loading, setLoading] = useState(false);

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
        body: JSON.stringify({ discordId }),
      });
      const payload = (await response.json()) as { error?: string; expiresAt?: string };
      if (!response.ok) throw new Error(mapDiscordError(payload.error || "FAILED"));
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
        body: JSON.stringify({ discordId, code, pseudo }),
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
    <main className="page-shell">
      <section className="fade-in ds-hero">
        <div className="ds-hero-body">
          <span className="badge" style={{ marginBottom: 20, display: "inline-block" }}>
            Authentification sans mot de passe
          </span>
          <h1 className="ds-title" style={{ fontSize: "clamp(36px, 4vw, 54px)", lineHeight: 1.08, marginBottom: 16 }}>
            Connexion
          </h1>
          <p style={{ color: "var(--text-1)", fontSize: 16, margin: 0, maxWidth: 520, lineHeight: 1.7 }}>
            Connecte-toi via ton compte Google ou par code temporaire envoyé par le bot Discord.
          </p>
        </div>
      </section>

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <article className="ds-block" style={{ borderColor: "rgba(89,212,255,0.2)", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, rgba(89,212,255,0.85), transparent)" }} />
          <div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 48,
                height: 48,
                borderRadius: 12,
                background: "rgba(89,212,255,0.1)",
                border: "1px solid rgba(89,212,255,0.22)",
                fontSize: 22,
                marginBottom: 16,
              }}
            >
              🔑
            </span>
            <h2 style={{ fontFamily: "var(--font-title), sans-serif", fontSize: 22, margin: "0 0 10px", letterSpacing: "0.02em" }}>
              OAuth Google
            </h2>
            <p style={{ color: "var(--text-1)", margin: 0, fontSize: 15, lineHeight: 1.65 }}>
              Connexion rapide et sécurisée avec ton compte Google existant.
            </p>
          </div>

          <Link
            href={`/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`}
            style={{
              display: "flex",
              alignItems: "center",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              overflow: "hidden",
              textDecoration: "none",
              marginTop: 20,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 56,
                height: 56,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRight: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.04)",
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  border: "1.5px dashed rgba(255,255,255,0.25)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  color: "rgba(255,255,255,0.3)",
                  fontWeight: 700,
                }}
              >
                G
              </span>
            </span>
            <span style={{ flex: 1, textAlign: "center", fontSize: 15, fontWeight: 600, color: "var(--text-0)", padding: "0 20px" }}>
              Continuer avec Google
            </span>
          </Link>
        </article>

        <article className="ds-block" style={{ borderColor: "rgba(79,224,162,0.2)", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, rgba(79,224,162,0.85), transparent)" }} />
          <div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 48,
                height: 48,
                borderRadius: 12,
                background: "rgba(79,224,162,0.1)",
                border: "1px solid rgba(79,224,162,0.22)",
                fontSize: 22,
                marginBottom: 16,
              }}
            >
              💬
            </span>
            <h2 style={{ fontFamily: "var(--font-title), sans-serif", fontSize: 22, margin: "0 0 10px", letterSpacing: "0.02em" }}>
              Code Discord
            </h2>
            <p style={{ color: "var(--text-1)", margin: 0, fontSize: 15, lineHeight: 1.65 }}>
              Entre ton ID Discord, le bot t'envoie un code à 6 chiffres en DM.
            </p>
          </div>

          <form onSubmit={requested ? verifyCode : requestCode} style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 20 }}>
            <div className="field">
              <label>Identifiant Discord (ID numérique)</label>
              <input required value={discordId} onChange={(e) => setDiscordId(e.target.value)} placeholder="123456789012345678" />
            </div>

            <div className="field">
              <label>Pseudo site <span style={{ color: "var(--text-2)", fontWeight: 400 }}>(première connexion)</span></label>
              <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} placeholder="Ton pseudo" />
            </div>

            {requested && (
              <div className="field">
                <label>Code reçu en DM</label>
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 chiffres" required />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn"
              style={{
                marginTop: "auto",
                borderRadius: 12,
                borderColor: "rgba(79,224,162,0.3)",
                background: "rgba(79,224,162,0.12)",
                opacity: loading ? 0.6 : 1,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Chargement..." : requested ? "Valider le code" : "Recevoir un code Discord"}
            </button>

          </form>
        </article>
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <Link href="/" className="btn ghost" style={{ padding: "11px 28px", fontSize: 14 }}>
          ← Retour à l'accueil
        </Link>
      </div>
    </main>
  );
}
