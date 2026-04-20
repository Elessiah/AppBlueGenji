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

      <section className="fade-in ds-hero">
        <div
          className="ds-hero-body"
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}
        >
          <div>
            <span className="badge" style={{ marginBottom: 24, display: "inline-block" }}>
              Esport amateur - Marvel Rivals - Francophone
            </span>
            <h1 className="ds-title" style={{ fontSize: "clamp(48px, 5.5vw, 76px)", lineHeight: 1.04, marginBottom: 24 }}>
              BlueGenji
              <br />
              Arena
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.75, color: "var(--text-1)", margin: "0 0 44px", maxWidth: 460 }}>
              La plateforme de la communauté BlueGenji : tournois, bot Discord inter-serveurs et suivi des équipes autour de Marvel Rivals.
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
                }}
              >
                Voir les tournois
              </Link>
              <Link href="/connexion" className="btn ghost" style={{ padding: "14px 32px", fontSize: 15 }}>
                Rejoindre la plateforme
              </Link>
            </div>
          </div>

          <div
            style={{
              borderRadius: 20,
              border: "1px dashed rgba(89,212,255,0.28)",
              aspectRatio: "16 / 10",
              background: "linear-gradient(135deg, rgba(13,20,36,0.9) 0%, rgba(22,32,52,0.95) 100%)",
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
            <span style={{ color: "var(--text-2)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Capture de la plateforme
            </span>
          </div>
        </div>
      </section>

      <div className="grid-3" style={{ marginTop: 0 }}>
        {FEATURES.map((f) => (
          <Link
            key={f.title}
            href={f.href}
            className="ds-block"
            style={{
              borderColor: `rgba(${f.rgb},0.2)`,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              textDecoration: "none",
              position: "relative",
              padding: 0,
            }}
          >
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, rgba(${f.rgb},0.85), transparent)` }} />
            <div
              style={{
                aspectRatio: "16 / 7",
                background: `linear-gradient(135deg, rgba(${f.rgb},0.08) 0%, rgba(13,20,36,0.97) 100%)`,
                borderBottom: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 32,
              }}
            >
              {f.icon}
            </div>
            <div style={{ padding: "22px 24px 26px", flex: 1, display: "flex", flexDirection: "column" }}>
              <h3 style={{ fontFamily: "var(--font-title), sans-serif", fontSize: 20, margin: "0 0 10px", letterSpacing: "0.02em" }}>
                {f.title}
              </h3>
              <p style={{ color: "var(--text-1)", margin: "0 0 20px", lineHeight: 1.65, fontSize: 15, flex: 1 }}>{f.desc}</p>
              <span style={{ alignSelf: "flex-start", fontSize: 13, fontWeight: 600, color: `rgb(${f.rgb})`, letterSpacing: "0.03em" }}>
                Découvrir →
              </span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}

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
    desc: "Mission, bureau, activites competitives, evenements LAN et modalites d'adhesion de Bluegenji Esport.",
  },
  {
    title: "Tournois",
    href: "/tournois",
    icon: "🏆",
    rgb: "255,157,46",
    desc: "Plateforme automatisée de création et gestion de tournois en simple ou double élimination avec bracket live.",
  },
];
