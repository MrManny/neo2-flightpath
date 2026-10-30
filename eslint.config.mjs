import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      // Generated output; rebuilt by npm run build and the issue-26 UI work.
      'out/',
      'ui/.next/',
      'ui/out/',
      'ui/next-env.d.ts',
      // Agent helper scripts are not linted on purpose (accepted risk).
      'scripts/start-work.mjs',
      'scripts/safe-push.mjs',
      'scripts/open-pr.mjs',
      'scripts/lib/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
);
