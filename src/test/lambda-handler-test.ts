import { testCrowdWorksLogin, testCrowdWorksScraping, testCrowdWorksCategories } from '../lambda/handler';
import dotenv from 'dotenv';

// 環境変数読み込み
dotenv.config();

async function main() {
    console.log('🚀 CrowdWorks Lambda Handler 機能テスト開始...');

    try {
        // Phase 1: ログインテスト
        console.log('\n🔐 === Phase 1: CrowdWorksログインテスト ===');
        const loginTest = await testCrowdWorksLogin();

        if (loginTest.success && loginTest.loginResult?.isLoggedIn) {
            console.log('✅ ログインテスト成功！');
        } else {
            console.log('❌ ログインテスト失敗:', loginTest.error);
            console.log('スクレイピングテストをスキップします。');
            return;
        }

        // Phase 2: 案件スクレイピングテスト
        console.log('\n📊 === Phase 2: 案件スクレイピングテスト ===');
        const scrapingTest = await testCrowdWorksScraping();

        if (scrapingTest.success && scrapingTest.scrapingResult) {
            console.log(`✅ スクレイピングテスト成功！ ${scrapingTest.scrapingResult.jobsFound}件の案件を取得`);

            // サンプル案件情報を表示
            if (scrapingTest.scrapingResult.jobs.length > 0) {
                const sampleJob = scrapingTest.scrapingResult.jobs[0];
                if (sampleJob) {
                    console.log('\n📋 サンプル案件情報:');
                    console.log(`  🏷️ タイトル: ${sampleJob.title}`);
                    console.log(`  💰 予算: ${sampleJob.budget}`);
                    console.log(`  🏢 クライアント: ${sampleJob.client.name}`);
                    console.log(`  🔗 URL: ${sampleJob.url}`);
                    console.log(`  📅 掲載日: ${sampleJob.postedAt}`);
                }
            }
        } else {
            console.log('❌ スクレイピングテスト失敗:', scrapingTest.error);
        }

        // Phase 3: カテゴリ別スクレイピングテスト
        console.log('\n🎯 === Phase 3: カテゴリ別スクレイピングテスト ===');
        const categoryTest = await testCrowdWorksCategories();

        if (categoryTest.success && categoryTest.results) {
            console.log('✅ カテゴリ別テスト成功！');

            Object.entries(categoryTest.results).forEach(([category, result]) => {
                console.log(`  📂 ${category}: ${result.success ? '✅' : '❌'} (${result.jobsFound}件)`);
            });
        } else {
            console.log('❌ カテゴリ別テスト失敗:', categoryTest.error);
        }

        console.log('\n🎉 === 全テスト完了 ===');

    } catch (error) {
        console.error('❌ テスト実行中にエラーが発生しました:', error);
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