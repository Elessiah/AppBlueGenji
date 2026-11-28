/**
 * Lecture et journalisation des violations de CSP remontées par les navigateurs.
 *
 * Le collecteur a été écrit pour le mode `Report-Only`, où la politique ne
 * refuse rien et se contente de **raconter** ; il vaut tel quel en application,
 * où il devient plus précieux encore — une ligne n'y annonce plus un risque,
 * elle signale quelque chose de cassé chez un visiteur, maintenant. Encore
 * faut-il que quelqu'un l'écoute : sans collecteur, les violations ne vivent
 * que dans la console du visiteur, où personne ne les lira jamais.
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

import { CSP_MODE } from "@/lib/shared/csp";

/** Ce qu'un rapport de violation apprend, une fois débarrassé du reste. */
export interface CspViolation {
  /** Directive effectivement violée, p. ex. `script-src-elem`. */
  directive: string;
  /** Origine de la ressource refusée, ou un mot-clé (`inline`, `eval`, `data`). */
  blockedOrigin: string;
  /** Chemin de la page, sans la chaîne de requête. */
  documentPath: string;
  /**
   * D'où part l'appel refusé : origine du script fautif, schéma d'une
   * extension (`chrome-extension`…), ou `"aucune"` quand le navigateur n'en
   * nomme pas — voir {@link sourceOriginOf}.
   */
  sourceOrigin: string;
}

/** Fenêtre de dédoublonnage : une cause distincte ne se journalise qu'une fois par heure. */
export const CSP_DEDUPE_WINDOW_MS = 60 * 60_000;

/** Borne dure du suivi de dédoublonnage, pour que la mémoire reste finie. */
export const CSP_MAX_TRACKED_CAUSES = 200;

/**
 * Borne dure du nombre de violations lues **par requête**.
 *
 * Le dédoublonnage par cause protège des rechargements répétés, pas d'une
 * requête unique qui fabrique d'un coup des milliers de causes distinctes
 * (un `blocked-uri` différent à chaque entrée du tableau du Reporting API) :
 * chacune serait « nouvelle » et journalisée une fois, avant même que
 * `CSP_MAX_TRACKED_CAUSES` n'ait de quoi purger. Un vrai navigateur ne
 * regroupe jamais autant de violations dans un seul envoi.
 */
export const CSP_MAX_VIOLATIONS_PER_REPORT = 25;

/**
 * Longueur maximale d'un champ de la ligne de journal (et donc de la clé de
 * dédoublonnage). Le corps est choisi par l'appelant : une origine de 30 Ko
 * (l'analyse d'URL ne borne pas la longueur d'un hôte) ferait une ligne de
 * 30 Ko et une clé de 30 Ko gardée en mémoire, deux cents fois.
 */
export const CSP_FIELD_MAX_LENGTH = 200;

/** Mot-clé ou schéma (`inline`, `eval`, `wasm-eval`, `data`, `chrome-extension`…). */
const KEYWORD = /^[a-z][a-z0-9+.-]{0,39}$/i;

/** Nom de directive (`script-src-elem`, `connect-src`…). */
const DIRECTIVE = /^[a-z][a-z-]{0,39}$/;

/**
 * Caractères qu'une ligne de journal ne doit jamais porter tels quels :
 * contrôles C0 et C1 (dont le saut de ligne, qui fabriquerait une fausse
 * ligne `[auth] …` dans pm2), séparateurs de ligne Unicode, marques
 * bidirectionnelles et caractères de largeur nulle (qui maquillent le texte).
 */
const UNSAFE_LOG_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/**
 * Rend un champ sûr pour une ligne de journal : caractères dangereux remplacés
 * par `?`, longueur bornée à {@link CSP_FIELD_MAX_LENGTH} (coupure marquée `…`).
 *
 * @param value Texte venu du rapport, donc de l'appelant.
 * @returns Le texte, sur une seule ligne et borné.
 */
