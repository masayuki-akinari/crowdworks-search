"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("jest");
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-lambda');
jest.mock('@aws-sdk/client-ssm');
jest.mock('@aws-sdk/client-sns');
jest.mock('openai');
jest.mock('playwright');
process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'ap-northeast-1';
process.env.LOG_LEVEL = 'error';
process.env.TZ = 'Asia/Tokyo';
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;
beforeEach(() => {
    jest.clearAllMocks();
});
afterEach(() => {
    jest.clearAllTimers();
});
afterAll(() => {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
});
expect.extend({
    toBeValidDate(received) {
        const pass = received instanceof Date && !isNaN(received.getTime());
        return {
            message: () => `expected ${received} to be a valid Date object`,
            pass,
        };
    },
    toBeValidJobData(received) {
        const pass = typeof received === 'object' &&
            received !== null &&
            'id' in received &&
            'title' in received &&
            'budget' in received &&
            typeof received.id === 'string' &&
            typeof received.title === 'string' &&
            typeof received.budget === 'number';
        return {
            message: () => `expected ${JSON.stringify(received)} to be valid job data`,
            pass,
        };
    },
});
//# sourceMappingURL=setup.js.map