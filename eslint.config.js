// Correctness lint only (npm run lint). No formatter, no stylistic rules, no repo-wide reformat.
//
// Node: server, shared, tools, scripts, types.
// Browser: public/js (also loaded under Node by unit tests, so `process` is a known global) and the plugin studio's page,
// public/studio.
// Tests: Node globals plus browser globals (page.evaluate callbacks).
// Warnings (unused vars, and a few rules that fire on intentional patterns) do not fail the run.
// `npm run lint` does not pass --max-warnings=0.

import js from '@eslint/js';
import globals from 'globals';

const unused = ['warn', {
  varsIgnorePattern: '^_',
  argsIgnorePattern: '^_',
  caughtErrorsIgnorePattern: '^_',
  ignoreRestSiblings: true,
}];

// eslint:recommended, with the style-adjacent rules turned down. Empty `catch { }` is how this
// code skips a missing file; `no-useless-escape` / `no-extra-boolean-cast` / `no-regex-spaces`
// only complain about how a correct expression is written.
const rules = {
  ...js.configs.recommended.rules,
  'no-unused-vars': unused,
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-useless-escape': 'off',
  'no-extra-boolean-cast': 'off',
  'no-regex-spaces': 'off',
  // `while (true)` is a normal loop. A constant condition anywhere else still warns.
  'no-constant-condition': ['warn', { checkLoops: false }],
  // Calling hasOwnProperty on a foreign object is a real footgun, but a lot of call sites are
  // plain data. Warn; do not fail the build on them.
  'no-prototype-builtins': 'warn',
  // Redundant initializers (`let x = 0; x = …`) are common here and are not behavior bugs.
  'no-useless-assignment': 'warn',
  // Name sanitizers intentionally match control characters.
  'no-control-regex': 'off',
  // ESLint 10 wants `error.cause`. The two hits already put the original message in the text.
  'preserve-caught-error': 'warn',
};

// ECMA-262 §21.3.2: the Math functions whose results are "implementation-approximated".
const APPROXIMATED_MATH = ['acos', 'acosh', 'asin', 'asinh', 'atan', 'atanh', 'atan2', 'cbrt', 'cos', 'cosh', 'exp',
  'expm1', 'hypot', 'log', 'log1p', 'log10', 'log2', 'pow', 'sin', 'sinh', 'tan', 'tanh'];

const nodeFiles = [
  'server/**/*.js',
  'shared/**/*.js',
  'tools/**/*.js',
  'tools/**/*.mjs',
  'scripts/**/*.js',
  'scripts/**/*.mjs',
  'types/**/*.js',
];

export default [
  {
    ignores: [
      'node_modules/**',
      'public/vendor/**',
      'public/assets/**',
      'public/fonts/**',
      'public/dev/**',
      '.cache/**',
      'coverage/**',
    ],
  },
  {
    files: nodeFiles,
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules,
  },
  {
    files: ['public/js/**/*.js', 'public/studio/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser, process: 'readonly' },
    },
    rules,
  },
  {
    // The sim runs in every player's browser and on the server, and must give the same bits everywhere. ECMA-262
    // leaves these Math functions (and **) implementation-approximated: engines differ in the last bits.
    files: ['server/sim/**/*.js'],
    rules: {
      'no-restricted-properties': ['error', ...APPROXIMATED_MATH.map((property) => ({
        object: 'Math', property, message: 'implementation-approximated (engines differ in the last bits): use server/sim/detmath.js',
      }))],
      'no-restricted-syntax': ['error',
        { selector: "BinaryExpression[operator='**']", message: 'implementation-approximated: use powi from server/sim/detmath.js' },
        { selector: "AssignmentExpression[operator='**=']", message: 'implementation-approximated: use powi from server/sim/detmath.js' },
      ],
    },
  },
  {
    // Content callers use one public entry (server/sim/attack.js); the facade, its implementation and the Battle methods
    // (battle/combat.js) own the deep imports. Tests may import the implementation directly.
    files: ['server/**/*.js', 'public/js/**/*.js'],
    ignores: ['server/sim/attack.js', 'server/sim/attack/**', 'server/sim/battle/combat.js'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { regex: '(^|/)attack/', message: 'Use public exports from attack.js; attack/ is private implementation.' },
      ] }],
    },
  },
  {
    // Node test runner, plus browser tests whose page.evaluate callbacks use DOM globals.
    // PIXI is the page global those render tests read inside evaluate().
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, PIXI: 'readonly' },
    },
    rules,
  },
];
