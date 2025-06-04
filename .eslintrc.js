module.exports = {
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
    env: {
        node: true,
        es2022: true
    },
    plugins: [
        '@typescript-eslint'
    ],
    extends: [
        'eslint:recommended'
    ],
    rules: {
        // any型を厳格に禁止
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unused-vars': ['error', {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_'
        }],

        // General rules
        'no-console': 'off', // 開発中は許可
        'no-debugger': 'error',
        'prefer-const': 'error',
        'no-var': 'error'
    },
    ignorePatterns: [
        'dist/',
        'node_modules/',
        'cdk.out/',
        '*.js',
        '*.d.ts'
    ]
}; 