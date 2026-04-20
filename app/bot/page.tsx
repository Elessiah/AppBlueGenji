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
        Acceder aux tournois →
      </Link>

      <section className="fade-in ds-hero green">
        <div className="ds-hero-body">
          <span className="badge" style={{ marginBottom: 24, display: "inline-block" }}>
            Bot Discord - Reseau inter-serveurs
          </span>
          <h1 className="ds-title green" style={{ fontSize: "clamp(44px, 5vw, 70px)", lineHeight: 1.06, marginBottom: 20 }}>
            BlueGenji
            <br />
            Bot
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.75, color: "var(--text-1)", margin: "0 0 40px", maxWidth: 620 }}>
            Le bot connecte des channels Discord de plusieurs serveurs pour simplifier la diffusion d'annonces scrims, recherche d'equipe, staff, cast et initiatives communautaires autour de Marvel Rivals.
          </p>

          <div className="ds-stats">
            {[
              { label: "Serveurs affilies", value: stats.affiliatedServers },
              { label: "Channels relies", value: stats.affiliatedChannels },
              { label: "Messages (30j)", value: stats.messagesLast30Days },
              { label: "Relais (30j)", value: stats.relayedMessagesLast30Days },
              { label: "Utilisateurs (30j)", value: stats.uniqueUsersLast30Days },
            ].map((k) => (
              <div key={k.label} className="ds-stat" style={{ borderLeftColor: "rgba(79,224,162,0.4)" }}>
                <div className="ds-stat-label">{k.label}</div>
                <div className="ds-stat-value">{k.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="fade-in ds-block" style={{ borderColor: "rgba(79,224,162,0.18)" }}>
        <div className="ds-section-title green">
          <h2>Fonctionnement</h2>
        </div>
        <p style={{ color: "var(--text-1)", margin: "0 0 14px", lineHeight: 1.75, fontSize: 15, maxWidth: 760 }}>
          Les annonces sont postees sur un channel partenaire, qualifiees via des mots-cles <code>lfs</code>, <code>lfp</code>, <code>lft</code>, <code>lfstaff</code>, <code>lfcast</code>, puis redistribuees automatiquement selon les services et filtres region/rank.
        </p>
        <p style={{ color: "var(--text-1)", margin: "0 0 28px", lineHeight: 1.75, fontSize: 15, maxWidth: 760 }}>
          Le bot gere la moderation basique, l'expiration des duplications, et conserve un historique exploite ici pour le suivi d'usage.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/" className="btn ghost" style={{ padding: "11px 24px", fontSize: 14 }}>
            ← Retour accueil
          </Link>
          <Link href="/tournois" className="btn" style={{ padding: "11px 24px", fontSize: 14 }}>
            Acceder aux tournois
          </Link>
        </div>
      </section>
    </main>
  );
}
