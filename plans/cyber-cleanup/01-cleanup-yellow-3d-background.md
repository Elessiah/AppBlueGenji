# Étape 1 — Suppression du fond 3D animé et de la palette « gold »

## Objectif

Le composant `Background3D` (`components/bg-canvas-3d.tsx`) injecte un canvas plein écran avec des particules 3D animées dont la palette `gold` introduit des nuances jaunes/orange globales. La maquette n'a aucun fond 3D — uniquement un canvas 2D discret de nœuds (déjà présent sous `app/(secured)/tournois/BgCanvas.tsx`) et le radial-gradient `.fabric`. Cette étape retire entièrement le `Background3D` et le système de palette `gold`.

## Fichiers à modifier

### 1.1 — `app/layout.tsx`
Supprimer l'import et le rendu de `Background3D`. Retirer aussi `PaletteProvider` si plus aucune page ne l'utilise après l'étape (on ne peut pas le vérifier ici donc on **garde** `PaletteProvider` pour l'instant — il sera retiré à la fin de l'étape une fois les autres fichiers nettoyés).

```diff
- import { Background3D } from "@/components/bg-canvas-3d";
- import { PaletteProvider } from "@/lib/palette-context";
...
-      <body className={...}>
-        <PaletteProvider>
-          <Background3D />
-          <ToastProvider>{children}</ToastProvider>
-        </PaletteProvider>
-      </body>
+      <body className={...}>
+        <ToastProvider>{children}</ToastProvider>
+      </body>
```

### 1.2 — Suppression de fichiers
Supprimer ces fichiers (plus utilisés après nettoyage des imports) :

- `components/bg-canvas-3d.tsx`
- `components/page-with-palette.tsx`
- `lib/palette-context.tsx` (à vérifier — si encore importé ailleurs, garder le fichier mais simplifier ; sinon supprimer)

Avant suppression, exécuter pour confirmer l'absence de consommateurs résiduels :
```bash
grep -rn "Background3D\|bg-canvas-3d\|PageWithPalette\|page-with-palette\|usePalette\|useSetPalette\|palette-context\|PaletteProvider" app components lib --include="*.tsx" --include="*.ts"
```

### 1.3 — Pages utilisant `PageWithPalette` ou `useSetPalette`

Remplacer par un simple fragment / supprimer les hooks. Les imports à retirer :

**`app/page.tsx`** (landing) :
```diff
- import { PageWithPalette } from "@/components/page-with-palette";
...
-    <PageWithPalette palette="blue">
+    <>
       {/* contenu */}
-    </PageWithPalette>
+    </>
```

**`app/association/page.tsx`** :
```diff
- import { PageWithPalette } from "@/components/page-with-palette";
...
-    <PageWithPalette palette="gold">
+    <>
       {/* contenu */}
-    </PageWithPalette>
+    </>
```
Retirer aussi toute classe `gold` (ex: `className="ds-header gold"` → `className="ds-header"`) et tout `palette="gold"` propagé.

**`app/partenaires/page.tsx`** : idem `association`.

**`app/bot/page.tsx`** : idem (palette était `blue`, pas critique, on retire quand même).

**`app/(secured)/tournois/page.tsx`, `app/(secured)/equipes/page.tsx`, `app/(secured)/joueurs/page.tsx`** :
Retirer les `useSetPalette` + `useEffect` de set palette. Retirer l'import de `@/lib/palette-context`.

```diff
- import { useSetPalette } from "@/lib/palette-context";
...
-  const setPalette = useSetPalette();
-  useEffect(() => {
-    setPalette("blue");
-  }, [setPalette]);
```

### 1.4 — `app/globals.css`

Retirer toutes les déclarations contenant `gold` :
- ligne 18 : `--gold-rgb: 245, 195, 58;` → supprimer
- bloc `.cta-float-home.gold { ... }` (≈ ligne 697-712) → supprimer
- blocs `.ds-header.gold`, `.ds-section-title.gold`, `.ds-title.gold`, `.ds-stat.gold` (≈ ligne 992-1010) → supprimer

Garder `--amber: #f5a524;` (utilisé pour les accents LIVE, ribbons "Inscriptions clôturent le…" — voir `RegistrationCard.tsx`). C'est un **accent contextuel**, pas un thème global — pas de problème.

### 1.5 — `components/cyber/landing/LiveCard.tsx`

Vérifier l'usage de `var(--amber)` ligne 124 (sigil de l'équipe 2 du match LIVE). À garder — c'est un placeholder visuel quand on n'a pas la vraie couleur d'équipe.

### 1.6 — Sanity check final

Après modifs :
```bash
grep -rn "gold\|Background3D\|PageWithPalette\|useSetPalette\|usePalette" app components lib --include="*.tsx" --include="*.ts" --include="*.css"
```
La sortie ne doit plus contenir que :
- `--amber` (OK, accent local)
- aucune mention de `gold` ni de `Background3D` ni de `palette-context`

### 1.7 — Suppression finale `PaletteProvider`

Une fois `useSetPalette` retiré partout, supprimer aussi `PaletteProvider` de `app/layout.tsx` et le fichier `lib/palette-context.tsx`.

## Critères d'acceptation

- `npm run build` passe.
- `npm run dev` puis visite de `/`, `/association`, `/partenaires`, `/tournois`, `/joueurs`, `/equipes` : **aucune particule 3D ne s'anime**, aucune nuance jaune sur le fond.
- Le fond visible est `var(--cyber-bg)` (`#070a10` ou équivalent) + le `.fabric` radial gradient bleu là où il est appliqué.

## Risques

- Casser `--amber` par mégarde. Ne PAS le supprimer — il sert pour les warnings de clôture d'inscription.
- Oublier un `PageWithPalette` quelque part → `npm run build` détectera l'import manquant.
