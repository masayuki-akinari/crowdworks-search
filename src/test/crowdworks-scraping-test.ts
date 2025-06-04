import { chromium, Browser, Page } from 'playwright';
import dotenv from 'dotenv';

// 環境変数読み込み
dotenv.config();

// 環境変数から認証情報を取得
async function getCrowdWorksCredentials() {
    const email = process.env['CROWDWORKS_EMAIL'];
    const password = process.env['CROWDWORKS_PASSWORD'];

    if (!email || !password) {
        throw new Error('❌ 環境変数 CROWDWORKS_EMAIL, CROWDWORKS_PASSWORD が設定されていません');
    }

    return { email, password };
}

// CrowdWorksログイン関数
async function loginToCrowdWorks(page: Page, credentials: { email: string; password: string }) {
    const startTime = Date.now();

    try {
        console.log('🔐 CrowdWorksログイン開始...');

        // ログインページへ移動
        await page.goto('https://crowdworks.jp/login', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        console.log('✅ ログインページ読み込み完了');

        // フォーム要素の検出と入力
        console.log('📝 認証情報入力中...');
        await page.getByRole('textbox', { name: 'メールアドレス' }).fill(credentials.email);
        await page.getByRole('textbox', { name: 'パスワード' }).fill(credentials.password);

        console.log('🔑 ログインボタンクリック...');
        await page.getByRole('button', { name: 'ログイン', exact: true }).click();

        // リダイレクト待機とログイン成功確認
        console.log('⏳ ダッシュボードへのリダイレクト待機...');
        await page.waitForURL('**/dashboard', { timeout: 15000 });

        console.log('✅ ログイン成功！ダッシュボードにアクセス完了');

        const executionTime = Date.now() - startTime;
        return {
            success: true,
            isLoggedIn: true,
            executionTime
        };

    } catch (error) {
        const executionTime = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ ログインエラー:', errorMessage);

        return {
            success: false,
            isLoggedIn: false,
            error: errorMessage,
            executionTime
        };
    }
}

// 新着順ソート機能付きカテゴリスクレイピングテスト
async function testCrowdWorksCategoryScraping(): Promise<void> {
    const startTime = Date.now();
    let browser: Browser | null = null;

    try {
        console.log('🚀 CrowdWorksカテゴリスクレイピングテスト開始（新着順ソート機能付き）...');

        // 認証情報取得
        const credentials = await getCrowdWorksCredentials();
        console.log(`📧 使用メールアドレス: ${credentials.email}`);

        // ブラウザ起動（ローカル開発では視覚的に確認するためheadless: false）
        browser = await chromium.launch({
            headless: false, // ローカルテスト用に視覚化
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
            ],
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
        });

        const page = await context.newPage();

        // ログイン実行
        const loginResult = await loginToCrowdWorks(page, credentials);
        if (!loginResult.success) {
            throw new Error(`ログイン失敗: ${loginResult.error}`);
        }

        // カテゴリ配列（web_products と ec）
        const categories = ['web_products', 'ec'];

        for (const category of categories) {
            console.log(`\n📂 === カテゴリ「${category}」処理開始 ===`);

            // カテゴリページアクセス
            const categoryUrl = `https://crowdworks.jp/public/jobs/group/${category}`;
            console.log(`📄 カテゴリページアクセス: ${categoryUrl}`);

            await page.goto(categoryUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            // ページタイトル確認
            const pageTitle = await page.title();
            console.log(`📋 ページタイトル: "${pageTitle}"`);

            // スクリーンショット保存（新着順ソート前）
            await page.screenshot({
                path: `screenshot_${category}_before_sort.png`,
                fullPage: true
            });
            console.log(`📸 スクリーンショット保存: screenshot_${category}_before_sort.png`);

            // 新着順ソート設定の実行
            console.log('🔄 新着順ソート設定開始...');

            try {
                // ソートドロップダウンを探してクリック
                const sortDropdown = await page.$('combobox');
                if (sortDropdown) {
                    console.log('✅ ソートドロップダウン発見');

                    // ドロップダウンをクリックして開く
                    await sortDropdown.click();
                    await page.waitForTimeout(1000);

                    // 新着順オプションを選択
                    try {
                        await page.selectOption('combobox', { label: '新着' });
                        console.log('✅ 新着順オプション選択成功');
                    } catch (selectError) {
                        console.log('⚠️ selectOption失敗、直接URLアクセスを試行');

                        // 直接新着順URLにアクセス
                        const newUrl = categoryUrl.includes('?')
                            ? `${categoryUrl}&order=new`
                            : `${categoryUrl}?order=new`;

                        await page.goto(newUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        console.log(`✅ 新着順URL直接アクセス: ${newUrl}`);
                    }

                    // ソート変更後のページ更新を待機
                    await page.waitForTimeout(3000);

                    // 現在のURLを確認
                    const currentUrl = page.url();
                    console.log(`🌐 現在のURL: ${currentUrl}`);

                    if (currentUrl.includes('order=new')) {
                        console.log('✅ 新着順ソート設定確認済み');
                    } else {
                        console.log('⚠️ URLに新着順パラメータが含まれていません');
                    }

                } else {
                    console.log('⚠️ ソートドロップダウンが見つかりません。直接URLアクセス');

                    // 直接新着順URLにアクセス
                    const newUrl = categoryUrl.includes('?')
                        ? `${categoryUrl}&order=new`
                        : `${categoryUrl}?order=new`;

                    await page.goto(newUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    console.log(`✅ 新着順URL直接アクセス: ${newUrl}`);
                }

            } catch (sortError) {
                console.warn('⚠️ ソート設定でエラーが発生:', sortError);
                console.log('デフォルト順序で続行します');
            }

            // スクリーンショット保存（新着順ソート後）
            await page.screenshot({
                path: `screenshot_${category}_after_sort.png`,
                fullPage: true
            });
            console.log(`📸 スクリーンショット保存: screenshot_${category}_after_sort.png`);

            // 案件一覧の取得
            console.log('📝 案件データ抽出開始...');

            try {
                // 案件一覧要素の確認
                const jobCount = await page.evaluate(() => {
                    // より多くのセレクターパターンを試行
                    const selectors = [
                        '.search_result .project_row',
                        '.project-item',
                        '[class*="project-row"]',
                        '.job-item',
                        '.list-item',
                        '[data-id]',
                        '.job-list .job',
                        '.project-list .project',
                        '.search-result-item',
                        '.job-card',
                        'article',
                        '[class*="job"]',
                        '[class*="project"]'
                    ];

                    let foundElements: any = null;
                    let usedSelector = '';

                    for (const selector of selectors) {
                        const elements = (globalThis as any).document.querySelectorAll(selector);
                        if (elements.length > 0) {
                            foundElements = elements;
                            usedSelector = selector;
                            console.log(`✅ 案件要素発見: ${selector} (${elements.length}件)`);
                            break;
                        }
                    }

                    if (!foundElements) {
                        // 全体的なDOM構造をデバッグ出力
                        const bodyClasses = (globalThis as any).document.body.className;
                        const mainContent = (globalThis as any).document.querySelector('main, #main, .main, .content, .container');
                        const allDivs = (globalThis as any).document.querySelectorAll('div[class*="search"], div[class*="result"], div[class*="job"], div[class*="project"]');

                        console.log(`🔍 デバッグ情報:`);
                        console.log(`   Body classes: ${bodyClasses}`);
                        console.log(`   Main content: ${mainContent ? 'found' : 'not found'}`);
                        console.log(`   Related divs: ${allDivs.length}件`);

                        return 0;
                    }

                    return foundElements.length;
                });

                console.log(`🔢 発見した案件数: ${jobCount}件`);

                if (jobCount > 0) {
                    // サンプル案件情報を取得（最初の3件）
                    const sampleJobs = await page.evaluate(() => {
                        const jobElements = (globalThis as any).document.querySelectorAll('.search_result .project_row, .project-item, [class*="project-row"]');
                        const samples: any[] = [];

                        for (let i = 0; i < Math.min(jobElements.length, 3); i++) {
                            const jobElement = jobElements[i];
                            const titleElement = jobElement.querySelector('.project_title a, .job-title a, a[class*="title"], h3 a, h2 a');
                            const title = titleElement?.textContent?.trim() || `案件${i + 1}`;

                            const dateElement = jobElement.querySelector('.posted_date, .date, .post-date');
                            const postedAt = dateElement?.textContent?.trim() || '投稿日不明';

                            samples.push({ title, postedAt });
                        }

                        return samples;
                    });

                    console.log('📝 サンプル案件（新着順）:');
                    sampleJobs.forEach((job, index) => {
                        console.log(`   ${index + 1}. ${job.title} (投稿: ${job.postedAt})`);
                    });

                } else {
                    console.log('⚠️ 案件が見つかりませんでした');
                }

            } catch (extractError) {
                console.error('❌ 案件データ抽出エラー:', extractError);
            }

            // 次のカテゴリ処理前に少し待機
            console.log(`✅ カテゴリ「${category}」処理完了\n`);
            await page.waitForTimeout(2000);
        }

        await context.close();

        const executionTime = Date.now() - startTime;
        console.log(`🎉 CrowdWorksカテゴリスクレイピングテスト完了！`);
        console.log(`⏱️ 総実行時間: ${executionTime}ms`);

    } catch (error) {
        const executionTime = Date.now() - startTime;
        console.error('❌ テスト失敗:', error);
        console.log(`⏱️ 実行時間: ${executionTime}ms`);
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 ブラウザクリーンアップ完了');
        }
    }
}

// テストタイプの判定
const testType = process.env['TEST_TYPE'] || 'category';

async function main() {
    console.log('🌟 === CrowdWorks スクレイピングテスト ===');
    console.log(`🔧 テストタイプ: ${testType}`);
    console.log(`📅 実行日時: ${new Date().toISOString()}`);
    console.log('');

    switch (testType) {
        case 'category':
            await testCrowdWorksCategoryScraping();
            break;
        default:
            console.error(`❌ 不明なテストタイプ: ${testType}`);
            console.log('利用可能なテストタイプ: category');
            process.exit(1);
    }
}

// スクリプト実行時のメイン処理
if (require.main === module) {
    main().catch((error) => {
        console.error('❌ メイン処理でエラーが発生しました:', error);
        process.exit(1);
    });
} 