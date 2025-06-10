import puppeteer, { Browser, Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';

interface JobDetail {
    jobId: string;
    category: string;
    url: string;
    title: string;
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
        thankCount: string;
        identityVerified: boolean;
        orderRuleCheck: boolean;
        description: string;
    };
    desiredImages: string[];
    recentApplicants: any[];
    scrapedAt: string;
}

async function scrapeJobDetails(browser: Browser, jobId: string, category: string): Promise<JobDetail | null> {
    const page: Page = await browser.newPage();

    try {
        const url = `https://crowdworks.jp/public/jobs/${jobId}`;
        console.log(`🔍 スクレイピング中: ${url}`);

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        const jobDetail: JobDetail = {
            jobId,
            category,
            url,
            title: '',
            paymentType: '',
            budget: '',
            deliveryDate: '',
            postDate: '',
            applicationDeadline: '',
            applicantCount: 0,
            contractCount: 0,
            recruitmentCount: 0,
            favoriteCount: 0,
            detailedDescription: '',
            client: {
                name: '',
                url: '',
                overallRating: '',
                orderHistory: '',
                completionRate: '',
                thankCount: '',
                identityVerified: false,
                orderRuleCheck: false,
                description: ''
            },
            desiredImages: [],
            recentApplicants: [],
            scrapedAt: new Date().toISOString()
        };

        // タイトルの取得
        try {
            // メインコンテンツエリアから案件タイトルを取得
            let titleFound = false;

            // デバッグ出力で確認した2番目のh1要素から案件名を抽出
            const mainH1 = await page.$$eval('h1', (elements) => {
                if (elements.length >= 2) {
                    const secondH1 = elements[1];
                    if (secondH1) {
                        const text = secondH1.textContent?.trim() || '';
                        // 改行と余分な空白を除去し、"の仕事の依頼"の前の部分を抽出
                        const cleanText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ');
                        const match = cleanText.match(/^(.+?)\s+.*の仕事の依頼$/);
                        if (match && match[1]) {
                            return match[1].trim();
                        }
                        const splitResult = cleanText.split('の仕事の依頼');
                        if (splitResult && splitResult[0]) {
                            return splitResult[0].trim();
                        }
                    }
                }
                return '';
            }).catch(() => '');

            if (mainH1 && mainH1.length > 5 && !mainH1.includes('クラウドソーシング')) {
                jobDetail.title = mainH1;
                console.log(`✅ タイトル: ${jobDetail.title}`);
                titleFound = true;
            }

            if (!titleFound) {
                // パンくずリストの最後の要素から取得を試行
                const breadcrumbTitle = await page.$eval('li:last-child generic', (el: Element) => {
                    return el.textContent?.trim() || '';
                }).catch(() => '');

                if (breadcrumbTitle && breadcrumbTitle.length > 10 && !breadcrumbTitle.includes('クラウドソーシング')) {
                    jobDetail.title = breadcrumbTitle;
                    console.log(`✅ タイトル (パンくず): ${jobDetail.title}`);
                    titleFound = true;
                }
            }

            if (!titleFound) {
                console.log('⚠️ タイトルが見つかりません');
                // デバッグ用
                const allHeadings = await page.$$eval('h1, h2', (elements) =>
                    elements.map(el => el.textContent?.trim()).filter(t => t && t.length > 10)
                );
                console.log('見つかったheading要素:', allHeadings.slice(0, 3));
            }
        } catch (error) {
            console.error('タイトル取得エラー:', error);
        }

        // 予算の取得
        try {
            // テーブルから予算情報を抽出
            const budgetFromTable = await page.$eval('table', (table: Element) => {
                const rows = Array.from(table.querySelectorAll('tr'));
                for (const row of rows) {
                    const cells = Array.from(row.querySelectorAll('td'));
                    if (cells.length >= 2) {
                        const secondCell = cells[1];
                        const text = secondCell?.textContent?.trim() || '';
                        if (text.includes('円') && (text.includes('〜') || text.includes('-') || text.includes('以上'))) {
                            return text;
                        }
                    }
                }
                return '';
            });

            if (budgetFromTable) {
                jobDetail.budget = budgetFromTable;
                console.log(`✅ 予算: ${jobDetail.budget}`);
            } else {
                // フォールバック: 円を含むテキストを探す
                const budgetText = await page.evaluate(() => {
                    const walker = document.createTreeWalker(
                        document.body,
                        NodeFilter.SHOW_TEXT
                    );

                    let node;
                    while (node = walker.nextNode()) {
                        const text = node.textContent?.trim() || '';
                        if (text.includes('円') && text.match(/[\d,]+円/)) {
                            return text;
                        }
                    }
                    return '';
                });

                if (budgetText) {
                    jobDetail.budget = budgetText;
                    console.log(`✅ 予算 (フォールバック): ${jobDetail.budget}`);
                } else {
                    console.log('⚠️ 予算情報が見つかりません');
                }
            }
        } catch (error) {
            console.error('予算取得エラー:', error);
        }

        // 詳細説明の取得
        try {
            // "仕事の詳細"セクションから詳細説明を抽出
            const detailFromTable = await page.evaluate(() => {
                // "仕事の詳細"というヘッダーの後のテーブルを探す
                const headings = Array.from(document.querySelectorAll('h2'));
                const detailHeading = headings.find(h => h.textContent?.includes('仕事の詳細'));

                if (detailHeading) {
                    // 次のテーブル要素を探す
                    let nextElement = detailHeading.nextElementSibling;
                    while (nextElement) {
                        if (nextElement.tagName === 'TABLE') {
                            const rows = Array.from(nextElement.querySelectorAll('tr'));
                            for (const row of rows) {
                                const cells = Array.from(row.querySelectorAll('td'));
                                if (cells.length >= 1) {
                                    const cellText = cells[0]?.textContent?.trim() || '';
                                    if (cellText.length > 100 && (cellText.includes('概要') || cellText.includes('業務') || cellText.includes('必要'))) {
                                        return cellText;
                                    }
                                }
                            }
                        }
                        nextElement = nextElement.nextElementSibling;
                    }
                }
                return '';
            });

            if (detailFromTable) {
                jobDetail.detailedDescription = detailFromTable;
                console.log(`✅ 詳細説明: ${jobDetail.detailedDescription.substring(0, 100)}...`);
            } else {
                console.log('⚠️ 詳細説明が見つかりません');
            }
        } catch (error) {
            console.error('詳細説明取得エラー:', error);
        }

        return jobDetail;

    } catch (error) {
        console.error(`❌ エラー (jobId: ${jobId}):`, error);
        return null;
    } finally {
        await page.close();
    }
}

