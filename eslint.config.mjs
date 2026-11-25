import globals from 'globals';

export default [
  {
    files: ['chess-wraith.user.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.browser, Worker: 'readonly', module: 'readonly' }
    },
    rules: {
      'no-undef': 'error',
      // One IIFE: a declaration nobody reads is either dead or a lost merge.
      'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none' }]
    }
  },
  {
    files: ['tools/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-undef': 'error'
    }
  }
];
