import { scrapeCrowdWorksJobsByCategoryWithDetails } from '../lambda/handler';
import dotenv from 'dotenv';

// 環境変数読み込み
dotenv.config();

async function testJobDetails() {
    console.log('🚀 CrowdWorks案件詳細取得テスト開始...');

    try {
        // web_productsカテゴリから案件詳細を取得
        console.log('📊 案件詳細付きスクレイピング実行中...');

        const result = await scrapeCrowdWorksJobsByCategoryWithDetails({
            category: 'web_products',
            maxJobs: 5,      // 案件一覧5件取得
            maxDetails: 2    // そのうち2件の詳細を取得
        });

        console.log(`\n📋 取得結果:`);
        console.log(`📊 案件一覧: ${result.jobs.length}件`);
        console.log(`📄 詳細取得: ${result.jobDetails.length}件`);

        // 案件一覧の情報を表示
        if (result.jobs.length > 0) {
            console.log('\n🔍 === 案件一覧情報 ===');
            result.jobs.forEach((job, index) => {
                console.log(`${index + 1}. ${job.title}`);
                console.log(`   💰 予算: ${job.budget}`);
                console.log(`   🏢 クライアント: ${job.client.name}`);
                console.log(`   🔗 URL: ${job.url}`);
                console.log('');
            });
        }

        // 案件詳細情報を表示
        if (result.jobDetails.length > 0) {
            console.log('\n📄 === 案件詳細情報 ===');
            result.jobDetails.forEach((detail, index) => {
                console.log(`\n${index + 1}. ${detail.title}`);
                console.log(`📊 案件ID: ${detail.jobId}`);
                console.log(`🏷️ カテゴリ: ${detail.category}`);
                console.log(`💰 支払い: ${detail.paymentType}`);
                console.log(`💵 予算: ${detail.budget}`);
                console.log(`📅 掲載日: ${detail.postDate}`);
                console.log(`⏰ 納期: ${detail.deliveryDate}`);
                console.log(`📬 応募期限: ${detail.applicationDeadline}`);

                console.log(`\n👥 応募状況:`);
                console.log(`   - 応募者: ${detail.applicantCount}人`);
                console.log(`   - 契約済み: ${detail.contractCount}人`);
                console.log(`   - 募集人数: ${detail.recruitmentCount}人`);
                console.log(`   - 気になる: ${detail.favoriteCount}人`);

                console.log(`\n🏢 クライアント情報:`);
                console.log(`   - 名前: ${detail.client.name}`);
                console.log(`   - 評価: ${detail.client.overallRating}`);
                console.log(`   - 実績: ${detail.client.orderHistory}`);
                console.log(`   - 完了率: ${detail.client.completionRate}`);
                console.log(`   - 本人確認: ${detail.client.identityVerified ? '済み' : '未確認'}`);

                if (detail.recentApplicants.length > 0) {
                    console.log(`\n👤 最近の応募者:`);
                    detail.recentApplicants.slice(0, 3).forEach((applicant, i) => {
                        console.log(`   ${i + 1}. ${applicant.name} (${applicant.applicationDate})`);
                    });
                }

                console.log(`\n📝 仕事内容: ${detail.detailedDescription.substring(0, 200)}...`);
                console.log('─'.repeat(50));
            });
        }

        console.log('\n✅ 案件詳細取得テスト完了！');

    } catch (error) {
        console.error('❌ 案件詳細取得エラー:', error);
        process.exit(1);
    }
}

// テスト実行
if (require.main === module) {
    testJobDetails().catch((error) => {
        console.error('❌ メイン処理でエラーが発生しました:', error);
        process.exit(1);
    });
} 