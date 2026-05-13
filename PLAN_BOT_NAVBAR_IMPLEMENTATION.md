# Plan d'implémentation — Bot dashboard + navbar publique

**Cible exécutante** : Claude Haiku 4.5
**Date** : 2026-05-12
**Source design** : bundle Claude Design `O-oRl29qBWppuhpIKafZ-g`
**Fichiers de référence (extraits localement)** :
- `C:\Users\kerya\.claude\projects\C--work-BlueGenji-appbluegenji\858230cd-22ce-46ed-9635-b2b36b9a282c\tool-results\design-extract\bluegenji-arena\project\Bot.html`
- `…\project\bot.jsx` (676 LOC — la source de vérité du dashboard)
- `…\project\bot.css` (677 LOC — styles dédiés bot)
- `…\project\styles.css`, `…\project\page.css` (déjà reflétés dans `app/globals.css`)
- `…\project\app.jsx` (header de la landing — référence navbar)
- `…\chats\chat4.md` (intention utilisateur — *"dashboard d'administration"*)

> **À lire avant d'écrire la moindre ligne** : `bot.jsx` intégralement, puis `bot.css`. Ne pas se contenter d'un skim — tout est dans la grammaire visuelle (ticks, sparklines, status dots, fabric, etc.).

---

## Objectif

