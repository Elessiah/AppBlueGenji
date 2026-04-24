# Prompt de démarrage — Phase 5 (`/association` refonte + `/partenaires` nouvelle)

> Pré-requis : Phases 1 → 4 commitées (tokens, primitives, endpoints,
> landing `/`).
>
> Copier-coller le bloc ci-dessous dans une nouvelle session Claude Code
> (Haiku 4.5) à la racine du projet `C:\work\BlueGenji\appbluegenji`.

---

```
Tu travailles sur la refonte « Cyber minimal » de BlueGenji.

LIS D'ABORD :
1. CLAUDE.md.
2. .maquette_tmp/bluegenji-arena/project/app.jsx (fonctions About,
   Sponsors — lignes 405-489).
3. .maquette_tmp/bluegenji-arena/project/page.css (sections ABOUT,
   SPONSORS, JOIN).
4. app/association/page.tsx actuel (pour récupérer le contenu
   rédactionnel existant et le réutiliser).
5. components/cyber/index.ts et components/cyber/landing/AboutSection.tsx,
   SponsorsGrid.tsx (réutilisables).
6. lib/server/database.ts (pour ajouter la table bg_sponsors).

OBJECTIF (Phase 5) :
A) Refondre app/association/page.tsx en version longue de la section
   About de la landing, avec contenu enrichi.
B) Créer app/partenaires/page.tsx en version longue de SponsorsGrid,
   avec CTA "Devenir partenaire".
C) Créer la table bg_sponsors via auto-migration et brancher les
   deux pages + la landing dessus.

────────────────────────────────────────────────────────────────────
A. MIGRATION DB — bg_sponsors
────────────────────────────────────────────────────────────────────
Dans lib/server/database.ts, fonction runMigrations, ajouter après
la dernière table existante :

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bg_sponsors (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(140) NOT NULL UNIQUE,
      tier ENUM('GOLD', 'SILVER', 'BRONZE', 'PARTNER') NOT NULL DEFAULT 'PARTNER',
      logo_url TEXT NULL,
      website_url TEXT NULL,
      description TEXT NULL,
      display_order INT NOT NULL DEFAULT 100,
      active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_bg_sponsors_active_order (active, display_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

────────────────────────────────────────────────────────────────────
B. SERVICE — lib/server/sponsors-service.ts (NOUVEAU)
────────────────────────────────────────────────────────────────────
Exporter :

  export type Sponsor = {
    id: number;
    name: string;
    slug: string;
    tier: "GOLD" | "SILVER" | "BRONZE" | "PARTNER";
    logoUrl: string | null;
    websiteUrl: string | null;
    description: string | null;
  };

  export async function listSponsors(): Promise<Sponsor[]>
    -> SELECT ... FROM bg_sponsors WHERE active = 1
       ORDER BY FIELD(tier, 'GOLD', 'SILVER', 'BRONZE', 'PARTNER'),
                display_order ASC, name ASC

Pour v1, si la table est vide, retourner un fallback en dur :
  [{ name: "LOGITECH G", tier: "PARTNER", slug: "logitech-g", ... },
   ... 5 autres sponsors placeholder identiques à la Phase 4]

────────────────────────────────────────────────────────────────────
C. ENDPOINT — app/api/landing/sponsors/route.ts (NOUVEAU)
────────────────────────────────────────────────────────────────────
GET -> ok({ sponsors: Sponsor[] })
export const revalidate = 600;

Brancher components/cyber/landing/SponsorsGrid.tsx pour consommer
cet endpoint (serveur-side fetch) au lieu du tableau hardcodé de
Phase 4. Supprimer le hardcode dans SponsorsGrid.tsx et prendre
les sponsors en props depuis app/page.tsx (qui appelle listSponsors
côté serveur).

────────────────────────────────────────────────────────────────────
D. REFONTE app/association/page.tsx
────────────────────────────────────────────────────────────────────
Server Component. Wrapper <PageWithPalette palette="gold">.

Structure :

  <PublicHeader/>   (réutilise Phase 4)
  <section className="container" style={{padding: "80px 0 40px"}}>
    <div className="fabric"/>
    <div className="section-head">
      <div>
        <div className="eyebrow">L'ASSOCIATION · LOI 1901</div>
        <h1 className="display" style={{fontSize: 64}}>
          Au service de la scène amateur française.
        </h1>
      </div>
      <div className="mono" style={{color: "var(--ink-mute)"}}>
        FONDÉE EN 2023 · SIÈGE LYON
      </div>
    </div>
  </section>

  <AboutSection/>   (déjà composant Phase 4, réutilisable tel quel)

  <section className="container" style={{paddingBottom: 80}}>
    <div className="section-head">
      <h2>Manifeste</h2>
      <div className="meta">CE QUI NOUS DÉFINIT</div>
    </div>
    <CyberCard ticks className="manifesto-card">
      Long texte rédactionnel (4-6 paragraphes) expliquant la mission :
      accessibilité, cash prize réinvesti, bénévolat, compétitivité,
      entraide communautaire, neutralité politique.
    </CyberCard>
  </section>

  <section className="container" style={{paddingBottom: 80}}>
    <div className="section-head">
      <h2>Bureau</h2>
      <div className="meta">4 MEMBRES</div>
    </div>
    <div style={{display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20}}>
      {BUREAU.map(b => (
        <CyberCard lift>
          <TeamSigil letter={b.initials} color={b.color}/>
          <h3>{b.name}</h3>
          <div className="mono" style={{color: "var(--ink-mute)"}}>{b.role}</div>
        </CyberCard>
      ))}
    </div>
  </section>

  <section className="container" style={{paddingBottom: 80}}>
    <div className="section-head">
      <h2>Adhérer</h2>
      <div className="meta">GRATUIT · SANS ENGAGEMENT</div>
    </div>
    <CyberCard ticks style={{padding: 48}}>
      Explication rapide + CTA primary "Créer un compte" -> /connexion
      et ghost "Rejoindre le Discord" (lien externe).
    </CyberCard>
  </section>

  <section className="container" style={{paddingBottom: 80}}>
    <div className="section-head">
      <h2>Documents</h2>
      <div className="meta">TÉLÉCHARGEABLES</div>
    </div>
    <ul style={{listStyle: "none", display: "flex", flexDirection: "column", gap: 12}}>
      <li><Link href="/statuts.pdf">Statuts (PDF) →</Link></li>
      <li><Link href="/reglement-interieur.pdf">Règlement intérieur →</Link></li>
      <li><Link href="/rapport-moral-2025.pdf">Rapport moral 2025 →</Link></li>
    </ul>
    <div className="mono" style={{color: "var(--ink-dim)", marginTop: 24}}>
      SIRET 912 345 678 00017 · RNA W691234567
    </div>
  </section>

  <PublicFooter/>

Pour BUREAU, hardcoder 4 membres avec rôles type "Président",
"Trésorier", "Secrétaire", "Responsable arbitrage".

────────────────────────────────────────────────────────────────────
E. NOUVELLE PAGE app/partenaires/page.tsx
────────────────────────────────────────────────────────────────────
Server Component. Wrapper <PageWithPalette palette="gold">.

  <PublicHeader/>
  <section className="container" style={{padding: "80px 0 40px"}}>
    <div className="fabric"/>
    <div className="section-head">
      <div>
        <div className="eyebrow">PARTENAIRES · SOUTIENS</div>
        <h1 className="display" style={{fontSize: 64}}>
          Ceux qui rendent la compétition possible.
        </h1>
      </div>
    </div>
    <p style={{maxWidth: 720, fontSize: 18, color: "var(--ink-mute)"}}>
      BlueGenji est soutenue par des acteurs de l'écosystème gaming
      français et européen. Leur aide — matérielle, financière ou
      logistique — alimente directement les cash prizes reversés aux
      équipes.
    </p>
  </section>

  <section id="sponsors" className="container" style={{paddingBottom: 80}}>
    {/* Grouper par tier */}
    {["GOLD", "SILVER", "BRONZE", "PARTNER"].map(tier => (
      <div key={tier} style={{marginBottom: 48}}>
        <div className="section-head">
          <h2>{tierLabel(tier)}</h2>
          <div className="meta">{sponsors.filter(s => s.tier === tier).length}</div>
        </div>
        <div className="sponsors-grid"> {/* 6 col GOLD=plus gros, 3 col autres */}
          {sponsors.filter(s => s.tier === tier).map(s => (
            <a href={s.websiteUrl ?? "#"} target="_blank" rel="noreferrer"
               className="sponsor-slot">
              {s.logoUrl
                ? <Image src={s.logoUrl} alt={s.name} fill/>
                : <div className="sponsor-ph">
                    {/* motif hachuré SVG identique landing */}
                    <span className="mono sponsor-ph-label">{s.name}</span>
                  </div>}
            </a>
          ))}
        </div>
      </div>
    ))}
  </section>

  <section className="container" style={{paddingBottom: 80}}>
    <CyberCard ticks style={{padding: 48}}>
      <span className="eyebrow">DEVENIR PARTENAIRE</span>
      <h3 className="display" style={{fontSize: 36}}>
        Votre marque, notre scène.
      </h3>
      <p style={{color: "var(--ink-mute)", maxWidth: 560}}>
        Nous publions un dossier de partenariat sur demande. Visibilité
        stream, présence événementielle LAN, naming de cash prize...
      </p>
      <CyberButton primary asChild>
        <a href="mailto:partenariats@bluegenji-esport.fr?subject=Dossier partenariat">
          Demander le dossier →
        </a>
      </CyberButton>
    </CyberCard>
  </section>

  <PublicFooter/>

tierLabel : { GOLD: "Partenaires Or", SILVER: "Partenaires Argent",
               BRONZE: "Partenaires Bronze", PARTNER: "Soutiens" }

────────────────────────────────────────────────────────────────────
F. MISE À JOUR DE components/cyber/landing/SponsorsGrid.tsx
────────────────────────────────────────────────────────────────────
- Supprimer le tableau hardcodé de noms.
- Props : { sponsors: Sponsor[] }
- Comportement inchangé (grille 6 slots) mais prend les sponsors
  en props. Pour la landing, afficher max 6 et mélanger tiers.

Mettre à jour app/page.tsx pour appeler listSponsors() côté serveur
et passer le résultat à <SponsorsGrid sponsors={sponsors}/>.

────────────────────────────────────────────────────────────────────
G. MISE À JOUR DU HEADER PUBLIC
────────────────────────────────────────────────────────────────────
Dans components/cyber/landing/PublicHeader.tsx, ajouter aux liens :
  "L'asso" -> /association
  "Partenaires" -> /partenaires
(remplacer les ancres #assoc et #sponsors).

────────────────────────────────────────────────────────────────────
CONTRAINTES
────────────────────────────────────────────────────────────────────
- NE PAS TOUCHER : routes /(secured)/*, /connexion, /bot, /api/* sauf
  l'ajout de /api/landing/sponsors.
- Pas de composant client sauf si strictement nécessaire (aucun
  besoin ici).
- Tous les textes en français.
- Si la table bg_sponsors est vide au lancement, les pages fonctionnent
  quand même avec le fallback.

────────────────────────────────────────────────────────────────────
CRITÈRES D'ACCEPTATION
────────────────────────────────────────────────────────────────────
- npm run lint && npm run build -> success.
- /association affiche : header public, hero gold, 4 sections
  (Manifeste, Bureau, Adhérer, Documents), footer.
- /partenaires affiche : header public, hero gold, 4 groupes de
  sponsors (vides si aucun), CTA partenariat, footer.
- curl /api/landing/sponsors -> JSON { sponsors: [...] }.
- La landing / utilise désormais les sponsors dynamiques.

Quand tu as fini, rapporte fichiers créés/modifiés, résultats lint/build,
et confirmation que les 2 nouvelles pages sont accessibles.

Ne committe pas. N'ouvre pas de prompts de confirmation npm.
```

---

## Après Phase 5

Commit `feat(cyber): phase 5 — /association refonte + /partenaires nouvelle`.
Phase 6 : refonte des pages `/(secured)/*` (tournois, equipes, joueurs, profil).
