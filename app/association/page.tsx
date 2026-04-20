import Link from "next/link";

export default function AssociationPage() {
  return (
    <main className="page-shell">
      <Link href="/" className="cta-float-home">
        ⌂ Accueil
      </Link>
      <Link href="/tournois" className="cta-float">
        Acceder aux tournois →
      </Link>

      <section className="fade-in ds-hero">
        <div className="ds-hero-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
          <div>
            <span className="badge" style={{ marginBottom: 24, display: "inline-block" }}>
              Association loi 1901 - Fondee le 11 septembre 2022
            </span>
            <h1 className="ds-title" style={{ fontSize: "clamp(44px, 5vw, 70px)", lineHeight: 1.06, marginBottom: 22 }}>
              Bluegenji
              <br />
              Esport
            </h1>
            <p style={{ fontSize: 17, lineHeight: 1.75, color: "var(--text-1)", margin: "0 0 40px", maxWidth: 480 }}>
              Structure associative esport dediee a la scene amateur francophone. Implantee au Mans, nous organisons des tournois, des evenements LAN et federons les equipes competitives autour de Marvel Rivals.
            </p>
            <div className="ds-stats">
              {[
                { label: "Fondee le", value: "11 sept. 2022" },
                { label: "Siege social", value: "Le Mans (72)" },
                { label: "Regime", value: "Loi 1901" },
                { label: "Age minimum", value: "16 ans" },
              ].map((k) => (
                <div key={k.label} className="ds-stat">
                  <div className="ds-stat-label">{k.label}</div>
                  <div className="ds-stat-value" style={{ fontSize: 16 }}>{k.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              borderRadius: 20,
              border: "1px dashed rgba(89,212,255,0.28)",
              aspectRatio: "4 / 3",
              background: "linear-gradient(135deg, rgba(13,20,36,0.9) 0%, rgba(22,32,52,0.95) 100%)",
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
                border: "2px dashed rgba(89,212,255,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                color: "rgba(89,212,255,0.5)",
              }}
            >
              📷
            </div>
            <span style={{ color: "var(--text-2)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Photo de l'equipe
            </span>
          </div>
        </div>
      </section>

      <section className="fade-in" style={{ marginBottom: 32 }}>
        <div className="ds-section-title blue">
          <h2>Notre mission</h2>
        </div>
        <div className="grid-2">
          {MISSIONS.map((item) => (
            <article key={item.title} className="ds-block" style={{ borderColor: `rgba(${item.rgb},0.18)`, position: "relative", overflow: "hidden" }}>
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
        <div className="ds-section-title orange">
          <h2>Nos activites</h2>
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
        <div className="ds-section-title green">
          <h2>Le Bureau</h2>
        </div>
        <div className="grid-2" style={{ marginTop: 0 }}>
          {BUREAU.map((person) => (
            <article key={person.name} className="ds-block" style={{ borderColor: `rgba(${person.rgb},0.2)`, display: "flex", gap: 22, alignItems: "flex-start", position: "relative", overflow: "hidden" }}>
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
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: `rgb(${person.rgb})`, fontWeight: 700, marginBottom: 6 }}>
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
        <div className="ds-section-title orange">
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
              {tier.featured && <span className="ds-chip" style={{ position: "absolute", top: 16, right: 16 }}>Populaire</span>}
              <h3 style={{ fontFamily: "var(--font-title), sans-serif", fontSize: 22, margin: "0 0 20px", color: `rgb(${tier.rgb})`, letterSpacing: "0.03em" }}>
                {tier.type}
              </h3>
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {tier.items.map((item) => (
                  <li key={item} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--line)", fontSize: 14, color: "var(--text-1)", lineHeight: 1.5 }}>
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
        <div className="ds-section-title blue">
          <h2>Cadre legal</h2>
        </div>
        <p style={{ color: "var(--text-1)", margin: "0 0 10px", lineHeight: 1.75, fontSize: 15 }}>
          Bluegenji Esport est une association regie par la loi du 1er juillet 1901 et le decret du 16 aout 1901.
        </p>
        <p style={{ color: "var(--text-1)", margin: 0, lineHeight: 1.75, fontSize: 15 }}>
          Ses ressources comprennent les cotisations membres, les subventions et les autres ressources autorisees par les textes en vigueur.
        </p>
      </section>
    </main>
  );
}

const MISSIONS = [
  { icon: "🏆", title: "Tournois & Evenements", rgb: "89,212,255", desc: "Organisation de competitions en ligne et en LAN, adaptees a toutes les progressions." },
  { icon: "🤝", title: "Federation d'equipes", rgb: "255,157,46", desc: "Rassembler les equipes participantes pour construire un ecosysteme competitif durable." },
  { icon: "📡", title: "Retransmission en direct", rgb: "79,224,162", desc: "Production et diffusion live des evenements avec une qualite broadcast." },
  { icon: "⭐", title: "Formation & Visibilite", rgb: "255,157,46", desc: "Accompagner et mettre en avant joueurs, coaches, managers, casters et organisateurs." },
];

const ACTIVITIES = [
  { title: "BlueLan", tag: "Evenement presentiel", rgb: "89,212,255", imgLabel: "Photo de l'evenement BlueLan", desc: "Evenement LAN communautaire autour de Marvel Rivals." },
  { title: "Tournois Marvel Rivals", tag: "Competition en ligne", rgb: "255,157,46", imgLabel: "Capture d'un tournoi en cours", desc: "Competitions regulieres en simple et double elimination." },
  { title: "Bot Discord inter-serveurs", tag: "Outil communautaire", rgb: "79,224,162", imgLabel: "Apercu du bot Discord", desc: "Reseau de diffusion d'annonces entre serveurs avec filtres automatiques." },
  { title: "Accompagnement & Coaching", tag: "Formation", rgb: "255,157,46", imgLabel: "Session de coaching", desc: "Encadrement des equipes emergentes: roster, coaching et preparation." },
];

const BUREAU = [
  { role: "President", name: "Leo PERREAUT", rgb: "89,212,255", desc: "Represente l'association dans les actes de la vie civile et ordonnance les depenses." },
  { role: "Tresorier", name: "Bryan BOULLEAUX", rgb: "79,224,162", desc: "Tient les comptes de l'association et presente le bilan financier a l'Assemblee Generale." },
];

const TIERS = [
  { type: "Ordinaire", rgb: "89,212,255", featured: false, items: ["Inscription via bulletin d'adhesion", "Sans cotisation", "Acces a tous les evenements", "Participation aux activites"] },
  { type: "Bienfaiteur", rgb: "255,157,46", featured: true, items: ["Cotisation annuelle definie par l'AG", "Soutien financier direct", "Contribution aux projets", "Mise en avant du soutien"] },
  { type: "Honneur", rgb: "79,224,162", featured: false, items: ["Decerne par le bureau", "Dispense de cotisation", "Reconnaissance exceptionnelle", "Services rendus a l'association"] },
];
