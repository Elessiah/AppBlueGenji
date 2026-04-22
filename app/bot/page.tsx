import Link from "next/link";
import { fetchBotStats } from "@/lib/server/bot-integration";

export default async function BotPage() {
  const stats = await fetchBotStats();

  return (
    <main className="page-shell">
      <Link href="/" className="cta-float-home home">
        ⌂ Accueil
      </Link>
      <Link href="/tournois" className="cta-float">
        Accéder aux tournois →
      </Link>

      <section className="fade-in ds-hero purple">
        <div className="ds-hero-body">
          <span
            className="badge"
            style={{
              marginBottom: 24,
              display: "inline-block",
              borderColor: "rgba(167,115,255,0.45)",
              background: "rgba(167,115,255,0.1)",
              color: "rgb(167,115,255)",
            }}
          >
            Bot Discord — Réseau inter-serveurs
          </span>
          <h1 className="ds-title purple" style={{ fontSize: "clamp(44px, 5vw, 70px)", lineHeight: 1.06, marginBottom: 20 }}>
            BlueGenji
            <br />
            Bot
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.75, color: "var(--text-1)", margin: "0 0 40px", maxWidth: 620 }}>
            Le bot connecte des channels Discord de plusieurs serveurs pour simplifier la diffusion d'annonces : scrims,
            recherche d'équipe, staff, cast et initiatives communautaires autour de Marvel Rivals.
          </p>

          <div className="ds-stats">
            {[
              { label: "Serveurs affiliés", value: stats.affiliatedServers },
              { label: "Channels reliés", value: stats.affiliatedChannels },
              { label: "Messages (30j)", value: stats.messagesLast30Days },
              { label: "Relais (30j)", value: stats.relayedMessagesLast30Days },
              { label: "Utilisateurs (30j)", value: stats.uniqueUsersLast30Days },
            ].map((k) => (
              <div key={k.label} className="ds-stat purple">
                <div className="ds-stat-label">{k.label}</div>
                <div className="ds-stat-value">{k.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="fade-in ds-block" style={{ borderColor: "rgba(167,115,255,0.18)" }}>
        <div className="ds-section-title purple">
          <h2>Fonctionnement</h2>
        </div>
        <p style={{ color: "var(--text-1)", margin: "0 0 14px", lineHeight: 1.75, fontSize: 15, maxWidth: 760 }}>
          Les annonces sont postées sur un channel partenaire, qualifiées via des mots-clés{" "}
          <code>lfs</code>, <code>lfp</code>, <code>lft</code>, <code>lfstaff</code>, <code>lfcast</code>, puis
          redistribuées automatiquement selon les services et filtres région/rank.
        </p>
        <p style={{ color: "var(--text-1)", margin: "0 0 28px", lineHeight: 1.75, fontSize: 15, maxWidth: 760 }}>
          Le bot gère la modération basique, l'expiration des duplications, et conserve un historique exploité ici pour
          le suivi d'usage.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/" className="btn ghost" style={{ padding: "11px 24px", fontSize: 14 }}>
            ← Retour accueil
          </Link>
          <Link
            href="/tournois"
            className="btn"
            style={{
              padding: "11px 24px",
              fontSize: 14,
              background: "rgba(167,115,255,0.15)",
              borderColor: "rgba(167,115,255,0.35)",
            }}
          >
            Accéder aux tournois
          </Link>
        </div>
      </section>
    </main>
  );
}
