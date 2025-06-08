// Services module exports
// TODO: 実際のサービスクラスを実装後、ここからエクスポート

import {
    UpworkJobData,
    UpworkCredentials,
    UpworkLoginResult,
    IntegratedJobSearchResult,
    IntegratedJobReport,
    IntegratedSearchConfig,
    JobData
} from '../types/index';

/**
 * Upwork API サービスクラス
 */
class UpworkService {
    private credentials: UpworkCredentials;
    private isAuthenticated = false;
    private accessToken?: string;

    constructor(credentials: UpworkCredentials) {
        this.credentials = credentials;
    }

    /**
     * OAuth認証を実行
     */
    async authenticate(): Promise<UpworkLoginResult> {
        const startTime = Date.now();

        try {
            // 簡易実装: 認証情報の検証
            if (!this.credentials.consumerKey || !this.credentials.consumerSecret) {
                return {
                    success: false,
                    isAuthenticated: false,
                    error: 'Consumer key and secret are required',
                    executionTime: Date.now() - startTime
                };
            }

            // TODO: 実際のOAuth認証フローの実装
            // 現在は基本的な認証情報チェックのみ
            this.isAuthenticated = true;
            this.accessToken = this.credentials.accessToken || 'mock-token';

            return {
                success: true,
                isAuthenticated: true,
                accessToken: this.accessToken,
                executionTime: Date.now() - startTime
            };

        } catch (error) {
            return {
                success: false,
                isAuthenticated: false,
                error: error instanceof Error ? error.message : 'Authentication failed',
                executionTime: Date.now() - startTime
            };
        }
    }

    /**
     * 案件を検索
     */
    async searchJobs(params: {
        query?: string;
        category?: string;
        minBudget?: number;
        maxBudget?: number;
        jobType?: 'hourly' | 'fixed-price';
        experienceLevel?: 'entry' | 'intermediate' | 'expert';
        limit?: number;
    }): Promise<UpworkJobData[]> {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Call authenticate() first.');
        }

        // TODO: 実際のUpwork API呼び出し実装
        // 現在はモックデータを返す
        const mockJobs: UpworkJobData[] = [
            {
                id: 'upwork-job-1',
                title: 'Full Stack Web Developer for E-commerce Platform',
                description: 'We need an experienced full stack developer to build a modern e-commerce platform using React and Node.js...',
                url: 'https://www.upwork.com/jobs/~01234567890123456789',
                budget: {
                    type: 'hourly',
                    min: 30,
                    max: 60
                },
                duration: 'More than 6 months',
                experienceLevel: 'expert',
                jobType: 'hourly',
                category: {
                    name: 'Web Development',
                    subcategory: 'Full Stack Development'
                },
                client: {
                    country: 'United States',
                    memberSince: '2020-01-15',
                    totalSpent: 50000,
                    hireRate: 85,
                    totalJobs: 25,
                    avgHourlyPaid: 45,
                    paymentVerified: true
                },
                skills: ['React', 'Node.js', 'MongoDB', 'AWS', 'TypeScript'],
                proposals: 5,
                postedTime: '2024-01-15T10:30:00Z',
                scrapedAt: new Date()
            },
            {
                id: 'upwork-job-2',
                title: 'Mobile App Development - React Native',
                description: 'Looking for a React Native developer to create a cross-platform mobile application...',
                url: 'https://www.upwork.com/jobs/~01234567890123456790',
                budget: {
                    type: 'fixed',
                    amount: 8000
                },
                duration: '3 to 6 months',
                experienceLevel: 'intermediate',
                jobType: 'fixed-price',
                category: {
                    name: 'Mobile Development',
                    subcategory: 'React Native'
                },
                client: {
                    country: 'Canada',
                    memberSince: '2019-05-20',
                    totalSpent: 25000,
                    hireRate: 92,
                    totalJobs: 12,
                    paymentVerified: true
                },
                skills: ['React Native', 'JavaScript', 'iOS', 'Android', 'Redux'],
                proposals: 12,
                postedTime: '2024-01-14T14:20:00Z',
                scrapedAt: new Date()
            }
        ];

        // フィルタリング適用
        let filteredJobs = mockJobs;

        if (params.query) {
            const query = params.query.toLowerCase();
            filteredJobs = filteredJobs.filter(job =>
                job.title.toLowerCase().includes(query) ||
                job.description.toLowerCase().includes(query)
            );
        }

        if (params.jobType) {
            filteredJobs = filteredJobs.filter(job => job.jobType === params.jobType);
        }

        if (params.experienceLevel) {
            filteredJobs = filteredJobs.filter(job => job.experienceLevel === params.experienceLevel);
        }

        if (params.limit) {
            filteredJobs = filteredJobs.slice(0, params.limit);
        }

