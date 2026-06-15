/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
    },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
    },
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
