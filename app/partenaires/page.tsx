import type { Metadata } from "next";
import Image from "next/image";
import { PageWithPalette } from "@/components/page-with-palette";
import { PublicHeader } from "@/components/cyber/landing/PublicHeader";
import { PublicFooter } from "@/components/cyber/landing/PublicFooter";
import { CyberCard, CyberButton } from "@/components/cyber";
import { listSponsors } from "@/lib/server/sponsors-service";

export const dynamic = "force-dynamic";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "BlueGenji - Partenaires & Soutiens",
  description: "Découvrez les partenaires qui soutiennent la scène esport francophone par BlueGenji.",
  openGraph: {
    title: "BlueGenji - Partenaires",
    description: "Acteurs de l'écosystème gaming français et européen qui soutiennent nos tournois.",
    type: "website",
    locale: "fr_FR",
  },
};

const TIER_LABELS: Record<string, string> = {
  GOLD: "Partenaires Or",
  SILVER: "Partenaires Argent",
  BRONZE: "Partenaires Bronze",
  PARTNER: "Soutiens",
};

export default async function PartenairesPage() {
  const sponsors = await listSponsors();

  const sponsorsByTier = {
    GOLD: sponsors.filter((s) => s.tier === "GOLD"),
    SILVER: sponsors.filter((s) => s.tier === "SILVER"),
    BRONZE: sponsors.filter((s) => s.tier === "BRONZE"),
    PARTNER: sponsors.filter((s) => s.tier === "PARTNER"),
  };

  return (
    <PageWithPalette palette="gold">
      <main className="page-shell" style={{ position: "relative", zIndex: 1 }}>
        <PublicHeader />

        {/* ── HERO ── */}
        <section className="container" style={{ padding: "80px 0 40px" }}>
          <div className="fabric" />
          <div className="section-head">
            <div>
              <div className="eyebrow">PARTENAIRES · SOUTIENS</div>
              <h1 className="display" style={{ fontSize: 64 }}>
                Ceux qui rendent la compétition possible.
              </h1>
            </div>
          </div>
          <p style={{ maxWidth: 720, fontSize: 18, color: "var(--ink-mute)", lineHeight: 1.8, marginTop: 24 }}>
            BlueGenji est soutenue par des acteurs de l'écosystème gaming français et européen. Leur aide — matérielle, financière ou logistique — alimente directement les cash prizes reversés aux équipes.
          </p>
        </section>

        {/* ── SPONSORS BY TIER ── */}
        <section id="sponsors" className="container" style={{ paddingBottom: 80 }}>
          {(["GOLD", "SILVER", "BRONZE", "PARTNER"] as const).map((tier) => {
            const tierSponsors = sponsorsByTier[tier];
            if (tierSponsors.length === 0) return null;

            const gridCols = tier === "GOLD" ? "repeat(6, 1fr)" : "repeat(3, 1fr)";

            return (
              <div key={tier} style={{ marginBottom: 48 }}>
                <div className="section-head">
                  <h2>{TIER_LABELS[tier]}</h2>
                  <div className="meta">{tierSponsors.length}</div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: gridCols,
                    gap: 20,
                  }}
                >
                  {tierSponsors.map((sponsor) => (
                    <a
                      key={sponsor.id}
                      href={sponsor.websiteUrl ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="sponsor-slot"
                      style={{
                        position: "relative",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 12,
                        border: "1px solid var(--line)",
                        aspectRatio: "4 / 3",
                        background: "rgba(255,255,255,0.02)",
                        overflow: "hidden",
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(90,200,255,0.5)";
                        (e.currentTarget as HTMLElement).style.background = "rgba(90,200,255,0.05)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor = "var(--line)";
                        (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)";
                      }}
                    >
                      {sponsor.logoUrl ? (
                        <Image
                          src={sponsor.logoUrl}
                          alt={sponsor.name}
                          fill
                          sizes="100%"
                          style={{ objectFit: "contain", padding: 16 }}
                        />
                      ) : (
                        <>
                          <svg
                            viewBox="0 0 300 100"
                            preserveAspectRatio="none"
                            style={{ position: "absolute", width: "100%", height: "100%" }}
                            aria-hidden="true"
                          >
                            <defs>
                              <pattern
                                id={`hatch-${sponsor.slug}`}
                                width="10"
                                height="10"
                                patternUnits="userSpaceOnUse"
                              >
                                <path
                                  d="M-1 1 l2 -2 M0 10 l10 -10 M8 12 l4 -4"
                                  stroke="rgba(180,210,230,0.12)"
                                  strokeWidth="1"
                                />
                              </pattern>
                            </defs>
                            <rect width="300" height="100" fill={`url(#hatch-${sponsor.slug})`} />
                          </svg>
                          <span
                            className="mono"
                            style={{
                              position: "relative",
                              zIndex: 1,
                              fontSize: 12,
                              textAlign: "center",
                              color: "var(--ink-mute)",
                              padding: "8px",
                            }}
                          >
                            {sponsor.name}
                          </span>
                        </>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        {/* ── PARTNERSHIP CTA ── */}
        <section className="container" style={{ paddingBottom: 80 }}>
          <CyberCard ticks style={{ padding: 48 }}>
            <span className="eyebrow">DEVENIR PARTENAIRE</span>
            <h3 className="display" style={{ fontSize: 36, marginTop: 12, marginBottom: 16 }}>
              Votre marque, notre scène.
            </h3>
            <p style={{ color: "var(--ink-mute)", maxWidth: 560, lineHeight: 1.8, marginBottom: 24, fontSize: 15 }}>
              Nous publions un dossier de partenariat sur demande. Visibilité stream, présence événementielle LAN, naming de cash prize — plusieurs formules d'engagement adaptées à votre budget et vos objectifs.
            </p>
            <CyberButton variant="primary" asChild>
              <a href="mailto:partenariats@bluegenji-esport.fr?subject=Dossier partenariat">
                Demander le dossier →
              </a>
            </CyberButton>
          </CyberCard>
        </section>

        <PublicFooter />
      </main>
    </PageWithPalette>
  );
}
