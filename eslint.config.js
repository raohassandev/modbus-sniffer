'use strict';

module.exports = [
  {
    ignores: ['node_modules/**', 'desktop/node_modules/**', 'desktop/dist/**', 'data/**'],
  },
  {
    files: ['src/**/*.js', 'scripts/**/*.js', 'test/**/*.js', 'desktop/*.js', 'public/**/*.js', 'playwright.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs'
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error'
    },
    rules: {
      'no-debugger': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'valid-typeof': 'error',
      'no-constant-binary-expression': 'error'
    }
  }
];
