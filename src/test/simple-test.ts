import { chromium } from 'playwright';
import dotenv from 'dotenv';

// 環境変数読み込み
dotenv.config();

async function simpleTest() {
    console.log('🚀 CrowdWorks簡易テスト開始...');

    const browser = await chromium.launch({
        headless: false, // 視覚的確認のため
        devtools: false,
        args: ['--start-maximized']
    });

    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            viewport: { width: 1920, height: 1080 },
        });

        const page = await context.newPage();

        // CrowdWorks公開案件ページに直接アクセス
        console.log('📄 CrowdWorks案件ページにアクセス...');
        await page.goto('https://crowdworks.jp/public/jobs', {
            waitUntil: 'domcontentloaded', // networkidleより軽量
            timeout: 60000 // タイムアウトを60秒に延長
        });

        // ページの読み込み完了まで少し待機
        await page.waitForTimeout(3000);

        // ページタイトル取得
        const title = await page.title();
        console.log(`📋 ページタイトル: "${title}"`);

        // 案件数をカウント
        const jobCount = await page.evaluate(() => {
            const jobLinks = (globalThis as any).document.querySelectorAll('a[href*="/public/jobs/"]');
            return jobLinks.length;
        });

        console.log(`📊 発見された案件リンク数: ${jobCount}`);

        if (jobCount > 0) {
            console.log('✅ CrowdWorks案件ページへのアクセス成功！');

            // 詳細な案件情報を取得
            const jobInfo = await page.evaluate(() => {
                const jobElements = (globalThis as any).document.querySelectorAll('main li, ul li');
                const jobs = [];

                for (let i = 0; i < Math.min(jobElements.length, 3); i++) {
                    const jobElement = jobElements[i];
                    if (!jobElement) continue;

                    // タイトルとURLを探す
                    const titleElement = jobElement.querySelector('a[href*="/public/jobs/"]');
                    if (!titleElement) continue;

                    const title = titleElement?.textContent?.trim() || '不明';
                    const href = titleElement?.getAttribute('href') || '';
                    const url = href.startsWith('http') ? href : `https://crowdworks.jp${href}`;

                    // 予算情報を探す
                    const allElements = jobElement.querySelectorAll('*');
                    let budget = '不明';
                    for (const el of allElements) {
                        const text = el?.textContent?.trim() || '';
                        if (text.includes('円') || text.includes('固定報酬制') || text.includes('時間単価制')) {
                            budget = text;
                            break;
                        }
                    }

                    jobs.push({ title, url, budget });
                }

                return jobs;
            });

            console.log('\n📋 抽出された案件情報:');
            jobInfo.forEach((job, index) => {
                console.log(`${index + 1}. ${job.title}`);
                console.log(`   💰 予算: ${job.budget}`);
                console.log(`   🔗 URL: ${job.url}`);
                console.log('');
            });

        } else {
            console.log('⚠️ 案件が見つかりませんでした');
        }

        // 5秒待機してから終了
        console.log('⏱️ 5秒後にブラウザを閉じます...');
        await page.waitForTimeout(5000);

        await context.close();

    } finally {
        await browser.close();
        console.log('🔒 ブラウザクリーンアップ完了');
    }

    console.log('✅ 簡易テスト完了！');
}

// テスト実行
if (require.main === module) {
    simpleTest().catch((error) => {
        console.error('❌ テストエラー:', error);
        process.exit(1);
    });
} 