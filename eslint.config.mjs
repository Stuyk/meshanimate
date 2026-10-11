import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      'tools/preview-video/assets/**',
      'tools/preview-video/.work/**',
      'tools/preview-video/.frames/**'
    ]
  },
  tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      curly: ['error', 'all'],
      // Prefer guard clauses (early return) over nested if/else — flags an
      // if-branch that ends in return/throw/continue/break followed by an
      // else, since that else is dead structure once the branch always exits.
      'no-else-return': ['error', { allowElseIf: false }],
      // No hard rule for "no nested if" exists; capping block depth is the
      // closest enforceable proxy — past this, restructure into early
      // returns instead of adding another nesting level.
      'max-depth': ['error', 3]
    }
  },
  {
    // Plain-JS tooling: no TypeScript return types, and engine.js is a classic
    // browser script whose functions are globals used by the scene pages.
    files: ['tools/**/*.{js,mjs}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^(appWindow|focus|finalize|showShot|tween|A|el)$' }
      ]
    }
  }
)
