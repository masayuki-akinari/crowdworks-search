import { chromium, Page } from 'playwright';
import dotenv from 'dotenv';
import fs from 'fs';

// 環境変数読み込み
dotenv.config();

// screenshotsディレクトリを作成
if (!fs.existsSync('screenshots')) {
    fs.mkdirSync('screenshots');
}

// 環境変数から認証情報を取得
async function getCrowdWorksCredentials() {
    const email = process.env['CROWDWORKS_EMAIL'];
    const password = process.env['CROWDWORKS_PASSWORD'];

    if (!email || !password) {
        throw new Error('CROWDWORKS_EMAIL and CROWDWORKS_PASSWORD environment variables are required');
    }

    return { email, password };
}

// CrowdWorksにログイン
async function loginToCrowdWorks(page: Page, credentials: { email: string; password: string }) {
    const startTime = Date.now();

    try {
        console.log('🔐 CrowdWorksログイン開始...');
        console.log(`📧 使用メールアドレス: ${credentials.email}`);

        // CrowdWorksのログインページにアクセス
        await page.goto('https://crowdworks.jp/login', { waitUntil: 'domcontentloaded' });

        // ログインフォームの要素を待機
        console.log('⏳ ログインフォーム要素を待機中...');
        await page.waitForSelector('input[name="email"], [role="textbox"][aria-label*="メール"], textbox', {
            timeout: 10000
        });

        // メールアドレス入力（MCPテストで確認したPlaywright方式）
        console.log('📧 メールアドレス入力中...');
        try {
            // getByRole方式（MCPで確認した方法）
            await page.getByRole('textbox', { name: 'メールアドレス' }).fill(credentials.email);
            console.log('✅ メールアドレス入力完了（getByRole方式）');
        } catch (roleError) {
            // フォールバック：従来のセレクター方式
            console.log('⚠️ getByRole失敗、セレクター方式でリトライ...');
            const emailSelector = 'input[name="email"], input[type="email"], textbox[name*="email"]';
            await page.fill(emailSelector, credentials.email);
            console.log('✅ メールアドレス入力完了（セレクター方式）');
        }

        await page.waitForTimeout(1000);

        // パスワード入力（MCPテストで確認した方式）
        console.log('🔑 パスワード入力中...');
        try {
            // getByRole方式（MCPで確認した方法）
            await page.getByRole('textbox', { name: 'パスワード' }).fill(credentials.password);
            console.log('✅ パスワード入力完了（getByRole方式）');
        } catch (roleError) {
            // フォールバック：従来のセレクター方式
            console.log('⚠️ getByRole失敗、セレクター方式でリトライ...');
            const passwordSelector = 'input[name="password"], input[type="password"]';
            await page.fill(passwordSelector, credentials.password);
            console.log('✅ パスワード入力完了（セレクター方式）');
        }

        await page.waitForTimeout(1000);

        // ログインボタンをクリック（MCPテストで確認した方式）
        console.log('🖱️ ログインボタンクリック中...');
        try {
            // getByRole方式（MCPで確認した方法）
            await page.getByRole('button', { name: 'ログイン', exact: true }).click();
            console.log('✅ ログインボタンクリック完了（getByRole方式）');
        } catch (roleError) {
            // フォールバック：従来のセレクター方式
            console.log('⚠️ getByRole失敗、セレクター方式でリトライ...');
            const loginButtonSelector = 'input[type="submit"], button[type="submit"], button:has-text("ログイン")';
            await page.click(loginButtonSelector);
            console.log('✅ ログインボタンクリック完了（セレクター方式）');
        }

        // ログイン完了まで待機
        await page.waitForTimeout(5000);

        // ログイン成功確認（URLチェック）
        const currentUrl = page.url();
        const isLoggedIn = !currentUrl.includes('/login');

        const executionTime = Date.now() - startTime;

        if (isLoggedIn) {
            console.log(`✅ CrowdWorksログイン成功 (${executionTime}ms)`);
            console.log(`🌐 現在のURL: ${currentUrl}`);
        } else {
            console.log(`❌ CrowdWorksログイン失敗 (${executionTime}ms)`);
            console.log(`🌐 現在のURL: ${currentUrl}`);
        }

        return {
            success: isLoggedIn,
            isLoggedIn,
            executionTime
        };

    } catch (error) {
        const executionTime = Date.now() - startTime;
        console.error('❌ ログインエラー:', error);

        return {
            success: false,
            isLoggedIn: false,
            error: error instanceof Error ? error.message : String(error),
            executionTime
        };
    }
}

