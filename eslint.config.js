import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

export default defineConfig([
  { ignores: ['dist/**', 'release/**', 'release-desktop/**', 'references/**', 'node_modules/**', 'artifacts/**', 'public/**', 'tools/pandoc/**'] },
  {
    files: ['**/*.{js,jsx,cjs,mjs}'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['electron/**/*.{js,cjs,mjs}', 'scripts/**/*.{js,cjs,mjs}', 'vite.config.js', 'electron-builder.config.cjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['scripts/desktop-smoke.mjs', 'scripts/monochrome-ui-smoke.mjs', 'scripts/lan-sync-desktop.mjs', 'scripts/quit-failure-desktop.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['src/services/ArchiveService.js', 'src/services/ProjectAssets.js', 'src/services/WordDocument.js'],
    rules: { 'no-control-regex': 'off' },
  },
  {
    files: ['electron/**/*.cjs', '*.config.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
])
