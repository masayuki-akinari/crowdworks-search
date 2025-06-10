import puppeteer, { Browser, Page } from 'puppeteer';

interface LancersJob {
    id: string;
    title: string;
    description: string;
    budget: {
        type: 'fixed' | 'hourly' | 'unknown';
        amount: number;
        currency: string;
    };
    hourlyRate?: number;
    category: string;
    client: {
        name: string;
        rating: number;
        reviewCount: number;
        completionRate: string;
        orders: number;
    };
    skills: string[];
    applicationCount: number;
    isUrgent: boolean;
    postDate: string;
    deadline: string;
    url: string;
}

async function testLancersJobDetail(browser: Browser, jobId: string): Promise<LancersJob | null> {
    const page: Page = await browser.newPage();

    try {
        const url = `https://www.lancers.jp/work/detail/${jobId}`;
        console.log(`🔍 ランサーズ詳細ページ: ${url}`);

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 削除やアクセス制限されたページかチェック
        const errorCheck = await page.evaluate(() => {
            const banner = document.querySelector('banner h1[level="1"]');
            if (banner) {
                const text = banner.textContent || '';
                if (text.includes('閲覧制限') || text.includes('削除')) {
                    return { error: true, message: text };
                }
            }
            return { error: false };
        });

        if (errorCheck.error) {
            console.log(`⚠️ ページアクセスエラー: ${jobId}`);
            return null;
        }

        const job: LancersJob = {
            id: jobId,
            title: '',
            description: '',
            budget: {
                type: 'unknown',
                amount: 0,
                currency: '円'
            },
            category: 'test',
            client: {
                name: '',
                rating: 0,
                reviewCount: 0,
                completionRate: '',
                orders: 0
            },
            skills: [],
            applicationCount: 0,
            isUrgent: false,
            postDate: '',
            deadline: '',
            url
        };

        // タイトルの取得（実際のランサーズ構造に基づく）
        try {
            const title = await page.evaluate(() => {
                const h1 = document.querySelector('h1');
                if (!h1) return '';

                // "【急募】オンライン子供向けプログラミングレッスン講師を募集！の仕事 [IT・通信・インターネット]"
                // から "【急募】オンライン子供向けプログラミングレッスン講師を募集！" を抽出
                const fullText = h1.textContent || '';
                const match = fullText.match(/^(.+?)の仕事/);
                return match ? match[1]!.trim() : fullText.replace(/\s*\[.*?\]\s*$/, '').trim();
            });

            if (title && title.length > 5) {
                job.title = title;
                console.log(`✅ タイトル: ${job.title}`);
            } else {
                console.log('⚠️ タイトルが見つかりません');
            }
        } catch (error) {
            console.error('タイトル取得エラー:', error);
        }

        // 予算の取得（定義リストからの抽出）
        try {
            const budget = await page.evaluate(() => {
                const terms = Array.from(document.querySelectorAll('dt'));
                for (const term of terms) {
                    if (term.textContent?.includes('提示した予算') || term.textContent?.includes('予算')) {
                        const dd = term.nextElementSibling;
                        if (dd && dd.tagName === 'DD') {
                            return dd.textContent?.trim() || '';
                        }
                    }
                }
                return '';
            });

            if (budget) {
                const amountMatch = budget.match(/(\d{1,3}(?:,\d{3})*)/);
                if (amountMatch && amountMatch[1]) {
                    job.budget.amount = parseInt(amountMatch[1].replace(/,/g, ''));
                    job.budget.type = budget.includes('時間') ? 'hourly' : 'fixed';
                    console.log(`✅ 予算: ${budget} (${job.budget.amount}円)`);
                }
            } else {
                console.log('⚠️ 予算情報が見つかりません');
            }
        } catch (error) {
            console.error('予算取得エラー:', error);
        }

        // 詳細説明の取得（定義リストからの抽出）
        try {
            const description = await page.evaluate(() => {
                const terms = Array.from(document.querySelectorAll('dt'));
                for (const term of terms) {
                    if (term.textContent?.includes('依頼概要')) {
                        const dd = term.nextElementSibling;
                        if (dd && dd.tagName === 'DD') {
                            const text = dd.textContent?.trim() || '';
                            // 最初の200文字に制限
                            return text.length > 200 ? text.substring(0, 200) + '...' : text;
                        }
                    }
                }
                return '';
            });

            if (description && description.length > 20) {
                job.description = description;
                console.log(`✅ 詳細説明: ${job.description.substring(0, 100)}...`);
            } else {
                console.log('⚠️ 詳細説明が見つかりません');
            }
        } catch (error) {
            console.error('詳細説明取得エラー:', error);
        }

        return job;

    } catch (error) {
        console.error(`❌ エラー (jobId: ${jobId}):`, error);
        return null;
    } finally {
        await page.close();
    }
}

async function main() {
    console.log('🚀 ランサーズ詳細スクレイピングテスト（5件）を開始します...');

    // 新しい有効なジョブID（実際のランサーズサイトから確認済み）
    const testJobIds: string[] = [
        '5323878', // 新しく取得されたID
        '5323864', // 新しく取得されたID
        '5323784', // 新しく取得されたID
        '5323287', // 新しく取得されたID
        '5323680'  // 新しく取得されたID
    ];

    const browser = await puppeteer.launch({
        headless: true,    // 高速実行のためheadlessモード
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        ]
    });

    const results: LancersJob[] = [];

    for (let i = 0; i < testJobIds.length; i++) {
        const jobId = testJobIds[i]!;
        console.log(`\n📋 ${i + 1}/${testJobIds.length}: ${jobId} をスクレイピング中...`);

        const job = await testLancersJobDetail(browser, jobId);
        if (job) {
            results.push(job);
            console.log(`✅ 成功: ${job.title || 'タイトル不明'}`);
        } else {
            console.log(`❌ 失敗: ${jobId}`);
        }

        // リクエスト間隔を空ける
        if (i < testJobIds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    await browser.close();

    // 結果の集計
    console.log('\n📊 結果サマリー:');
    console.log(`成功: ${results.length}/${testJobIds.length} (${Math.round(results.length / testJobIds.length * 100)}%)`);

    let titlesFound = 0;
    let budgetsFound = 0;
    let descriptionsFound = 0;

    results.forEach(job => {
        if (job.title) titlesFound++;
        if (job.budget.amount > 0) budgetsFound++;
        if (job.description) descriptionsFound++;
    });

    console.log(`タイトル取得: ${titlesFound}/${results.length}`);
    console.log(`予算取得: ${budgetsFound}/${results.length}`);
    console.log(`詳細説明取得: ${descriptionsFound}/${results.length}`);

    // 取得できたデータのサンプル表示
    if (results.length > 0) {
        console.log('\n📝 取得データサンプル:');
        for (let i = 0; i < Math.min(3, results.length); i++) {
            const job = results[i]!;
            console.log(`\n[${job.id}]`);
            console.log(`タイトル: ${job.title || '取得失敗'}`);
            console.log(`予算: ${job.budget.amount > 0 ? job.budget.amount + '円' : '取得失敗'}`);
            console.log(`説明: ${job.description ? job.description.substring(0, 50) + '...' : '取得失敗'}`);
        }
    }
}

main().catch(console.error); 