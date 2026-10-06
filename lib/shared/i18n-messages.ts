/**
 * Forme des messages de traduction (`messages/<langue>/<espace>.json`).
 *
 * Un fichier par **espace de noms** (une zone du site : `common`, `nav`,
 * `rules`…) et par langue. Le français est la référence des types : l'anglais
 * doit avoir exactement les mêmes clés (vérifié à la compilation par
 * `lib/server/i18n-messages.ts`, et arguments ICU compris par le test de
 * parité `tests/lib/shared/i18n-messages-parity.test.ts`).
 *
 * Ajouter un espace : créer les deux fichiers, l'ajouter à
 * {@link MESSAGE_NAMESPACES}, à {@link Messages} et au catalogue serveur.
 */
import type frCommon from "@/messages/fr/common.json";
import type frShell from "@/messages/fr/shell.json";
import type frRules from "@/messages/fr/rules.json";

export const MESSAGE_NAMESPACES = ["common", "shell", "rules"] as const;
export type MessageNamespace = (typeof MESSAGE_NAMESPACES)[number];

export type Messages = {
  common: typeof frCommon;
  /** Coquille partagée (en-têtes, pieds de page, menus, notifications, pages d'erreur) — `components/i18n/shell-text.tsx`. */
  shell: typeof frShell;
  /** Pages `/regles` et `/regles/[slug]` : registre des modes, schémas, sommaire — `lib/shared/tournament-rules.ts`. */
  rules: typeof frRules;
};

/**
 * Les seuls espaces de noms qu'un sous-arbre client utilise.
 *
 * Un composant serveur lit ses messages sans rien envoyer au navigateur ; un
 * composant client, lui, reçoit son dictionnaire **sérialisé dans la page**.
 * On n'y met donc que ce qu'il lit (cible : moins de 10 Ko par page publique).
 */
export function pickMessages<N extends MessageNamespace>(messages: Messages, namespaces: readonly N[]): Pick<Messages, N> {
  const picked = {} as Pick<Messages, N>;
  for (const namespace of namespaces) picked[namespace] = messages[namespace];
  return picked;
}
