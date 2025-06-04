import 'jest';

// AWS SDKのモック設定
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-lambda');
jest.mock('@aws-sdk/client-ssm');
jest.mock('@aws-sdk/client-sns');

// OpenAI SDKのモック設定
jest.mock('openai');

// Playwrightのモック設定
jest.mock('playwright');

// 環境変数の設定
process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'ap-northeast-1';
process.env.LOG_LEVEL = 'error'; // テスト中はエラーログのみ

// タイムゾーンの固定（テストの一貫性のため）
process.env.TZ = 'Asia/Tokyo';

// コンソールログの制御（必要に応じて）
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeEach(() => {
    // 各テスト前にモックをクリア
    jest.clearAllMocks();

    // 時間を固定（必要に応じて）
    // jest.useFakeTimers();
});

afterEach(() => {
    // テスト後のクリーンアップ
    jest.clearAllTimers();
    // jest.useRealTimers();
});

// 全テスト後のクリーンアップ
afterAll(() => {
    // コンソールログを復元
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
});

// グローバルなテストヘルパー関数
declare global {
    namespace jest {
        interface Matchers<R> {
            toBeValidDate(): R;
            toBeValidJobData(): R;
        }
    }
}

// カスタムマッチャーの追加
expect.extend({
    toBeValidDate(received: unknown) {
        const pass = received instanceof Date && !isNaN(received.getTime());
        return {
            message: () => `expected ${received} to be a valid Date object`,
            pass,
        };
    },

    toBeValidJobData(received: unknown) {
        const pass =
            typeof received === 'object' &&
            received !== null &&
            'id' in received &&
            'title' in received &&
            'budget' in received &&
            typeof (received as { id: unknown }).id === 'string' &&
            typeof (received as { title: unknown }).title === 'string' &&
            typeof (received as { budget: unknown }).budget === 'number';

        return {
            message: () => `expected ${JSON.stringify(received)} to be valid job data`,
            pass,
        };
    },
}); 