/**
 * CrowdWorksスクレイピング動作確認テスト
 * ローカル環境でPlaywrightとCrowdWorksアクセスをテスト
 */

import { chromium } from 'playwright';

async function testCrowdWorksAccess() {
    console.log('🚀 CrowdWorksアクセステスト開始...');

    const browser = await chromium.launch({
        headless: false, // ローカルテスト用に表示
        slowMo: 1000     // 動作を見やすくするためスロー実行
    });

    try {
        const page = await browser.newPage();

        // CrowdWorksトップページにアクセス
        console.log('📄 CrowdWorksアクセス中...');
        await page.goto('https://crowdworks.jp/public/jobs', {
            waitUntil: 'networkidle',
            timeout: 30000
        });

        console.log('✅ ページ読み込み完了');
        console.log(`📋 タイトル: ${await page.title()}`);

        // ページのスクリーンショット
        await page.screenshot({ path: 'crowdworks-test.png', fullPage: true });
        console.log('📸 スクリーンショット保存: crowdworks-test.png');

        // ページの基本構造を確認
        await page.waitForTimeout(3000); // 3秒待機

        // セレクターの存在確認
        const selectors = [
            '.search_result',
            '.project_row',
            '.project_title',
            '.project_budget',
            '.project_category',
            '.client_info'
        ];

        console.log('🔍 セレクター存在確認:');
        for (const selector of selectors) {
            const exists = await page.$(selector) !== null;
            console.log(`   ${selector}: ${exists ? '✅' : '❌'}`);
        }

        // 実際に案件要素を取得してみる
        const jobElements = await page.$$('.project_row, .job_item, [data-job-id]');
        console.log(`📊 発見した案件要素数: ${jobElements.length}`);

        if (jobElements.length > 0) {
            console.log('📝 最初の案件要素を詳しく調査...');
            const firstJob = jobElements[0];

            if (firstJob) {
                // 要素のクラス名とテキストを確認
                const jobInfo = await firstJob.evaluate((el) => {
                    return {
                        className: el.className,
                        innerHTML: el.innerHTML.slice(0, 500) + '...',
                        textContent: el.textContent?.slice(0, 200) + '...'
                    };
                });

                console.log('🔍 最初の案件要素情報:');
                console.log(`   クラス名: ${jobInfo.className}`);
                console.log(`   テキスト: ${jobInfo.textContent}`);
            }
        }

        // ページの全体構造も確認
        const pageStructure = await page.evaluate(() => {
            const main = (globalThis as any).document.querySelector('main, .main, #main, .content');
            if (main) {
                const children = Array.from(main.children).map((child: any) => ({
                    tagName: child.tagName,
                    className: child.className,
                    id: child.id
                }));
                return children.slice(0, 10); // 最初の10要素
            }
            return [];
        });

        console.log('🏗️ ページメイン構造:');
        pageStructure.forEach((element, index) => {
            console.log(`   ${index + 1}. <${element.tagName}> class="${element.className}" id="${element.id}"`);
        });

    } catch (error) {
        console.error('❌ テストエラー:', error);
    } finally {
        await browser.close();
        console.log('🔒 ブラウザクローズ完了');
    }
}

// テスト実行
if (require.main === module) {
    testCrowdWorksAccess()
        .then(() => console.log('🎉 テスト完了'))
        .catch(error => console.error('💥 テスト失敗:', error));
} 