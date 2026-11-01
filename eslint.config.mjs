import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// AGENTS.md: built-ins use the node: prefix, so bare specifiers stay banned.
// Curated list rather than node:module's builtinModules: the runtime-reported
// list differs between plain Node and Electron and would make lint results
// environment-dependent. The `/*` forms cover subpaths like fs/promises.
const bareNodeBuiltins = [
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os',
  'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'string_decoder', 'timers', 'tls', 'trace_events', 'tty', 'url',
  'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
].flatMap((name) => [name, `${name}/*`]);

// AGENTS.md: top-level failures set process.exitCode; exiting mid-flow would cut flows short.
const noProcessExit = {
  selector:
    "CallExpression[callee.object.name='process'][callee.property.name='exit']",
  message: 'Set process.exitCode instead of calling process.exit() (AGENTS.md).',
};

// AGENTS.md: never commit .only, .skip or .todo; they silently shrink the suite.
const noTestGating = {
  selector:
    'MemberExpression[object.name=/^(describe|it|test)$/][property.name=/^(only|skip|todo)$/]',
  message: 'Never commit .only, .skip or .todo (AGENTS.md).',
};

export default tseslint.config(
  {
    ignores: [
      'dist/',
      // Packaging output from npm run app:pack.
      'dist-electron/',
      'node_modules/',
      // Agent scratch space is git-ignored and not linted on purpose.
      '.scratch/',
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
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      eqeqeq: 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: bareNodeBuiltins,
              message: 'Import Node built-ins with the node: prefix (AGENTS.md).',
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', noProcessExit],
      'no-script-url': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // Rules that need type information; the project service resolves the
    // nearest tsconfig per file (root for src/, ui/tsconfig.json for ui/).
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', noProcessExit, noTestGating],
    },
  },
  {
    files: ['ui/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
  },
  {
    files: ['ui/**/*.{ts,tsx}'],
    ...nextPlugin.configs['core-web-vitals'],
  },
  {
    files: ['app/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    files: ['app/**/*.cjs'],
    languageOptions: {
      globals: { require: 'readonly' },
    },
    rules: {
      // Sandboxed preload scripts cannot use ESM.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
