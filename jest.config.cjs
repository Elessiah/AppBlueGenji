/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
    },
    moduleNameMapper: {
        // Les composants importent leurs modules CSS ; Node ne sait pas les lire.
        '\\.(css|scss|sass)$': '<rootDir>/tests/__mocks__/style-mock.cjs',
        '^@/(.*)$': '<rootDir>/$1',
    },
    setupFiles: ['<rootDir>/tests/setup-env.cjs'],
    // Couverture par V8 et non par l'instrumentation babel : sous Jest 30,
    // ts-jest 29 rend des cartes de source dont les `sources` sont des URL
    // `file:`, que l'instrumentation relit comme un chemin relatif
    // (`lib/shared/file:/C:/…`). L'écriture du rapport échouait alors en entier
    // — `coverage/lcov.info` vide, couverture comptée à 0 par SonarQube.
    coverageProvider: 'v8',
    moduleFileExtensions: ['ts', 'tsx', 'js'],
    testMatch: ['**/tests/**/*.test.(ts|tsx|js)'],
    // Ignore les worktrees Claude Code imbriqués (`.claude/worktrees/*`) : sans
    // ça, `npm run test` lancé depuis le dépôt principal collecte les mêmes
    // tests une fois par worktree (comptage multiplié, exécutions en double).
    // Ancré sur <rootDir> pour ne viser que le `.claude` directement sous la
    // racine du projet — sans exclure un worktree lancé depuis son propre dossier.
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>[/\\\\]\\.claude[/\\\\]'],
    modulePathIgnorePatterns: ['<rootDir>[/\\\\]\\.claude[/\\\\]'],
};
