# Prompt de correction — Refonte `/association` (alignée sur `/`)

> Pré-requis : la refonte « Cyber minimal » est en place (Phases 1–7).
> Copier-coller le bloc ci-dessous dans une nouvelle session Claude Code
> (Haiku 4.5) à la racine du projet `C:\work\BlueGenji\appbluegenji`.

---

```
Tu travailles sur la refonte « Cyber minimal » de BlueGenji.

CONTEXTE :
La page d'accueil `/` est propre et finalisée. La page `/association` a été
refaite mais est cassée visuellement :

  1. Le PublicHeader paraît "brut" — il ne couvre pas toute la largeur de
     l'écran sur cette page alors qu'il fonctionne sur `/`.
  2. Le hero de la page est minimaliste et désaligné par rapport au hero
     de `/`.
  3. Les sections utilisent une classe `.container` qui n'existe NULLE
     PART dans le CSS. Résultat : aucune contrainte de largeur, aucun
     centrage, aucun padding. Les sections s'étalent en pleine largeur.
  4. Les cartes du Bureau (4 membres) sont moches : pas de hauteur
     cohérente, TeamSigil minuscule par défaut, contenu non centré, pas
     de hiérarchie visuelle.

LIS D'ABORD :
1. CLAUDE.md (sections « Design System Cyber minimal » et « Conventions »).
2. app/page.tsx — structure de la home (Server Component, composition).
3. components/cyber/landing/Hero.tsx + Hero.module.css — pattern hero.
4. components/cyber/landing/AboutSection.tsx + AboutSection.module.css —
   pattern section ancrée (largeur 1240px, head avec eyebrow + meta).
5. components/cyber/landing/PublicHeader.tsx + PublicHeader.module.css.
6. components/cyber/CyberCard.tsx, CyberButton.tsx, TeamSigil.tsx,
   Pill.tsx (props disponibles).
7. app/globals.css — sections `.eyebrow`, `.fabric`, `.section-head`,
   `.page-shell`, tokens cyber (--cyber-bg, --ink, --blue-*, --r-cy-*,
   --line-soft, --line-strong-cy).
8. app/association/page.tsx — état actuel à refondre.

OBJECTIF :
Refondre `app/association/page.tsx` pour qu'elle suive EXACTEMENT le
pattern visuel de `/` : header pleine largeur + sections ancrées dans
une largeur centrée 1240px via leur PROPRE module CSS (pas de
`.container` global), hero riche, cartes Bureau cohérentes.

────────────────────────────────────────────────────────────────────
1. Retirer `page-shell` du <main>
────────────────────────────────────────────────────────────────────
Sur `/`, le main est :
  <main style={{ position: "relative", zIndex: 1 }}>

Sur `/association`, c'est :
  <main className="page-shell" style={{ position: "relative", zIndex: 1 }}>

`.page-shell` impose `width: min(1200px, calc(100vw - 40px))` au <main>,
ce qui contraint le PublicHeader. Retirer la classe `page-shell` pour
laisser le header s'étendre sur toute la largeur (le header gère déjà
sa largeur interne via son propre module CSS).

────────────────────────────────────────────────────────────────────
2. Créer un module CSS dédié pour la page
────────────────────────────────────────────────────────────────────
Créer `app/association/page.module.css` avec les classes suivantes
(toutes les sections doivent suivre le même pattern qu'AboutSection
pour la largeur et le centrage) :

  .section {
    position: relative;
    z-index: 1;
    width: min(1240px, calc(100vw - 40px));
    margin: 0 auto;
    padding: 48px 0;
  }

  .heroSection {
    /* hero plus aéré */
    padding: 80px 0 40px;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 20px;
    border-top: 1px solid var(--line-soft);
    padding: 24px 0 28px;
  }

  .sectionTitle {
    margin: 6px 0 0;
    font-family: var(--font-sans);
    font-size: clamp(28px, 3vw, 44px);
    font-weight: 500;
    letter-spacing: -0.02em;
  }

  .meta {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--ink-mute);
  }

  /* Hero spécifique */
  .heroGrid {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 48px;
    align-items: end;
    padding-top: 24px;
  }

  .heroTitle {
    font-size: clamp(40px, 6vw, 72px);
    line-height: 1.05;
    margin: 14px 0 0;
    letter-spacing: -0.02em;
  }

  .heroSide {
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-left: 1px solid var(--line-soft);
    padding-left: 28px;
  }

  .heroFact {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* Bureau grid */
  .bureauGrid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }

  .bureauCard {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
    padding: 24px;
    min-height: 200px;
  }

  .bureauSigil {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: var(--r-cy-md);
    background: rgba(90, 200, 255, 0.06);
    border: 1px solid var(--line-soft);
  }

  .bureauName {
    font-family: var(--font-sans);
    font-size: 17px;
    font-weight: 500;
    letter-spacing: -0.01em;
    margin: 0;
  }

  .bureauRole {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-mute);
    margin: 0;
  }

  .bureauDivider {
    width: 32px;
    height: 1px;
    background: var(--line-soft);
    margin: 4px 0;
  }

  /* Manifeste / Adhérer */
  .prose p {
    color: var(--ink);
    line-height: 1.75;
    margin: 0 0 14px;
    font-size: 15px;
  }

  .prose p:last-child {
    margin-bottom: 0;
  }

  .ctaRow {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 24px;
  }

  /* Documents */
  .docList {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    border-top: 1px solid var(--line-soft);
  }

  .docItem {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 0;
    border-bottom: 1px solid var(--line-soft);
    transition: color 0.18s ease;
  }

  .docItem:hover {
    color: var(--blue-300);
  }

  .docMeta {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-mute);
  }

  .legal {
    margin-top: 32px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  /* Responsive */
  @media (max-width: 920px) {
    .heroGrid { grid-template-columns: 1fr; gap: 24px; }
    .heroSide { border-left: none; border-top: 1px solid var(--line-soft); padding: 24px 0 0; }
    .bureauGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  @media (max-width: 560px) {
    .section { width: min(1240px, calc(100vw - 24px)); }
    .bureauGrid { grid-template-columns: 1fr; }
    .head { flex-direction: column; align-items: flex-start; }
  }

────────────────────────────────────────────────────────────────────
3. Refondre app/association/page.tsx
────────────────────────────────────────────────────────────────────
Conserver la palette gold (`<PageWithPalette palette="gold">`).

Structure attendue :

  <PageWithPalette palette="gold">
    <main style={{ position: "relative", zIndex: 1 }}>
      <PublicHeader />

      {/* HERO — riche, deux colonnes, fabric overlay */}
      <section className={`${styles.section} ${styles.heroSection}`}>
        <div className="fabric" />
        <span className="eyebrow">L'ASSOCIATION · LOI 1901</span>
        <div className={styles.heroGrid}>
          <div>
            <h1 className={`display ${styles.heroTitle}`}>
              Au service de la scène<br />amateur française.
            </h1>
          </div>
          <aside className={styles.heroSide}>
            <div className={styles.heroFact}>
              <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 10, letterSpacing: "0.2em" }}>FONDÉE EN</span>
              <span className="num" style={{ fontSize: 28 }}>2023</span>
            </div>
            <div className={styles.heroFact}>
              <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 10, letterSpacing: "0.2em" }}>SIÈGE</span>
              <span style={{ fontSize: 17 }}>Lyon</span>
            </div>
            <div className={styles.heroFact}>
              <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 10, letterSpacing: "0.2em" }}>STATUT</span>
              <span style={{ fontSize: 17 }}>Association loi 1901</span>
            </div>
          </aside>
        </div>
      </section>

      {/* ABOUT SECTION (composant existant) */}
      <AboutSection />

      {/* MANIFESTE */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 04</span>
            <h2 className={styles.sectionTitle}>Manifeste</h2>
          </div>
          <span className={styles.meta}>CE QUI NOUS DÉFINIT</span>
        </header>
        <CyberCard ticks>
          <div className={styles.prose} style={{ padding: 8 }}>
            {/* 5 paragraphes du manifeste — réutiliser le texte actuel */}
            <p>...</p>
            <p>...</p>
            ...
          </div>
        </CyberCard>
      </section>

      {/* BUREAU */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 05</span>
            <h2 className={styles.sectionTitle}>Bureau</h2>
          </div>
          <span className={styles.meta}>4 MEMBRES · BÉNÉVOLES</span>
        </header>
        <div className={styles.bureauGrid}>
          {BUREAU.map((b) => (
            <CyberCard key={b.name} lift className={styles.bureauCard}>
              <div className={styles.bureauSigil}>
                <TeamSigil letter={b.initials} color={b.color} size={36} />
              </div>
              <div className={styles.bureauDivider} />
              <div>
                <h3 className={styles.bureauName}>{b.name}</h3>
                <p className={styles.bureauRole}>{b.role}</p>
              </div>
            </CyberCard>
          ))}
        </div>
      </section>

      {/* ADHÉRER */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 06</span>
            <h2 className={styles.sectionTitle}>Adhérer</h2>
          </div>
          <span className={styles.meta}>GRATUIT · SANS ENGAGEMENT</span>
        </header>
        <CyberCard ticks>
          <div className={styles.prose} style={{ padding: 8 }}>
            <p>L'adhésion à BlueGenji vous ouvre l'accès complet...</p>
          </div>
          <div className={styles.ctaRow}>
            <CyberButton variant="primary" asChild>
              <Link href="/connexion">Créer un compte →</Link>
            </CyberButton>
            <CyberButton variant="ghost" asChild>
              <a href="https://discord.gg/bluegenji" target="_blank" rel="noreferrer">
                Rejoindre le Discord
              </a>
            </CyberButton>
          </div>
        </CyberCard>
      </section>

      {/* DOCUMENTS */}
      <section className={styles.section}>
        <header className={styles.head}>
          <div>
            <span className="eyebrow">SECTION 07</span>
            <h2 className={styles.sectionTitle}>Documents</h2>
          </div>
          <span className={styles.meta}>TÉLÉCHARGEABLES</span>
        </header>
        <ul className={styles.docList}>
          <li>
            <Link href="/statuts.pdf" className={styles.docItem}>
              <span>Statuts de l'association</span>
              <span className={styles.docMeta}>PDF · 142 KO →</span>
            </Link>
          </li>
          {/* idem règlement intérieur, rapport moral 2025 */}
        </ul>
        <div className={styles.legal}>
          SIRET 912 345 678 00017 · RNA W691234567
        </div>
      </section>

      <PublicFooter />
    </main>
  </PageWithPalette>

────────────────────────────────────────────────────────────────────
4. Vérifications visuelles
────────────────────────────────────────────────────────────────────
Après les modifs, le PublicHeader doit s'étendre sur toute la largeur
de l'écran (comme sur `/`). Les sections doivent toutes être centrées
dans 1240px max avec une bordure top fine. Les 4 cartes du Bureau
doivent être de hauteur égale, avec un sigil bien visible dans une
case bordée, un séparateur fin, puis nom + rôle alignés à gauche.

────────────────────────────────────────────────────────────────────
CONTRAINTES :
────────────────────────────────────────────────────────────────────
- AUCUNE modification de `app/globals.css`. Tout le CSS spécifique à
  cette page va dans `app/association/page.module.css`.
- AUCUNE modification du PublicHeader / AboutSection / PublicFooter.
- AUCUNE modification des composants cyber (CyberCard, TeamSigil, etc.).
- Conserver le contenu textuel existant (manifeste, bureau, adhérer,
  documents). On refait juste la mise en page, pas le copywriting.
- Conserver `palette="gold"`.
- Pas de any en TypeScript (strict mode).
- Pas de dépendance externe nouvelle.

CRITÈRE D'ACCEPTATION :
- npm run lint && npm run build → success.
- Le PublicHeader couvre toute la largeur de l'écran.
- Les 4 cartes Bureau ont la même hauteur, sont bien alignées.
- Toutes les sections sont centrées dans 1240px max avec une bordure
  top et un eyebrow + meta cohérents.
- Pas d'erreur d'hydration en console navigateur.

Quand tu as fini, rapporte :
- Fichiers créés / modifiés.
- Sortie de npm run lint.
- Sortie de npm run build.

Ne committe pas. N'ouvre pas de prompts de confirmation npm.
```

---

## Après ce prompt

Commit suggéré :
```
fix(cyber): refonte /association — header pleine largeur, hero riche, cartes bureau cohérentes
```
