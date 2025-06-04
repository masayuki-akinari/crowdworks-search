import { chromium } from 'playwright';
import dotenv from 'dotenv';

// 環境変数読み込み
dotenv.config();

async function testNewJobDetail() {
    console.log('🚀 CrowdWorks最新案件詳細取得テスト開始...');

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
        const jobUrl = 'https://crowdworks.jp/public/jobs/12131254';

        console.log(`📄 案件詳細ページアクセス: ${jobUrl}`);
        await page.goto(jobUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await page.waitForTimeout(3000);

        // ページタイトル確認
        const title = await page.title();
        console.log(`📋 ページタイトル: "${title}"`);

        // 新しい構造に基づいた詳細情報抽出
        const jobDetail = await page.evaluate(() => {
            const doc = (globalThis as any).document;

            // 案件タイトル - h1の最初の部分のみ取得
            const titleElement = doc.querySelector('h1');
            const fullTitle = titleElement?.textContent?.trim() || '';
            const title = fullTitle.split('の仕事の依頼')[0]?.trim() || fullTitle;

            // 案件ID
            const jobId = (globalThis as any).window.location.pathname.match(/\/(\d+)$/)?.[1] || '';

            // カテゴリ - 正確なリンクから取得
            const categoryLink = doc.querySelector('a[href*="/public/jobs/category/"]');
            const category = categoryLink?.textContent?.trim() || '';

            // テーブル情報を行ベースで取得
            const tableRows = doc.querySelectorAll('table tr');
            let paymentType = '';
            let budget = '';
            let deliveryDate = '';
            let postDate = '';
            let applicationDeadline = '';
            let applicantCount = 0;
            let contractCount = 0;
            let recruitmentCount = 0;
            let favoriteCount = 0;

            tableRows.forEach((row: any) => {
                const cells = row.querySelectorAll('td');
                if (cells.length === 2) {
                    const label = cells[0]?.textContent?.trim() || '';
                    const value = cells[1]?.textContent?.trim() || '';

                    // 仕事の概要情報
                    if (label === '固定報酬制') {
                        paymentType = '固定報酬制';
                        budget = value;
                    } else if (label === '時間単価制') {
                        paymentType = '時間単価制';
                        budget = value;
                    } else if (label === '納品希望日') {
                        deliveryDate = value === '-' ? '' : value;
                    } else if (label === '掲載日') {
                        postDate = value;
                    } else if (label === '応募期限') {
                        applicationDeadline = value;
                    }
                    // 応募状況情報
                    else if (label === '応募した人') {
                        applicantCount = parseInt(value.replace(/[^\d]/g, '')) || 0;
                    } else if (label === '契約した人') {
                        contractCount = parseInt(value.replace(/[^\d]/g, '')) || 0;
                    } else if (label === '募集人数') {
                        recruitmentCount = parseInt(value.replace(/[^\d]/g, '')) || 0;
                    } else if (label === '気になる！リスト') {
                        favoriteCount = parseInt(value.replace(/[^\d]/g, '')) || 0;
                    }
                }
            });

            // クライアント情報
            const clientLink = doc.querySelector('a[href*="/public/employers/"]');
            const clientName = clientLink?.textContent?.trim() || '匿名';
            const clientUrl = clientLink?.getAttribute('href') || '';

            // 評価情報 - definition要素から
            let overallRating = '';
            let orderHistory = '';
            let completionRate = '';

            const definitions = doc.querySelectorAll('definition');
            definitions.forEach((def: any) => {
                const text = def.textContent?.trim() || '';
                if (text.match(/^\d+\.\d+$/)) {
                    overallRating = text;
                } else if (text.match(/^\d+$/) && text.length <= 2) {
                    if (!orderHistory) orderHistory = text;
                    else if (!completionRate) completionRate = text;
                }
            });

            // 本人確認状況
            const pageText = doc.body?.textContent || '';
            const identityVerified = !pageText.includes('本人確認未提出');

            // 詳細説明 - 最も長いテーブルセルから取得
            let detailedDescription = '';
            let maxLength = 0;
            const allCells = doc.querySelectorAll('td');
            allCells.forEach((cell: any) => {
                const text = cell.textContent?.trim() || '';
                if (text.length > maxLength && text.length > 100) {
                    detailedDescription = text;
                    maxLength = text.length;
                }
            });

            // 最近の応募者
            const recentApplicants: Array<{
                name: string;
                applicationDate: string;
            }> = [];

            // 最後のテーブルから応募者を取得
            const tables = doc.querySelectorAll('table');
            if (tables.length > 0) {
                const lastTable = tables[tables.length - 1];
                const applicantRows = lastTable.querySelectorAll('tbody tr');

                applicantRows.forEach((row: any) => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 2) {
                        const nameCell = cells[0];
                        const dateCell = cells[1];

                        const nameLink = nameCell.querySelector('a');
                        const name = nameLink?.textContent?.trim() || nameCell.textContent?.trim() || '';
                        const applicationDate = dateCell.textContent?.trim() || '';

                        if (name && applicationDate && applicationDate.includes('/') && !name.includes('クラウドワーカー')) {
                            recentApplicants.push({ name, applicationDate });
                        }
                    }
                });
            }

            return {
                jobId,
                title,
                category,
                paymentType,
                budget,
                postDate,
                deliveryDate,
                applicationDeadline,
                applicantCount,
                contractCount,
                recruitmentCount,
                favoriteCount,
                clientName,
                clientUrl: clientUrl ? `https://crowdworks.jp${clientUrl}` : '',
                overallRating,
                orderHistory: orderHistory ? orderHistory + '件' : '',
                completionRate: completionRate ? completionRate + '%' : '',
                identityVerified,
                detailedDescription: detailedDescription.length > 500 ?
                    detailedDescription.substring(0, 500) + '...' : detailedDescription,
                recentApplicants
            };
        });

        // 結果表示
        console.log('\n📊 === 新構造での抽出結果 ===');
        console.log(`🆔 案件ID: ${jobDetail.jobId}`);
        console.log(`🏷️ タイトル: ${jobDetail.title}`);
        console.log(`📂 カテゴリ: ${jobDetail.category}`);
        console.log(`💰 支払い: ${jobDetail.paymentType}`);
        console.log(`💵 予算: ${jobDetail.budget}`);
        console.log(`📅 掲載日: ${jobDetail.postDate}`);
        console.log(`⏰ 納期: ${jobDetail.deliveryDate}`);
        console.log(`📬 応募期限: ${jobDetail.applicationDeadline}`);

        console.log(`\n👥 応募状況:`);
        console.log(`   - 応募者: ${jobDetail.applicantCount}人`);
        console.log(`   - 契約済み: ${jobDetail.contractCount}人`);
        console.log(`   - 募集人数: ${jobDetail.recruitmentCount}人`);
        console.log(`   - 気になる: ${jobDetail.favoriteCount}人`);

        console.log(`\n🏢 クライアント:`);
        console.log(`   - 名前: ${jobDetail.clientName}`);
        console.log(`   - URL: ${jobDetail.clientUrl}`);
        console.log(`   - 評価: ${jobDetail.overallRating}`);
        console.log(`   - 実績: ${jobDetail.orderHistory}`);
        console.log(`   - 完了率: ${jobDetail.completionRate}`);
        console.log(`   - 本人確認: ${jobDetail.identityVerified ? '済み' : '未確認'}`);

        if (jobDetail.recentApplicants.length > 0) {
            console.log(`\n👤 最近の応募者 (${jobDetail.recentApplicants.length}人):`);
            jobDetail.recentApplicants.slice(0, 5).forEach((applicant, i) => {
                console.log(`   ${i + 1}. ${applicant.name} (${applicant.applicationDate})`);
            });
        }

        console.log(`\n📝 仕事内容: ${jobDetail.detailedDescription.substring(0, 300)}...`);

        console.log('\n⏱️ 5秒待機してからブラウザを閉じます...');
        await page.waitForTimeout(5000);

        await context.close();

    } finally {
        await browser.close();
        console.log('🔒 ブラウザクリーンアップ完了');
    }

    console.log('✅ 新構造案件詳細取得テスト完了！');
}

// テスト実行
if (require.main === module) {
    testNewJobDetail().catch((error) => {
        console.error('❌ テストエラー:', error);
        process.exit(1);
    });
} 