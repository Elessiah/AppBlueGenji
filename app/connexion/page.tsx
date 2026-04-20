"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

function mapDiscordError(errorCode: string): string {
  if (errorCode === "BOT_INTERNAL_UNREACHABLE")
    return "Le service de connexion Discord est indisponible (bot non joignable). Vérifie BOT_INTERNAL_URL et que le bot tourne.";
  if (errorCode === "BOT_INTERNAL_UNAUTHORIZED")
    return "Connexion Discord indisponible : token interne invalide entre le site et le bot.";
  if (errorCode === "DISCORD_DM_FAILED")
    return "Impossible d'envoyer le code en DM Discord. Active les messages privés du serveur puis réessaie.";
  if (errorCode === "CODE_INVALID_OR_EXPIRED")
    return "Code invalide ou expiré. Demande un nouveau code.";
  if (errorCode === "INVALID_DISCORD_ID")
    return "Identifiant Discord invalide. Utilise ton ID numérique (mode développeur Discord).";
  if (errorCode === "INVALID_CODE")
    return "Le code doit contenir 6 chiffres.";
  return errorCode || "Une erreur interne est survenue.";
}

export default function LoginPage() {
  const router = useRouter();
  const [redirect, setRedirect] = useState("/tournois");
  const [oauthError, setOauthError] = useState<string | null>(null);

  const [discordId, setDiscordId] = useState("");
  const [pseudo, setPseudo] = useState("");
  const [code, setCode] = useState("");
  const [requested, setRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setRedirect(params.get("redirect") || "/tournois");
    const routeError = params.get("error");
    if (routeError === "google_not_configured")
      setOauthError("Connexion Google indisponible : GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET non configurés.");
    else if (routeError === "google_unavailable")
      setOauthError("Connexion Google temporairement indisponible.");
    else if (routeError === "oauth")
      setOauthError("Échec OAuth Google. Réessaie ou utilise la connexion Discord.");
    else if (routeError === "state")
      setOauthError("Session OAuth expirée ou invalide. Relance la connexion.");
    else if (routeError === "google")
      setOauthError("Paramètres OAuth Google invalides.");
    else
      setOauthError(null);
  }, []);

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/auth/discord/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discordId }),
      });
      const payload = (await response.json()) as { error?: string; expiresAt?: string };
      if (!response.ok) throw new Error(mapDiscordError(payload.error || "FAILED"));
      setRequested(true);
      setSuccess(`Code envoyé en DM Discord (expiration : ${new Date(payload.expiresAt || "").toLocaleTimeString()}).`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
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
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page-shell">

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section
        className="fade-in"
        style={{
          position: "relative",
          borderRadius: 28,
          border: "1px solid rgba(89,212,255,0.18)",
          background:
            "linear-gradient(140deg, rgba(9,12,20,0.98) 0%, rgba(18,24,38,0.96) 60%, rgba(26,34,53,0.92) 100%)",
          overflow: "hidden",
          padding: "52px 56px 48px",
          marginBottom: 32,
          boxShadow: "0 32px 80px rgba(0,0,0,0.55)",
        }}
      >
        {/* Ambient glows */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse at 10% 60%, rgba(89,212,255,0.12) 0%, transparent 50%), radial-gradient(ellipse at 90% 10%, rgba(255,157,46,0.09) 0%, transparent 45%)",
          }}
        />
        {/* Top color bar */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background:
              "linear-gradient(90deg, transparent 0%, #59d4ff 25%, #ff9d2e 75%, transparent 100%)",
          }}
        />

        <div style={{ position: "relative" }}>
          <span className="badge" style={{ marginBottom: 20, display: "inline-block" }}>
            Authentification sans mot de passe
          </span>
          <h1
            style={{
              fontFamily: "var(--font-title), sans-serif",
              fontSize: "clamp(36px, 4vw, 54px)",
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: "0.02em",
              margin: "0 0 16px",
              background: "linear-gradient(135deg, #f3f7ff 10%, #59d4ff 60%, #ff9d2e 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Connexion
          </h1>
          <p style={{ color: "var(--text-1)", fontSize: 16, margin: 0, maxWidth: 520, lineHeight: 1.7 }}>
            Connecte-toi via ton compte Google ou par code temporaire envoyé par le bot Discord —
            aucun mot de passe requis.
          </p>
          {oauthError && (
            <p className="error" style={{ marginTop: 16, maxWidth: 600 }}>
              {oauthError}
            </p>
          )}
        </div>
      </section>

      {/* ── AUTH CARDS ───────────────────────────────────────────────────── */}
      <div className="grid-2" style={{ marginBottom: 24 }}>

        {/* ── Google OAuth ── */}
        <article
          style={{
            border: "1px solid rgba(89,212,255,0.18)",
            borderRadius: 20,
            background: "rgba(13,18,30,0.88)",
            padding: "32px 28px 28px",
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* Top bar */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: "linear-gradient(90deg, rgba(89,212,255,0.85), transparent)",
            }}
          />

          {/* Header */}
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
            <h2
              style={{
                fontFamily: "var(--font-title), sans-serif",
                fontSize: 22,
                margin: "0 0 10px",
                letterSpacing: "0.02em",
              }}
            >
              OAuth Google
            </h2>
            <p style={{ color: "var(--text-1)", margin: 0, fontSize: 15, lineHeight: 1.65 }}>
              Connexion rapide et sécurisée avec ton compte Google existant. Aucune information
              supplémentaire requise.
            </p>
          </div>

          {/* OAuth Button avec zone logo */}
          <Link
            href={`/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 0,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              overflow: "hidden",
              textDecoration: "none",
              transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease",
              marginTop: "auto",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.1)";
              (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(255,255,255,0.24)";
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.06)";
              (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(255,255,255,0.14)";
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(0)";
            }}
          >
            {/* Logo zone */}
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
              {/* Placeholder — remplacer par <Image src="/google.svg" … /> */}
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
                  letterSpacing: 0,
                }}
              >
                G
              </span>
            </span>
            {/* Label */}
            <span
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: 15,
                fontWeight: 600,
                color: "var(--text-0)",
                padding: "0 20px",
              }}
            >
              Continuer avec Google
            </span>
          </Link>
        </article>

        {/* ── Discord code ── */}
        <article
          style={{
            border: "1px solid rgba(79,224,162,0.18)",
            borderRadius: 20,
            background: "rgba(13,18,30,0.88)",
            padding: "32px 28px 28px",
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* Top bar */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: "linear-gradient(90deg, rgba(79,224,162,0.85), transparent)",
            }}
          />

          {/* Header */}
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
            <h2
              style={{
                fontFamily: "var(--font-title), sans-serif",
                fontSize: 22,
                margin: "0 0 10px",
                letterSpacing: "0.02em",
              }}
            >
              Code Discord
            </h2>
            <p style={{ color: "var(--text-1)", margin: 0, fontSize: 15, lineHeight: 1.65 }}>
              Entre ton ID Discord — le bot t'envoie un code à 6 chiffres en DM pour valider ta
              connexion.
            </p>
          </div>

          {/* Form */}
          <form
            onSubmit={requested ? verifyCode : requestCode}
            style={{ display: "flex", flexDirection: "column", gap: 14, flex: 1 }}
          >
            <div className="field">
              <label>Identifiant Discord (ID numérique)</label>
              <input
                required
                value={discordId}
                onChange={(e) => setDiscordId(e.target.value)}
                placeholder="123456789012345678"
              />
            </div>

            <div className="field">
              <label>Pseudo site <span style={{ color: "var(--text-2)", fontWeight: 400 }}>(première connexion)</span></label>
              <input
                value={pseudo}
                onChange={(e) => setPseudo(e.target.value)}
                placeholder="Ton pseudo"
              />
            </div>

            {requested && (
              <div className="field">
                <label>Code reçu en DM</label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6 chiffres"
                  required
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: "auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "14px 24px",
                borderRadius: 12,
                border: "1px solid rgba(79,224,162,0.3)",
                background: "rgba(79,224,162,0.12)",
                color: "var(--text-0)",
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                transition: "background 0.18s ease, transform 0.18s ease",
              }}
            >
              {loading
                ? "Chargement…"
                : requested
                ? "Valider le code"
                : "Recevoir un code Discord"}
            </button>

            {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
            {success && <p className="success" style={{ margin: 0 }}>{success}</p>}
          </form>
        </article>
      </div>

      {/* ── Back ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Link href="/" className="btn ghost" style={{ padding: "11px 28px", fontSize: 14 }}>
          ← Retour à l'accueil
        </Link>
      </div>

    </main>
  );
}
