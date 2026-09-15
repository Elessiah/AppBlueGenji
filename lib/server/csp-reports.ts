/**
 * Lecture et journalisation des violations de CSP remontées par les navigateurs.
 *
 * La politique part en `Report-Only` ({@link lib/shared/csp}) : elle ne refuse
 * rien, elle **raconte**. Encore faut-il que quelqu'un l'écoute — sans
 * collecteur, les violations ne vivent que dans la console du visiteur, où
 * personne ne les lira jamais.
 *
 * Deux contraintes gouvernent ce module, et elles tirent dans le même sens.
 *
 * La première est le **volume**. Une page fautive produit une violation par
 * chargement, sur chaque visite de chaque visiteur : journaliser chacune
 * remplirait le disque du Raspberry en quelques heures — l'application sœur a
 * déjà produit un fichier de log de 235 Mo de cette façon. On ne retient donc
 * qu'un exemplaire par cause distincte et par heure, la cause étant la
 * directive violée et l'**origine** de la ressource, jamais son URL complète.
 *
 * La seconde est la **vie privée**. Le corps d'un rapport porte l'URL de la
 * page visitée et le bout de script incriminé ; les fiches de tournoi, d'équipe
 * et de joueur portent des identifiants dans leur chemin, et la page de
 * connexion porte sa destination en paramètre. Rien de tout cela n'est utile
 * pour corriger une politique : le chemin est conservé sans sa requête, et
 * l'extrait de script n'est pas lu du tout.
 *
 * Aucun stockage : la sortie est la console du processus, que pm2 capture.
 * Une table grandirait, et ce que l'on cherche ici tient en quelques lignes.
 */

/** Ce qu'un rapport de violation apprend, une fois débarrassé du reste. */
export interface CspViolation {
  /** Directive effectivement violée, p. ex. `script-src-elem`. */
  directive: string;
  /** Origine de la ressource refusée, ou un mot-clé (`inline`, `eval`, `data`). */
  blockedOrigin: string;
  /** Chemin de la page, sans la chaîne de requête. */
  documentPath: string;
}

/** Fenêtre de dédoublonnage : une cause distincte ne se journalise qu'une fois par heure. */
export const CSP_DEDUPE_WINDOW_MS = 60 * 60_000;

/** Borne dure du suivi de dédoublonnage, pour que la mémoire reste finie. */
export const CSP_MAX_TRACKED_CAUSES = 200;

/**
 * Réduit une URL à son origine, ou au mot-clé que le navigateur a employé.
 *
 * Les navigateurs ne renvoient pas toujours une URL : `inline`, `eval` et
 * `data` désignent la nature de la ressource, pas son adresse. Ils passent
 * tels quels. Une vraie URL est ramenée à son origine — c'est ce qui manque à
 * la politique, le reste ne fait que grossir la ligne.
 *
 * @param value Valeur de `blocked-uri`.
 * @returns L'origine, le mot-clé, ou `"inconnu"` si la valeur est inexploitable.
 */
export function blockedOriginOf(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "inconnu";
  }
  const trimmed = value.trim();
  // Mots-clés et schémas sans hôte : `data:`, `blob:`, `inline`, `eval`…
  if (!trimmed.includes("://")) {
    return trimmed.split(":")[0] || "inconnu";
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    return "inconnu";
  }
}

/**
 * Retire la chaîne de requête d'une URL de page, et ne garde que le chemin.
 *
 * @param value Valeur de `document-uri`.
 * @returns Le chemin seul, ou `"/"` à défaut.
 */
