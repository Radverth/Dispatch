export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/test/unit'],
  moduleNameMapper: {
    vscode: '<rootDir>/src/test/unit/__mocks__/vscode.ts',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/test/**'],
};
