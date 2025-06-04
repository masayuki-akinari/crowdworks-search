import { chromium } from 'playwright';
import dotenv from 'dotenv';

// 環境変数読み込み
dotenv.config();

async function testDirectJobDetail() {
    console.log('🚀 CrowdWorks案件詳細直接取得テスト開始...');

    const browser = await chromium.launch({
        headless: false,
        devtools: false,
        args: ['--start-maximized']
    });

    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            viewport: { width: 1920, height: 1080 },
        });

        const page = await context.newPage();

        // 実際の案件詳細ページに直接アクセス
        // 注意：実際の案件IDを使用（public案件のため問題なし）
        const jobUrl = 'https://crowdworks.jp/public/jobs/12131254'; // MCPテストで使用した案件ID

        console.log(`📄 案件詳細ページアクセス: ${jobUrl}`);
        await page.goto(jobUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await page.waitForTimeout(3000);

        // ページタイトル確認
        const title = await page.title();
        console.log(`📋 ページタイトル: "${title}"`);

        // MCPで確認した構造に基づいて詳細情報を抽出
        const jobDetail = await page.evaluate(() => {
            // タイトル取得
            const titleElement = (globalThis as any).document.querySelector('h1');
            const fullTitle = titleElement?.textContent?.trim() || '';
            const cleanTitle = fullTitle.replace(/\s+(ウェブデザイン|アンケート|その他).*の仕事の依頼.*$/, '').trim();

            // テーブル情報を抽出
            const tables = (globalThis as any).document.querySelectorAll('table');
            let paymentInfo = '';
            let budget = '';
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
                            paymentInfo = label;
                            budget = value;
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

            // 詳細説明（最長のテーブルセル）
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

            return {
                title: cleanTitle,
                paymentInfo,
                budget,
                postDate,
                deadline,
                applicantCount,
                contractCount,
                recruitmentCount,
                favoriteCount,
                clientName,
                rating,
                description: description.length > 500 ? description.substring(0, 500) + '...' : description
            };
        });

        // 結果表示
        console.log('\n📊 === 抽出された案件詳細情報 ===');
        console.log(`🏷️ タイトル: ${jobDetail.title}`);
        console.log(`💰 支払い形式: ${jobDetail.paymentInfo}`);
        console.log(`💵 予算: ${jobDetail.budget}`);
        console.log(`📅 掲載日: ${jobDetail.postDate}`);
        console.log(`⏰ 応募期限: ${jobDetail.deadline}`);
        console.log(`\n👥 応募状況:`);
        console.log(`   - 応募者: ${jobDetail.applicantCount}人`);
        console.log(`   - 契約済み: ${jobDetail.contractCount}人`);
        console.log(`   - 募集人数: ${jobDetail.recruitmentCount}人`);
        console.log(`   - 気になる: ${jobDetail.favoriteCount}人`);
        console.log(`\n🏢 クライアント情報:`);
        console.log(`   - 名前: ${jobDetail.clientName}`);
        console.log(`   - 評価: ${jobDetail.rating}`);
        console.log(`\n📝 仕事内容:`);
        console.log(`${jobDetail.description}`);

        console.log('\n⏱️ 10秒待機してからブラウザを閉じます...');
        await page.waitForTimeout(10000);

        await context.close();

    } finally {
        await browser.close();
        console.log('🔒 ブラウザクリーンアップ完了');
    }

    console.log('✅ 案件詳細直接取得テスト完了！');
}

// テスト実行
if (require.main === module) {
    testDirectJobDetail().catch((error) => {
        console.error('❌ テストエラー:', error);
        process.exit(1);
    });
} 