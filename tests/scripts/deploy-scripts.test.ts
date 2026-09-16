import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Les deux scripts d'exploitation, gardés à la source.
 *
 * Rien ici n'exécute quoi que ce soit — on ne lance pas un déploiement depuis
 * une suite de tests. Ce que ces cas tiennent, c'est la **forme** des deux
 * fichiers, parce que les deux défauts qu'ils ont eus étaient invisibles tant
 * qu'on ne déployait pas : ils ne cassaient rien en développement, et c'est la
 * production qui les a révélés.
 */
function script(name: string): string {
  const source = readFileSync(join(process.cwd(), name), "utf8");

  // Les lignes de commentaire sont retirées avant lecture, comme le fait
  // `tests/app/team-card-logo.test.ts` pour les commentaires CSS : l'en-tête de
  // chaque script **cite** les commandes que ces gardes interdisent, pour dire
  // pourquoi elles sont parties. Lire le fichier entier ferait échouer des
  // scripts pourtant corrects — et pousserait à effacer l'explication pour
  // faire passer le test, ce qui est exactement le mauvais remède.
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

describe("start.sh — démarrer, et rien d'autre", () => {
  const source = script("start.sh");

  it("ne sème jamais la base", () => {
    // Le point le plus grave de l'ancienne version. `npm run seed` écrit dans
    // la base de l'environnement courant : posé dans le chemin de démarrage du
    // serveur de production, il y aurait créé la matrice de test — une
    // centaine d'équipes et des dizaines de tournois — dans la base servie.
    expect(source).not.toMatch(/\bseed\b/);
  });

  it("ne tire pas de code au démarrage", () => {
    // La version servie doit être décidée par un déploiement, pas par un
    // redémarrage — y compris un redémarrage que personne n'a demandé (reboot,
    // `pm2 resurrect`).
    expect(source).not.toMatch(/git\s+pull/);
  });

  it("ne fait pas dépendre la disponibilité d'une suite de tests", () => {
    expect(source).not.toMatch(/npm\s+run\s+test/);
  });

  it("lance le serveur par un chemin qui existe", () => {
    // `next start` seul n'est pas dans le `PATH` : l'ancienne ligne n'aboutissait
    // pas. Le binaire se désigne par son chemin dans `node_modules`.
    expect(source).toMatch(/node_modules\/\.bin\/next\s+start/);
    // `exec` : le serveur remplace le shell et reçoit donc directement les
    // signaux d'arrêt de pm2.
    expect(source).toMatch(/\bexec\b/);
  });
});

describe("update.sh — un déploiement s'arrête à la première erreur", () => {
  const source = script("update.sh");

  it("interrompt la suite dès qu'une étape échoue", () => {
    // Sans cette ligne, chaque étape s'exécutait quoi qu'il arrive : un build
    // en échec menait quand même au redémarrage, donc à servir un site cassé —
    // ou à ne plus rien servir.
    expect(source).toMatch(/set -euo pipefail/);
  });

  it("installe d'après le verrou, pas d'après une résolution neuve", () => {
    // `npm install --force` ignore `package-lock.json` : deux déploiements du
    // même commit pouvaient installer deux arbres de dépendances différents.
    expect(source).toMatch(/npm ci/);
    expect(source).not.toMatch(/npm\s+install\s+--force/);
  });

  it("construit avant de redémarrer, jamais après", () => {
    expect(source.indexOf("npm run build")).toBeGreaterThan(-1);
    expect(source.indexOf("npm run build")).toBeLessThan(source.indexOf("pm2 restart"));
  });

  it("transmet l'environnement au processus relancé", () => {
    // Sans `--update-env`, pm2 relance avec l'environnement figé au premier
    // lancement : une variable ajoutée à `.env.production` n'arrive jamais.
    expect(source).toMatch(/pm2 restart bluegenji --update-env/);
  });

  it("vérifie que le site répond avant de se déclarer fini", () => {
    // Un déploiement qui ne contrôle rien annonce un succès qu'il n'a pas
    // constaté : c'est ainsi qu'une panne reste invisible jusqu'au premier
    // visiteur.
    expect(source).toMatch(/curl/);
    expect(source).toMatch(/exit 1/);
  });
});
