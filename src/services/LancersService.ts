import { Page } from 'playwright';

/**
 * ランサーズ案件データ型
 */
export interface LancersJob {
    id: string;
    title: string;
    description: string;
    url: string;
    budget: {
        type: 'fixed' | 'hourly' | 'unknown';
        amount: number;
        currency: string;
    };
    category: string;
    tags: string[];
    client: {
        name: string;
        rating: number;
        reviewCount: number;
    };
    postedAt: string;
    deadline?: string;
    applicants: number;
    scrapedAt: string;
}

/**
 * ランサーズ案件詳細情報の型定義
 */
export interface LancersJobDetail {
    jobId: string;
    title: string;
    category: string;
    url: string;
    paymentType: string;
    budget: string;
    deliveryDate: string;
    postDate: string;
    applicationDeadline: string;
    applicantCount: number;
    contractCount: number;
    recruitmentCount: number;
    favoriteCount: number;
    detailedDescription: string;
    client: {
        name: string;
        url: string;
        overallRating: string;
        orderHistory: string;
        completionRate: string;
        identityVerified: boolean;
        description: string;
    };
    recentApplicants: Array<{
        name: string;
        url: string;
        applicationDate: string;
    }>;
    scrapedAt: string;
}

/**
 * スクレイピング結果型
 */
export interface LancersScrapingResult {
    category: string;
    jobs: LancersJob[];
    totalCount: number;
    errors: string[];
    executionTime: number;
}

/**
 * ランサーズ案件取得サービス
 */
export class LancersService {
    private page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    /**
     * カテゴリ別ランサーズ案件スクレイピング
     */
    async scrapeJobsByCategory(
        category: string,
        maxJobs: number = 20
    ): Promise<LancersScrapingResult> {
        const startTime = Date.now();
        const errors: string[] = [];

        try {
            const categoryUrls: { [key: string]: string } = {
                'system': 'https://www.lancers.jp/work/search/system?open=1',
                'web': 'https://www.lancers.jp/work/search/web?open=1',
                'app': 'https://www.lancers.jp/work/search/app?open=1',
                'design': 'https://www.lancers.jp/work/search/design?open=1',
                'writing': 'https://www.lancers.jp/work/search/writing?open=1'
            };

            const baseUrl = categoryUrls[category];
            if (!baseUrl) {
                throw new Error(`未知のカテゴリ: ${category}`);
            }

            console.log(`📂 ランサーズ「${category}」カテゴリのスクレイピング開始 (最大${maxJobs}件)`);

            const jobs: LancersJob[] = [];
            let currentPage = 1;
            let consecutiveEmptyPages = 0;
            const maxConsecutiveEmptyPages = 2;
            const maxPages = Math.min(Math.ceil(maxJobs / 20) + 1, 3);

            while (jobs.length < maxJobs && currentPage <= maxPages && consecutiveEmptyPages < maxConsecutiveEmptyPages) {
                const pageUrl = `${baseUrl}&page=${currentPage}`;
                console.log(`📄 ページ ${currentPage} を処理中: ${pageUrl}`);

                try {
                    await this.page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });

                    await this.page.waitForTimeout(3000);

                    try {
                        await this.page.waitForSelector('.c-work-search-list, .p-work-list', { timeout: 10000 });
                    } catch (selectorError) {
                        console.log(`⚠️ 案件リストセレクタが見つかりません (ページ ${currentPage})`);
                        const pageTitle = await this.page.title();
                        console.log(`ページタイトル: ${pageTitle}`);

                        const isLoginPage = await this.page.$('input[type="password"]');
                        if (isLoginPage) {
                            console.log('⚠️ ログインページが表示されています。公開案件のみ取得します。');
                            errors.push(`ページ ${currentPage}: ログインが必要`);
                            break;
                        }
                    }

                    const pageJobs = await this.extractJobsFromPage(category);

                    if (pageJobs.length === 0) {
                        consecutiveEmptyPages++;
                        console.log(`⚠️ ページ ${currentPage} で案件が見つかりませんでした (連続空ページ: ${consecutiveEmptyPages}/${maxConsecutiveEmptyPages})`);
                    } else {
                        consecutiveEmptyPages = 0;
                        const jobsToAdd = pageJobs.slice(0, maxJobs - jobs.length);
                        jobs.push(...jobsToAdd);
                        console.log(`✅ ページ ${currentPage}: ${pageJobs.length}件取得 (追加: ${jobsToAdd.length}件, 累計: ${jobs.length}件)`);
                    }

                    currentPage++;

                    if (jobs.length < maxJobs && currentPage <= maxPages) {
                        await this.page.waitForTimeout(4000);
                    }

                } catch (error) {
                    const errorMsg = `ページ ${currentPage} の処理エラー: ${error}`;
                    console.error(`❌ ${errorMsg}`);
                    errors.push(errorMsg);

                    consecutiveEmptyPages++;
                    if (consecutiveEmptyPages >= maxConsecutiveEmptyPages) {
                        console.log('⚠️ 連続エラーのため処理を中断します');
                        break;
                    }

                    currentPage++;
                    await this.page.waitForTimeout(5000);
                }
            }