export function logSafe(value: string): string {
  const clean = value.replace(UNSAFE_LOG_CHARS, "?");
  return clean.length > CSP_FIELD_MAX_LENGTH ? `${clean.slice(0, CSP_FIELD_MAX_LENGTH - 1)}\u2026` : clean;
}

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
  // Seul un vrai mot-clé passe : le reste (sauts de ligne compris) est rejeté.
  if (!trimmed.includes("://")) {
    const keyword = trimmed.split(":")[0];
    return KEYWORD.test(keyword) ? keyword : "inconnu";
  }
  try {
    const origin = new URL(trimmed).origin;
    if (origin !== "null") return logSafe(origin);
    // Un schéma non standard n'a pas d'origine : son nom suffit.
    const scheme = trimmed.split(":")[0];
    return KEYWORD.test(scheme) ? scheme.toLowerCase() : "inconnu";
  } catch {
    return "inconnu";
  }
}

/**
 * Schémas des scripts d'extension de navigateur. Un refus qui en part ne se
 * corrige pas dans le site : il le dit, plutôt que d'envoyer chercher un appel
 * qui n'existe pas dans le code.
 */
const EXTENSION_SCHEMES = new Set([
  "chrome-extension",
  "moz-extension",
  "safari-extension",
  "safari-web-extension",
  "ms-browser-extension",
]);

/** Source rendue quand le rapport ne nomme aucun script. */
export const CSP_SOURCE_NONE = "aucune";

/**
 * Source rendue quand le script fautif est **la page elle-même** : Chrome
 * nomme l'URL du document pour un script en ligne ou un attribut d'évènement.
 * Les scripts en ligne de Next portent le nonce et ne sont jamais refusés :
 * un refus « page » vient d'un code posé dans la page par un tiers.
 */
export const CSP_SOURCE_PAGE = "page";

/**
 * Réduit le script fautif (`source-file` / `sourceFile`) à ce qui sert au tri.
 *
 * Sans ce champ, une ligne du journal ne distinguait pas un défaut du site
 * d'un code **injecté** dans la page — extension, navigateur intégré d'une
 * application : `connect-src a refusé data sur /tournois/20` a ainsi fait
 * chercher un `fetch("data:…")` que le site ne contient pas. Un appel parti
 * d'un morceau du site nomme ce morceau, donc l'origine du site ; une
 * extension nomme son schéma ; un code évalué ou injecté en ligne n'en nomme
 * **aucun** (`"aucune"`), ce qui, sur une page sans script en ligne de notre
 * main, désigne un code étranger.
 *
 * Un script **de la page** (même URL que le document) n'est pas réduit ici
 * mais par l'appelant, en {@link CSP_SOURCE_PAGE} : une origine du site ne
 * désigne donc qu'un morceau servi par le site.
 *
 * Comme pour la ressource refusée, seule l'origine est gardée : le chemin
 * d'un script d'extension porte l'identifiant de l'extension, qui n'apprend
 * rien au correctif et singularise le visiteur.
 *
 * @param value Valeur de `source-file` ou `sourceFile`.
 * @returns L'origine, le schéma d'extension, ou {@link CSP_SOURCE_NONE}.
 */
export function sourceOriginOf(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return CSP_SOURCE_NONE;
  }
  const trimmed = value.trim();
  // Tête avant le premier `:` : schéma d'une adresse, ou mot-clé entier.
  // Chrome ramène souvent le script d'une extension à son seul schéma
  // (`"chrome-extension"`, sans `:`) ; Firefox et Safari écrivent `inline`
  // ou `eval` pour du code sans fichier.
  const head = trimmed.split(":")[0].toLowerCase();
  const keyword = KEYWORD.test(head) ? head : null;
  if (keyword && EXTENSION_SCHEMES.has(keyword)) return keyword;
  if (!trimmed.includes("://")) {
    return keyword ?? "inconnu";
  }
  try {
    const origin = new URL(trimmed).origin;
    // Un schéma non standard n'a pas d'origine (`"null"`) : son nom suffit.
    return origin === "null" ? (keyword ?? "inconnu") : logSafe(origin);
  } catch {
    return "inconnu";
  }
}