export function documentPathOf(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "/";
  }
  const trimmed = value.trim();
  try {
    return new URL(trimmed).pathname || "/";
  } catch {
    // Une valeur relative reste exploitable : on coupe à la requête ou au fragment.
    const cut = trimmed.split(/[?#]/)[0];
    return cut.startsWith("/") ? cut : "/";
  }
}

/**
 * Lit un corps de rapport, quel que soit le format du navigateur.
 *
 * Deux formats coexistent et coexisteront longtemps : le `{"csp-report": {…}}`
 * historique (`application/csp-report`, encore envoyé par Chrome et Safari) et
 * le tableau d'objets `{type, body}` du Reporting API
 * (`application/reports+json`, Firefox et les versions récentes de Chrome).
 * Ne lire que l'un des deux reviendrait à n'écouter que la moitié des
 * visiteurs, sans jamais savoir laquelle manque.
 *
 * @param payload Corps JSON reçu.
 * @returns Les violations lisibles, éventuellement aucune.
 */
export function parseCspReport(payload: unknown): CspViolation[] {
  const bodies: Record<string, unknown>[] = [];

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      if (record.type !== undefined && record.type !== "csp-violation") continue;
      const body = record.body;
      if (typeof body === "object" && body !== null && !Array.isArray(body)) {
        bodies.push(body as Record<string, unknown>);
      }
    }
  } else if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>;
    const legacy = record["csp-report"];
    if (typeof legacy === "object" && legacy !== null && !Array.isArray(legacy)) {
      bodies.push(legacy as Record<string, unknown>);
    }
  }

  const violations: CspViolation[] = [];
  for (const body of bodies) {
    // Les deux formats nomment les mêmes champs différemment : tirets pour
    // l'historique, camelCase pour le Reporting API.
    const directive =
      body["effective-directive"] ??
      body.effectiveDirective ??
      body["violated-directive"] ??
      body.violatedDirective;
    if (typeof directive !== "string" || directive.trim().length === 0) continue;

    violations.push({
      directive: directive.trim(),
      blockedOrigin: blockedOriginOf(body["blocked-uri"] ?? body.blockedURL),
      documentPath: documentPathOf(body["document-uri"] ?? body.documentURL),
    });
  }

  return violations;
}

/** Clé de dédoublonnage : ce qui distingue deux causes à corriger. */
export function violationCause(violation: CspViolation): string {
  return `${violation.directive}|${violation.blockedOrigin}`;
}

type Tracker = Map<string, { last: number; suppressed: number }>;

/**
 * Décide si une violation mérite une ligne, et compte celles qu'on tait.
 *
 * Extrait de la journalisation pour être testable sans console ni horloge
 * réelle : c'est la règle de volume qui compte, pas le canal de sortie.
 *
 * @param tracker État de suivi, modifié sur place.
 * @param cause Clé de la cause, rendue par {@link violationCause}.
 * @param now Horodatage courant.
 * @returns `null` si la ligne est étouffée, sinon le nombre d'occurrences tues depuis la dernière.
 */
export function admitViolation(tracker: Tracker, cause: string, now: number): number | null {
  const entry = tracker.get(cause);
  if (entry && now - entry.last < CSP_DEDUPE_WINDOW_MS) {
    entry.suppressed += 1;
    return null;
  }

  const suppressed = entry?.suppressed ?? 0;
  tracker.set(cause, { last: now, suppressed: 0 });

  if (tracker.size > CSP_MAX_TRACKED_CAUSES) {
    // `Map` préserve l'ordre d'insertion : les plus anciennes partent d'abord.
    for (const key of tracker.keys()) {
      if (tracker.size <= CSP_MAX_TRACKED_CAUSES) break;
      if (key !== cause) tracker.delete(key);
    }
  }

  return suppressed;
}

const tracker: Tracker = new Map();

/**
 * Journalise les violations d'un rapport, une par cause et par heure.
 *
 * @param violations Violations déjà lues par {@link parseCspReport}.
 * @param now Horodatage courant, injectable pour les tests.
 */
export function logCspViolations(violations: CspViolation[], now: number = Date.now()): void {
  for (const violation of violations) {
    const suppressed = admitViolation(tracker, violationCause(violation), now);
    if (suppressed === null) continue;
    const repeated = suppressed > 0 ? ` (+${suppressed} identique(s) depuis)` : "";
    console.warn(
      `[csp] ${violation.directive} refuserait ${violation.blockedOrigin} sur ${violation.documentPath}${repeated}`,
    );
  }
}
