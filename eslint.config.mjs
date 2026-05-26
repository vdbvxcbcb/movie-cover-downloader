import antfu from '@antfu/eslint-config'

export default antfu({
  stylistic: false,
  typescript: true,
  vue: true,
  ignores: [
    '**/dist/**',
    '**/src-tauri/target/**',
    '**/.cargo-target-alt/**',
    '**/tmp-sqlite-probe/**',
  ],
  rules: {
    'e18e/prefer-object-has-own': 'off',
    'jsonc/sort-keys': 'off',
    'no-alert': 'off',
    'node/prefer-global/process': 'off',
    'perfectionist/sort-imports': 'off',
    'perfectionist/sort-named-imports': 'off',
    'pnpm/yaml-enforce-settings': 'off',
    'regexp/negation': 'off',
    'regexp/no-super-linear-backtracking': 'off',
    'regexp/no-useless-non-capturing-group': 'off',
    'regexp/prefer-d': 'off',
    'test/no-import-node-test': 'off',
    'ts/no-empty-object-type': 'off',
    'vue/define-macros-order': 'off',
    'vue/html-indent': 'off',
    'vue/html-self-closing': 'off',
    'vue/prefer-separate-static-class': 'off',
    'vue/singleline-html-element-content-newline': 'off',
  },
})