        return filteredJobs;
    }

    /**
     * 案件詳細を取得
     */
    async getJobDetails(jobId: string): Promise<UpworkJobData | null> {
        if (!this.isAuthenticated) {
            throw new Error('Not authenticated. Call authenticate() first.');
        }

        // TODO: 実際のAPI実装
        // 現在はsearchJobsで取得したデータから検索
        const jobs = await this.searchJobs({ limit: 100 });
        return jobs.find(job => job.id === jobId) || null;
    }
}

/**
 * 通貨変換サービス
 */
class CurrencyService {
    private static readonly DEFAULT_USD_TO_JPY = 150; // デフォルト換算レート

    /**
     * USD から JPY への変換
     */
    static convertUSDToJPY(usdAmount: number, exchangeRate?: number): number {
        const rate = exchangeRate || this.DEFAULT_USD_TO_JPY;
        return Math.round(usdAmount * rate);
    }

    /**
     * JPY から USD への変換
     */
    static convertJPYToUSD(jpyAmount: number, exchangeRate?: number): number {
        const rate = exchangeRate || this.DEFAULT_USD_TO_JPY;
        return Math.round((jpyAmount / rate) * 100) / 100; // 小数点2桁まで
    }

    /**
     * Upwork案件の時給をJPY換算
     */
    static calculateUpworkHourlyRateJPY(upworkJob: UpworkJobData, exchangeRate?: number): number | null {
        if (upworkJob.budget.type === 'hourly') {
            if (upworkJob.budget.min && upworkJob.budget.max) {
                const avgUSD = (upworkJob.budget.min + upworkJob.budget.max) / 2;
                return this.convertUSDToJPY(avgUSD, exchangeRate);
            } else if (upworkJob.budget.min) {
                return this.convertUSDToJPY(upworkJob.budget.min, exchangeRate);
            }
        }
        return null;
    }
}

/**
 * 統合ジョブサーチサービス
 */
class IntegratedJobSearchService {
    private crowdworksService?: any; // TODO: CrowdWorksServiceの型定義後に更新
    private upworkService: UpworkService;
    private config: IntegratedSearchConfig;

    constructor(
        upworkCredentials: UpworkCredentials,
        config: IntegratedSearchConfig,
        crowdworksService?: any
    ) {
        this.upworkService = new UpworkService(upworkCredentials);
        this.config = config;
        this.crowdworksService = crowdworksService;
    }

    /**
     * 統合案件検索を実行
     */
    async searchJobs(params: {
        categories?: string[];
        minHourlyRateJPY?: number;
        maxJobsPerSource?: number;
        keywords?: string[];
    }): Promise<IntegratedJobSearchResult> {
        const startTime = Date.now();

        const result: IntegratedJobSearchResult = {
            crowdworks: {
                jobs: [],
                total: 0,
                success: false,
                executionTime: 0
            },
            upwork: {
                jobs: [],
                total: 0,
                success: false,
                executionTime: 0
            },
            summary: {
                totalJobs: 0,
                highHourlyJobs: 0,
                averageHourlyRate: 0,
                executionTime: 0,
                timestamp: new Date()
            }
        };

        // Upwork検索実行
        if (this.config.enabled.upwork) {
            const upworkStartTime = Date.now();
            try {
                await this.upworkService.authenticate();

                const searchParams: Parameters<typeof this.upworkService.searchJobs>[0] = {
                    limit: params.maxJobsPerSource || this.config.limits.maxJobsPerSource
                };

                if (params.keywords && params.keywords.length > 0) {
                    searchParams.query = params.keywords.join(' ');
                }

                const upworkJobs = await this.upworkService.searchJobs(searchParams);

                result.upwork = {
                    jobs: upworkJobs,
                    total: upworkJobs.length,
                    success: true,
                    executionTime: Date.now() - upworkStartTime
                };

            } catch (error) {
                result.upwork = {
                    jobs: [],
                    total: 0,
                    success: false,
                    error: error instanceof Error ? error.message : 'Upwork search failed',
                    executionTime: Date.now() - upworkStartTime
                };
            }
        }

        // CrowdWorks検索実行（将来実装）
        if (this.config.enabled.crowdworks && this.crowdworksService) {
            const crowdworksStartTime = Date.now();
            try {
                // TODO: CrowdWorksServiceとの統合
                result.crowdworks = {
                    jobs: [],
                    total: 0,
                    success: true,
                    executionTime: Date.now() - crowdworksStartTime
                };
            } catch (error) {
                result.crowdworks = {
                    jobs: [],
                    total: 0,
                    success: false,
                    error: error instanceof Error ? error.message : 'CrowdWorks search failed',
                    executionTime: Date.now() - crowdworksStartTime
                };
            }
        }

        // サマリー計算
        const allUpworkJobs = result.upwork.jobs;
        const minHourlyRate = params.minHourlyRateJPY || this.config.filtering.minHourlyRateJPY;

        let highHourlyCount = 0;
        let totalHourlyRates: number[] = [];

        // Upwork案件の高時給判定
        allUpworkJobs.forEach(job => {
            const hourlyRateJPY = CurrencyService.calculateUpworkHourlyRateJPY(
                job,
                this.config.currency.exchangeRateUSDToJPY
            );

            if (hourlyRateJPY) {
                totalHourlyRates.push(hourlyRateJPY);
                if (hourlyRateJPY >= minHourlyRate) {
                    highHourlyCount++;
                }
            }
        });

        result.summary = {
            totalJobs: result.crowdworks.total + result.upwork.total,
            highHourlyJobs: highHourlyCount,
            averageHourlyRate: totalHourlyRates.length > 0
                ? Math.round(totalHourlyRates.reduce((a, b) => a + b, 0) / totalHourlyRates.length)
                : 0,
            executionTime: Date.now() - startTime,
            timestamp: new Date()
        };

        return result;
    }