            console.log(`🎯 ランサーズ「${category}」カテゴリ完了: ${jobs.length}件取得`);

            return {
                category,
                jobs,
                totalCount: jobs.length,
                errors,
                executionTime: Date.now() - startTime
            };

        } catch (error) {
            const errorMsg = `カテゴリ「${category}」のスクレイピングエラー: ${error}`;
            console.error(`❌ ${errorMsg}`);
            errors.push(errorMsg);

            return {
                category,
                jobs: [],
                totalCount: 0,
                errors,
                executionTime: Date.now() - startTime
            };
        }
    }

    /**
     * ページから案件情報を抽出
     */
    private async extractJobsFromPage(category: string): Promise<LancersJob[]> {
        return await this.page.evaluate((cat) => {
            const jobs: LancersJob[] = [];

            // ランサーズの案件アイテムセレクター（複数のパターンに対応）
            const possibleSelectors = [
                '.c-work-search-list__item',
                '.p-work-item',
                '.work-item',
                '.c-media-object',
                '[data-testid="work-item"]',
                '.c-card--work'
            ];

            let jobElements: NodeListOf<Element> | null = null;

            // セレクタを順番に試す
            for (const selector of possibleSelectors) {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    jobElements = elements;
                    console.log(`使用セレクタ: ${selector} (${elements.length}件)`);
                    break;
                }
            }

            if (!jobElements || jobElements.length === 0) {
                console.log('⚠️ 案件要素が見つかりません。利用可能なクラス名を確認します...');
                // デバッグ用: ページ内の主要な要素を確認
                const debugElements = document.querySelectorAll('[class*="work"], [class*="item"], [class*="card"]');
                console.log(`デバッグ: 可能性のある要素数: ${debugElements.length}`);
                debugElements.forEach((el, idx) => {
                    if (idx < 5) { // 最初の5個だけ表示
                        console.log(`要素 ${idx}: ${el.className}`);
                    }
                });
                return [];
            }

            jobElements.forEach((element, index) => {
                try {
                    // タイトルと URL の取得（複数のパターンに対応）
                    const titleSelectors = [
                        'h3 a',
                        'h2 a',
                        '.p-work-item__title a',
                        '.work-title a',
                        '.c-media-object__title a',
                        'a[href*="/work/detail/"]'
                    ];

                    let titleElement: HTMLAnchorElement | null = null;
                    for (const selector of titleSelectors) {
                        titleElement = element.querySelector(selector) as HTMLAnchorElement;
                        if (titleElement) break;
                    }

                    if (!titleElement) {
                        console.log(`要素 ${index}: タイトルリンクが見つかりません`);
                        return;
                    }

                    const title = titleElement.textContent?.trim() || '';
                    const href = titleElement.href;

                    if (!title || !href) {
                        console.log(`要素 ${index}: タイトルまたはURLが空です`);
                        return;
                    }

                    // 案件IDを URL から抽出
                    const jobIdMatch = href.match(/\/work\/detail\/(\d+)/);
                    const jobId = jobIdMatch?.[1] || `lancers_${cat}_${Date.now()}_${index}`;

                    // 予算情報の取得（複数のパターンに対応）
                    let budgetAmount = 0;
                    let budgetType: 'fixed' | 'hourly' | 'unknown' = 'unknown';

                    const budgetSelectors = [
                        '.p-work-item__price',
                        '.work-price',
                        '.price',
                        '.c-media-object__price',
                        '[class*="price"]'
                    ];

                    let budgetText = '';
                    for (const selector of budgetSelectors) {
                        const budgetElement = element.querySelector(selector);
                        if (budgetElement) {
                            budgetText = budgetElement.textContent?.trim() || '';
                            if (budgetText) break;
                        }
                    }

                    if (budgetText && budgetText.includes('円')) {
                        const amountMatch = budgetText.match(/(\d{1,3}(?:,\d{3})*)/);
                        if (amountMatch && amountMatch[1]) {
                            budgetAmount = parseInt(amountMatch[1].replace(/,/g, ''));
                            budgetType = budgetText.includes('時間') || budgetText.includes('時給') ? 'hourly' : 'fixed';
                        }
                    }

                    // 説明文の取得
                    const descSelectors = [
                        '.p-work-item__summary',
                        '.work-summary',
                        '.summary',
                        '.c-media-object__summary',
                        '[class*="summary"]'
                    ];

                    let description = '';
                    for (const selector of descSelectors) {
                        const descElement = element.querySelector(selector);
                        if (descElement) {
                            description = descElement.textContent?.trim() || '';
                            if (description) break;
                        }
                    }

                    // クライアント情報の取得
                    const clientSelectors = [
                        '.p-work-item__client',
                        '.client-info',
                        '.c-media-object__client',
                        '[class*="client"]'
                    ];

                    let clientName = '';
                    for (const selector of clientSelectors) {
                        const clientElement = element.querySelector(selector);
                        if (clientElement) {
                            clientName = clientElement.textContent?.trim() || '';
                            if (clientName) break;
                        }
                    }

                    // 応募数の取得
                    const applicantsSelectors = [
                        '.p-work-item__applicants',
                        '.applicants-count',
                        '[class*="applicant"]'
                    ];

                    let applicants = 0;
                    for (const selector of applicantsSelectors) {
                        const applicantsElement = element.querySelector(selector);
                        if (applicantsElement) {
                            const applicantsText = applicantsElement.textContent?.trim() || '0';
                            const applicantsMatch = applicantsText.match(/(\d+)/);
                            if (applicantsMatch && applicantsMatch[1]) {
                                applicants = parseInt(applicantsMatch[1]);
                                break;
                            }
                        }
                    }

                    // 投稿日時の取得
                    const postedSelectors = [
                        '.p-work-item__posted',
                        '.posted-date',
                        '[class*="posted"]',
                        '[class*="date"]'
                    ];

                    let postedAt = '';
                    for (const selector of postedSelectors) {
                        const postedElement = element.querySelector(selector);
                        if (postedElement) {
                            postedAt = postedElement.textContent?.trim() || '';
                            if (postedAt) break;
                        }
                    }

                    // タグの取得
                    const tagSelectors = [
                        '.p-work-item__tag',
                        '.work-tag',
                        '.tag',
                        '[class*="tag"]'
                    ];

                    const tags: string[] = [];
                    for (const selector of tagSelectors) {
                        const tagElements = element.querySelectorAll(selector);
                        tagElements.forEach(tag => {
                            const tagText = tag.textContent?.trim();
                            if (tagText && !tags.includes(tagText)) {
                                tags.push(tagText);
                            }
                        });
                        if (tags.length > 0) break;
                    }

                    // 最低限の情報があれば案件として追加
                    if (title && href && title.length > 5) {
                        const finalPostedAt: string = postedAt ?? new Date().toISOString().split('T')[0];

                        const job: LancersJob = {
                            id: jobId,
                            title,
                            description: description || `${cat}カテゴリの案件です。`,
                            url: href,
                            budget: {
                                type: budgetType,
                                amount: budgetAmount,
                                currency: 'JPY'
                            },
                            category: cat,
                            tags,
                            client: {
                                name: clientName || '非公開',
                                rating: 0,
                                reviewCount: 0
                            },
                            postedAt: finalPostedAt,
                            applicants,
                            scrapedAt: new Date().toISOString()
                        };

                        jobs.push(job);
                        console.log(`案件追加: ${title.substring(0, 50)}...`);
                    } else {
                        console.log(`要素 ${index}: 必要な情報が不足 (タイトル: ${title.length}文字)`);
                    }

                } catch (error) {
                    console.error(`案件要素の解析エラー (要素 ${index}):`, error);
                }
            });

            console.log(`抽出完了: ${jobs.length}件の案件を取得`);
            return jobs;
        }, category);
    }

    /**
     * 案件詳細情報を取得
     */
    async scrapeJobDetail(jobUrl: string): Promise<LancersJobDetail> {
        console.log(`🔍 ランサーズ詳細取得: ${jobUrl}`);

        try {
            await this.page.goto(jobUrl, { waitUntil: 'networkidle', timeout: 30000 });

            const detail = await this.page.evaluate(() => {
                const getTextContent = (selector: string): string => {
                    const element = document.querySelector(selector);
                    return element?.textContent?.trim() || '';
                };

                const getNumbers = (text: string): number => {
                    const match = text.match(/(\d+)/);
                    return match?.[1] ? parseInt(match[1]) : 0;
                };

                // 基本情報の取得
                const title = getTextContent('h1, .p-work-detail__title h1');
                const paymentType = getTextContent('.p-work-detail__price-type, .price-type');
                const budget = getTextContent('.p-work-detail__price, .work-price');
                const deliveryDate = getTextContent('.p-work-detail__delivery, .delivery-date');
                const postDate = getTextContent('.p-work-detail__posted, .posted-date');
                const applicationDeadline = getTextContent('.p-work-detail__deadline, .deadline');

                // 応募状況
                const applicantCount = getNumbers(getTextContent('.p-work-detail__applicants, .applicants-count'));
                const contractCount = getNumbers(getTextContent('.p-work-detail__contracts, .contracts-count'));
                const recruitmentCount = getNumbers(getTextContent('.p-work-detail__recruitment, .recruitment-count'));
                const favoriteCount = getNumbers(getTextContent('.p-work-detail__favorites, .favorites-count'));

                // 詳細説明
                const detailedDescription = getTextContent('.p-work-detail__description, .work-description');

                // クライアント情報
                const clientName = getTextContent('.p-work-detail__client-name, .client-name');
                const clientUrl = (document.querySelector('.p-work-detail__client-name a, .client-name a') as HTMLAnchorElement)?.href || '';
                const overallRating = getTextContent('.p-work-detail__client-rating, .client-rating');
                const orderHistory = getTextContent('.p-work-detail__client-history, .client-history');
                const completionRate = getTextContent('.p-work-detail__client-completion, .client-completion');

                return {
                    title,
                    paymentType,
                    budget,
                    deliveryDate,
                    postDate,
                    applicationDeadline,
                    applicantCount,
                    contractCount,
                    recruitmentCount,
                    favoriteCount,
                    detailedDescription,
                    client: {
                        name: clientName,
                        url: clientUrl,
                        overallRating,
                        orderHistory,
                        completionRate,
                        identityVerified: document.querySelector('.p-work-detail__client-verified, .client-verified') !== null,
                        description: getTextContent('.p-work-detail__client-description, .client-description')
                    },
                    recentApplicants: []
                };
            });

            // URLからjobIdを抽出
            const jobId = jobUrl.match(/\/work\/detail\/(\d+)/)?.[1] || '';

            return {
                jobId,
                category: '',
                url: jobUrl,
                scrapedAt: new Date().toISOString(),
                ...detail
            };

        } catch (error) {
            console.error(`❌ ランサーズ詳細取得エラー (${jobUrl}):`, error);
            throw error;
        }
    }
} 