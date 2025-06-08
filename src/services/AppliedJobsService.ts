import { Page } from 'playwright';
import { CrowdWorksCredentials, CrowdWorksLoginResult } from '../types';

/**
 * 応募済み案件情報
 */
export interface AppliedJob {
    jobId: string;
    title: string;
    url: string;
    applicationDate: string;
    status: string;
}

/**
 * 応募済み案件取得サービス
 */
export class AppliedJobsService {
    private page: Page;
    private credentials: CrowdWorksCredentials;

    constructor(page: Page, credentials: CrowdWorksCredentials) {
        this.page = page;
        this.credentials = credentials;
    }

    /**
     * CrowdWorksにログインする
     */
    async login(): Promise<CrowdWorksLoginResult> {
        const startTime = Date.now();

        try {
            console.log('🔑 CrowdWorksにログイン中...');

            // ログインページに移動
            await this.page.goto('https://crowdworks.jp/login', {
                waitUntil: 'networkidle',
                timeout: 30000
            });

            // すでにログイン済みかチェック
            const isAlreadyLoggedIn = await this.page.evaluate(() => {
                return !document.querySelector('textbox[name="メールアドレス"]') &&
                    !document.querySelector('input[type="email"]') &&
                    !document.title.includes('ログイン');
            });

            if (isAlreadyLoggedIn) {
                console.log('✅ 既にログイン済みです');
                return {
                    success: true,
                    isLoggedIn: true,
                    executionTime: Date.now() - startTime
                };
            }

            // メールアドレスとパスワードを入力（ブラウザで確認したセレクターを使用）
            await this.page.getByRole('textbox', { name: 'メールアドレス' }).fill(this.credentials.email);
            await this.page.getByRole('textbox', { name: 'パスワード' }).fill(this.credentials.password);

            // ログインボタンをクリック
            await this.page.getByRole('button', { name: 'ログイン', exact: true }).click();

            // ログイン完了を待機
            await this.page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 });

            console.log('✅ ログインに成功しました');

            return {
                success: true,
                isLoggedIn: true,
                executionTime: Date.now() - startTime
            };

        } catch (error) {
            console.error('❌ ログインに失敗しました:', error);
            return {
                success: false,
                isLoggedIn: false,
                error: error instanceof Error ? error.message : 'ログインに失敗しました',
                executionTime: Date.now() - startTime
            };
        }
    }

    /**
     * 応募済み案件一覧を取得する
     */
    async getAppliedJobs(): Promise<AppliedJob[]> {
        try {
            console.log('📋 応募済み案件を取得中...');

            // 応募済み案件ページに移動
            await this.page.goto('https://crowdworks.jp/e/proposals?ref=mypage_joboffers_all', {
                waitUntil: 'networkidle',
                timeout: 30000
            });

            // 応募済み案件を取得
            const appliedJobs = await this.page.evaluate(() => {
                const jobs: AppliedJob[] = [];

                // 応募済み案件のセレクタを特定する（実際のHTMLに基づいて調整）
                const jobElements = document.querySelectorAll('.proposal-item, .job-item, [data-job-id]');

                jobElements.forEach(element => {
                    try {
                        // jobIdをURLから抽出
                        const linkElement = element.querySelector('a[href*="/public/jobs/"]') as HTMLAnchorElement;
                        if (!linkElement) return;

                        const url = linkElement.href;
                        const jobIdMatch = url.match(/\/jobs\/(\d+)/);
                        if (!jobIdMatch) return;

                        const jobId = jobIdMatch[1];

                        // タイトルを取得
                        const titleElement = element.querySelector('.job-title, .proposal-title, h3, h4');
                        const title = titleElement?.textContent?.trim() || '';

                        // 応募日を取得（可能であれば）
                        const dateElement = element.querySelector('.application-date, .proposal-date, .date');
                        const applicationDate = dateElement?.textContent?.trim() || '';

                        // ステータスを取得（可能であれば）
                        const statusElement = element.querySelector('.status, .proposal-status');
                        const status = statusElement?.textContent?.trim() || '';

                        if (jobId && title) {
                            jobs.push({
                                jobId,
                                title,
                                url,
                                applicationDate,
                                status
                            });
                        }
                    } catch (error) {
                        console.warn('案件の解析でエラー:', error);
                    }
                });

                return jobs;
            });

            console.log(`✅ 応募済み案件を${appliedJobs.length}件取得しました`);

            // ログ出力
            if (appliedJobs.length > 0) {
                console.log('📋 応募済み案件一覧:');
                appliedJobs.slice(0, 5).forEach((job, index) => {
                    console.log(`  ${index + 1}. ${job.title} (ID: ${job.jobId})`);
                });
                if (appliedJobs.length > 5) {
                    console.log(`  ... 他${appliedJobs.length - 5}件`);
                }
            }

            return appliedJobs;

        } catch (error) {
            console.error('❌ 応募済み案件の取得に失敗しました:', error);
            return [];
        }
    }

    /**
     * 応募済み案件のJobIDセットを取得する
     */
    async getAppliedJobIds(): Promise<Set<string>> {
        const appliedJobs = await this.getAppliedJobs();
        return new Set(appliedJobs.map(job => job.jobId));
    }
} 