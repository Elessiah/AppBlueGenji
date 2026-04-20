import Link from "next/link";
import { fetchBotStats } from "@/lib/server/bot-integration";

export default async function BotPage() {
  const stats = await fetchBotStats();

  return (
    <main className="page-shell">
      <Link href="/" className="cta-float-home">
        ⌂ Accueil
      </Link>
      <Link href="/tournois" className="cta-float">
        Accéder aux tournois →
      </Link>

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
          padding: "64px 56px 56px",
          marginBottom: 32,
          boxShadow: "0 32px 80px rgba(0,0,0,0.55)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse at 10% 60%, rgba(79,224,162,0.12) 0%, transparent 50%), radial-gradient(ellipse at 90% 10%, rgba(89,212,255,0.08) 0%, transparent 45%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background:
              "linear-gradient(90deg, transparent 0%, #4fe0a2 25%, #59d4ff 75%, transparent 100%)",
          }}
        />

        <div style={{ position: "relative" }}>
          <span className="badge" style={{ marginBottom: 24, display: "inline-block" }}>
            Bot Discord · Réseau inter-serveurs
          </span>
          <h1
            style={{
              fontFamily: "var(--font-title), sans-serif",
              fontSize: "clamp(44px, 5vw, 70px)",
              fontWeight: 700,
              lineHeight: 1.06,
              letterSpacing: "0.02em",
              margin: "0 0 20px",
              background: "linear-gradient(135deg, #f3f7ff 10%, #4fe0a2 55%, #59d4ff 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            BlueGenji
            <br />
            Bot
          </h1>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.75,
              color: "var(--text-1)",
              margin: "0 0 40px",
              maxWidth: 620,
            }}
          >
            Le bot connecte des channels Discord de plusieurs serveurs pour simplifier la diffusion
            d'annonces scrims, recherche d'équipe, staff, cast et initiatives communautaires autour
            de <strong style={{ color: "var(--accent-blue)" }}>Marvel Rivals</strong>.
          </p>

          {/* Stats */}
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            {[
              { label: "Serveurs affiliés", value: stats.affiliatedServers },
              { label: "Channels reliés", value: stats.affiliatedChannels },
              { label: "Messages (30j)", value: stats.messagesLast30Days },
              { label: "Relais (30j)", value: stats.relayedMessagesLast30Days },
              { label: "Utilisateurs (30j)", value: stats.uniqueUsersLast30Days },
            ].map((k) => (
              <div
                key={k.label}
                style={{ borderLeft: "2px solid rgba(79,224,162,0.4)", paddingLeft: 14 }}
              >
                <div
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: "var(--text-2)",
                  }}
                >
                  {k.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{k.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FONCTIONNEMENT ───────────────────────────────────────────────── */}
      <section
        className="fade-in"
        style={{
          border: "1px solid rgba(79,224,162,0.15)",
          borderRadius: 20,
          background: "rgba(13,18,30,0.85)",
          padding: "36px 40px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, rgba(79,224,162,0.8), transparent)",
          }}
        />
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
          <span
            style={{
              flexShrink: 0,
              width: 4,
              height: 32,
              background: "linear-gradient(180deg, #4fe0a2, #59d4ff)",
              borderRadius: 2,
              marginTop: 3,
            }}
          />
          <h2
            style={{
              fontFamily: "var(--font-title), sans-serif",
              fontSize: 26,
              margin: 0,
              letterSpacing: "0.02em",
            }}
          >
            Fonctionnement
          </h2>
        </div>
        <p style={{ color: "var(--text-1)", margin: "0 0 14px", lineHeight: 1.75, fontSize: 15, maxWidth: 760 }}>
          Les annonces sont postées sur un channel partenaire, qualifiées via des mots-clés (
          <code
            style={{
              background: "rgba(79,224,162,0.1)",
              border: "1px solid rgba(79,224,162,0.2)",
              borderRadius: 4,
              padding: "1px 6px",
              fontSize: 13,
              color: "var(--accent-green)",
            }}
          >
            lfs
          </code>
          ,{" "}
          <code
            style={{
              background: "rgba(79,224,162,0.1)",
              border: "1px solid rgba(79,224,162,0.2)",
              borderRadius: 4,
              padding: "1px 6px",
              fontSize: 13,
              color: "var(--accent-green)",
            }}
          >
            lfp
          </code>
          ,{" "}
          <code
            style={{
              background: "rgba(79,224,162,0.1)",
              border: "1px solid rgba(79,224,162,0.2)",
              borderRadius: 4,
              padding: "1px 6px",
              fontSize: 13,
              color: "var(--accent-green)",
            }}
          >
            lft
          </code>
          ,{" "}
          <code
            style={{
              background: "rgba(79,224,162,0.1)",
              border: "1px solid rgba(79,224,162,0.2)",
              borderRadius: 4,
              padding: "1px 6px",
              fontSize: 13,
              color: "var(--accent-green)",
            }}
          >
            lfstaff
          </code>
          ,{" "}
          <code
            style={{
              background: "rgba(79,224,162,0.1)",
              border: "1px solid rgba(79,224,162,0.2)",
              borderRadius: 4,
              padding: "1px 6px",
              fontSize: 13,
              color: "var(--accent-green)",
            }}
          >
            lfcast
          </code>
          …), puis redistribuées automatiquement selon les services et filtres région/rank.
        </p>
        <p style={{ color: "var(--text-1)", margin: "0 0 28px", lineHeight: 1.75, fontSize: 15, maxWidth: 760 }}>
          Le bot gère la modération basique, l'expiration des duplications, et conserve un
          historique exploité ici pour le suivi d'usage.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/" className="btn ghost" style={{ padding: "11px 24px", fontSize: 14 }}>
            ← Retour accueil
          </Link>
          <Link href="/tournois" className="btn" style={{ padding: "11px 24px", fontSize: 14 }}>
            Accéder aux tournois
          </Link>
        </div>
      </section>
    </main>
  );
}
