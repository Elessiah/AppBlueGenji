import styles from "./AboutSection.module.css";

export function AboutSection() {
  return (
    <section id="assoc" className={styles.root}>
      <div className={styles.head}>
        <div>
          <span className="eyebrow">SECTION 03</span>
          <h2 className={styles.sectionTitle}>L&apos;association</h2>
        </div>
        <div className={styles.meta}>LOI 1901 · LYON · 2023</div>
      </div>

      <div className={styles.grid}>
        <div className={styles.left}>
          <p className={styles.lede}>
            Une structure associative à but non lucratif, gérée par des bénévoles
            passionnés. On organise des tournois accessibles, bien arbitrés,
            avec des cash prizes réinvestis dans la scène amateur française.
          </p>

          <div className={styles.stats}>
            {[
              ["100%", "Bénévole"],
              ["€4 200", "Prizepool 2025"],
              ["12", "Arbitres"],
              ["0 €", "Frais d'inscription"],
            ].map(([value, label]) => (
              <div key={label} className={styles.stat}>
                <div className="num" style={{ fontSize: 26 }}>{value}</div>
                <div className="mono">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.right}>
          {[
            ["Accessible", "Inscription gratuite, matchmaking par niveau et support francophone sur Discord."],
            ["Compétitif", "Brackets arbitrés, admins formés et rulebook versionné. On prend le jeu au sérieux."],
            ["Communautaire", "Watch parties, coaching ouvert et entraide entre équipes. L'asso avant le scoreboard."],
          ].map(([title, text], index) => (
            <article key={title} className={styles.pillar}>
              <span className="mono">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