async function main() {
    console.log('🚀 クラウドワークス詳細スクレイピングテスト（5件）を開始します...');

    // テスト用のジョブID（最近のものから5件）
    const testJobIds: string[] = [
        '12130347',
        '12132217',
        '12135465',
        '12041204',
        '12056088'
    ];

    const browser = await puppeteer.launch({
        headless: false, // デバッグのため表示
        slowMo: 1000,    // 動作を遅くしてデバッグ
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        ]
    });

    const results: JobDetail[] = [];

    for (let i = 0; i < testJobIds.length; i++) {
        const jobId = testJobIds[i]!;
        console.log(`\n📋 ${i + 1}/${testJobIds.length}: ${jobId} をスクレイピング中...`);

        const jobDetail = await scrapeJobDetails(browser, jobId, 'development');
        if (jobDetail) {
            results.push(jobDetail);
            console.log(`✅ 成功: ${jobDetail.title || 'タイトル不明'}`);
        } else {
            console.log(`❌ 失敗: ${jobId}`);
        }

        // 間隔を開ける
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    await browser.close();

    // 結果を保存
    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `test-scraping-results-${timestamp}.json`;
    const filepath = path.join(outputDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(results, null, 2), 'utf8');

    console.log(`\n📊 テスト完了！`);
    console.log(`📁 結果保存先: ${filepath}`);
    console.log(`📈 成功: ${results.length}/${testJobIds.length}件`);

    // 結果のサマリー表示
    results.forEach((job, i) => {
        console.log(`\n[${i + 1}] ID: ${job.jobId}`);
        console.log(`    タイトル: ${job.title || '未取得'}`);
        console.log(`    予算: ${job.budget || '未取得'}`);
        console.log(`    説明: ${job.detailedDescription ? job.detailedDescription.substring(0, 50) + '...' : '未取得'}`);
    });
}

if (require.main === module) {
    main().catch(console.error);
} 