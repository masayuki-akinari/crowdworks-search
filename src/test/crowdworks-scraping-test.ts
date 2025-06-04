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

            // 案件データ抽出を実行
            console.log('📝 実際の案件データ抽出テスト...');

            // 修正されたセレクターで案件要素を検索
            const finalJobCount = await page.evaluate(() => {
                const selectors = [
                    'main li',  // メイン要素内のli要素（最も可能性が高い）
                    'ul li',    // 一般的なリスト構造
                    'ol li',    // 順序付きリスト
                    '.job-list li',
                    'li',       // 全てのli要素
                    '.job-item',
                    '[data-job-id]'
                ];

                let foundJobElements: any = null;
                let usedSelector = '';

                for (const selector of selectors) {
                    const elements = (globalThis as any).document.querySelectorAll(selector);

                    // 案件リンクを含むli要素のみフィルタリング
                    const jobElements = Array.from(elements).filter((el: any) => {
                        return el.querySelector('a[href*="/public/jobs/"]');
                    });

                    if (jobElements.length > 0) {
                        foundJobElements = jobElements;
                        usedSelector = selector;
                        console.log(`✅ 案件要素発見: ${selector} (フィルタ後${jobElements.length}件)`);
                        break;
                    }
                }

                if (!foundJobElements) {
                    console.log('❌ 案件要素が見つかりませんでした');
                    return 0;
                }

                console.log(`📊 使用セレクター: ${usedSelector}`);
                console.log(`📝 案件数: ${foundJobElements.length}件`);

                return foundJobElements.length;
            });

            console.log(`🔢 最終案件数: ${finalJobCount}件`);

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