/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
    },
    moduleFileExtensions: ['ts', 'tsx', 'js'],
    testMatch: ['**/tests/**/*.test.(ts|tsx|js)'],
};