1. **Refonte `/bot`** : passer de la page « hero + 6 features + 6 commands » actuelle ([app/bot/page.tsx](app/bot/page.tsx)) à un **dashboard d'admin** complet (11 sections), tout en restant cohérent avec le design system *Cyber minimal* du repo.
2. **Refonte navbar publique** : aligner [PublicHeader.tsx](components/cyber/landing/PublicHeader.tsx) sur la nav du design (Tournois · Équipes · Joueurs · Bot · L'asso). La navbar est partagée — l'édition impacte `/`, `/association`, `/bot`, `/partenaires`, `/connexion`.

---

## Décisions tranchées

| # | Décision |
|---|----------|
| D1 | Navbar : remplacer le set actuel par `Tournois · Équipes · Joueurs · Bot · L'asso`. Supprimer Calendrier et Partenaires (les pages restent mais ne sont plus dans la navbar). |
| D2 | `/joueurs` pointe vers la route sécurisée existante (`app/(secured)/joueurs`). Cliquer le lien déclenche la redirection vers `/connexion` pour les non-authentifiés — comportement attendu et voulu. **Pas de version publique à créer.** |
| D3 | Données du dashboard (KPIs, serveurs, chart, feed) : **mocks statiques** dans `components/bot/mocks.ts`. `fetchBotStats` reste utilisé uniquement pour les compteurs réels du Hero/KPI là où c'est dispo ; le reste est inline. TODO clair en commentaire pour le branchement v2. |
| D4 | Polices Orbitron / Inter / JetBrains Mono déjà chargées globalement via `app/layout.tsx`. Aucune modification de chargement de police. |
| D5 | L'ancienne page `/bot` est **entièrement remplacée** par le dashboard. Pas de variante préservée. |

Pas de blocage. Le pipeline peut démarrer.

---

## Tâches

Chaque tâche liste : **scope**, **fichiers touchés**, **acceptance**, et **validation** (commande ou vérif visuelle). Exécution séquentielle — ne pas démarrer la suivante avant que la précédente passe sa validation.

---

### Tâche 1 — Mise à jour navbar publique

**Scope** : Aligner les liens de [components/cyber/landing/PublicHeader.tsx](components/cyber/landing/PublicHeader.tsx) sur le design.

**État actuel** (déjà non-staged dans le working tree) :
```tsx
<Link href="/#tournois">Tournois</Link>
<Link href="/#equipes">Équipes</Link>
<Link href="/#calendrier">Calendrier</Link>
<Link href="/association">L&apos;asso</Link>
<Link href="/bot">Bot Discord</Link>
<Link href="/partenaires">Partenaires</Link>
```

**État cible** (cf. `bot.jsx:95-101`) :
```tsx
<Link href="/#tournois">Tournois</Link>
<Link href="/#equipes">Équipes</Link>
<Link href="/joueurs">Joueurs</Link>
<Link href="/bot">Bot</Link>
<Link href="/association">L&apos;asso</Link>
```

Notes :
- **Supprimer** `Calendrier` et `Partenaires`. Cf. Q1.
- **Renommer** `Bot Discord` → `Bot`.
- **Ajouter** `Joueurs` → `/joueurs` (route sécurisée existante, cf. Q2).
- L'état « page courante » du design met `color: var(--blue-300)` sur le lien actif. Pour Next.js : utiliser `usePathname()` + classe conditionnelle. Si refactor coûteux, faire un suivi en tâche séparée et garder le styling neutre pour l'instant.

**Fichiers touchés** :
- `components/cyber/landing/PublicHeader.tsx`
- `components/cyber/landing/PublicHeader.module.css` (si ajustements spacing)

**Acceptance** :
- [ ] La navbar affiche 5 liens dans l'ordre : Tournois · Équipes · Joueurs · Bot · L'asso
- [ ] Plus aucune référence à `Calendrier` ou `Partenaires` dans `PublicHeader.tsx`
- [ ] Les pages qui linkaient vers `/partenaires` via la navbar continuent de fonctionner (la route et la page restent en place, juste retirées de la nav)
- [ ] Aucune régression visuelle sur les autres pages publiques (`/`, `/association`, `/bot`, `/connexion`)

**Validation** :
1. `npm run lint`
2. `npm run dev` → ouvrir `/`, `/association`, `/bot`, `/connexion` et vérifier que la navbar a le bon set de liens.
3. Cliquer chaque lien → comportement attendu (anchor scroll pour `#tournois`/`#equipes`, navigation pour `/joueurs`/`/bot`/`/association`).

---

### Tâche 2 — Mise en place du squelette de la nouvelle page Bot

**Scope** : Préparer la structure de la page sans encore implémenter les sections riches. Ceci découple le risque (layout d'abord, contenu ensuite).

**Fichier principal** : `app/bot/page.tsx` (réécriture).

**Découpage en composants** (créer dans `components/bot/`) :
```
components/bot/
  BotCrumb.tsx          ← server, statique
  BotHero.tsx           ← server, statique
  BotStatusStrip.tsx    ← 'use client' (timer uptime)
  BotKpis.tsx           ← server (mocks)
  BotActivityChart.tsx  ← 'use client' (state range 7/30/90)
  BotServersTable.tsx   ← server (mocks)
  BotLiveFeed.tsx       ← 'use client' (interval rotation, pause)
  BotLatencyCard.tsx    ← server (mocks)
  BotModules.tsx        ← 'use client' (toggles)
  BotCommands.tsx       ← server (statique)
  BotInviteCard.tsx     ← server (statique)
  Sparkline.tsx         ← server (SVG pur)
  Icon.tsx              ← server (lib d'icônes inline du design)
  mocks.ts              ← données mock (ACTIVITY, SCRIMS, SERVERS, FEED, MODULES, COMMANDS)
```

Justification client/server : seuls les composants à état (timer, toggle, range, feed) sont `'use client'`. Le reste reste server pour cohérence Next.js 15.

**Structure de `app/bot/page.tsx`** :
```tsx
<PublicHeader />
<main className="bot-main">
  <div className="fabric" />
  <div className="container">
    <BotCrumb />
    <BotHero />
    <BotStatusStrip />
    <BotKpis />
    <div className="bot-grid">
      <div className="bot-stack">
        <BotActivityChart />
        <BotServersTable />
      </div>
      <div className="bot-stack">
        <BotLiveFeed />
        <BotLatencyCard />
      </div>
    </div>
    <BotModules />
    <BotCommands />
    <BotInviteCard />
  </div>
</main>
<PublicFooter />
```

**Acceptance** :
- [ ] Tous les composants existent (placeholders OK : juste un `<section>{title}</section>`)
- [ ] La page compile et s'affiche sans erreurs console
- [ ] L'ordre vertical des sections est conforme au design

**Validation** : `npm run build` passe ; `/bot` charge sans erreur.

---

### Tâche 3 — Injection des styles `bot.css` dans le design system

**Scope** : Porter les ~677 lignes de `bot.css` dans le repo. **Ne pas** importer le fichier brut — l'intégrer en respectant les conventions existantes.

**Stratégie** :
1. Lire `bot.css` intégralement.
2. Identifier les **tokens** (variables CSS) → vérifier la correspondance avec `app/globals.css` (`--cyber-bg`, `--ink`, `--blue-500`, etc.). Le design utilise `--fg`/`--fg-mute`/`--fg-dim` ; mapper sur `--ink`/`--ink-mute`/`--ink-dim` du repo.
3. Identifier les **classes utilitaires** déjà présentes (`.fabric`, `.eyebrow`, `.mono`, `.card-ticks`, `.container`, `.row`, `.col`, `.gap-*`, `.btn`, `.btn-primary`, `.btn-ghost`) → ne pas dupliquer.
4. Ajouter les classes **nouvelles** dans `app/globals.css` (section dédiée `/* === BOT DASHBOARD === */`) ou créer `app/bot/bot.css` importé par `app/bot/page.tsx` si la taille gêne. **Préférer le second** — c'est isolé.

Liste non-exhaustive de classes nouvelles à porter :
- `.bot-main`, `.bot-crumb`, `.bot-hero`, `.bot-id`, `.bot-avatar`, `.bot-name`, `.bot-tag`, `.bot-title`, `.bot-handle`, `.bot-cta`, `.row-actions`
- `.status-strip`, `.status-cell` (+ `.online`)
- `.kpis`, `.kpi`, `.kpi-head`, `.kpi-lbl`, `.kpi-delta` (`.up`/`.down`), `.kpi-val`, `.unit`, `.kpi-spark`
- `.panel`, `.panel-head`, `.panel-body`, `.title`, `.meta`, `.chip`, `.chip-on`
- `.chart-wrap`, `.chart`, `.y-axis`, `.bars`, `.bar`, `.bar.relais`, `.x-axis`, `.chart-legend`, `.lg`, `.lg.amber`
- `.srv-table`, `.srv-head`, `.srv-row`, `.srv-rank`, `.srv-name`, `.srv-sigil`, `.srv-num`, `.srv-status` (`.ok`/`.lag`/`.off`), `.srv-spark`
- `.feed`, `.feed-row`, `.ts`, `.tag` (`.relay`/`.scrim`/`.recr`/`.auth`/`.warn`), `.msg`
- `.lat-card`, `.lat-cell`, `.l`, `.v`, `.v.ok`, `.lat-bar` (+ `> i`)
- `.bot-section-head`, `.modules`, `.mod`, `.mod-head`, `.mod-tag`, `.mod-toggle` (+ `.off`), `.mod-icon`, `.mod-title`, `.mod-desc`, `.mod-foot`
- `.cmds`, `.cmd-row`, `.glyph`, `.cmd`, `.syntax` (+ `.arg`), `.desc`, `.key`
- `.invite-card`, `.invite-inner`, `.invite-copy`, `.perms`, `.perm`, `.check`, `.scope`
- `.bot-grid`, `.bot-stack`

**Acceptance** :
- [ ] Aucune **redéfinition** de classe existante (`.container`, `.fabric`, `.btn`, etc.)
- [ ] Variables CSS `--fg*` du design remappées sur `--ink*` du repo
- [ ] CSS importé dans `app/bot/page.tsx` ou intégré à `app/globals.css` selon la décision
- [ ] Aucune classe orpheline (toute classe ajoutée est utilisée par au moins un composant de la Tâche 2)

**Validation** : `npm run build` passe ; visuellement, les sections placeholders prennent forme dès qu'on commence la Tâche 4.

---

### Tâche 4 — Implémentation des sections statiques (server components)

**Scope** : Remplir le contenu des composants server.

**Ordre recommandé** (du haut de page vers le bas) :

1. **BotCrumb** (`bot.jsx:136-148`) : breadcrumb `BLUEGENJI / DASHBOARD / BOT DISCORD` + endpoint avec dot pulsé.
2. **BotHero** (`bot.jsx:150-190`) : avatar SVG hexagonal, titre `BlueGenji Relay`, handle `@bluegenji_relay#7340`, badge Discord, CTA Documentation + Inviter.
3. **BotKpis** (`bot.jsx:261-282`) : 4 cartes avec label, delta, valeur, sparkline. Sparkline = composant SVG pur (`bot.jsx:242-259`). Données : mocks `ACTIVITY` (cf. `bot.jsx:11-17`).
4. **BotServersTable** (`bot.jsx:339-375`) : table avec rank, sigil coloré, members, relays, status dot, mini-sparkline en barres. Données : `SERVERS` (cf. `bot.jsx:27-36`).
5. **BotLatencyCard** (`bot.jsx:426-457`) : 4 cells (API latency, Gateway, CPU, RAM) avec barre de progression. Statique.
6. **BotCommands** (`bot.jsx:499-530`) : 8 slash commands avec glyph, syntax (avec `<span class="arg">` pour args), desc, key (`PUBLIC`/`ADMIN`). Données : `COMMANDS` (cf. `bot.jsx:63-72`).
7. **BotInviteCard** (`bot.jsx:535-586`) : card OAuth avec 5 perms checklistées et integer `1099511627776`.

**Données mock** : centralisées dans `components/bot/mocks.ts`. Conserver telles quelles depuis `bot.jsx` (constantes en haut).

**Icons** : porter le composant `Icon` (`bot.jsx:118-131`) — switch sur 7 noms (`relay`, `swords`, `user`, `bell`, `key`, `chart`, `discord`). SVG inline.

**Acceptance** :
- [ ] Chaque section affiche un rendu fidèle au design (comparer avec le HTML extrait)
- [ ] Le texte est en **français** (cf. CLAUDE.md)
- [ ] Pas de hardcoded color : utiliser les tokens CSS

**Validation** : `npm run dev` → `/bot` → comparer section par section avec `bot.jsx`. Pas de screenshot automatique nécessaire (cf. README design : *« don't render unless asked »*) ; lecture du DOM suffit. Sur demande utilisateur : un screenshot via Preview.

---

### Tâche 5 — Implémentation des sections interactives (client components)

**Scope** : Composants à état. Tous marqués `'use client'`, hooks `useState`/`useEffect`.

1. **BotStatusStrip** (`bot.jsx:195-237`) :
   - 5 cells : Status (OPERATIONAL · dot pulsé), Uptime (timer live `21j 14h XXm XXs` qui incrémente toutes les secondes), Version, Gateway latency, Shards.
   - `useEffect` avec `setInterval(1000)` pour l'uptime. **Cleanup obligatoire** (`return () => clearInterval(id)`).

2. **BotActivityChart** (`bot.jsx:287-334`) :
   - `useState("30j")` pour la plage. Chips `7j / 30j / 90j` (le design n'a pas vraiment 90j, garder uniquement 7j/30j ou ajouter mock 90j).
   - Barres relais (bleu) + scrims (ambre) côte à côte, axe Y dynamique (`max`), axe X selon plage.
   - Légende + moyenne par jour.

3. **BotLiveFeed** (`bot.jsx:380-420`) :
   - `useState(FEED)` + `useState(false)` (paused).
   - `setInterval(1000)` qui incrémente les timestamps de chaque entrée.
   - Bouton **PAUSE / REPRENDRE**.
   - Affichage 13 entrées max, overflow hidden.
   - Tags colorés via classes : `relay` (bleu), `scrim` (ambre), `recr` (mauve), `auth` (vert), `warn` (rouge).

4. **BotModules** (`bot.jsx:462-494`) :
   - 6 cards avec toggle individuel (`useState(MODULES)` + `toggle(i)`).
   - Toggle pill : `.mod-toggle` / `.mod-toggle.off` (cf. CSS).
   - Footer : `● EN LIGNE` (ok) vs `○ DÉSACTIVÉ` (warn).

**Attention SSR** :
- L'uptime et le feed dépendent du temps. Pour éviter un **hydration mismatch**, initialiser l'état avec la même valeur côté serveur et client (ex : `"21j 14h 32m 18s"` en dur), puis laisser l'interval mettre à jour seulement après mount.
- Pour les randomisations éventuelles : ne PAS utiliser `Math.random()` dans le rendu initial.

**Acceptance** :
- [ ] Aucun warning d'hydration dans la console
- [ ] Les toggles modifient l'état visuel sans page reload
- [ ] Le feed peut être mis en pause et reprend correctement
- [ ] Les intervals sont nettoyés au unmount (pas de leak)

**Validation** :
1. `npm run dev`
2. Ouvrir `/bot`, vérifier la console (0 erreur, 0 warning)
3. Cliquer Pause → timestamps s'arrêtent. Cliquer Reprendre → reprennent.
4. Toggler un module → état visuel change.
5. Changer la plage du chart → barres mises à jour.

---

### Tâche 6 — Responsive & accessibilité

**Scope** : Vérifier le comportement aux breakpoints standards et l'accessibilité.

**Breakpoints à tester** :
- Desktop ≥ 1280px : grille 2 colonnes pour `bot-grid`, 4 colonnes pour KPIs, 3 colonnes pour modules
- Tablet ~768px : passer en 2 colonnes / stack
- Mobile 375px : tout en stack vertical, padding ajusté

**Le `bot.css` du design n'inclut pas de media queries explicites** (à vérifier en lisant les 677 lignes). Si absentes, ajouter à la fin du CSS porté :
```css
@media (max-width: 1024px) {
  .bot-grid { grid-template-columns: 1fr; }
  .kpis { grid-template-columns: repeat(2, 1fr); }
  .modules { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .kpis, .modules { grid-template-columns: 1fr; }
  .status-strip { grid-template-columns: repeat(2, 1fr); }
  .bot-hero { flex-direction: column; gap: 24px; }
}
```

**Accessibilité** :
- Tous les `<button>` (chips, toggles, pause) ont un `aria-label` explicite
- Hiérarchie : 1× `<h1>` (BotHero), `<h2>` pour Modules/Commands, `<h3>` pour InviteCard
- Liens externes (Discord OAuth, docs) : `target="_blank"` + `rel="noreferrer"`
- Contraste : tous les textes sur `--cyber-bg` passent AA (déjà respecté dans le design system)

**Acceptance** :
- [ ] Affichage correct à 375px, 768px, 1280px (DevTools responsive mode)
- [ ] Navigation clavier opérationnelle (Tab dans la navbar, dans les toggles, dans le bouton Pause)
- [ ] `npm run lint` propre

**Validation** : ouvrir `/bot` en DevTools, tester chaque breakpoint.

---

### Tâche 7 — Nettoyage et arrêt des serveurs de dev

**Scope** : Conformité aux conventions du repo.

**Checklist** :
- [ ] Supprimer l'ancien `app/bot/page.tsx` si remplacé entièrement (sinon écraser proprement)
- [ ] Supprimer toute `console.log` de debug
- [ ] Pas de commentaire `// TODO` orphelin (sauf ceux liés à Q3 — données réelles à brancher en v2 — bien documentés)
- [ ] **Arrêter tous les `npm run dev`** en cours (cf. CLAUDE.md : *« Arrête les previews à la fin »*)
- [ ] `npm run lint` clean
- [ ] `npm run build` passe

**Validation** : `git status` montre uniquement les fichiers attendus :
```
modified:   components/cyber/landing/PublicHeader.tsx
modified:   app/bot/page.tsx
new:        components/bot/*.tsx
new:        components/bot/mocks.ts
new:        app/bot/bot.css  (si ce choix retenu)
```

---

## Conventions à respecter (extrait CLAUDE.md)

- **Textes en français**, partout
- **Toasts** via `useToast()` pour erreurs/succès — pas applicable ici (page statique majoritairement), mais à garder en tête si on ajoute des interactions API plus tard
- **Server-only** : `lib/server/*` jamais importé depuis un client component. Tous les composants `'use client'` listés en Tâche 5 ne doivent **pas** importer `fetchBotStats` directement — passer les données en props depuis `app/bot/page.tsx`.
- **Helpers** : `normalizePseudo`, `toIso`, etc. ne sont pas requis ici
- **Path alias** `@/*` (déjà configuré)

---

## Ordre d'exécution récapitulatif

```
Tâche 1 → Navbar (édit ciblé, faible risque)         [~ 5 min]
Tâche 2 → Squelette page bot (placeholders)          [~ 20 min]
Tâche 3 → Portage CSS                                [~ 30 min]
Tâche 4 → Sections server statiques                  [~ 60 min]
Tâche 5 → Sections client interactives               [~ 45 min]
Tâche 6 → Responsive & a11y                          [~ 20 min]
Tâche 7 → Nettoyage + arrêt servers                  [~ 5 min]
```

Estimations indicatives pour Haiku — ajuster selon retours.

---

## Risques connus

| Risque | Mitigation |
|--------|-----------|
| Hydration mismatch sur uptime/feed | Initialiser avec valeur statique côté SSR, animer après mount |
| CSS conflicts avec `globals.css` | Préfixer toutes les classes `bot-*` ou les isoler dans `app/bot/bot.css` |
| `/joueurs` mène vers une page sécurisée (redirect login) | Confirmer Q2 avec l'utilisateur ; UX acceptable mais à valider |
| Mocks figées en prod | Tâche v2 — brancher `fetchBotStats` étendu après validation visuelle |
| Polices Orbitron / JetBrains Mono pas chargées au moment du render | Déjà chargées globalement dans `app/layout.tsx`, vérifier |

---

## Critères de succès finaux

- [ ] `/bot` affiche un dashboard 11-sections fidèle au design
- [ ] La navbar publique est alignée sur les 5 liens du design
- [ ] Aucune régression visible sur `/`, `/association`, `/connexion`, `/partenaires`
- [ ] Build et lint clean
- [ ] Pas de warning console en navigation normale
- [ ] Aucun serveur de dev ne tourne en fin de session
