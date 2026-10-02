#!/usr/bin/env node
/**
 * Analyse SonarQube de la branche courante, sur l'instance locale (Docker).
 *
 *   npm run sonar                      # couverture Jest + analyse + rapport
 *   npm run sonar -- --skip-coverage   # réutilise coverage/lcov.info tel quel
 *   npm run sonar -- --fresh-baseline  # rejoue l'analyse de référence
 *
 * Aucun jeton à fournir : l'instance est locale (conteneur `sonarqube`,
 * http://localhost:9000, démarré par le script s'il est arrêté) et le script
 * s'y authentifie avec le compte d'administration (`admin`/`admin` par défaut,
 * surchargeable par SONAR_LOGIN / SONAR_PASSWORD, ou SONAR_TOKEN si l'on en a
 * un). Il tire un jeton d'analyse temporaire, le passe au scanner (image
 * Docker `sonarsource/sonar-scanner-cli`), puis le révoque.
 *
 * « Nouveau code » = ce que la branche change par rapport à `origin/main`.
 * L'édition Community n'analyse pas de branches : chaque branche a donc son
 * propre projet (`appbluegenji-<branche>`), dont la première analyse porte sur
 * le merge-base avec `origin/main` (version `base-<sha>`) et les suivantes sur
 * la branche (version `branch`). La période de nouveau code étant « version
 * précédente », le nouveau code est exactement l'écart entre les deux. Le SCM
 * est désactivé : sans lui, SonarQube compare les lignes à l'analyse de
 * référence au lieu de se fier aux dates de commit — antérieures à l'analyse
 * de référence, elles feraient passer tout le travail de la branche pour ancien.
 * Si `origin/main` a avancé et que la branche a été rebasée, la référence est
 * rejouée d'elle-même.
 *
 * Sortie : le rapport des critères de CLAUDE.md (pipeline, étape 7) — code 0
 * s'ils sont tous tenus, 1 sinon, 2 si l'analyse n'a pas pu avoir lieu.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const HOST = trimEnd(process.env.SONAR_HOST_URL || "http://localhost:9000", "/");
const SCANNER_HOST = hostSeenFromDocker(HOST);
const CONTAINER = process.env.SONAR_CONTAINER || "sonarqube";
const SCANNER_IMAGE = process.env.SONAR_SCANNER_IMAGE || "sonarsource/sonar-scanner-cli:latest";
const PROJECT_PREFIX = "appbluegenji";
const BRANCH_VERSION = "branch";
const MIN_COVERAGE = 80;
const MAX_DUPLICATION = 3;

const SOURCE_EXCLUSIONS = [
    "node_modules/**", ".next/**", "coverage/**", ".scannerwork/**", ".claude/**",
    "dist/**", "docs/**", "public/uploads/**", "tests/**", "e2e/**",
];
const TEST_DIRECTORIES = ["tests", "e2e"];
// Ce qui ne s'exécute pas sous Jest : configuration, scripts d'exploitation.
const COVERAGE_EXCLUSIONS = [
    "*.config.*", "*.cjs", "*.mjs", "scripts/**", "middleware.ts", "public/**",
    "lib/server/seed-view.ts", "lib/server/seed/**", "lib/server/backfill-*.ts", "lib/server/replay-*.ts",
    "lib/server/rotate-*.ts", "lib/server/generate-*.ts",
];
const RATING = { "1.0": "A", "2.0": "B", "3.0": "C", "4.0": "D", "5.0": "E" };

const cliArgs = new Set(process.argv.slice(2));
const skipCoverage = cliArgs.has("--skip-coverage");
const freshBaseline = cliArgs.has("--fresh-baseline");

const createdTokens = [];
const tempWorktrees = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message) {
    process.stdout.write(`[sonar] ${message}\n`);
}

function trimEnd(text, char) {
    let end = text.length;
    while (end > 0 && text[end - 1] === char) end--;
    return text.slice(0, end);
}

function trimBoth(text, char) {
    let start = 0;
    while (start < text.length && text[start] === char) start++;
    return trimEnd(text.slice(start), char);
}

/** Le scanner tourne dans un conteneur : « localhost » y désigne le conteneur. */
function hostSeenFromDocker(host) {
    const url = new URL(host);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        url.hostname = "host.docker.internal";
    }
    return trimEnd(url.toString(), "/");
}

