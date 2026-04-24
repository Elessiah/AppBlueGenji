# Prompt de démarrage — Phase 7 (`/bot`, `/connexion`, polish, QA)

> Pré-requis : Phases 1 → 6 commitées (tokens, primitives, endpoints,
> landing, association, partenaires, secured pages).
>
> Copier-coller le bloc ci-dessous dans une nouvelle session Claude Code
> (Haiku 4.5) à la racine du projet `C:\work\BlueGenji\appbluegenji`.

---

```
Tu travailles sur la refonte « Cyber minimal » de BlueGenji — PHASE FINALE.

LIS D'ABORD :
1. CLAUDE.md.
2. app/bot/page.tsx actuel.
3. app/connexion/page.tsx actuel.
4. app/globals.css (pour identifier les classes ds-* / cta-float-* /
   tournament-card obsolètes après la refonte).
5. components/cyber/* (pour t'assurer de réutiliser au lieu de
   dupliquer).
6. .maquette_tmp/bluegenji-arena/project/page.css (sponsors-grid,
   join section pour référence).

OBJECTIF (Phase 7 — 5 tâches : bot + connexion + nettoyage + QA +
documentation) :

────────────────────────────────────────────────────────────────────
A. app/bot/page.tsx — REFONTE
────────────────────────────────────────────────────────────────────
Server Component. Wrapper <PageWithPalette palette="blue">.

Structure :

  <PublicHeader/>   (réutilisé depuis Phase 4)

  <section className="container" style={{padding: "80px 0"}}>
    <div className="fabric"/>
    <div style={{display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 64, alignItems: "start"}}>
      <div>
        <span className="eyebrow">BOT DISCORD · INTER-SERVEURS</span>
        <h1 className="display" style={{fontSize: 72}}>
          Le réseau.<br/>
          <span style={{color: "var(--blue-500)"}}>Connecté.</span>
        </h1>
        <p style={{fontSize: 17, color: "var(--ink-mute)", maxWidth: 520, margin: "20px 0 32px"}}>
          Un bot Discord qui relaie les annonces entre serveurs
          affiliés. Scrims, recrutement staff, cast, coaching — la
          communauté Overwatch 2 francophone, unifiée.
        </p>
        <CyberButton variant="primary" asChild>
          <a href="https://discord.com/api/oauth2/authorize?..." target="_blank" rel="noreferrer">
            Inviter le bot →
          </a>
        </CyberButton>
        <CyberButton variant="ghost" asChild style={{marginLeft: 12}}>
          <a href="https://docs.bluegenji-esport.fr/bot">Documentation</a>
        </CyberButton>
      </div>

      <CyberCard ticks style={{padding: 32}}>
        {/* Stats temps réel depuis /api/bot (existant) */}
        <div className="eyebrow">ACTIVITÉ 30 DERNIERS JOURS</div>
        <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 24}}>
          {stats.map(s => (
            <div>
              <div className="num" style={{fontSize: 32, color: "var(--blue-500)"}}>{s.value}</div>
              <div className="mono" style={{color: "var(--ink-mute)", fontSize: 10, letterSpacing: "0.18em"}}>{s.label}</div>
            </div>
          ))}
        </div>
      </CyberCard>
    </div>
  </section>

  <section className="container" style={{paddingBottom: 80}}>
    <div className="section-head">
      <h2>Fonctionnalités</h2>
      <div className="meta">{FEATURES.length} MODULES</div>
    </div>
    <div style={{display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20}}>
      {FEATURES.map(f => (
        <CyberCard lift>
          <div className="eyebrow" style={{color: "var(--blue-300)"}}>{f.tag}</div>
          <h3 className="display" style={{fontSize: 22, margin: "8px 0"}}>{f.title}</h3>
          <p style={{color: "var(--ink-mute)", fontSize: 14}}>{f.desc}</p>
        </CyberCard>
      ))}
    </div>
  </section>

  <section className="container" style={{paddingBottom: 80}}>
    <div className="section-head">
      <h2>Commandes</h2>
      <div className="meta">PRÉFIXE /</div>
    </div>
    <CyberCard style={{padding: 0, overflow: "hidden"}}>
      {COMMANDS.map(c => (
        <div style={{display: "grid", gridTemplateColumns: "180px 1fr", padding: "14px 20px", borderBottom: "1px solid var(--line-soft)"}}>
          <code className="mono" style={{color: "var(--blue-300)"}}>{c.cmd}</code>
          <span style={{color: "var(--ink-mute)"}}>{c.desc}</span>
        </div>
      ))}
    </CyberCard>
  </section>

  <PublicFooter/>

FEATURES : 6 cards (Annonces inter-serveurs, Scrims, Recrutement,
Notifications tournois, Auth Discord, Stats). COMMANDS : 5-8 commandes
classiques (/ping, /scrim, /recrute, /link, /stats, ...).

Stats : fetch server-side via /api/bot (endpoint existant). Fallback
si le bot est down : afficher "—" dans les valeurs.

────────────────────────────────────────────────────────────────────
B. app/connexion/page.tsx — REFONTE
────────────────────────────────────────────────────────────────────
"use client" (conserve la logique existante : submit Discord code,
OAuth Google redirect, useToast).

Structure :

  <main style={{minHeight: "100vh", display: "grid", placeItems: "center"}}>
    <div className="fabric"/>
    <CyberCard ticks style={{padding: 48, width: "min(480px, calc(100vw - 32px))"}}>
      <div style={{textAlign: "center", marginBottom: 32}}>
        {/* Logo hexagonal SVG */}
        <h1 className="display" style={{fontSize: 36, marginTop: 20}}>
          Connexion
        </h1>
        <p className="mono" style={{color: "var(--ink-mute)", letterSpacing: "0.18em", fontSize: 11}}>
          BLUEGENJI · ACCÈS MEMBRE
        </p>
      </div>

      {/* Google OAuth */}
      <CyberButton variant="primary" style={{width: "100%", marginBottom: 12}}
                   onClick={() => window.location.href = "/api/auth/google"}>
        Continuer avec Google
      </CyberButton>

      {/* Séparateur */}
      <div style={{display: "flex", alignItems: "center", gap: 12, margin: "20px 0", color: "var(--ink-dim)"}}>
        <div style={{flex: 1, height: 1, background: "var(--line-soft)"}}/>
        <span className="mono" style={{fontSize: 10, letterSpacing: "0.2em"}}>OU</span>
        <div style={{flex: 1, height: 1, background: "var(--line-soft)"}}/>
      </div>

      {/* Discord code */}
      <form onSubmit={handleDiscordSubmit}>
        <div className="field">
          <label>Discord ID</label>
          <input type="text" name="discordId" required/>
        </div>
        <div className="field" style={{marginTop: 12}}>
          <label>Code reçu en DM (6 chiffres)</label>
          <input type="text" name="code" maxLength={6} pattern="\d{6}" required
                 className="num" style={{fontSize: 20, letterSpacing: "0.3em", textAlign: "center"}}/>
        </div>
        <CyberButton variant="ghost" type="submit" style={{width: "100%", marginTop: 16}}>
          Se connecter
        </CyberButton>
      </form>

      <div style={{marginTop: 24, textAlign: "center"}}>
        <Link href="/" className="mono" style={{fontSize: 11, color: "var(--ink-mute)", letterSpacing: "0.14em"}}>
          ← RETOUR ACCUEIL
        </Link>
      </div>
    </CyberCard>
  </main>

Conserver toute la logique : première étape "demander code" si
pas encore envoyé, deuxième étape "entrer code". Adapter l'UI aux
2 étapes (afficher un seul formulaire à la fois).

────────────────────────────────────────────────────────────────────
C. NETTOYAGE — Classes `ds-*` et autres
────────────────────────────────────────────────────────────────────
Maintenant que toutes les pages ont été refaites, identifier les
classes CSS obsolètes dans app/globals.css :

- ds-hero, ds-header, ds-block, ds-section-title, ds-title, ds-stats,
  ds-stat, ds-chip
- cta-float (garder cta-float-home si encore utilisé sur /tournois
  par le bouton "Accueil flottant")
- tournament-card (remplacé par CyberCard)
- shimmer, glow-pulse-blue/gold, float-subtle (si plus utilisés)
- logoPulse, logoRing*, logoFloat*, logoShadow* (garder si logo-with-glow
  les utilise encore)

Pour chaque classe, faire :
  grep -r "className.*ds-block" app/ components/
Si 0 occurrence -> supprimer la règle de globals.css.
Si occurrences -> les migrer vers CyberCard/Pill/etc. puis supprimer.

Supprimer aussi app/_dev/cyber-preview/ entièrement.

────────────────────────────────────────────────────────────────────
D. QA RESPONSIVE & ACCESSIBILITÉ
────────────────────────────────────────────────────────────────────
1. Ouvrir chaque page en 3 viewports : 1440px, 1024px, 375px.
2. Vérifier que les grids passent en 1 colonne sous 900px.
3. Vérifier les contrastes WCAG AA :
     var(--ink) #e6f1f5 sur var(--cyber-bg) #05080c -> ratio ~16:1 ✓
     var(--ink-mute) #8ea3b0 sur var(--cyber-bg) -> ratio ~7:1 ✓
     var(--ink-dim) #53646f sur var(--cyber-bg) -> ratio ~4:1 — limite.
     Ne pas utiliser --ink-dim pour du texte courant.
4. Focus visible sur tous les boutons/liens (outline 2px
   var(--blue-500)).
5. aria-label sur les SVG décoratifs du logo.
6. Vérifier que les liens Discord/externes ont target="_blank" +
   rel="noreferrer".

────────────────────────────────────────────────────────────────────
E. MISE À JOUR DOC
────────────────────────────────────────────────────────────────────
1. CLAUDE.md — remplacer la section « Refonte graphique en cours »
   par une section « Design system » documentant l'état final :
     - Tokens cyber
     - Composants components/cyber/*
     - Polices (Inter / JetBrains Mono / Orbitron pour cyber,
       Rajdhani / Exo_2 deprecated mais conservées jusqu'à migration
       complète ou à supprimer selon ce qui reste).
     - Règle toast via useToast (inchangée).
     - Règle : nouveaux composants dans components/cyber/, pas de
       classes ds-*.
2. Supprimer .maquette_tmp/ du repo (déjà dans .gitignore mais
   s'assurer qu'elle n'est pas trackée).
3. Supprimer les prompts PROMPT_HAIKU_PHASE_*.md (ils sont dans
   .maquette_tmp/ donc suivront).

────────────────────────────────────────────────────────────────────
F. TESTS FINAUX
────────────────────────────────────────────────────────────────────
- npm run lint -> 0 erreur, 0 warning ideally.
- npm run build -> success, bundle size inspecté (doit baisser vs
  avant refonte grâce au CSS retiré).
- npm test -> pass.
- npm run dev -> parcours manuel complet des pages :
    / (landing)
    /association
    /partenaires
    /bot
    /connexion (les 2 étapes)
    /(secured)/tournois (liste + détail + création)
    /(secured)/equipes (liste + détail + création)
    /(secured)/joueurs (liste + détail)
    /(secured)/profil
- Tester la génération .ics : télécharger et ouvrir dans un agenda.
- Tester le live SSE : ouvrir un tournoi en RUNNING dans 2 onglets
  et vérifier que les events se propagent.

────────────────────────────────────────────────────────────────────
CONTRAINTES
────────────────────────────────────────────────────────────────────
- La suppression des ds-* / classes obsolètes n'est faite QUE si 0
  occurrence reste. Si une classe est toujours utilisée, migrer
  d'abord, supprimer ensuite.
- Ne pas toucher aux tests unitaires existants sauf si un casse
  cause clairement un bug (dans ce cas réparer).
- Pas de nouvelle dépendance npm.

────────────────────────────────────────────────────────────────────
CRITÈRES D'ACCEPTATION
────────────────────────────────────────────────────────────────────
- /bot et /connexion en langage cyber minimal cohérent avec la
  landing.
- globals.css allégé (mesure : wc -l avant/après).
- Parcours manuel complet validé sans régression fonctionnelle.
- CLAUDE.md à jour.
- 0 occurrence de classes ds-* dans app/ et components/ (hormis
  legacy commenté).

Quand tu as fini, rapporte :
- Liste des classes CSS supprimées.
- wc -l de app/globals.css avant/après.
- Résultats lint/build/test.
- Confirmation que /bot, /connexion, et le parcours complet sont OK.

Ne committe pas. N'ouvre pas de prompts de confirmation npm.
```

---

## Après Phase 7

Commit `feat(cyber): phase 7 — /bot /connexion + QA + nettoyage`.

Tag de release suggéré : `v0.4.0 — cyber-minimal redesign complete`.

La refonte est terminée. Le repo ne dépend plus de `.maquette_tmp/`.