/**
 * Le script fautif est-il la page elle-même (même origine, même chemin) ?
 *
 * @param source Valeur de `source-file` / `sourceFile`.
 * @param document Valeur de `document-uri` / `documentURL`.
 * @returns `true` si les deux adresses désignent le même document.
 */
function isDocumentItself(source: unknown, document: unknown): boolean {
  if (typeof source !== "string" || typeof document !== "string") return false;
  try {
    const a = new URL(source.trim());
    const b = new URL(document.trim());
    return a.origin !== "null" && a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
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
    return logSafe(new URL(trimmed).pathname || "/");
  } catch {
    // Une valeur relative reste exploitable : on coupe à la requête ou au fragment.
    const cut = trimmed.split(/[?#]/)[0];
    return cut.startsWith("/") ? logSafe(cut) : "/";
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
  const violations: CspViolation[] = [];
  for (const body of reportBodies(payload)) {
    const violation = violationOf(body);
    if (violation) violations.push(violation);
  }

  return violations;
}

/** Objet simple (ni `null`, ni tableau), seule forme qu'un corps peut prendre. */
function asPlainRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Corps de violation portés par un rapport, sous l'un ou l'autre format. */
function reportBodies(payload: unknown): Record<string, unknown>[] {
  if (!Array.isArray(payload)) {
    const legacy = asPlainRecord(asPlainRecord(payload)?.["csp-report"]);
    return legacy ? [legacy] : [];
  }
  const bodies: Record<string, unknown>[] = [];
  for (const entry of payload) {
    if (bodies.length >= CSP_MAX_VIOLATIONS_PER_REPORT) break;
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (record.type !== undefined && record.type !== "csp-violation") continue;
    const body = asPlainRecord(record.body);
    if (body) bodies.push(body);
  }
  return bodies;
}

/** Violation lue dans un corps, ou `null` s'il ne nomme aucune directive. */
function violationOf(body: Record<string, unknown>): CspViolation | null {
  // Les deux formats nomment les mêmes champs différemment : tirets pour
  // l'historique, camelCase pour le Reporting API.
  const directive =
    body["effective-directive"] ??
    body.effectiveDirective ??
    body["violated-directive"] ??
    body.violatedDirective;
  if (typeof directive !== "string") return null;
  // L'ancien `violated-directive` porte la directive entière
  // (`script-src 'self'`) : seul son nom compte. Un nom qui n'en est pas un
  // (saut de ligne, texte libre) écarte le rapport — un navigateur n'en envoie pas.
  const name = directive.trim().split(/\s+/)[0].toLowerCase();
  if (!DIRECTIVE.test(name)) return null;

  const documentUrl = body["document-uri"] ?? body.documentURL;
  const sourceFile = body["source-file"] ?? body.sourceFile;
  return {
    directive: name,
    blockedOrigin: blockedOriginOf(body["blocked-uri"] ?? body.blockedURL),
    documentPath: documentPathOf(documentUrl),
    sourceOrigin: isDocumentItself(sourceFile, documentUrl) ? CSP_SOURCE_PAGE : sourceOriginOf(sourceFile),
  };
}

/**
 * Clé de dédoublonnage : ce qui distingue deux causes à corriger.
 *
 * La source en fait partie : un même refus venu du site et d'une extension
 * sont deux causes, et la seconde ne doit pas taire la première.
 */
export function violationCause(violation: CspViolation): string {
  return `${violation.directive}|${violation.blockedOrigin}|${violation.sourceOrigin}`;
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
    // Le temps du verbe suit le mode : en `Report-Only` le navigateur annonce ce
    // qu'il **aurait** refusé, en application il dit ce qu'il **a** refusé —
    // c'est-à-dire quelque chose de cassé, à l'instant, chez un visiteur. Lire
    // « refuserait » sur une page en panne enverrait chercher au mauvais endroit.
    const verbe = CSP_MODE === "enforce" ? "a refusé" : "refuserait";
    console.warn(
      `[csp] ${logSafe(violation.directive)} ${verbe} ${logSafe(violation.blockedOrigin)} sur ${logSafe(violation.documentPath)} (source : ${logSafe(violation.sourceOrigin)})${repeated}`,
    );
  }
}
