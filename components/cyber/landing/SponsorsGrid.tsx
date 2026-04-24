import Image from "next/image";
import type { Sponsor } from "@/lib/server/sponsors-service";
import styles from "./SponsorsGrid.module.css";

type SponsorsGridProps = {
  sponsors: Sponsor[];
};

export function SponsorsGrid({ sponsors }: SponsorsGridProps) {
  const displaySponsors = sponsors.slice(0, 6);

  return (
    <section id="sponsors" className={styles.root}>
      <div className={styles.head}>
        <div>
          <span className="eyebrow">SECTION 04</span>
          <h2 className={styles.sectionTitle}>Partenaires et soutiens</h2>
        </div>
        <div className={styles.meta}>{displaySponsors.length} PARTENAIRES</div>
      </div>

      <div className={styles.grid}>
        {displaySponsors.map((sponsor) => (
          <a
            key={sponsor.id}
            href={sponsor.websiteUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            className={styles.slot}
          >
            {sponsor.logoUrl ? (
              <Image src={sponsor.logoUrl} alt={sponsor.name} fill sizes="100%" />
            ) : (
              <>
                <svg className={styles.pattern} viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <pattern id={`hatch-${sponsor.slug}`} width="10" height="10" patternUnits="userSpaceOnUse">
                      <path d="M-1 1 l2 -2 M0 10 l10 -10 M8 12 l4 -4" stroke="rgba(180,210,230,0.12)" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="300" height="100" fill={`url(#hatch-${sponsor.slug})`} />
                </svg>
                <span className="mono">{sponsor.name}</span>
              </>
            )}
          </a>
        ))}
      </div>
    </section>
  );
}

