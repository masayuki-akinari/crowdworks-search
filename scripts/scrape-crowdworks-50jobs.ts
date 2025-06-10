import puppeteer from 'puppeteer';
import * as fs from 'fs';

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

async function scrapeCrowdWorksWebJobs(): Promise<void> {
    console.log('🚀 CrowdWorks Webエンジニアカテゴリスクレイピング開始（30件取得）');

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(60000); // 60秒に延長
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    const allJobs: CrowdWorksJob[] = [];

    // Webエンジニアカテゴリから30件取得
    const categoryUrl = 'https://crowdworks.jp/public/jobs/category/241';
    console.log(`📄 カテゴリページにアクセス: ${categoryUrl}`);

    try {
        await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 3000)); // 3秒待機

        // 案件リンクを30件取得
        const jobLinks = await page.evaluate(() => {
            const links: string[] = [];
            const linkElements = document.querySelectorAll('a[href*="/public/jobs/"]');

            for (let i = 0; i < linkElements.length; i++) {
                const link = linkElements[i] as HTMLAnchorElement;
                if (link) {
                    const href = link.getAttribute('href');
                    if (href && href.match(/\/public\/jobs\/\d+$/)) { // 数字のIDで終わるもののみ
                        const fullUrl = href.startsWith('http') ? href : `https://crowdworks.jp${href}`;
                        if (!links.includes(fullUrl)) {
                            links.push(fullUrl);
                        }
                    }
                }
            }

            return links.slice(0, 30); // 30件に制限
        });

        console.log(`📋 取得した案件URL数: ${jobLinks.length}件`);

        // 各案件の詳細を取得
        for (let i = 0; i < jobLinks.length; i++) {
            const jobUrl = jobLinks[i];
            if (!jobUrl) continue;

            console.log(`🔍 案件 ${i + 1}/${jobLinks.length} を処理中: ${jobUrl}`);

            try {
                const jobId = jobUrl.split('/').pop() || '';

                await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2秒待機

                const jobDetails = await page.evaluate((currentUrl, currentJobId) => {
                    // タイトルの取得（成功したロジック）
                    let title = '';
                    const h1Elements = document.querySelectorAll('h1');
                    if (h1Elements.length >= 2) {
                        const secondH1 = h1Elements[1];
                        if (secondH1) {
                            const text = secondH1.textContent?.trim() || '';
                            const cleanText = text.replace(/\\n/g, ' ').replace(/\\s+/g, ' ');
                            const match = cleanText.match(/^(.+?)\\s+.*の仕事の依頼$/);
                            if (match && match[1]) {
                                title = match[1].trim();
                            } else {
                                const splitResult = cleanText.split('の仕事の依頼');
                                if (splitResult && splitResult[0]) {
                                    title = splitResult[0].trim();
                                }
                            }
                        }
                    }

                    // 予算の取得（テーブルから）
                    let budget = '';
                    const table = document.querySelector('table');
                    if (table) {
                        const rows = Array.from(table.querySelectorAll('tr'));
                        for (const row of rows) {
                            const cells = Array.from(row.querySelectorAll('td'));
                            if (cells.length >= 2) {
                                const secondCell = cells[1];
                                const text = secondCell?.textContent?.trim() || '';
                                if (text.includes('円') && (text.includes('〜') || text.includes('-') || text.includes('以上'))) {
                                    budget = text;
                                    break;
                                }
                            }
                        }
                    }

                    // フォールバック予算取得
                    if (!budget) {
                        const walker = document.createTreeWalker(
                            document.body,
                            NodeFilter.SHOW_TEXT
                        );
                        let node;
                        while (node = walker.nextNode()) {
                            const text = node.textContent?.trim() || '';
                            if (text.includes('円') && text.match(/[\\d,]+円/)) {
                                budget = text;
                                break;
                            }
                        }
                    }

                    // 説明文の取得（改善版）
                    let description = '';
                    const headings = Array.from(document.querySelectorAll('h2'));
                    const detailHeading = headings.find(h => h.textContent?.includes('仕事の詳細'));

                    if (detailHeading) {
                        let nextElement = detailHeading.nextElementSibling;
                        while (nextElement) {
                            if (nextElement.tagName === 'TABLE') {
                                const rows = Array.from(nextElement.querySelectorAll('tr'));
                                for (const row of rows) {
                                    const cells = Array.from(row.querySelectorAll('td'));
                                    if (cells.length >= 1) {
                                        const cellText = cells[0]?.textContent?.trim() || '';
                                        if (cellText.length > 50) {
                                            description = cellText.substring(0, 500);
                                            break;
                                        }
                                    }
                                }
                                break;
                            }
                            nextElement = nextElement.nextElementSibling;
                        }
                    }

                    // クライアント情報の取得
                    let client = '';
                    const clientElement = document.querySelector('a[href*="/public/employees/"] span, .client-name');
                    if (clientElement) {
                        client = clientElement.textContent?.trim() || '';
                    }

                    return {
                        jobId: currentJobId,
                        title: title || 'タイトル不明',
                        category: 'webエンジニア',
                        url: currentUrl || '',
                        budget: budget || '未取得',
                        description: description || 'ページアクセス制限またはデータ取得エラー',
                        client: client || '未取得',
                        tags: [],
                        postedAt: '',
                        scrapedAt: new Date().toISOString()
                    };
                }, jobUrl, jobId);

                allJobs.push(jobDetails);

                if (jobDetails.title !== 'タイトル不明' && jobDetails.budget !== '未取得') {
                    console.log(`✅ 成功: ${jobDetails.title}`);
                } else {
                    console.log(`⚠️ 部分取得: ${jobDetails.title} (${jobDetails.budget})`);
                }

            } catch (error) {
                console.error(`❌ 案件詳細取得エラー: ${error}`);
                allJobs.push({
                    jobId: jobUrl.split('/').pop() || '',
                    title: 'スクレイピングエラー',
                    category: 'webエンジニア',
                    url: jobUrl,
                    budget: 'エラー',
                    description: 'スクレイピング中にエラーが発生しました',
                    client: 'エラー',
                    tags: [],
                    postedAt: '',
                    scrapedAt: new Date().toISOString()
                });
            }
        }

        // ファイル出力
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `output/crowdworks-web-jobs-${timestamp}.json`;

        fs.writeFileSync(filename, JSON.stringify(allJobs, null, 2), 'utf8');

        console.log(`\\n🎉 CrowdWorks Webエンジニアスクレイピング完了！`);
        console.log(`📊 総取得件数: ${allJobs.length}件 (目標: 30件)`);
        console.log(`✅ タイトル取得成功: ${allJobs.filter(j => j.title !== 'タイトル不明').length}件`);
        console.log(`💰 予算取得成功: ${allJobs.filter(j => j.budget !== '未取得' && j.budget !== 'エラー').length}件`);
        console.log(`💾 保存先: ${filename}`);

    } catch (error) {
        console.error('💥 カテゴリページアクセスエラー:', error);
        process.exit(1);
    }

    await browser.close();
}

// メイン実行
if (require.main === module) {
    scrapeCrowdWorksWebJobs().catch(error => {
        console.error('💥 スクレイピングエラー:', error);
        process.exit(1);
    });
}

export default scrapeCrowdWorksWebJobs; 