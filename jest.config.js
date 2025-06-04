module.exports = {
    // テスト環境
    preset: 'ts-jest',
    testEnvironment: 'node',

    // TypeScript設定
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: './tsconfig.json'
        }]
    },

    // ファイル拡張子の設定
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],

    // パスマッピング（tsconfig.jsonと同期）
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@/types/(.*)$': '<rootDir>/src/types/$1',
        '^@/services/(.*)$': '<rootDir>/src/services/$1',
        '^@/utils/(.*)$': '<rootDir>/src/utils/$1',
        '^@/infrastructure/(.*)$': '<rootDir>/src/infrastructure/$1'
    },

    // テストファイルのパターン
    testMatch: [
        '<rootDir>/src/**/*.test.(ts|tsx)',
        '<rootDir>/src/**/*.spec.(ts|tsx)',
        '<rootDir>/test/**/*.test.(ts|tsx)',
        '<rootDir>/test/**/*.spec.(ts|tsx)'
    ],

    // カバレッジ設定
    collectCoverage: false, // デフォルトでは無効（npm run test:coverageで有効）
    collectCoverageFrom: [
        'src/**/*.{ts,tsx}',
        '!src/**/*.d.ts',
        '!src/**/*.test.{ts,tsx}',
        '!src/**/*.spec.{ts,tsx}',
        '!src/test/**/*',
        '!src/types/**/*', // 型定義はカバレッジから除外
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    coverageThreshold: {
        global: {
            branches: 75,
            functions: 80,
            lines: 80,
            statements: 80
        }
    },

    // セットアップファイル
    setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],

    // モック設定
    clearMocks: true,
    resetMocks: true,
    restoreMocks: true,

    // タイムアウト設定
    testTimeout: 30000, // 30秒（AWS SDK呼び出しなど時間がかかる場合に対応）

    // 並列実行設定
    maxWorkers: '50%', // CPUコア数の50%で並列実行

    // エラー表示設定
    verbose: true,
    errorOnDeprecated: true,

    // 不要なログを抑制
    silent: false,

    // テスト実行前後のフック
    globalSetup: undefined,
    globalTeardown: undefined
}; 