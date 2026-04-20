import Link from "next/link";

export default function AssociationPage() {
  return (
    <main className="page-shell">
      <Link href="/" className="cta-float-home home">
        ⌂ Accueil
      </Link>
      <Link href="/tournois" className="cta-float">
        Accéder aux tournois →
      </Link>

      <section className="fade-in ds-hero gold">
        <div className="ds-hero-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
          <div>
            <span
              className="badge"
              style={{
                marginBottom: 24,
                display: "inline-block",
                borderColor: "rgba(245,195,58,0.45)",
                background: "rgba(245,195,58,0.1)",
                color: "rgb(245,195,58)",
              }}
            >
              Association loi 1901 — Fondée le 11 septembre 2022
            </span>
            <h1 className="ds-title gold" style={{ fontSize: "clamp(44px, 5vw, 70px)", lineHeight: 1.06, marginBottom: 22 }}>
              Bluegenji
              <br />
              Esport
            </h1>
            <p style={{ fontSize: 17, lineHeight: 1.75, color: "var(--text-1)", margin: "0 0 40px", maxWidth: 480 }}>
              Structure associative esport dédiée à la scène amateur francophone. Implantée au Mans, nous organisons des
              tournois, des événements LAN et fédérons les équipes compétitives autour de Marvel Rivals.
            </p>
            <div className="ds-stats">
              {[
                { label: "Fondée le", value: "11 sept. 2022" },
                { label: "Siège social", value: "Le Mans (72)" },
                { label: "Régime", value: "Loi 1901" },
                { label: "Âge minimum", value: "16 ans" },
              ].map((k) => (
                <div key={k.label} className="ds-stat gold">
                  <div className="ds-stat-label">{k.label}</div>
                  <div className="ds-stat-value" style={{ fontSize: 16 }}>{k.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              borderRadius: 20,
              border: "1px dashed rgba(245,195,58,0.28)",
              aspectRatio: "4 / 3",
              background: "linear-gradient(135deg, rgba(28,22,8,0.9) 0%, rgba(36,28,10,0.95) 100%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              minHeight: 280,
            }}
          >
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                border: "2px dashed rgba(245,195,58,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                color: "rgba(245,195,58,0.5)",
              }}
            >
              📷
            </div>
            <span style={{ color: "var(--text-2)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Photo de l'équipe
            </span>
          </div>
        </div>
      </section>

      <section className="fade-in" style={{ marginBottom: 32 }}>
        <div className="ds-section-title gold">
          <h2>Notre mission</h2>
        </div>
        <div className="grid-2">
          {MISSIONS.map((item) => (
            <article
              key={item.title}
              className="ds-block"
              style={{ borderColor: `rgba(${item.rgb},0.2)`, position: "relative", overflow: "hidden" }}
            >
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, rgba(${item.rgb},0.85), transparent)` }} />
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: `rgba(${item.rgb},0.1)`,
                  border: `1px solid rgba(${item.rgb},0.22)`,
                  fontSize: 24,
                  marginBottom: 18,
                }}
              >
                {item.icon}
              </span>
              <h3 style={{ fontFamily: "var(--font-title), sans-serif", fontSize: 20, margin: "0 0 10px", letterSpacing: "0.02em" }}>
                {item.title}
              </h3>
              <p style={{ color: "var(--text-1)", margin: 0, lineHeight: 1.65, fontSize: 15 }}>{item.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="fade-in" style={{ marginBottom: 32 }}>
        <div className="ds-section-title gold">
          <h2>Nos activités</h2>
        </div>
        <div className="grid-2">
          {ACTIVITIES.map((activity) => (
            <article key={activity.title} className="ds-block" style={{ padding: 0, overflow: "hidden" }}>
              <div
                style={{
                  aspectRatio: "16 / 7",
                  background: `linear-gradient(135deg, rgba(${activity.rgb},0.07) 0%, rgba(13,20,36,0.97) 100%)`,
                  borderBottom: "1px solid var(--line)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    border: `1.5px dashed rgba(${activity.rgb},0.4)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                  }}
                >
                  🖼
                </div>
                <span style={{ fontSize: 10, letterSpacing: "0.09em", textTransform: "uppercase", color: `rgba(${activity.rgb},0.55)` }}>
                  {activity.imgLabel}
                </span>
              </div>
              <div style={{ padding: "22px 24px 26px" }}>
                <span
                  className="ds-chip"
                  style={{
                    marginBottom: 12,
                    borderColor: `rgba(${activity.rgb},0.35)`,
                    background: `rgba(${activity.rgb},0.1)`,
                    color: `rgb(${activity.rgb})`,
                  }}
                >
                  {activity.tag}
                </span>
                <h3 style={{ fontFamily: "var(--font-title), sans-serif", fontSize: 20, margin: "0 0 10px", letterSpacing: "0.02em" }}>
                  {activity.title}
                </h3>
                <p style={{ color: "var(--text-1)", margin: 0, lineHeight: 1.65, fontSize: 15 }}>{activity.desc}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="fade-in ds-block" style={{ marginBottom: 32 }}>
        <div className="ds-section-title gold">
          <h2>Le Bureau</h2>
        </div>
        <div className="grid-2" style={{ marginTop: 0 }}>
          {BUREAU.map((person) => (
            <article
              key={person.name}
              className="ds-block"
              style={{
                borderColor: `rgba(${person.rgb},0.2)`,
                display: "flex",
                gap: 22,
                alignItems: "flex-start",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, rgba(${person.rgb},0.85), transparent)` }} />
              <div
                style={{
                  flexShrink: 0,
                  width: 72,
                  height: 72,
                  borderRadius: "50%",
                  border: `2px dashed rgba(${person.rgb},0.4)`,
                  background: `rgba(${person.rgb},0.07)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 26,
                  marginTop: 4,
                }}
              >
                👤
              </div>
              <div>
                <div
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: `rgb(${person.rgb})`,
                    fontWeight: 700,
                    marginBottom: 6,
                  }}
                >
                  {person.role}
                </div>
                <h3 style={{ fontFamily: "var(--font-title), sans-serif", fontSize: 24, margin: "0 0 10px", letterSpacing: "0.02em" }}>
                  {person.name}
                </h3>
                <p style={{ color: "var(--text-1)", margin: 0, lineHeight: 1.65, fontSize: 15 }}>{person.desc}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="fade-in ds-block" style={{ marginBottom: 32 }}>
        <div className="ds-section-title gold">
          <h2>Nous rejoindre</h2>
        </div>
        <div className="grid-3" style={{ marginTop: 0 }}>
          {TIERS.map((tier) => (
            <article
              key={tier.type}
              className="ds-block"
              style={{
                borderColor: `rgba(${tier.rgb},${tier.featured ? "0.4" : "0.2"})`,
                background: tier.featured
                  ? `linear-gradient(160deg, rgba(${tier.rgb},0.06) 0%, rgba(13,18,30,0.9) 100%)`
                  : "rgba(13,18,30,0.88)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, rgba(${tier.rgb},0.85), transparent)` }} />
              {tier.featured && (
                <span
                  className="ds-chip"
                  style={{
                    position: "absolute",
                    top: 16,
                    right: 16,
                    borderColor: `rgba(${tier.rgb},0.35)`,
                    background: `rgba(${tier.rgb},0.1)`,
                    color: `rgb(${tier.rgb})`,
                  }}
                >
                  Populaire
                </span>
              )}
              <h3 style={{ fontFamily: "var(--font-title), sans-serif", fontSize: 22, margin: "0 0 20px", color: `rgb(${tier.rgb})`, letterSpacing: "0.03em" }}>
                {tier.type}
              </h3>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {tier.items.map((item) => (
                  <li
                    key={item}
                    style={{
                      display: "flex",
                      gap: 10,
                      padding: "9px 0",
                      borderBottom: "1px solid var(--line)",
                      fontSize: 14,
                      color: "var(--text-1)",
                      lineHeight: 1.5,
                    }}
                  >
                    <span style={{ color: `rgb(${tier.rgb})` }}>✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="fade-in ds-block" style={{ marginBottom: 32 }}>
        <div className="ds-section-title gold">
          <h2>Cadre légal</h2>
        </div>
        <p style={{ color: "var(--text-1)", margin: "0 0 10px", lineHeight: 1.75, fontSize: 15 }}>
          Bluegenji Esport est une association régie par la loi du 1er juillet 1901 et le décret du 16 août 1901.
        </p>
        <p style={{ color: "var(--text-1)", margin: 0, lineHeight: 1.75, fontSize: 15 }}>
          Ses ressources comprennent les cotisations membres, les subventions et les autres ressources autorisées par les
          textes en vigueur.
        </p>
      </section>
    </main>
  );
}

const MISSIONS = [
  {
    icon: "🏆",
    title: "Tournois & Événements",
    rgb: "245,195,58",
    desc: "Organisation de compétitions en ligne et en LAN, adaptées à toutes les progressions.",
  },
  {
    icon: "🤝",
    title: "Fédération d'équipes",
    rgb: "220,165,35",
    desc: "Rassembler les équipes participantes pour construire un écosystème compétitif durable.",
  },
  {
    icon: "📡",
    title: "Retransmission en direct",
    rgb: "255,210,80",
    desc: "Production et diffusion live des événements avec une qualité broadcast.",
  },
  {
    icon: "⭐",
    title: "Formation & Visibilité",
    rgb: "220,165,35",
    desc: "Accompagner et mettre en avant joueurs, coaches, managers, casters et organisateurs.",
  },
];

const ACTIVITIES = [
  {
    title: "BlueLan",
    tag: "Événement présentiel",
    rgb: "245,195,58",
    imgLabel: "Photo de l'événement BlueLan",
    desc: "Événement LAN communautaire autour de Marvel Rivals.",
  },
  {
    title: "Tournois Marvel Rivals",
    tag: "Compétition en ligne",
    rgb: "220,165,35",
    imgLabel: "Capture d'un tournoi en cours",
    desc: "Compétitions régulières en simple et double élimination.",
  },
  {
    title: "Bot Discord inter-serveurs",
    tag: "Outil communautaire",
    rgb: "255,210,80",
    imgLabel: "Aperçu du bot Discord",
    desc: "Réseau de diffusion d'annonces entre serveurs avec filtres automatiques.",
  },
  {
    title: "Accompagnement & Coaching",
    tag: "Formation",
    rgb: "220,165,35",
    imgLabel: "Session de coaching",
    desc: "Encadrement des équipes émergentes : roster, coaching et préparation.",
  },
];

const BUREAU = [
  {
    role: "Président",
    name: "Leo PERREAUT",
    rgb: "245,195,58",
    desc: "Représente l'association dans les actes de la vie civile et ordonnance les dépenses.",
  },
  {
    role: "Trésorier",
    name: "Bryan BOULLEAUX",
    rgb: "220,165,35",
    desc: "Tient les comptes de l'association et présente le bilan financier à l'Assemblée Générale.",
  },
];

const TIERS = [
  {
    type: "Ordinaire",
    rgb: "200,160,40",
    featured: false,
    items: [
      "Inscription via bulletin d'adhésion",
      "Sans cotisation",
      "Accès à tous les événements",
      "Participation aux activités",
    ],
  },
  {
    type: "Bienfaiteur",
    rgb: "245,195,58",
    featured: true,
    items: [
      "Cotisation annuelle définie par l'AG",
      "Soutien financier direct",
      "Contribution aux projets",
      "Mise en avant du soutien",
    ],
  },
  {
    type: "Honneur",
    rgb: "255,210,80",
    featured: false,
    items: [
      "Décerné par le bureau",
      "Dispensé de cotisation",
      "Reconnaissance exceptionnelle",
      "Services rendus à l'association",
    ],
  },
];
