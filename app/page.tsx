import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page-shell">
      <Link href="/association" className="cta-float-home">
        ⌂ Association
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
          padding: "72px 56px 64px",
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
              "radial-gradient(ellipse at 8% 55%, rgba(89,212,255,0.16) 0%, transparent 48%), radial-gradient(ellipse at 92% 10%, rgba(255,157,46,0.11) 0%, transparent 45%)",
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

        <div
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 64,
            alignItems: "center",
          }}
        >
          {/* ── Text ── */}
          <div>
            <span className="badge" style={{ marginBottom: 24, display: "inline-block" }}>
              Esport amateur · Marvel Rivals · Francophone
            </span>
            <h1
              style={{
                fontFamily: "var(--font-title), sans-serif",
                fontSize: "clamp(48px, 5.5vw, 76px)",
                fontWeight: 700,
                lineHeight: 1.04,
                letterSpacing: "0.02em",
                margin: "0 0 24px",
                background: "linear-gradient(135deg, #f3f7ff 10%, #59d4ff 55%, #ff9d2e 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              BlueGenji
              <br />
              Arena
            </h1>
            <p
              style={{
                fontSize: 18,
                lineHeight: 1.75,
                color: "var(--text-1)",
                margin: "0 0 44px",
                maxWidth: 460,
              }}
            >
              La plateforme de la communauté BlueGenji — tournois, bot Discord inter-serveurs et
              suivi des équipes autour de{" "}
              <strong style={{ color: "var(--accent-blue)" }}>Marvel Rivals</strong>.
            </p>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Link
                href="/tournois"
                className="btn"
                style={{
                  padding: "14px 32px",
                  fontSize: 15,
                  background: "var(--accent-blue)",
                  color: "var(--bg-0)",
                  border: "none",
                  fontWeight: 700,
                  borderRadius: 999,
                  boxShadow: "0 4px 28px rgba(89,212,255,0.4)",
                }}
              >
                Voir les tournois
              </Link>
              <Link
                href="/connexion"
                className="btn ghost"
                style={{ padding: "14px 32px", fontSize: 15 }}
              >
                Rejoindre la plateforme
              </Link>
            </div>
          </div>

          {/* ── Screenshot placeholder ── */}
          <div
            style={{
              borderRadius: 20,
              border: "1px dashed rgba(89,212,255,0.28)",
              aspectRatio: "16 / 10",
              background:
                "linear-gradient(135deg, rgba(13,20,36,0.9) 0%, rgba(22,32,52,0.95) 100%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              minHeight: 260,
            }}
          >
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                border: "2px dashed rgba(89,212,255,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                color: "rgba(89,212,255,0.5)",
              }}
            >
              🖥
            </div>
            <span
              style={{
                color: "var(--text-2)",
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              Capture de la plateforme
            </span>
          </div>
        </div>
      </section>

      {/* ── FEATURE CARDS ────────────────────────────────────────────────── */}
      <div className="grid-3" style={{ marginTop: 0 }}>
        {FEATURES.map((f) => (
          <Link
            key={f.title}
            href={f.href}
            style={{
              border: `1px solid rgba(${f.rgb},0.18)`,
              borderRadius: 20,
              background: "rgba(13,18,30,0.88)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              textDecoration: "none",
              transition: "transform 0.2s ease, border-color 0.2s ease",
              position: "relative",
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
                background: `linear-gradient(90deg, rgba(${f.rgb},0.85), transparent)`,
              }}
            />
            {/* Visual placeholder */}
            <div
              style={{
                aspectRatio: "16 / 7",
                background: `linear-gradient(135deg, rgba(${f.rgb},0.08) 0%, rgba(13,20,36,0.97) 100%)`,
                borderBottom: "1px solid var(--line)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 32 }}>{f.icon}</span>
            </div>
            {/* Content */}
            <div style={{ padding: "22px 24px 26px", flex: 1, display: "flex", flexDirection: "column" }}>
              <h3
                style={{
                  fontFamily: "var(--font-title), sans-serif",
                  fontSize: 20,
                  margin: "0 0 10px",
                  letterSpacing: "0.02em",
                  color: "var(--text-0)",
                }}
              >
                {f.title}
              </h3>
              <p
                style={{
                  color: "var(--text-1)",
                  margin: "0 0 20px",
                  lineHeight: 1.65,
                  fontSize: 15,
                  flex: 1,
                }}
              >
                {f.desc}
              </p>
              <span
                style={{
                  alignSelf: "flex-start",
                  fontSize: 13,
                  fontWeight: 600,
                  color: `rgb(${f.rgb})`,
                  letterSpacing: "0.03em",
                }}
              >
                Découvrir →
              </span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}

/* ── Data ──────────────────────────────────────────────────────────────────── */

const FEATURES = [
  {
    title: "Bot Discord",
    href: "/bot",
    icon: "🤖",
    rgb: "79,224,162",
    desc: "Réseau inter-serveurs de diffusion d'annonces : scrims, recrutement de joueurs, staff et cast autour de Marvel Rivals.",
  },
  {
    title: "L'Association",
    href: "/association",
    icon: "🏛",
    rgb: "89,212,255",
    desc: "Mission, bureau, activités compétitives, événements LAN et modalités d'adhésion de Bluegenji Esport.",
  },
  {
    title: "Tournois",
    href: "/tournois",
    icon: "🏆",
    rgb: "255,157,46",
    desc: "Plateforme automatisée de création et gestion de tournois en simple ou double élimination avec bracket live.",
  },
];
