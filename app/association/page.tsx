import type { Metadata } from "next";
import Link from "next/link";
import { LogoHero } from "@/components/logo-hero";
import { PageWithPalette } from "@/components/page-with-palette";

export const metadata: Metadata = {
  title: "BlueGenji - Association Esport Overwatch 2",
  description: "Découvrez BlueGenji, association loi 1901 spécialisée en Overwatch 2. Tournois, événements LAN, coaching et communauté francophone en ligne.",
  openGraph: {
    title: "BlueGenji - Association Esport",
    description: "Structure compétitive et inclusive pour la scène esport francophone.",
    type: "website",
    locale: "fr_FR",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function AssociationPage() {
  return (
    <PageWithPalette palette="gold">
      <main className="page-shell" style={{ position: "relative", zIndex: 1 }}>
      <Link href="/" className="cta-float-home home">⌂ Accueil</Link>
      <Link href="/tournois" className="cta-float">Accéder aux tournois →</Link>

      {/* ── HERO ── */}
      <section className="fade-in ds-hero">
        <div className="ds-hero-body" style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 52, alignItems: "center" }}>
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
              <span className="badge">Association loi 1901</span>
              <span className="badge" style={{ borderColor: "rgba(245,195,58,0.45)", background: "rgba(245,195,58,0.1)", color: "rgb(245,195,58)" }}>
                Fondée en 2022
              </span>
              <span className="badge" style={{ borderColor: "rgba(89,212,255,0.4)", background: "rgba(89,212,255,0.09)", color: "rgb(89,212,255)" }}>
                En ligne
              </span>
            </div>

            <h1 className="ds-title" style={{ fontSize: "clamp(48px, 5.5vw, 80px)", lineHeight: 1.04, marginBottom: 4 }}>
              Bluegenji
            </h1>
            <h2 className="ds-title orange" style={{ fontSize: "clamp(26px, 3vw, 42px)", lineHeight: 1.1, marginBottom: 26, fontWeight: 600 }}>
              Esport
            </h2>

            <p style={{ fontSize: 17, lineHeight: 1.8, color: "var(--text-1)", margin: "0 0 8px", maxWidth: 520 }}>
              Structure associative compétitive en ligne spécialisée en{" "}
              <strong style={{ color: "var(--accent-blue)", fontWeight: 700 }}>Overwatch 2</strong>
              . Tournois, événements LAN et accompagnement des équipes de la scène amateur francophone.
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--text-2)", margin: "0 0 36px", maxWidth: 480 }}>
              Nous accueillons également les compétiteurs{" "}
              <span style={{ color: "rgb(167,115,255)", fontWeight: 600 }}>Marvel Rivals</span>
              {" "}dans notre communauté francophone.
            </p>

            <div className="ds-stats">
              {HERO_STATS.map((k) => (
                <div key={k.label} className="ds-stat">
                  <div className="ds-stat-label">{k.label}</div>
                  <div className="ds-stat-value" style={{ fontSize: 15 }}>{k.value}</div>
                </div>
              ))}
            </div>
          </div>

          <LogoHero />
        </div>
      </section>

      {/* ── NOS JEUX ── */}
      <section className="fade-in" style={{ marginBottom: 32 }}>
        <div className="ds-section-title">
          <h2>Nos jeux</h2>
        </div>
        <div className="grid-2">
          {/* Overwatch — principal */}
          <article className="ds-block" style={{
            borderColor: "rgba(89,212,255,0.28)",
            position: "relative",
            overflow: "hidden",
            background: "linear-gradient(135deg, rgba(6,20,40,0.97) 0%, rgba(13,18,30,0.92) 100%)",
          }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, rgba(89,212,255,1), rgba(255,157,46,0.6), transparent)" }} />
            <span className="ds-chip" style={{ position: "absolute", top: 20, right: 20, borderColor: "rgba(89,212,255,0.4)", background: "rgba(89,212,255,0.1)", color: "var(--accent-blue)" }}>
              Jeu principal
            </span>

            <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
              <div style={{
                flexShrink: 0,
                width: 64,
                height: 64,
                borderRadius: 16,
                border: "1.5px dashed rgba(89,212,255,0.3)",
                background: "rgba(89,212,255,0.05)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
              }}>🎯</div>
              <div>
                <h3 style={{ fontFamily: "var(--font-title), sans-serif", fontSize: 24, margin: "0 0 10px", letterSpacing: "0.02em", color: "var(--accent-blue)" }}>
                  Overwatch 2
                </h3>
                <p style={{ color: "var(--text-1)", margin: "0 0 18px", lineHeight: 1.7, fontSize: 15 }}>
                  Notre discipline phare depuis la création de l'association. Tournois hebdomadaires, coaching d'équipes, analyse de replay et organisation d'événements LAN — tout notre savoir-faire est concentré sur Overwatch.
                </p>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {["Tournois", "Coaching", "LAN", "Broadcast", "Analyse"].map((tag) => (
                    <span key={tag} className="ds-chip" style={{ fontSize: 11 }}>{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          </article>

          {/* Marvel Rivals — secondaire */}
          <article className="ds-block" style={{ borderColor: "rgba(167,115,255,0.22)", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, rgba(167,115,255,0.85), transparent)" }} />
            <span className="ds-chip purple" style={{ position: "absolute", top: 20, right: 20, fontSize: 11 }}>
              Branche secondaire
            </span>

            <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
              <div style={{
                flexShrink: 0,
                width: 64,
                height: 64,
                borderRadius: 16,
                border: "1.5px dashed rgba(167,115,255,0.3)",
                background: "rgba(167,115,255,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
              }}>⚔️</div>
              <div>
                <h3 style={{ fontFamily: "var(--font-title), sans-serif", fontSize: 24, margin: "0 0 10px", letterSpacing: "0.02em", color: "rgb(167,115,255)" }}>
                  Marvel Rivals
                </h3>
                <p style={{ color: "var(--text-1)", margin: "0 0 18px", lineHeight: 1.7, fontSize: 15 }}>
                  Notre branche en développement actif. Tournois en ligne et présence lors des BlueLan — la communauté Marvel Rivals francophone trouve également sa place chez BlueGenji.
                </p>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  {["Tournois", "BlueLan"].map((tag) => (
                    <span key={tag} className="ds-chip purple" style={{ fontSize: 11 }}>{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>

      {/* ── CHIFFRES CLÉS ── */}
      <section className="fade-in ds-block" style={{ marginBottom: 32 }}>
        <div className="ds-section-title">
          <h2>BlueGenji en chiffres</h2>
        </div>
        <div className="kpi-row">
          {IMPACT.map((item) => (
            <div key={item.label} className="kpi" style={{ borderColor: `rgba(${item.rgb},0.2)`, textAlign: "center", padding: "18px 12px" }}>
              <div className="kpi-value" style={{ color: `rgb(${item.rgb})`, fontFamily: "var(--font-title), sans-serif" }}>
                {item.value}
              </div>
              <div className="kpi-label" style={{ marginTop: 8 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── NOTRE MISSION ── */}
      <section className="fade-in" style={{ marginBottom: 32 }}>
        <div className="ds-section-title">
          <h2>Notre mission</h2>
        </div>
        <div className="grid-2">
          {MISSIONS.map((item) => (
            <article key={item.title} className="ds-block" style={{ borderColor: `rgba(${item.rgb},0.2)`, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, rgba(${item.rgb},0.85), transparent)` }} />
              <span style={{
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
              }}>
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

      {/* ── NOS ACTIVITÉS ── */}
      <section className="fade-in" style={{ marginBottom: 32 }}>
        <div className="ds-section-title">
          <h2>Nos activités</h2>
        </div>
        <div className="grid-2">
          {ACTIVITIES.map((activity) => (
            <article key={activity.title} className="ds-block" style={{ padding: 0, overflow: "hidden", borderColor: `rgba(${activity.rgb},0.2)` }}>
              <div style={{
                aspectRatio: "16 / 7",
                background: `linear-gradient(135deg, rgba(${activity.rgb},0.08) 0%, rgba(13,20,36,0.97) 100%)`,
                borderBottom: "1px solid var(--line)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
              }}>
                <div style={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  border: `1.5px dashed rgba(${activity.rgb},0.4)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                }}>🖼</div>
                <span style={{ fontSize: 10, letterSpacing: "0.09em", textTransform: "uppercase", color: `rgba(${activity.rgb},0.75)` }}>
                  {activity.imgLabel}
                </span>
              </div>
              <div style={{ padding: "22px 24px 26px" }}>
                <span className="ds-chip" style={{ marginBottom: 12, borderColor: `rgba(${activity.rgb},0.35)`, background: `rgba(${activity.rgb},0.1)`, color: `rgb(${activity.rgb})` }}>
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

      {/* ── LE BUREAU ── */}
      <section className="fade-in ds-block" style={{ marginBottom: 32 }}>
        <div className="ds-section-title">
          <h2>Le Bureau</h2>
        </div>
        <div className="grid-2" style={{ marginTop: 0 }}>
          {BUREAU.map((person) => (
            <article key={person.name} className="ds-block" style={{
              borderColor: `rgba(${person.rgb},0.2)`,
              display: "flex",
              gap: 22,
              alignItems: "flex-start",
              position: "relative",
              overflow: "hidden",
            }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, rgba(${person.rgb},0.85), transparent)` }} />
              <div style={{
                flexShrink: 0,
                width: 76,
                height: 76,
                borderRadius: "50%",
                border: `2px dashed rgba(${person.rgb},0.4)`,
                background: `rgba(${person.rgb},0.07)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                marginTop: 4,
              }}>👤</div>
              <div>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: `rgb(${person.rgb})`, fontWeight: 700, marginBottom: 6 }}>
                  {person.role}
                </div>
                <h3 style={{ fontFamily: "var(--font-title), sans-serif", fontSize: 22, margin: "0 0 4px", letterSpacing: "0.02em" }}>
                  {person.name}
                </h3>
                {person.pseudo && (
                  <div style={{ fontSize: 13, color: "var(--accent-blue)", marginBottom: 10, fontStyle: "italic" }}>{person.pseudo}</div>
                )}
                <p style={{ color: "var(--text-1)", margin: "8px 0 0", lineHeight: 1.65, fontSize: 15 }}>{person.desc}</p>
              </div>
            </article>
          ))}
        </div>
        <p style={{ marginTop: 20, color: "var(--text-2)", fontSize: 13, textAlign: "center", lineHeight: 1.6 }}>
          L'association s'appuie sur des membres bénévoles engagés — organisateurs, casters, coaches et modérateurs — qui contribuent activement à chaque événement.
        </p>
      </section>

      {/* ── NOUS REJOINDRE ── */}
      <section className="fade-in ds-block" style={{ marginBottom: 32 }}>
        <div className="ds-section-title gold">
          <h2>Nous rejoindre</h2>
        </div>
        <p style={{ color: "var(--text-1)", margin: "0 0 24px", lineHeight: 1.75, fontSize: 15, maxWidth: 640 }}>
          L'adhésion à BlueGenji vous ouvre les portes de tous nos tournois, événements et ressources.
          Gratuite pour les membres ordinaires — aucune barrière à l'entrée.
        </p>
        <div className="grid-3" style={{ marginTop: 0 }}>
          {TIERS.map((tier) => (
            <article key={tier.type} className="ds-block" style={{
              borderColor: `rgba(${tier.rgb},${tier.featured ? "0.4" : "0.18"})`,
              background: tier.featured
                ? `linear-gradient(160deg, rgba(${tier.rgb},0.07) 0%, rgba(13,18,30,0.9) 100%)`
                : "rgba(13,18,30,0.88)",
              position: "relative",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, rgba(${tier.rgb},0.85), transparent)` }} />
              {tier.featured && (
                <span className="ds-chip" style={{ position: "absolute", top: 16, right: 16, borderColor: `rgba(${tier.rgb},0.35)`, background: `rgba(${tier.rgb},0.1)`, color: `rgb(${tier.rgb})` }}>
                  Populaire
                </span>
              )}
              <h3 style={{ fontFamily: "var(--font-title), sans-serif", fontSize: 20, margin: "0 0 20px", color: `rgb(${tier.rgb})`, letterSpacing: "0.03em" }}>
                {tier.type}
              </h3>
              <ul style={{ margin: "0 0 20px", padding: 0, listStyle: "none", flex: 1 }}>
                {tier.items.map((item) => (
                  <li key={item} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--line)", fontSize: 14, color: "var(--text-1)", lineHeight: 1.5 }}>
                    <span style={{ color: `rgb(${tier.rgb})`, flexShrink: 0 }}>✓</span>
                    {item}
                  </li>
                ))}
              </ul>
              {tier.cta && (
                <a href={tier.cta.href} style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "11px 18px",
                  borderRadius: 999,
                  border: `1px solid rgba(${tier.rgb},0.4)`,
                  background: `rgba(${tier.rgb},0.1)`,
                  color: `rgb(${tier.rgb})`,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  transition: "background 0.16s ease",
                  marginTop: "auto",
                }}>
                  {tier.cta.label}
                </a>
              )}
            </article>
          ))}
        </div>
      </section>

      {/* ── CTA COMMUNAUTÉ ── */}
      <section className="fade-in ds-hero gold" style={{ marginBottom: 32 }}>
        <div className="ds-hero-body" style={{ textAlign: "center", maxWidth: 600, margin: "0 auto" }}>
          <span className="badge" style={{ marginBottom: 20, display: "inline-block", borderColor: "rgba(245,195,58,0.45)", background: "rgba(245,195,58,0.1)", color: "rgb(245,195,58)" }}>
            Communauté
          </span>
          <h2 style={{ fontFamily: "var(--font-title), sans-serif", fontSize: "clamp(26px, 4vw, 44px)", margin: "0 0 16px", letterSpacing: "0.02em" }}>
            Rejoignez la communauté BlueGenji
          </h2>
          <p style={{ color: "var(--text-1)", fontSize: 16, lineHeight: 1.8, margin: "0 0 34px" }}>
            Tournois, coaching, annonces en avant-première — tout se passe sur notre Discord.
            Des centaines de joueurs Overwatch et Marvel Rivals vous attendent.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <a href="[LIEN_DISCORD]" style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "13px 28px",
              borderRadius: 999,
              background: "#5865F2",
              color: "#fff",
              fontWeight: 700,
              fontSize: 15,
              border: "none",
              boxShadow: "0 4px 24px rgba(88,101,242,0.35)",
              cursor: "pointer",
            }}>
              💬 Rejoindre le Discord
            </a>
            <Link href="/tournois" style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "13px 28px",
              borderRadius: 999,
              border: "1px solid rgba(245,195,58,0.4)",
              background: "rgba(245,195,58,0.08)",
              color: "rgb(245,195,58)",
              fontWeight: 700,
              fontSize: 15,
            }}>
              Voir les tournois →
            </Link>
          </div>
        </div>
      </section>

      {/* ── CADRE LÉGAL ── */}
      <section className="fade-in ds-block" style={{ marginBottom: 32, padding: "20px 28px" }}>
        <div className="ds-section-title" style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 16 }}>Cadre légal</h2>
        </div>
        <p style={{ color: "var(--text-2)", margin: "0 0 6px", lineHeight: 1.75, fontSize: 14 }}>
          Bluegenji Esport est une association régie par la loi du 1er juillet 1901 et le décret du 16 août 1901.
        </p>
        <p style={{ color: "var(--text-2)", margin: 0, lineHeight: 1.75, fontSize: 14 }}>
          Ses ressources comprennent les cotisations membres, les subventions et les autres ressources autorisées par les textes en vigueur.
        </p>
      </section>
    </main>
    </PageWithPalette>
  );
}

const HERO_STATS = [
  { label: "Fondée le", value: "11 sept. 2022" },
  { label: "Présence", value: "En ligne (FR)" },
  { label: "Régime", value: "Loi 1901" },
  { label: "Âge minimum", value: "16 ans" },
];

const IMPACT = [
  { value: "[X]+", label: "Tournois organisés", rgb: "89,212,255" },
  { value: "[X]+", label: "Membres inscrits", rgb: "245,195,58" },
  { value: "[X]", label: "Événements LAN", rgb: "255,157,46" },
  { value: "3+", label: "Années d'activité", rgb: "167,115,255" },
];

const MISSIONS = [
  {
    icon: "🏆",
    title: "Tournois & Événements",
    rgb: "89,212,255",
    desc: "Compétitions en ligne et en LAN conçues pour tous les niveaux — du débutant au semi-pro. Format simple et double élimination, bracket transparent, arbitrage rigoureux.",
  },
  {
    icon: "🤝",
    title: "Fédération d'équipes",
    rgb: "79,224,162",
    desc: "Rassembler les équipes participantes pour construire un écosystème compétitif durable, sain et accessible à toute la scène francophone.",
  },
  {
    icon: "📡",
    title: "Retransmission en direct",
    rgb: "245,195,58",
    desc: "Production et diffusion live des événements avec une qualité broadcast — casters, overlays, rediffusions — pour valoriser chaque match.",
  },
  {
    icon: "⭐",
    title: "Formation & Visibilité",
    rgb: "255,157,46",
    desc: "Accompagner et mettre en avant joueurs, coaches, managers, casters et organisateurs qui font vivre la scène amateur francophone.",
  },
];

const ACTIVITIES = [
  {
    title: "BlueLan",
    tag: "Événement présentiel",
    rgb: "89,212,255",
    imgLabel: "Photo de l'événement BlueLan",
    desc: "Notre événement LAN phare — une journée de compétition en présentiel pour Overwatch et Marvel Rivals dans une ambiance communautaire unique. Networking, gaming et bonne humeur garantis.",
  },
  {
    title: "Tournois Overwatch 2",
    tag: "Compétition en ligne",
    rgb: "255,157,46",
    imgLabel: "Capture d'un tournoi Overwatch",
    desc: "Compétitions régulières sur Overwatch 2 en simple et double élimination, ouvertes à tous les niveaux. Brackets gérés directement depuis notre plateforme.",
  },
  {
    title: "Tournois Marvel Rivals",
    tag: "Compétition en ligne",
    rgb: "167,115,255",
    imgLabel: "Capture d'un tournoi Marvel Rivals",
    desc: "Notre branche Marvel Rivals propose des tournois en ligne réguliers pour la communauté francophone, avec des formats adaptés à une scène en pleine croissance.",
  },
  {
    title: "Bot Discord inter-serveurs",
    tag: "Outil communautaire",
    rgb: "79,224,162",
    imgLabel: "Aperçu du bot Discord BlueGenji",
    desc: "Réseau de diffusion d'annonces entre serveurs avec filtres automatiques — restez informés de tous les tournois et événements BlueGenji, depuis votre propre serveur.",
  },
];

const BUREAU = [
  {
    role: "Président",
    name: "Leo PERREAUT",
    pseudo: null,
    rgb: "89,212,255",
    desc: "Représente l'association dans les actes de la vie civile, coordonne les projets et ordonnance les dépenses.",
  },
  {
    role: "Trésorier",
    name: "Bryan BOULLEAUX",
    pseudo: null,
    rgb: "245,195,58",
    desc: "Tient les comptes de l'association et présente le bilan financier à l'Assemblée Générale annuelle.",
  },
];

const TIERS = [
  {
    type: "Membre Ordinaire",
    rgb: "89,212,255",
    featured: false,
    cta: { label: "Adhérer gratuitement →", href: "[LIEN_ADHESION]" },
    items: [
      "Inscription via bulletin d'adhésion",
      "Sans cotisation",
      "Accès à tous les tournois",
      "Participation aux événements LAN",
      "Accès au Discord membres",
    ],
  },
  {
    type: "Membre Bienfaiteur",
    rgb: "245,195,58",
    featured: true,
    cta: { label: "Soutenir BlueGenji →", href: "[LIEN_ADHESION_BIENFAITEUR]" },
    items: [
      "Cotisation annuelle définie par l'AG",
      "Soutien financier direct à l'asso",
      "Contribution visible aux projets",
      "Mise en avant de votre soutien",
      "Rôle dédié sur le Discord",
    ],
  },
  {
    type: "Membre d'Honneur",
    rgb: "167,115,255",
    featured: false,
    cta: null,
    items: [
      "Décerné par le bureau",
      "Dispensé de cotisation",
      "Reconnaissance exceptionnelle",
      "Services rendus à l'association",
    ],
  },
];
