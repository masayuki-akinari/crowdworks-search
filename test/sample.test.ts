/**
 * Sample test file to verify Jest configuration
 */

import { AppError, ErrorType, JobData } from '@/types';

describe('Sample Tests', () => {
    describe('Basic functionality', () => {
        it('should pass basic test', () => {
            expect(true).toBe(true);
        });

        it('should handle numbers correctly', () => {
            const result = 2 + 2;
            expect(result).toBe(4);
        });

        it('should work with async functions', async () => {
            const promise = Promise.resolve('test');
            await expect(promise).resolves.toBe('test');
        });
    });

    describe('Type definitions', () => {
        it('should create valid JobData object', () => {
            const jobData: JobData = {
                id: 'test-job-001',
                title: 'テストジョブ',
                description: 'これはテスト用の案件です',
                url: 'https://crowdworks.jp/public/jobs/test-001',
                budget: 100000,
                deadline: new Date('2024-12-31'),
                workType: 'fixed',
                category: 'システム開発',
                clientName: 'テストクライアント',
                clientRating: 4.5,
                clientReviews: 10,
                skills: ['TypeScript', 'React', 'AWS'],
                experience: 'intermediate',
                scrapedAt: new Date(),
                source: 'crowdworks',
            };

            expect(jobData).toBeValidJobData();
            expect(jobData.budget).toBe(100000);
            expect(jobData.skills).toHaveLength(3);
            expect(jobData.workType).toBe('fixed');
        });

        it('should create valid AppError', () => {
            const error = new AppError(
                ErrorType.SCRAPING_ERROR,
                'Test error message',
                true
            );

            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(AppError);
            expect(error.type).toBe(ErrorType.SCRAPING_ERROR);
            expect(error.message).toBe('Test error message');
            expect(error.retryable).toBe(true);
            expect(error.name).toBe('AppError');
        });
    });

    describe('Environment variables', () => {
        it('should have test environment variables set', () => {
            expect(process.env.NODE_ENV).toBe('test');
            expect(process.env.AWS_REGION).toBe('ap-northeast-1');
            expect(process.env.TZ).toBe('Asia/Tokyo');
        });
    });

    describe('Date handling', () => {
        it('should handle dates correctly', () => {
            const now = new Date();
            const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

            expect(now).toBeValidDate();
            expect(tomorrow).toBeValidDate();
            expect(tomorrow.getTime()).toBeGreaterThan(now.getTime());
        });

        it('should handle invalid dates', () => {
            const invalidDate = new Date('invalid');
            expect(invalidDate).not.toBeValidDate();
        });
    });

    describe('Custom matchers', () => {
        it('should use custom toBeValidDate matcher', () => {
            const validDate = new Date();
            const invalidDate = new Date('invalid');

            expect(validDate).toBeValidDate();
            expect(invalidDate).not.toBeValidDate();
        });

        it('should use custom toBeValidJobData matcher', () => {
            const validJob = {
                id: 'test-001',
                title: 'Test Job',
                budget: 50000,
            };

            const invalidJob = {
                title: 'Missing ID',
                budget: '50000', // wrong type
            };

            expect(validJob).toBeValidJobData();
            expect(invalidJob).not.toBeValidJobData();
        });
    });
}); 