async function main() {
    try {
        console.log('🚀 CrowdWorks案件詳細取得テスト開始...');

        // 認証情報取得
        const credentials = await getCrowdWorksCredentials();
        console.log(`📧 使用メールアドレス: ${credentials.email}`);

        // Playwrightブラウザを起動してテスト
        const browser = await chromium.launch({
            headless: false,  // 視覚的にテスト確認
            devtools: false,
            args: ['--start-maximized']
        });

        try {
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                viewport: { width: 1920, height: 1080 },
                locale: 'ja-JP',
                timezoneId: 'Asia/Tokyo',
            });

            const page = await context.newPage();

            // CrowdWorksにログイン
            const loginResult = await loginToCrowdWorks(page, credentials);
            if (!loginResult.success) {
                throw new Error(`ログイン失敗: ${loginResult.error}`);
            }

            // 新着順案件一覧ページにアクセス
            console.log('\n📋 案件一覧ページアクセス...');
            await page.goto('https://crowdworks.jp/public/jobs/group/web_products?order=new', {
                waitUntil: 'networkidle'
            });
            await page.waitForTimeout(3000);

            // 案件一覧のスクリーンショット
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            await page.screenshot({
                path: `screenshots/job-list-${timestamp}.png`,
                fullPage: true
            });
            console.log(`📸 案件一覧スクリーンショット保存: screenshots/job-list-${timestamp}.png`);

            // 最初の案件のリンクを取得
            const firstJobUrl = await page.evaluate(() => {
                const jobLinks = (globalThis as any).document.querySelectorAll('a[href*="/public/jobs/"]');
                for (const link of jobLinks) {
                    const href = link.getAttribute('href');
                    if (href && href.match(/\/public\/jobs\/\d+$/)) {
                        return href.startsWith('http') ? href : `https://crowdworks.jp${href}`;
                    }
                }
                return null;
            });

            if (!firstJobUrl) {
                throw new Error('案件リンクが見つかりませんでした');
            }

            console.log(`📄 最初の案件詳細ページにアクセス: ${firstJobUrl}`);

            // 案件詳細ページにアクセス
            await page.goto(firstJobUrl, { waitUntil: 'networkidle' });
            await page.waitForTimeout(3000);

            // 詳細情報を抽出（MCPで確認した構造に基づく）
            const jobDetail = await page.evaluate(() => {
                // 基本情報
                const titleElement = (globalThis as any).document.querySelector('h1');
                const fullTitle = titleElement?.textContent?.trim() || '';
                const title = fullTitle.replace(/\s+(ウェブデザイン|アンケート|その他).*の仕事の依頼.*$/, '').trim();

                // 概要テーブル情報
                const tables = (globalThis as any).document.querySelectorAll('table');
                let paymentInfo = '';
                let postDate = '';
                let deadline = '';
                let applicantCount = 0;
                let contractCount = 0;
                let recruitmentCount = 0;
                let favoriteCount = 0;

                tables.forEach((table: any) => {
                    const rows = table.querySelectorAll('tr');
                    rows.forEach((row: any) => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 2) {
                            const label = cells[0]?.textContent?.trim() || '';
                            const value = cells[1]?.textContent?.trim() || '';

                            if (label.includes('固定報酬制') || label.includes('時間単価制')) {
                                paymentInfo = `${label}: ${value}`;
                            } else if (label.includes('掲載日')) {
                                postDate = value;
                            } else if (label.includes('応募期限')) {
                                deadline = value;
                            } else if (label.includes('応募した人')) {
                                applicantCount = parseInt(value.replace(/[^\d]/g, '')) || 0;
                            } else if (label.includes('契約した人')) {
                                contractCount = parseInt(value.replace(/[^\d]/g, '')) || 0;
                            } else if (label.includes('募集人数')) {
                                recruitmentCount = parseInt(value.replace(/[^\d]/g, '')) || 0;
                            } else if (label.includes('気になる')) {
                                favoriteCount = parseInt(value.replace(/[^\d]/g, '')) || 0;
                            }
                        }
                    });
                });

                // クライアント情報
                const clientElement = (globalThis as any).document.querySelector('a[href*="/public/employers/"]');
                const clientName = clientElement?.textContent?.trim() || '匿名';

                // 評価情報
                let rating = '';
                const ratingElements = (globalThis as any).document.querySelectorAll('dd, definition');
                ratingElements.forEach((el: any) => {
                    const text = el?.textContent?.trim() || '';
                    if (text.includes('.') && text.length < 5 && !rating) {
                        rating = text;
                    }
                });

                // 詳細説明（最も長いテーブルセル）
                let description = '';
                let maxLength = 0;
                const descCells = (globalThis as any).document.querySelectorAll('td');
                descCells.forEach((cell: any) => {
                    const text = cell?.textContent?.trim() || '';
                    if (text.length > maxLength && text.length > 100) {
                        description = text;
                        maxLength = text.length;
                    }
                });

                // 応募者情報
                const applicantRows = (globalThis as any).document.querySelectorAll('tbody tr');
                const recentApplicants: string[] = [];
                applicantRows.forEach((row: any) => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 2) {
                        const nameElement = cells[0]?.querySelector('a');
                        if (nameElement) {
                            const name = nameElement?.textContent?.trim() || '';
                            const applicationDate = cells[1]?.textContent?.trim() || '';
                            if (name && applicationDate.includes('/')) {
                                recentApplicants.push(`${name} (${applicationDate})`);
                            }
                        }
                    }
                });

                return {
                    title,
                    paymentInfo,
                    postDate,
                    deadline,
                    applicantCount,
                    contractCount,
                    recruitmentCount,
                    favoriteCount,
                    clientName,
                    rating,
                    description: description.length > 500 ? description.substring(0, 500) + '...' : description,
                    recentApplicants: recentApplicants.slice(0, 5)
                };
            });

            // 詳細情報表示
            console.log('\n📊 === 抽出された案件詳細情報 ===');
            console.log(`🏷️ タイトル: ${jobDetail.title}`);
            console.log(`💰 支払い情報: ${jobDetail.paymentInfo}`);
            console.log(`📅 掲載日: ${jobDetail.postDate}`);
            console.log(`⏰ 応募期限: ${jobDetail.deadline}`);
            console.log(`👥 応募者数: ${jobDetail.applicantCount}人`);
            console.log(`🤝 契約済み: ${jobDetail.contractCount}人`);
            console.log(`📢 募集人数: ${jobDetail.recruitmentCount}人`);
            console.log(`⭐ 気になる: ${jobDetail.favoriteCount}人`);
            console.log(`🏢 クライアント: ${jobDetail.clientName}`);
            console.log(`⭐ 評価: ${jobDetail.rating}`);
            console.log(`📝 概要: ${jobDetail.description}`);

            if (jobDetail.recentApplicants.length > 0) {
                console.log('👥 最近の応募者:');
                jobDetail.recentApplicants.forEach((applicant, index) => {
                    console.log(`   ${index + 1}. ${applicant}`);
                });
            }

            // 案件詳細ページのスクリーンショット保存
            const detailTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const screenshotPath = `screenshots/job-detail-${detailTimestamp}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`📸 案件詳細スクリーンショット保存: ${screenshotPath}`);

            await context.close();

        } finally {
            await browser.close();
        }

        console.log('\n✅ 案件詳細取得テスト完了！');
        console.log('🎯 MCPブラウザで確認した構造に基づく案件詳細抽出機能が正常に動作しました');

    } catch (error) {
        console.error('❌ メイン処理でエラーが発生しました:', error);
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