/**
 * Seul point où le script lance un programme (git, docker). Il les cherche
 * dans le PATH de la session : c'est un outil de poste de développement, qui
 * lance les mêmes outils que le développeur tape lui-même.
 */
function run(command, commandArgs, options = {}) {
    return spawnSync(command, commandArgs, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...options });
}

function git(gitArgs, cwd = process.cwd()) {
    const result = run("git", gitArgs, { cwd });
    if (result.status !== 0) throw new Error(`git ${gitArgs.join(" ")} : ${result.stderr.trim()}`);
    return result.stdout.trim();
}

function authHeader() {
    if (process.env.SONAR_TOKEN) return `Bearer ${process.env.SONAR_TOKEN}`;
    const credentials = `${process.env.SONAR_LOGIN || "admin"}:${process.env.SONAR_PASSWORD || "admin"}`;
    return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

/**
 * Le scanner bloque le processus plusieurs minutes : la connexion gardée
 * ouverte par l'appel précédent a été fermée par le serveur entre-temps, et le
 * premier `fetch` qui la réutilise échoue sur le réseau.
 */
async function fetchWithRetry(url, init) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await fetch(url, init);
        } catch (error) {
            if (attempt >= 4) throw error;
            await sleep(1000 * attempt);
        }
    }
}

async function api(method, endpoint, params = {}) {
    const query = new URLSearchParams(params).toString();
    const isGet = method === "GET";
    const suffix = isGet && query ? "?" + query : "";
    const headers = { Authorization: authHeader() };
    if (!isGet) headers["Content-Type"] = "application/x-www-form-urlencoded";
    const response = await fetchWithRetry(`${HOST}/api/${endpoint}${suffix}`, {
        method,
        headers,
        body: isGet ? undefined : query,
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${method} ${endpoint} → HTTP ${response.status} ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : {};
}

async function serverStatus() {
    try {
        const response = await fetchWithRetry(`${HOST}/api/system/status`);
        return (await response.json()).status;
    } catch {
        return null;
    }
}

async function ensureServerUp() {
    if ((await serverStatus()) === "UP") return;
    log(`SonarQube injoignable sur ${HOST} — démarrage du conteneur « ${CONTAINER} »…`);
    const started = run("docker", ["start", CONTAINER]);
    if (started.status !== 0) {
        const reason = started.stderr?.trim() || started.error?.message || "";
        throw new Error(`impossible de démarrer le conteneur « ${CONTAINER} » (${reason}). Docker Desktop est-il lancé ?`);
    }
    for (let i = 0; i < 90; i++) {
        if ((await serverStatus()) === "UP") return;
        await sleep(2000);
    }
    throw new Error("SonarQube n'est pas passé à l'état UP en 3 minutes");
}

function slugify(branch) {
    return trimBoth(branch.toLowerCase().replace(/[^a-z0-9._-]+/g, "-"), "-").slice(0, 200);
}

function fileOf(component) {
    return component.split(":").slice(1).join(":");
}

async function analyses(projectKey) {
    try {
        const result = await api("GET", "project_analyses/search", { project: projectKey, ps: "100" });
        return result.analyses ?? [];
    } catch (error) {
        if (String(error.message).includes("HTTP 404")) return null;
        throw error;
    }
}

async function generateToken(projectKey) {
    if (process.env.SONAR_TOKEN) return process.env.SONAR_TOKEN;
    const name = `claude-scan-${projectKey}-${Date.now()}`;
    const result = await api("POST", "user_tokens/generate", {
        name, type: "PROJECT_ANALYSIS_TOKEN", projectKey,
    });
    createdTokens.push(name);
    return result.token;
}

/** Jest écrit des chemins absolus Windows, illisibles pour le scanner Linux. */
function relativizeLcov(dir) {
    const lcov = path.join(dir, "coverage", "lcov.info");
    if (!existsSync(lcov)) return false;
    const rewritten = readFileSync(lcov, "utf8")
        .split("\n")
        .map((line) => {
            if (!line.startsWith("SF:")) return line;
            const file = line.slice(3).trim();
            const relative = path.isAbsolute(file) ? path.relative(dir, file) : file;
            return "SF:" + relative.split(path.sep).join("/");
        })
        .join("\n");
    writeFileSync(lcov, rewritten);
    return true;
}

function scannerProperties({ dir, projectKey, projectName, version, withCoverage }) {
    const properties = {
        "sonar.projectKey": projectKey,
        "sonar.projectName": projectName,
        "sonar.projectVersion": version,
        "sonar.sources": ".",
        "sonar.exclusions": SOURCE_EXCLUSIONS.join(","),
        "sonar.coverage.exclusions": COVERAGE_EXCLUSIONS.join(","),
        "sonar.sourceEncoding": "UTF-8",
        "sonar.scm.disabled": "true",
    };
    const testDirectories = TEST_DIRECTORIES.filter((directory) => existsSync(path.join(dir, directory)));
    if (testDirectories.length) properties["sonar.tests"] = testDirectories.join(",");
    if (withCoverage) properties["sonar.javascript.lcov.reportPaths"] = "coverage/lcov.info";
    return properties;
}

async function waitForTask(taskId) {
    for (let i = 0; i < 300; i++) {
        const { task } = await api("GET", "ce/task", { id: taskId });
        if (task.status === "SUCCESS") return task.analysisId;
        if (task.status === "FAILED" || task.status === "CANCELED") {
            throw new Error(`traitement SonarQube ${task.status} : ${task.errorMessage ?? ""}`);
        }
        await sleep(2000);
    }
    throw new Error("le traitement SonarQube n'a pas abouti en 10 minutes");
}

async function runScanner(options) {
    const { dir, projectKey, version, token } = options;
    const properties = scannerProperties(options);
    const dockerArgs = [
        "run", "--rm",
        "-e", `SONAR_HOST_URL=${SCANNER_HOST}`,
        "-e", `SONAR_TOKEN=${token}`,
        "-v", `${dir}:/usr/src`,
        SCANNER_IMAGE,
        ...Object.entries(properties).map(([key, value]) => `-D${key}=${value}`),
    ];
    log(`analyse de ${projectKey} (version ${version})…`);
    const scan = run("docker", dockerArgs);
    const output = (scan.stdout ?? "") + (scan.stderr ?? "");
    // L'image du scanner garde son dossier de travail hors du volume monté :
    // l'identifiant du traitement se lit dans sa sortie.
    const taskId = /api\/ce\/task\?id=([\w-]+)/.exec(output)?.[1];
    if (scan.status !== 0 || !taskId) {
        process.stderr.write(output.slice(-6000));
        const detail = taskId ? "" : ", aucun rapport envoyé";
        throw new Error(`le scanner a échoué (code ${scan.status}${detail})`);
    }
    return waitForTask(taskId);
}

async function ensureBaseline({ root, projectKey, projectName, base }) {
    const baselineVersion = `base-${base.slice(0, 12)}`;
    const existing = await analyses(projectKey);
    const hasBaseline = existing?.some((analysis) => analysis.projectVersion === baselineVersion);
    if (hasBaseline && !freshBaseline) {
        log(`référence ${baselineVersion} déjà analysée`);
        return;
    }
    if (existing) {
        log(`référence absente, périmée ou redemandée — projet ${projectKey} recréé`);
        await api("POST", "projects/delete", { project: projectKey });
    }
    await api("POST", "projects/create", { project: projectKey, name: projectName, visibility: "private" });
    await api("POST", "new_code_periods/set", { project: projectKey, type: "PREVIOUS_VERSION" });

    const worktree = mkdtempSync(path.join(tmpdir(), "sonar-base-"));
    rmSync(worktree, { recursive: true, force: true });
    git(["worktree", "add", "--detach", "--quiet", worktree, base], root);
    tempWorktrees.push({ root, worktree });
    const token = await generateToken(projectKey);
    await runScanner({ dir: worktree, projectKey, projectName, version: baselineVersion, token, withCoverage: false });
}

function runCoverage(root) {
    log("couverture Jest (jest --coverage)…");
    // Node lui-même et le binaire de Jest du dépôt : ni PATH ni shell.
    const jest = spawnSync(
        process.execPath,
        [path.join(root, "node_modules", "jest", "bin", "jest.js"), "--coverage", "--coverageReporters=lcov", "--silent"],
        { cwd: root, stdio: "inherit" },
    );
    return jest.status === 0;
}

async function loadMeasures(projectKey) {
    const metricKeys = [
        "new_reliability_rating", "new_security_rating", "new_maintainability_rating",
        "new_coverage", "new_lines_to_cover", "new_duplicated_lines_density",
    ];
    const { component } = await api("GET", "measures/component", { component: projectKey, metricKeys: metricKeys.join(",") });
    return (key) => {
        const found = component.measures.find((m) => m.metric === key);
        return found?.period?.value ?? found?.value ?? null;
    };
}

async function checkQualityGate(analysisId) {
    const { projectStatus } = await api("GET", "qualitygates/project_status", { analysisId });
    log(`Quality Gate : ${projectStatus.status}`);
    const failures = projectStatus.status === "OK" ? [] : [`Quality Gate ${projectStatus.status}`];
    for (const condition of projectStatus.conditions ?? []) {
        if (condition.status === "OK") continue;
        const threshold = `${condition.comparator} ${condition.errorThreshold}`;
        failures.push(`condition ${condition.metricKey} : ${condition.actualValue} (seuil ${threshold})`);
    }
    return failures;
}

function checkRatings(measure) {
    const failures = [];
    for (const [key, label] of [
        ["new_reliability_rating", "fiabilité"],
        ["new_security_rating", "sécurité"],
        ["new_maintainability_rating", "maintenabilité"],
    ]) {
        const rating = RATING[Number(measure(key) ?? 1).toFixed(1)] ?? "?";
        log(`note ${label} (nouveau code) : ${rating}`);
        if (rating !== "A") failures.push(`note ${label} ${rating} (A exigé)`);
    }
    return failures;
}

function checkCoverageAndDuplication(measure) {
    const failures = [];
    const linesToCover = Number(measure("new_lines_to_cover") ?? 0);
    const coverage = Number(measure("new_coverage") ?? 0).toFixed(1);
    if (linesToCover > 0) {
        log(`couverture (nouveau code) : ${coverage} % sur ${linesToCover} lignes`);
        if (Number(coverage) < MIN_COVERAGE) failures.push(`couverture ${coverage} % (≥ ${MIN_COVERAGE} % exigé)`);
    } else {
        log("couverture (nouveau code) : aucune ligne à couvrir");
    }
    const duplication = Number(measure("new_duplicated_lines_density") ?? 0).toFixed(1);
    log(`duplication (nouveau code) : ${duplication} %`);
    if (Number(duplication) > MAX_DUPLICATION) failures.push(`duplication ${duplication} % (≤ ${MAX_DUPLICATION} % exigé)`);
    return failures;
}

async function checkIssues(projectKey) {
    const failures = [];
    const open = await api("GET", "issues/search", {
        componentKeys: projectKey, inNewCodePeriod: "true", issueStatuses: "OPEN,CONFIRMED", ps: "500",
    });
    log(`problèmes ouverts (nouveau code) : ${open.total}`);
    for (const issue of open.issues) {
        const severity = issue.severity ?? issue.impacts?.[0]?.severity ?? "";
        log(`  - ${fileOf(issue.component)}:${issue.line ?? "?"} [${severity} ${issue.rule}] ${issue.message}`);
    }
    if (open.total > 0) failures.push(`${open.total} problème(s) ouvert(s) (zéro exigé)`);

    const closed = await api("GET", "issues/search", {
        componentKeys: projectKey, inNewCodePeriod: "true", issueStatuses: "ACCEPTED,FALSE_POSITIVE",
        additionalFields: "comments", ps: "500",
    });
    const unjustified = closed.issues.filter((issue) => !(issue.comments ?? []).length);
    for (const issue of unjustified) {
        log(`  - non justifié : ${fileOf(issue.component)}:${issue.line ?? "?"} [${issue.rule}] ${issue.issueStatus}`);
    }
    if (unjustified.length) failures.push(`${unjustified.length} problème(s) accepté(s) ou faux positif(s) sans commentaire`);
    return failures;
}

async function checkHotspots(projectKey) {
    const hotspots = await api("GET", "hotspots/search", {
        project: projectKey, inNewCodePeriod: "true", status: "TO_REVIEW", ps: "500",
    });
    const total = hotspots.paging?.total ?? hotspots.hotspots?.length ?? 0;
    log(`security hotspots à examiner (nouveau code) : ${total}`);
    for (const hotspot of hotspots.hotspots ?? []) {
        log(`  - ${fileOf(hotspot.component)}:${hotspot.line ?? "?"} [${hotspot.ruleKey}] ${hotspot.message}`);
    }
    return total > 0 ? [`${total} security hotspot(s) non examiné(s)`] : [];
}

async function report({ projectKey, analysisId, testsPassed }) {
    const measure = await loadMeasures(projectKey);
    const failures = [
        ...(await checkQualityGate(analysisId)),
        ...checkRatings(measure),
        ...checkCoverageAndDuplication(measure),
        ...(await checkIssues(projectKey)),
        ...(await checkHotspots(projectKey)),
    ];
    if (!testsPassed) failures.push("des tests Jest échouent (couverture incomplète)");

    log(`tableau de bord : ${HOST}/dashboard?id=${encodeURIComponent(projectKey)}`);
    if (failures.length === 0) {
        log("tous les critères sont tenus ✓");
        return 0;
    }
    log("CRITÈRES NON TENUS :");
    for (const failure of failures) log(`  ✗ ${failure}`);
    return 1;
}

async function main() {
    const root = git(["rev-parse", "--show-toplevel"]);
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], root);
    if (branch === "HEAD") throw new Error("HEAD détachée : se placer sur une branche");
    run("git", ["fetch", "--quiet", "origin", "main"], { cwd: root });
    const base = git(["merge-base", "HEAD", "origin/main"], root);
    const projectKey = `${PROJECT_PREFIX}-${slugify(branch)}`;
    const projectName = `BlueGenji — ${branch}`;

    await ensureServerUp();
    await ensureBaseline({ root, projectKey, projectName, base });

    const testsPassed = skipCoverage || runCoverage(root);
    const withCoverage = relativizeLcov(root);
    if (!withCoverage) log("aucun coverage/lcov.info : la couverture sera comptée à 0");

    const token = await generateToken(projectKey);
    const analysisId = await runScanner({ dir: root, projectKey, projectName, version: BRANCH_VERSION, token, withCoverage });
    return report({ projectKey, analysisId, testsPassed });
}

async function cleanup() {
    for (const { root, worktree } of tempWorktrees) {
        run("git", ["worktree", "remove", "--force", worktree], { cwd: root });
    }
    for (const name of createdTokens) {
        try {
            await api("POST", "user_tokens/revoke", { name });
        } catch (error) {
            process.stderr.write(`[sonar] jeton « ${name} » non révoqué : ${error.message}\n`);
        }
    }
}

let exitCode = 2;
try {
    exitCode = await main();
} catch (error) {
    process.stderr.write(`[sonar] échec : ${error.message}\n`);
} finally {
    await cleanup();
}
process.exit(exitCode);
