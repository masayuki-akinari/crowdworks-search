import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';

interface CrowdWorksJob {
    jobId: string;
    title: string;
    category: string;
    url: string;
    budget: string;
    description: string;
    client: string;
    tags: string[];
    postedAt: string;
    scrapedAt: string;
}

async function scrapeCrowdWorksJobs(): Promise<void> {
    console.log('🚀 CrowdWorksスクレイピング開始（各カテゴリ10件ずつ）');

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    // カテゴリ設定（10件ずつ）
    const categories = [
        { name: 'development', url: 'https://crowdworks.jp/public/jobs/category/1', maxJobs: 10 },
        { name: 'web_products', url: 'https://crowdworks.jp/public/jobs/category/9', maxJobs: 10 },
        { name: 'ec', url: 'https://crowdworks.jp/public/jobs/category/10', maxJobs: 10 },
        { name: 'software_development', url: 'https://crowdworks.jp/public/jobs/category/236', maxJobs: 10 }
    ];

    const allJobs: CrowdWorksJob[] = [];

    for (const category of categories) {
        console.log(`\n📁 カテゴリ「${category.name}」をスクレイピング中...`);

        try {
            await page.goto(category.url, { waitUntil: 'networkidle2' });
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 案件リンクを取得
            const jobLinks = await page.$$eval('a[href*="/public/jobs/"]', links =>
                links.map(link => (link as HTMLAnchorElement).href)
                    .filter(href => href.match(/\/public\/jobs\/\d+$/))
                    .slice(0, 10) // 10件に制限
            );

            console.log(`🔍 ${category.name}カテゴリ: ${jobLinks.length}件の案件を発見`);

            // 各案件の詳細を取得
            for (const [index, jobUrl] of jobLinks.entries()) {
                try {
                    console.log(`📋 ${index + 1}/${jobLinks.length}: ${jobUrl.split('/').pop()}`);

                    await page.goto(jobUrl, { waitUntil: 'networkidle2' });
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    const jobData = await page.evaluate((url, categoryName) => {
                        const title = document.querySelector('h1')?.textContent?.trim() || '';
                        const jobId = url.split('/').pop() || '';

                        // 予算を取得（複数のセレクタを試行）
                        let budget = '';
                        const budgetSelectors = [
                            'table tr:has(th:contains("予算")) td',
                            'table tr:has(th:contains("固定報酬")) td',
                            'table tr:has(th:contains("時間単価")) td',
                            '.job-detail-table tr:has(th:contains("予算")) td'
                        ];

                        for (const selector of budgetSelectors) {
                            const element = document.querySelector(selector);
                            if (element && element.textContent?.trim()) {
                                budget = element.textContent.trim();
                                break;
                            }
                        }

                        // 詳細説明を取得
                        let description = '';
                        const descSelectors = [
                            '.job_description',
                            '.job-detail-description',
                            'div:has(h2:contains("依頼詳細")) + div',
                            '.description'
                        ];

                        for (const selector of descSelectors) {
                            const element = document.querySelector(selector);
                            if (element && element.textContent?.trim()) {
                                description = element.textContent.trim().substring(0, 500);
                                break;
                            }
                        }

                        // クライアント情報
                        let client = '';
                        const clientElement = document.querySelector('a[href*="/public/employees/"] span, .client-name');
                        if (clientElement) {
                            client = clientElement.textContent?.trim() || '';
                        }

                        return {
                            jobId,
                            title,
                            category: categoryName,
                            url,
                            budget,
                            description,
                            client,
                            tags: [],
                            postedAt: '',
                            scrapedAt: new Date().toISOString()
                        };
                    }, jobUrl, category.name);

                    allJobs.push(jobData);
                    console.log(`✅ ${jobData.title || 'タイトル不明'}`);

                } catch (error) {
                    console.log(`❌ 案件取得エラー: ${jobUrl}`);
                }
            }

        } catch (error) {
            console.error(`❌ カテゴリ「${category.name}」でエラー:`, error);
        }
    }

    // ファイル出力
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `output/crowdworks-jobs-${timestamp}.json`;

    writeFileSync(filename, JSON.stringify(allJobs, null, 2), 'utf8');

    console.log(`\n🎉 CrowdWorksスクレイピング完了！`);
    console.log(`📊 総取得件数: ${allJobs.length}件`);
    console.log(`💾 保存先: ${filename}`);

    await browser.close();
}

// メイン実行
if (require.main === module) {
    scrapeCrowdWorksJobs().catch(error => {
        console.error('💥 スクレイピングエラー:', error);
        process.exit(1);
    });
}

export default scrapeCrowdWorksJobs; 