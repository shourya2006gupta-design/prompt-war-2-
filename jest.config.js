export default {
  testEnvironment: "node",
  transform: {},
  testMatch: ["**/tests/**/*.test.js"],
  verbose: true,
  collectCoverageFrom: ["src/**/*.js", "public/app.js", "!src/server.js", "!**/node_modules/**"],
  coverageReporters: ["text", "lcov", "html"],
  coverageThreshold: {
    global: {
      branches: 55,
      functions: 75,
      lines: 75,
      statements: 75,
    },
  },
};
