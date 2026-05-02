// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      'contracts/out/**',
      'contracts/cache/**',
      'contracts/lib/**',
      '.changeset/**',
    ],
  },

  // Base recommended rules for all TS files
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Project-wide rules
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      // We use console in scripts/* CLIs intentionally; allow there, ban in packages.
      'no-console': 'off',
    },
  },

  // Stricter rules in shipped library code (no console allowed in packages)
  {
    files: ['packages/**/src/**/*.ts'],
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // Disable formatting rules that conflict with Prettier (must be last)
  prettier,
);
