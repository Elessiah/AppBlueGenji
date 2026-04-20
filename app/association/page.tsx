import Link from "next/link";

export default function AssociationPage() {
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
        {/* ambient glows */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse at 10% 60%, rgba(89,212,255,0.14) 0%, transparent 50%), radial-gradient(ellipse at 90% 10%, rgba(255,157,46,0.1) 0%, transparent 45%)",
          }}
        />
        {/* top color bar */}
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
            gap: 56,
            alignItems: "center",
          }}
        >
          {/* ── Text ── */}
          <div>
            <span className="badge" style={{ marginBottom: 24, display: "inline-block" }}>
              Association loi 1901 · Fondée le 11 septembre 2022
            </span>
            <h1
              style={{
                fontFamily: "var(--font-title), sans-serif",
                fontSize: "clamp(44px, 5vw, 70px)",
                fontWeight: 700,
                lineHeight: 1.06,
                letterSpacing: "0.02em",
                margin: "0 0 22px",
                background: "linear-gradient(135deg, #f3f7ff 10%, #59d4ff 55%, #ff9d2e 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Bluegenji
              <br />
              Esport
            </h1>
            <p
              style={{
                fontSize: 17,
                lineHeight: 1.75,
                color: "var(--text-1)",
                margin: "0 0 40px",
                maxWidth: 480,
              }}
            >
              Structure associative esport dédiée à la scène amateur francophone. Implantée au{" "}
              <strong style={{ color: "var(--text-0)" }}>Mans</strong>, nous organisons des
              tournois, des événements LAN, formons les acteurs du milieu et fédérons les équipes
              compétitives autour de{" "}
              <strong style={{ color: "var(--accent-blue)" }}>Marvel Rivals</strong>.
            </p>
            {/* KPIs */}
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
              {[
                { label: "Fondée le", value: "11 sept. 2022" },
                { label: "Siège social", value: "Le Mans (72)" },
                { label: "Régime", value: "Loi 1901" },
                { label: "Âge minimum", value: "16 ans" },
              ].map((k) => (
                <div
                  key={k.label}
                  style={{ borderLeft: "2px solid rgba(89,212,255,0.4)", paddingLeft: 14 }}
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
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{k.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Image placeholder ── */}
          <div
            style={{
              borderRadius: 20,
              border: "1px dashed rgba(89,212,255,0.28)",
              aspectRatio: "4 / 3",
              background:
                "linear-gradient(135deg, rgba(13,20,36,0.9) 0%, rgba(22,32,52,0.95) 100%)",
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
            <span
              style={{
                color: "var(--text-2)",
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              Photo de l'équipe
            </span>
          </div>
        </div>
      </section>

      {/* ── MISSION ──────────────────────────────────────────────────────── */}
      <section className="fade-in" style={{ marginBottom: 32 }}>
        <SectionHeader
          title="Notre mission"
          sub="Quatre engagements fondamentaux envers la communauté esport amateur"
          gradient="linear-gradient(180deg, #59d4ff, #ff9d2e)"
        />
        <div className="grid-2">
          {MISSIONS.map((item) => (
            <article
              key={item.title}
              style={{
                border: `1px solid rgba(${item.rgb},0.18)`,
                borderRadius: 20,
                background: "rgba(13,18,30,0.88)",
                padding: "28px 24px 26px",
                position: "relative",
                overflow: "hidden",
                transition: "transform 0.2s ease, border-color 0.2s ease",
              }}
            >
              <TopBar rgb={item.rgb} />
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
              <h3
                style={{
                  fontFamily: "var(--font-title), sans-serif",
                  fontSize: 20,
                  margin: "0 0 10px",
                  letterSpacing: "0.02em",
                }}
              >
                {item.title}
              </h3>
              <p style={{ color: "var(--text-1)", margin: 0, lineHeight: 1.65, fontSize: 15 }}>
                {item.desc}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ── ACTIVITÉS ────────────────────────────────────────────────────── */}
      <section className="fade-in" style={{ marginBottom: 32 }}>
        <SectionHeader
          title="Nos activités"
          sub="Les projets qui font vivre la communauté BlueGenji"
          gradient="linear-gradient(180deg, #ff9d2e, #4fe0a2)"
        />
        <div className="grid-2">
          {ACTIVITIES.map((activity) => (
            <article
              key={activity.title}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 20,
                background: "rgba(13,18,30,0.85)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                transition: "transform 0.2s ease, border-color 0.2s ease",
              }}
            >
              {/* Image placeholder */}
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
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.09em",
                    textTransform: "uppercase",
                    color: `rgba(${activity.rgb},0.55)`,
                  }}
                >
                  {activity.imgLabel}
                </span>
              </div>
              {/* Content */}
              <div style={{ padding: "22px 24px 26px", flex: 1 }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "3px 10px",
                    borderRadius: 999,
                    border: `1px solid rgba(${activity.rgb},0.3)`,
                    background: `rgba(${activity.rgb},0.08)`,
                    color: `rgb(${activity.rgb})`,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    marginBottom: 12,
                  }}
                >
                  {activity.tag}
                </span>
                <h3
                  style={{
                    fontFamily: "var(--font-title), sans-serif",
                    fontSize: 20,
                    margin: "0 0 10px",
                    letterSpacing: "0.02em",
                  }}
                >
                  {activity.title}
                </h3>
                <p style={{ color: "var(--text-1)", margin: 0, lineHeight: 1.65, fontSize: 15 }}>
                  {activity.desc}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── BUREAU ───────────────────────────────────────────────────────── */}
      <section className="fade-in" style={{ marginBottom: 32 }}>
        <SectionHeader
          title="Le Bureau"
          sub="L'association est administrée par un bureau élu d'au moins deux membres"
          gradient="linear-gradient(180deg, #4fe0a2, #59d4ff)"
        />
        <div className="grid-2">
          {BUREAU.map((person) => (
            <article
              key={person.name}
              style={{
                border: `1px solid rgba(${person.rgb},0.2)`,
                borderRadius: 20,
                background: "rgba(13,18,30,0.88)",
                padding: "28px",
                display: "flex",
                gap: 22,
                alignItems: "flex-start",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <TopBar rgb={person.rgb} />
              {/* Avatar placeholder */}
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
                <h3
                  style={{
                    fontFamily: "var(--font-title), sans-serif",
                    fontSize: 24,
                    margin: "0 0 10px",
                    letterSpacing: "0.02em",
                  }}
                >
                  {person.name}
                </h3>
                <p style={{ color: "var(--text-1)", margin: 0, lineHeight: 1.65, fontSize: 15 }}>
                  {person.desc}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── ADHÉSION ─────────────────────────────────────────────────────── */}
      <section className="fade-in" style={{ marginBottom: 32 }}>
        <SectionHeader
          title="Nous rejoindre"
          sub="Bluegenji Esport accueille toute personne de 16 ans et plus partageant ses valeurs"
          gradient="linear-gradient(180deg, #ff9d2e, #59d4ff)"
        />
        <div className="grid-3" style={{ marginTop: 0 }}>
          {TIERS.map((tier) => (
            <article
              key={tier.type}
              style={{
                border: `1px solid rgba(${tier.rgb},${tier.featured ? "0.4" : "0.18"})`,
                borderRadius: 20,
                background: tier.featured
                  ? `linear-gradient(160deg, rgba(${tier.rgb},0.06) 0%, rgba(13,18,30,0.9) 100%)`
                  : "rgba(13,18,30,0.88)",
                padding: "28px 24px 26px",
                position: "relative",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <TopBar rgb={tier.rgb} />
              {tier.featured && (
                <span
                  style={{
                    position: "absolute",
                    top: 16,
                    right: 16,
                    padding: "3px 10px",
                    borderRadius: 999,
                    background: `rgba(${tier.rgb},0.15)`,
                    border: `1px solid rgba(${tier.rgb},0.3)`,
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: `rgb(${tier.rgb})`,
                  }}
                >
                  Populaire
                </span>
              )}
              <h3
                style={{
                  fontFamily: "var(--font-title), sans-serif",
                  fontSize: 22,
                  margin: "0 0 20px",
                  color: `rgb(${tier.rgb})`,
                  letterSpacing: "0.03em",
                }}
              >
                {tier.type}
              </h3>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", flex: 1 }}>
                {tier.items.map((item) => (
                  <li
                    key={item}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "9px 0",
                      borderBottom: "1px solid var(--line)",
                      fontSize: 14,
                      color: "var(--text-1)",
                      lineHeight: 1.5,
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: `rgba(${tier.rgb},0.15)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        color: `rgb(${tier.rgb})`,
                        marginTop: 1,
                        fontWeight: 700,
                      }}
                    >
                      ✓
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* ── CADRE LÉGAL ──────────────────────────────────────────────────── */}
      <section
        className="fade-in"
        style={{
          border: "1px solid var(--line)",
          borderRadius: 20,
          background: "rgba(13,18,30,0.76)",
          padding: "28px 32px",
          marginBottom: 32,
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-title), sans-serif",
            fontSize: 22,
            margin: "0 0 16px",
            letterSpacing: "0.02em",
          }}
        >
          Cadre légal
        </h2>
        <p style={{ color: "var(--text-1)", margin: "0 0 10px", lineHeight: 1.75, fontSize: 15 }}>
          Bluegenji Esport est une association régie par la loi du 1er juillet 1901 et le décret du
          16 août 1901. Fondée à Krautwiller le 11 septembre 2022, son siège est établi au 78
          avenue Général Leclerc, 72000 Le Mans. L'association est constituée pour une durée
          illimitée.
        </p>
        <p style={{ color: "var(--text-1)", margin: 0, lineHeight: 1.75, fontSize: 15 }}>
          Ses ressources comprennent les droits d'entrée et cotisations membres, les subventions de
          l'État, des départements et des communes, ainsi que toute autre ressource autorisée par
          les textes législatifs et réglementaires en vigueur.
        </p>
      </section>

      {/* ── JOIN CTA ─────────────────────────────────────────────────────── */}
      <section
        className="fade-in"
        style={{
          borderRadius: 24,
          border: "1px solid rgba(89,212,255,0.2)",
          background:
            "linear-gradient(135deg, rgba(9,14,24,0.97) 0%, rgba(18,28,46,0.96) 100%)",
          padding: "60px 56px",
          textAlign: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse at 50% 120%, rgba(89,212,255,0.12) 0%, transparent 55%)",
          }}
        />
        <div style={{ position: "relative" }}>
          <h2
            style={{
              fontFamily: "var(--font-title), sans-serif",
              fontSize: "clamp(28px, 3.5vw, 44px)",
              margin: "0 0 14px",
              letterSpacing: "0.02em",
            }}
          >
            Prêt à rejoindre l'aventure ?
          </h2>
          <p
            style={{
              color: "var(--text-1)",
              fontSize: 16,
              maxWidth: 480,
              margin: "0 auto 36px",
              lineHeight: 1.75,
            }}
          >
            Rejoins la communauté BlueGenji, participe aux tournois et deviens acteur de la scène
            esport amateur francophone.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Link
              className="btn"
              href="/connexion"
              style={{
                padding: "14px 36px",
                fontSize: 15,
                background: "var(--accent-blue)",
                color: "var(--bg-0)",
                border: "none",
                fontWeight: 700,
                borderRadius: 999,
                boxShadow: "0 4px 28px rgba(89,212,255,0.4)",
              }}
            >
              Rejoindre la plateforme
            </Link>
            <Link className="btn ghost" href="/" style={{ padding: "14px 36px", fontSize: 15 }}>
              Retour à l'accueil
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

/* ── Shared presentational components ─────────────────────────────────────── */

function SectionHeader({
  title,
  sub,
  gradient,
}: {
  title: string;
  sub: string;
  gradient: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 24 }}>
      <span
        style={{
          flexShrink: 0,
          width: 4,
          height: 36,
          background: gradient,
          borderRadius: 2,
          marginTop: 4,
        }}
      />
      <div>
        <h2
          style={{
            fontFamily: "var(--font-title), sans-serif",
            fontSize: 30,
            margin: 0,
            letterSpacing: "0.02em",
          }}
        >
          {title}
        </h2>
        <p style={{ color: "var(--text-2)", margin: "6px 0 0", fontSize: 14 }}>{sub}</p>
      </div>
    </div>
  );
}

function TopBar({ rgb }: { rgb: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: `linear-gradient(90deg, rgba(${rgb},0.85), transparent)`,
      }}
    />
  );
}

/* ── Data ──────────────────────────────────────────────────────────────────── */

const MISSIONS = [
  {
    icon: "🏆",
    title: "Tournois & Événements",
    rgb: "89,212,255",
    desc: "Organisation de compétitions en ligne et en LAN, avec des formats adaptés à toutes les progressions — du joueur débutant à l'équipe confirmée.",
  },
  {
    icon: "🤝",
    title: "Fédération d'équipes",
    rgb: "255,157,46",
    desc: "Rassembler et structurer les équipes participantes pour construire un écosystème compétitif cohérent, durable et ouvert à tous.",
  },
  {
    icon: "📡",
    title: "Retransmission en direct",
    rgb: "79,224,162",
    desc: "Production et diffusion live des événements. Commentateurs, réalisateurs et techniciens unis pour un broadcast de qualité.",
  },
  {
    icon: "⭐",
    title: "Formation & Visibilité",
    rgb: "255,157,46",
    desc: "Accompagner et mettre en avant joueurs, coaches, managers, casters et organisateurs — valoriser chaque rôle de l'esport amateur.",
  },
];

const ACTIVITIES = [
  {
    title: "BlueLan",
    tag: "Événement présentiel",
    rgb: "89,212,255",
    imgLabel: "Photo de l'événement BlueLan",
    desc: "Événement LAN communautaire : compétition en présentiel, networking, production locale et expérience esport immersive autour de Marvel Rivals.",
  },
  {
    title: "Tournois Marvel Rivals",
    tag: "Compétition en ligne",
    rgb: "255,157,46",
    imgLabel: "Capture d'un tournoi en cours",
    desc: "Compétitions régulières en simple et double élimination, bracket live, suivi statistique des performances et accompagnement des équipes.",
  },
  {
    title: "Bot Discord inter-serveurs",
    tag: "Outil communautaire",
    rgb: "79,224,162",
    imgLabel: "Aperçu du bot Discord",
    desc: "Réseau de diffusion d'annonces entre serveurs : scrims, LFS/LFP/LFT, recrutement de staff et de cast, filtres région et rang automatisés.",
  },
  {
    title: "Accompagnement & Coaching",
    tag: "Formation",
    rgb: "255,157,46",
    imgLabel: "Session de coaching",
    desc: "Encadrement des équipes émergentes : structuration de roster, coaching, gestion, suivi de progression et préparation aux compétitions.",
  },
];

const BUREAU = [
  {
    role: "Président",
    name: "Leo PERREAUT",
    rgb: "89,212,255",
    desc: "Représente l'association dans tous les actes de la vie civile, préside les assemblées générales et ordonnance les dépenses.",
  },
  {
    role: "Trésorier",
    name: "Bryan BOULLEAUX",
    rgb: "79,224,162",
    desc: "Tient les comptes de l'association, effectue les paiements sous contrôle du président et présente le bilan financier à l'Assemblée Générale.",
  },
];

const TIERS = [
  {
    type: "Ordinaire",
    rgb: "89,212,255",
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
    rgb: "255,157,46",
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
    rgb: "79,224,162",
    featured: false,
    items: [
      "Décerné par le bureau",
      "Dispensé de cotisation",
      "Reconnaissance exceptionnelle",
      "Services rendus à l'association",
    ],
  },
];
