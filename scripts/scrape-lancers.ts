import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { LancersService, LancersJob, LancersJobDetail } from '../src/services/LancersService';
import * as dotenv from 'dotenv';

// 環境変数を読み込み
dotenv.config();

/**
 * ランサーズ案件スクレイピングメイン処理
 */
async function main(): Promise<void> {
    console.log('🚀 ランサーズ案件のスクレイピングを開始します...');
    console.log('⚠️ 注意: 公開案件のみを対象とします');

    const browser = await chromium.launch({
        headless: false,
        slowMo: 1000,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

        // User-Agentを設定
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        });

        const lancersService = new LancersService(page);

        // 取得するカテゴリとそれぞれの最大件数（実際のスクレイピングでは控えめに設定）
        const categories = [
            { name: 'system', maxJobs: 20 },      // システム開発・運用
            { name: 'web', maxJobs: 15 },         // Web制作・Webデザイン
            { name: 'app', maxJobs: 10 },         // スマホアプリ・モバイル開発
        ];

        const allJobs: LancersJob[] = [];
        const allDetails: LancersJobDetail[] = [];
        const startTime = Date.now();

        console.log('🔍 Lancersサイトの状態を確認しています...');

        // Lancersログインページから開始
        try {
            const loginUrl = 'https://www.lancers.jp/user/login?ref=header_menu';
            console.log(`🌐 Lancersログインページにアクセス: ${loginUrl}`);

            await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(3000);

            // ページタイトルを確認
            const pageTitle = await page.title();
            console.log(`📄 ページタイトル: ${pageTitle}`);

            // ログインページの要素を確認
            const isLoginPage = await page.$('input[name="email"], input[type="email"]');
            if (isLoginPage) {
                console.log('✅ ランサーズログインページを確認しました');

                // 環境変数からログイン情報を取得
                const lancersEmail = process.env['LANCERS_EMAIL'];
                const lancersPassword = process.env['LANCERS_PASSWORD'];

                if (lancersEmail && lancersPassword) {
                    console.log('🔐 環境変数からログイン情報を取得しました');
                    console.log('🚀 自動ログインを開始します...');

                    try {
                        // メールアドレス入力フィールドを特定して入力
                        // MCPで確認した正確なPlaywrightセレクター
                        try {
                            await page.getByRole('textbox', { name: 'メールアドレス' }).fill(lancersEmail);
                            console.log('✅ メールアドレスを入力しました');
                            await page.waitForTimeout(1000);
                        } catch (emailError) {
                            console.log('⚠️ 主要メールセレクターが失敗、フォールバック試行中...');
                            // フォールバック: より汎用的なセレクター
                            const fallbackEmailInput = await page.$('input[type="email"], input[type="text"]:first-of-type');
                            if (fallbackEmailInput) {
                                await fallbackEmailInput.fill(lancersEmail);
                                console.log('✅ メールアドレスを入力しました（フォールバック）');
                                await page.waitForTimeout(1000);
                            } else {
                                console.log('❌ メールアドレス入力フィールドが見つかりません');
                            }
                        }

                        // パスワード入力フィールドを特定して入力
                        // MCPで確認した正確なPlaywrightセレクター
                        try {
                            await page.getByRole('textbox', { name: 'パスワード' }).fill(lancersPassword);
                            console.log('✅ パスワードを入力しました');
                            await page.waitForTimeout(1000);
                        } catch (passwordError) {
                            console.log('⚠️ 主要パスワードセレクターが失敗、フォールバック試行中...');
                            // フォールバック: パスワードタイプのinput
                            const fallbackPasswordInput = await page.$('input[type="password"]');
                            if (fallbackPasswordInput) {
                                await fallbackPasswordInput.fill(lancersPassword);
                                console.log('✅ パスワードを入力しました（フォールバック）');
                                await page.waitForTimeout(1000);
                            } else {
                                console.log('❌ パスワード入力フィールドが見つかりません');
                            }
                        }

                        // ログインボタンをクリック
                        // より具体的なセレクターを使用（複数ボタン問題の解決）
                        try {
                            // 通常のログインボタンを特定（Appleのログインボタンではなく）
                            await page.click('button[type="submit"]#form_submit, button.c-button--blue:has-text("ログイン")');
                            console.log('🔑 ログインボタンをクリックしました');

                            // ログイン処理の完了を待機（より長く）
                            console.log('⏳ ログイン処理を待機中...');
                            await page.waitForTimeout(8000);

                            // ログイン成功の確認を複数の方法で試行
                            const currentUrl = page.url();
                            console.log(`🌐 現在のURL: ${currentUrl}`);

                            // 方法1: URLによる判定
                            const isLoggedInByUrl = !currentUrl.includes('/user/login');
                            console.log(`📍 URL判定: ${isLoggedInByUrl ? 'ログイン状態' : '未ログイン状態'}`);

                            // 方法2: ユーザーメニューの存在による判定
                            const userMenu = await page.$('.c-header__user-menu, .user-menu, [data-testid="user-menu"]');
                            const isLoggedInByMenu = !!userMenu;
                            console.log(`👤 ユーザーメニュー判定: ${isLoggedInByMenu ? 'ログイン状態' : '未ログイン状態'}`);

                            // 方法3: ログインフォームが残っているかの判定
                            const loginForm = await page.$('textbox[name="メールアドレス"], input[type="email"]');
                            const isLoggedInByForm = !loginForm;
                            console.log(`📝 フォーム判定: ${isLoggedInByForm ? 'ログイン状態' : '未ログイン状態'}`);

                            // 総合判定
                            const isLoggedIn = isLoggedInByUrl || isLoggedInByMenu || isLoggedInByForm;

                            if (isLoggedIn) {
                                console.log('🎉 ログインに成功しました！全ての案件を取得できます');
                            } else {
                                console.log('❌ ログインに失敗しました。手動でのログインが必要です');

                                // エラーメッセージの詳細確認
                                const errorElements = await page.$$('.error-message, .alert, .warning, .c-validation-error, .form-error');
                                if (errorElements.length > 0) {
                                    console.log('🔍 エラーメッセージを確認中...');
                                    for (const element of errorElements) {
                                        const errorText = await element.textContent();
                                        if (errorText && errorText.trim()) {
                                            console.log(`❌ エラー: ${errorText.trim()}`);
                                        }
                                    }
                                }

                                // ページタイトルでも判定
                                const pageTitle = await page.title();
                                console.log(`📄 ページタイトル: ${pageTitle}`);

                                // 30秒待機して手動ログインの機会を提供
                                console.log('⏱️ 手動ログイン用に30秒待機します...');
                                await page.waitForTimeout(30000);

                                // 再度ログイン状態を確認
                                const finalUrl = page.url();
                                const finalLoggedIn = !finalUrl.includes('/user/login');
                                if (finalLoggedIn) {
                                    console.log('🎉 手動ログインが確認されました！');
                                } else {
                                    console.log('ℹ️ 公開案件のみでスクレイピングを続行します');
                                }
                            }
                        } catch (buttonError) {
                            console.log('⚠️ 主要ログインボタンセレクターが失敗、フォールバック試行中...');
                            console.error('ボタンエラー詳細:', buttonError);
                            // フォールバック: submitボタン
                            const fallbackSubmitButton = await page.$('button:has-text("ログイン"), input[type="submit"]');
                            if (fallbackSubmitButton) {
                                await fallbackSubmitButton.click();
                                console.log('🔑 ログインボタンをクリックしました（フォールバック）');
                                await page.waitForTimeout(8000);

                                // フォールバック処理後も成功判定
                                const currentUrl = page.url();
                                const isLoggedIn = !currentUrl.includes('/user/login');
                                if (isLoggedIn) {
                                    console.log('🎉 フォールバックログインに成功しました！');
                                } else {
                                    console.log('❌ フォールバックログインも失敗しました');
                                }
                            } else {
                                console.log('❌ ログインボタンが見つかりません');
                            }
                        }

                    } catch (loginError) {
                        console.error('❌ 自動ログイン中にエラーが発生:', loginError);
                        console.log('🔄 手動ログインまたは公開案件のみでスクレイピングを続行します');
                    }

                } else {
                    console.log('ℹ️ 環境変数にログイン情報が設定されていません');
                    console.log('💡 .envファイルにLANCERS_EMAILとLANCERS_PASSWORDを設定すると自動ログインできます');
                    console.log('⏱️ 手動ログイン用に30秒待機します...');

                    // ユーザーが手動でログインできるよう30秒待機
                    await page.waitForTimeout(30000);

                    // ログイン状態を再確認
                    const currentUrl = page.url();
                    const isLoggedIn = !currentUrl.includes('/user/login') && await page.$('.c-header__user-menu, [data-testid="user-menu"]');

                    if (isLoggedIn) {
                        console.log('🎉 ログイン状態を検出しました！全ての案件を取得できます');
                    } else {
                        console.log('ℹ️ 未ログイン状態のため、公開案件のみを取得します');
                    }
                }
            } else {
                console.log('⚠️ ログインページの表示に問題がある可能性があります');
            }

        } catch (error) {
            console.error('⚠️ ログインページのアクセスでエラー:', error);
            console.log('🔄 通常のトップページからスクレイピングを続行します');

            // フォールバック: 通常のトップページにアクセス
            await page.goto('https://www.lancers.jp', { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(2000);
        }

        // 各カテゴリから案件を取得
        for (const category of categories) {
            console.log(`\n🔍 カテゴリ「${category.name}」の処理開始 (最大${category.maxJobs}件)`);

            try {
                const result = await lancersService.scrapeJobsByCategory(category.name, category.maxJobs);

                if (result.jobs.length > 0) {
                    allJobs.push(...result.jobs);
                    console.log(`✅ カテゴリ「${category.name}」: ${result.jobs.length}件取得`);

                    // カテゴリ別にファイル保存
                    const categoryData = {
                        category: category.name,
                        totalCount: result.totalCount,
                        jobs: result.jobs,
                        scrapedAt: new Date().toISOString()
                    };

                    const categoryFilename = `output/lancers-${category.name}.json`;
                    writeFileSync(categoryFilename, JSON.stringify(categoryData, null, 2), 'utf8');
                    console.log(`💾 カテゴリファイル保存: ${categoryFilename}`);

                    // 詳細情報を取得（最初の5件のみ - 負荷軽減）
                    const detailJobs = result.jobs.slice(0, 5);
                    console.log(`📋 詳細情報取得開始: ${detailJobs.length}件`);

                    for (let i = 0; i < detailJobs.length; i++) {
                        const job = detailJobs[i];
                        if (job) {
                            try {
                                console.log(`📝 [${i + 1}/${detailJobs.length}] 詳細取得: ${job.title.substring(0, 30)}...`);
                                const detail = await lancersService.scrapeJobDetail(job.url);
                                allDetails.push(detail);

                                // 詳細取得間の待機時間（長めに設定）
                                if (i < detailJobs.length - 1) {
                                    await page.waitForTimeout(5000);
                                }
                            } catch (error) {
                                console.error(`❌ 詳細取得エラー: ${job.url}`, error);
                                // 詳細取得エラーは続行
                                continue;
                            }
                        }
                    }

                } else {
                    console.log(`⚠️ カテゴリ「${category.name}」: 案件が見つかりませんでした`);
                }

                if (result.errors.length > 0) {
                    console.log(`⚠️ カテゴリ「${category.name}」でエラーが発生:`, result.errors);
                }

                // カテゴリ間の待機時間（長めに設定）
                if (categories.indexOf(category) < categories.length - 1) {
                    console.log('⏱️ 次のカテゴリまで15秒待機...');
                    await page.waitForTimeout(15000);
                }

            } catch (error) {
                console.error(`❌ カテゴリ「${category.name}」処理エラー:`, error);
                // カテゴリエラーは続行
                continue;
            }

        }

        // 全案件をマージして保存
        if (allJobs.length > 0) {
            const allJobsData = {
                totalCount: allJobs.length,
                jobs: allJobs,
                scrapedAt: new Date().toISOString(),
                categories: categories.map(c => c.name),
                source: 'real_scraping'
            };

            const allJobsFilename = 'output/lancers-all-jobs.json';
            writeFileSync(allJobsFilename, JSON.stringify(allJobsData, null, 2), 'utf8');
            console.log(`💾 全案件ファイル保存: ${allJobsFilename}`);
        }

        // 全詳細をマージして保存
        if (allDetails.length > 0) {
            const allDetailsData = {
                totalCount: allDetails.length,
                details: allDetails,
                scrapedAt: new Date().toISOString(),
                categories: categories.map(c => c.name),
                source: 'real_scraping'
            };

            const allDetailsFilename = 'output/lancers-all-details.json';
            writeFileSync(allDetailsFilename, JSON.stringify(allDetailsData, null, 2), 'utf8');
            console.log(`💾 全詳細ファイル保存: ${allDetailsFilename}`);
        }

        const executionTime = Date.now() - startTime;
        console.log(`\n🎉 ランサーズスクレイピング完了!`);
        console.log(`📊 結果統計:`);
        console.log(`  - 総案件数: ${allJobs.length}件`);
        console.log(`  - 詳細取得数: ${allDetails.length}件`);
        console.log(`  - 実行時間: ${Math.round(executionTime / 1000)}秒`);
        console.log(`  - 処理カテゴリ: ${categories.map(c => c.name).join(', ')}`);

        if (allJobs.length === 0) {
            console.log('⚠️ 案件が取得できませんでした。テストデータを生成します...');
            await generateTestData();
        }

    } catch (error) {
        console.error('❌ スクレイピング中にエラーが発生しました:', error);
        console.log('⚠️ テストデータを生成します...');
        await generateTestData();
    } finally {
        await browser.close();
    }
}

/**
 * テストデータを生成（実際のスクレイピングが失敗した場合のフォールバック）
 */
async function generateTestData(): Promise<void> {
    console.log('🔧 テストデータを生成中...');

    const testJobs = [
        {
            id: "lancers_test_001",
            title: "【ランサーズ】Webアプリケーション開発案件",
            description: "ECサイトのリニューアルプロジェクトです。React/Node.jsでの開発経験者を募集します。",
            url: "https://www.lancers.jp/work/detail/4507321",
            budget: { type: "fixed" as const, amount: 500000, currency: "JPY" },
            category: "system",
            tags: ["React", "Node.js", "JavaScript"],
            client: { name: "テストクライアントA", rating: 4.5, reviewCount: 15 },
            postedAt: "2025-01-07",
            applicants: 8,
            scrapedAt: new Date().toISOString()
        },
        {
            id: "lancers_test_002",
            title: "【ランサーズ】モバイルアプリUI/UX改善",
            description: "既存のiOSアプリのUI/UX改善をお願いします。Figmaでのデザイン経験必須。",
            url: "https://www.lancers.jp/work/detail/4507322",
            budget: { type: "fixed" as const, amount: 300000, currency: "JPY" },
            category: "design",
            tags: ["UI/UX", "Figma", "iOS"],
            client: { name: "テストクライアントB", rating: 4.2, reviewCount: 8 },
            postedAt: "2025-01-06",
            applicants: 12,
            scrapedAt: new Date().toISOString()
        },
        {
            id: "lancers_test_003",
            title: "【ランサーズ】WordPress カスタマイズ開発",
            description: "WordPressサイトの機能追加とカスタマイズを行います。PHP、MySQLの知識が必要です。",
            url: "https://www.lancers.jp/work/detail/4507323",
            budget: { type: "hourly" as const, amount: 4000, currency: "JPY" },
            category: "web",
            tags: ["WordPress", "PHP", "MySQL"],
            client: { name: "テストクライアントC", rating: 4.8, reviewCount: 25 },
            postedAt: "2025-01-05",
            applicants: 5,
            scrapedAt: new Date().toISOString()
        }
    ];

    const testJobsData = {
        totalCount: testJobs.length,
        jobs: testJobs,
        scrapedAt: new Date().toISOString(),
        categories: ["system", "web", "app", "design", "writing"],
        source: 'test_data'
    };

    writeFileSync('output/lancers-all-jobs.json', JSON.stringify(testJobsData, null, 2), 'utf8');
    console.log('💾 テスト用案件データを保存しました');
}

// スクリプト実行
if (require.main === module) {
    main().catch(error => {
        console.error('💥 スクリプト実行エラー:', error);
        process.exit(1);
    });
}

export default main; 