    /**
     * 高時給案件のフィルタリング
     */
    filterHighValueJobs(
        result: IntegratedJobSearchResult,
        minHourlyRateJPY: number
    ): { crowdworks: JobData[]; upwork: UpworkJobData[] } {

        const highValueUpworkJobs = result.upwork.jobs.filter(job => {
            const hourlyRateJPY = CurrencyService.calculateUpworkHourlyRateJPY(
                job,
                this.config.currency.exchangeRateUSDToJPY
            );
            return hourlyRateJPY && hourlyRateJPY >= minHourlyRateJPY;
        });

        // TODO: CrowdWorks案件のフィルタリング実装

        return {
            crowdworks: [], // TODO: 実装後に更新
            upwork: highValueUpworkJobs
        };
    }

    /**
     * 統合レポート生成
     */
    async generateReport(params: {
        minHourlyRate: number;
        categories: string[];
        maxJobsPerSource: number;
    }): Promise<IntegratedJobReport> {

        const searchResult = await this.searchJobs({
            categories: params.categories,
            minHourlyRateJPY: params.minHourlyRate,
            maxJobsPerSource: params.maxJobsPerSource
        });

        const highValueJobs = this.filterHighValueJobs(searchResult, params.minHourlyRate);

        return {
            id: `report-${Date.now()}`,
            generatedAt: new Date(),
            criteria: {
                minHourlyRate: params.minHourlyRate,
                categories: params.categories,
                maxJobsPerSource: params.maxJobsPerSource
            },
            results: searchResult,
            highValueJobs,
            analysis: {
                marketTrends: this.generateMarketAnalysis(searchResult),
                recommendations: this.generateRecommendations(highValueJobs),
                alerts: this.generateAlerts(searchResult)
            }
        };
    }

    private generateMarketAnalysis(result: IntegratedJobSearchResult): string {
        const { summary } = result;

        if (summary.totalJobs === 0) {
            return '案件データが取得できませんでした。';
        }

        const highValueRatio = (summary.highHourlyJobs / summary.totalJobs * 100).toFixed(1);

        return `総案件数: ${summary.totalJobs}件、高時給案件率: ${highValueRatio}%、平均時給: ${summary.averageHourlyRate.toLocaleString()}円`;
    }

    private generateRecommendations(highValueJobs: { crowdworks: JobData[]; upwork: UpworkJobData[] }): string[] {
        const recommendations: string[] = [];

        if (highValueJobs.upwork.length > 0) {
            recommendations.push(`Upworkで${highValueJobs.upwork.length}件の高時給案件を発見`);

            // スキル分析
            const skillCounts: { [skill: string]: number } = {};
            highValueJobs.upwork.forEach(job => {
                job.skills.forEach(skill => {
                    skillCounts[skill] = (skillCounts[skill] || 0) + 1;
                });
            });

            const topSkills = Object.entries(skillCounts)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 3)
                .map(([skill]) => skill);

            if (topSkills.length > 0) {
                recommendations.push(`需要の高いスキル: ${topSkills.join(', ')}`);
            }
        }

        if (recommendations.length === 0) {
            recommendations.push('現在、条件に合う高時給案件が見つかりませんでした。');
        }

        return recommendations;
    }

    private generateAlerts(result: IntegratedJobSearchResult): string[] {
        const alerts: string[] = [];

        if (!result.upwork.success) {
            alerts.push(`Upwork検索でエラーが発生: ${result.upwork.error || '不明なエラー'}`);
        }

        if (!result.crowdworks.success) {
            alerts.push(`CrowdWorks検索でエラーが発生: ${result.crowdworks.error || '不明なエラー'}`);
        }

        if (result.summary.totalJobs === 0) {
            alerts.push('案件が見つかりませんでした。検索条件を確認してください。');
        }

        return alerts;
    }
}

// Services module exports
export { UpworkService, CurrencyService, IntegratedJobSearchService };
export { AppliedJobsService } from './AppliedJobsService';
export { LancersService } from './LancersService';
