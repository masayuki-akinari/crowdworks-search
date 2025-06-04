module.exports = {
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
    },
    env: {
        node: true,
        es2022: true,
        jest: true,
    },
    extends: [
        'eslint:recommended',
        '@typescript-eslint/recommended',
        '@typescript-eslint/recommended-requiring-type-checking',
        'prettier',
    ],
    plugins: ['@typescript-eslint', 'import', 'jest'],
    rules: {
        // TypeScript推奨
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/explicit-function-return-type': 'warn',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-non-null-assertion': 'error',
        '@typescript-eslint/prefer-nullish-coalescing': 'error',
        '@typescript-eslint/prefer-optional-chain': 'error',

        // Import関連
        'import/order': ['error', {
            'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
            'newlines-between': 'always',
            'alphabetize': { 'order': 'asc' }
        }],

        // 一般的なベストプラクティス
        'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
        'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
        'prefer-const': 'error',
        'no-var': 'error',

        // Jest関連
        'jest/no-disabled-tests': 'warn',
        'jest/no-focused-tests': 'error',
        'jest/no-identical-title': 'error',
        'jest/prefer-to-have-length': 'warn',
        'jest/valid-expect': 'error',
    },
    overrides: [
        {
            files: ['**/*.test.ts', '**/*.spec.ts'],
            rules: {
                '@typescript-eslint/no-explicit-any': 'off',
                'no-console': 'off', // テストファイルではconsole.log許可
            },
        },
        {
            files: ['src/index.ts', 'src/lambda/handler.ts'],
            rules: {
                'no-console': 'off', // メインエントリーポイントではconsole.log許可
            },
        },
    ],
    ignorePatterns: [
        'dist/',
        'node_modules/',
        'cdk.out/',
        '*.js',
        '*.d.ts'
    ]
}; 