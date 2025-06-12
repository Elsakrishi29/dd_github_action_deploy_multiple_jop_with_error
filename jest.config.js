module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/synthetics-ci-github-action'],
  globals: {
    'ts-jest': {
      tsconfig: 'synthetics-ci-github-action/tsconfig.json',
    },
  },
}
