require('dotenv').config();

import {
    IntegratedJobSearchService,
    CurrencyService
} from '../src/services/index';
import {
    UpworkCredentials,
    IntegratedSearchConfig,
    IntegratedJobReport
} from '../src/types/index';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import * as path from 'path';

/**
 * 統合ジョブサーチスクリプト
 * CrowdWorksとUpworkから高時給案件を検索してレポート生成
 */

// 出力ディレクトリの確保
const outputDir = 'output';
if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
}

// 環境変数から設定を取得
function getUpworkCredentials(): UpworkCredentials {
    const consumerKey = process.env['UPWORK_CONSUMER_KEY'];
    const consumerSecret = process.env['UPWORK_CONSUMER_SECRET'];
    const accessToken = process.env['UPWORK_ACCESS_TOKEN'];
    const accessTokenSecret = process.env['UPWORK_ACCESS_TOKEN_SECRET'];

    if (!consumerKey || !consumerSecret) {
        throw new Error('Upwork認証情報が不足しています。UPWORK_CONSUMER_KEY, UPWORK_CONSUMER_SECRETを設定してください。');
    }

    const credentials: UpworkCredentials = {
        consumerKey,
        consumerSecret
    };

    if (accessToken) {
        credentials.accessToken = accessToken;
    }

    if (accessTokenSecret) {
        credentials.accessTokenSecret = accessTokenSecret;
    }

    return credentials;
}

// デフォルト統合検索設定
function createDefaultSearchConfig(): IntegratedSearchConfig {
    return {
        enabled: {
            crowdworks: true,
            upwork: true
        },
        limits: {
            maxJobsPerSource: 50,
            maxExecutionTime: 300 // 5分
        },
        filtering: {
            minHourlyRateJPY: 3000, // 最低時給3000円
            minBudgetJPY: 50000, // 最低予算5万円
            excludeKeywords: ['テスト', 'アンケート', '単純作業'],
            requiredSkills: []
        },
        currency: {
            exchangeRateUSDToJPY: 150, // USD→JPY換算レート
            lastUpdated: new Date()
        }
    };
}

/**
 * メイン実行関数
 */
async function executeIntegratedJobSearch(options: {
    minHourlyRate?: number;
    maxJobsPerSource?: number;
    categories?: string[];
    keywords?: string[];
    outputFormat?: 'json' | 'markdown' | 'both';
}): Promise<void> {
    console.log('🚀 統合ジョブサーチを開始します...');
    console.log(`📊 設定: 最低時給${options.minHourlyRate || 3000}円, 最大取得件数${options.maxJobsPerSource || 50}件/サイト`);

    const startTime = Date.now();

    try {
        // 認証情報とサービス初期化
        console.log('🔐 Upwork認証情報を取得中...');
        const upworkCredentials = getUpworkCredentials();

        console.log('⚙️ 検索設定を初期化中...');
        const searchConfig = createDefaultSearchConfig();

        // カスタム設定の適用
        if (options.minHourlyRate) {
            searchConfig.filtering.minHourlyRateJPY = options.minHourlyRate;
        }
        if (options.maxJobsPerSource) {
            searchConfig.limits.maxJobsPerSource = options.maxJobsPerSource;
        }

        // 統合サービスの初期化
        const integratedService = new IntegratedJobSearchService(
            upworkCredentials,
            searchConfig
        );

        console.log('🔍 統合案件検索を実行中...');

        console.log('📝 検索結果レポートを生成中...');

        // レポート生成
        const reportParams = {
            minHourlyRate: options.minHourlyRate || 3000,
            categories: options.categories || [],
            maxJobsPerSource: options.maxJobsPerSource || 50
        };

        const report = await integratedService.generateReport(reportParams);

        // 結果の出力
        await saveResults(report, options.outputFormat || 'both');

        // 実行サマリーの表示
        displaySummary(report, Date.now() - startTime);

    } catch (error) {
        console.error('❌ 統合ジョブサーチでエラーが発生しました:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

/**
 * 結果の保存
 */
async function saveResults(
    report: IntegratedJobReport,
    format: 'json' | 'markdown' | 'both'
): Promise<void> {
    const timestamp = new Date().toISOString().split('T')[0];
    const baseFilename = `integrated-job-report-${timestamp}`;

    if (format === 'json' || format === 'both') {
        const jsonPath = path.join(outputDir, `${baseFilename}.json`);
        writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
        console.log(`💾 JSON レポートを保存: ${jsonPath}`);
    }

    if (format === 'markdown' || format === 'both') {
        const markdownPath = path.join(outputDir, `${baseFilename}.md`);
        const markdownContent = generateMarkdownReport(report);
        writeFileSync(markdownPath, markdownContent, 'utf8');
        console.log(`📄 Markdown レポートを保存: ${markdownPath}`);
    }

    // 高時給案件の詳細レポート
    if (report.highValueJobs.upwork.length > 0 || report.highValueJobs.crowdworks.length > 0) {
        const highValuePath = path.join(outputDir, `high-value-jobs-${timestamp}.md`);
        const highValueContent = generateHighValueJobsReport(report);
        writeFileSync(highValuePath, highValueContent, 'utf8');
        console.log(`💰 高時給案件詳細レポートを保存: ${highValuePath}`);
    }
}

/**
 * Markdownレポート生成
 */
function generateMarkdownReport(report: IntegratedJobReport): string {
    const date = report.generatedAt.toLocaleDateString('ja-JP');
    const time = report.generatedAt.toLocaleTimeString('ja-JP');

    return `# 統合ジョブサーチレポート

> **生成日時**: ${date} ${time}  
> **レポートID**: ${report.id}  

## 📊 検索サマリー

| 項目 | CrowdWorks | Upwork | 合計 |
|------|------------|--------|------|
| 取得案件数 | ${report.results.crowdworks.total} | ${report.results.upwork.total} | ${report.results.summary.totalJobs} |
| 高時給案件数 | - | ${report.highValueJobs.upwork.length} | ${report.results.summary.highHourlyJobs} |
| 検索成功 | ${report.results.crowdworks.success ? '✅' : '❌'} | ${report.results.upwork.success ? '✅' : '❌'} | - |
| 実行時間 | ${report.results.crowdworks.executionTime}ms | ${report.results.upwork.executionTime}ms | ${report.results.summary.executionTime}ms |

## 🎯 検索条件

- **最低時給**: ${report.criteria.minHourlyRate.toLocaleString()}円
- **最大取得件数**: ${report.criteria.maxJobsPerSource}件/サイト
- **対象カテゴリ**: ${report.criteria.categories.length > 0 ? report.criteria.categories.join(', ') : '全カテゴリ'}

## 📈 市場分析

${report.analysis.marketTrends}

## 🎯 おすすめ

${report.analysis.recommendations.map(rec => `- ${rec}`).join('\n')}

## ⚠️ 注意事項

${report.analysis.alerts.length > 0
            ? report.analysis.alerts.map(alert => `- ${alert}`).join('\n')
            : '特になし'}

## 💰 高時給案件 (Upwork)

${report.highValueJobs.upwork.length > 0
            ? report.highValueJobs.upwork.map(job => {
                const hourlyRate = CurrencyService.calculateUpworkHourlyRateJPY(job, 150);
                return `### ${job.title}
- **時給**: ${hourlyRate ? `${hourlyRate.toLocaleString()}円` : '固定価格'}
- **スキル**: ${job.skills.slice(0, 5).join(', ')}
- **提案数**: ${job.proposals}件
- **クライアント**: ${job.client.country || '不明'} (評価率: ${job.client.hireRate || 'N/A'}%)
- **URL**: [案件詳細](${job.url})

`;
            }).join('\n')
            : '条件に合う高時給案件が見つかりませんでした。'}

---

*このレポートは自動生成されました (${new Date().toISOString()})*
`;
}

/**
 * 高時給案件詳細レポート生成
 */
function generateHighValueJobsReport(report: IntegratedJobReport): string {
    return `# 高時給案件詳細レポート

> **最低時給条件**: ${report.criteria.minHourlyRate.toLocaleString()}円以上  
> **生成日時**: ${report.generatedAt.toLocaleString('ja-JP')}  

## 📊 サマリー

- **CrowdWorks高時給案件**: ${report.highValueJobs.crowdworks.length}件
- **Upwork高時給案件**: ${report.highValueJobs.upwork.length}件
- **総合計**: ${report.highValueJobs.crowdworks.length + report.highValueJobs.upwork.length}件

## 💰 Upwork 高時給案件詳細

${report.highValueJobs.upwork.map((job, index) => {
        const hourlyRate = CurrencyService.calculateUpworkHourlyRateJPY(job, 150);

        return `### ${index + 1}. ${job.title}

**基本情報**
- **時給**: ${hourlyRate ? `${hourlyRate.toLocaleString()}円 (USD $${job.budget.min || 'N/A'}-$${job.budget.max || 'N/A'})` : `固定価格 $${job.budget.amount}`}
- **案件タイプ**: ${job.jobType === 'hourly' ? '時間単価' : '固定価格'}
- **期間**: ${job.duration}
- **経験レベル**: ${job.experienceLevel}
- **提案数**: ${job.proposals}件

**クライアント情報**
- **国**: ${job.client.country || '不明'}
- **登録日**: ${job.client.memberSince || '不明'}
- **総支出**: $${job.client.totalSpent?.toLocaleString() || 'N/A'}
- **採用率**: ${job.client.hireRate || 'N/A'}%
- **支払い認証**: ${job.client.paymentVerified ? '✅' : '❌'}

**必要スキル**
${job.skills.map(skill => `- ${skill}`).join('\n')}

**案件説明**
${job.description.substring(0, 200)}...

**詳細URL**: [${job.url}](${job.url})

---

`;
    }).join('')}

## 🎯 CrowdWorks 高時給案件詳細

${report.highValueJobs.crowdworks.length > 0
            ? 'CrowdWorks案件の詳細はこちらに表示されます（実装予定）'
            : '条件に合うCrowdWorks案件が見つかりませんでした。'}

---

*詳細レポート生成完了*
`;
}

/**
 * 実行サマリーの表示
 */
function displaySummary(report: IntegratedJobReport, executionTime: number): void {
    console.log('\n🎉 統合ジョブサーチ完了！');
    console.log('='.repeat(50));
    console.log(`📊 総案件数: ${report.results.summary.totalJobs}件`);
    console.log(`💰 高時給案件: ${report.results.summary.highHourlyJobs}件`);
    console.log(`📈 平均時給: ${report.results.summary.averageHourlyRate.toLocaleString()}円`);
    console.log(`⏱️ 実行時間: ${Math.round(executionTime / 1000)}秒`);
    console.log('='.repeat(50));

    if (report.analysis.alerts.length > 0) {
        console.log('\n⚠️ 注意事項:');
        report.analysis.alerts.forEach(alert => console.log(`  - ${alert}`));
    }

    if (report.analysis.recommendations.length > 0) {
        console.log('\n🎯 おすすめ:');
        report.analysis.recommendations.forEach(rec => console.log(`  - ${rec}`));
    }
}

/**
 * CLIインターフェース
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);

    // ヘルプ表示
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
🔍 統合ジョブサーチツール - CrowdWorks & Upwork

使用方法:
  npm run integrated-search [オプション]

オプション:
  --min-rate <数値>     最低時給（円）[デフォルト: 3000]
  --max-jobs <数値>     最大取得件数/サイト [デフォルト: 50]
  --categories <文字列> 対象カテゴリ（カンマ区切り）
  --keywords <文字列>   検索キーワード（カンマ区切り）
  --format <形式>       出力形式 [json|markdown|both] [デフォルト: both]
  --help, -h           このヘルプを表示

環境変数:
  UPWORK_CONSUMER_KEY     Upwork Consumer Key（必須）
  UPWORK_CONSUMER_SECRET  Upwork Consumer Secret（必須）
  UPWORK_ACCESS_TOKEN     Upwork Access Token（オプション）
  UPWORK_ACCESS_TOKEN_SECRET Upwork Access Token Secret（オプション）

例:
  npm run integrated-search
  npm run integrated-search -- --min-rate 4000 --max-jobs 30
  npm run integrated-search -- --categories "web,mobile" --keywords "react,typescript"
    `);
        return;
    }

    // 引数の解析
    const options: Parameters<typeof executeIntegratedJobSearch>[0] = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];

        switch (arg) {
            case '--min-rate':
                if (nextArg !== undefined) {
                    options.minHourlyRate = parseInt(nextArg);
                    i++; // 次の引数をスキップ
                }
                break;
            case '--max-jobs':
                if (nextArg !== undefined) {
                    options.maxJobsPerSource = parseInt(nextArg);
                    i++; // 次の引数をスキップ
                }
                break;
            case '--categories':
                if (nextArg !== undefined) {
                    options.categories = nextArg.split(',').map(s => s.trim());
                    i++; // 次の引数をスキップ
                }
                break;
            case '--keywords':
                if (nextArg !== undefined) {
                    options.keywords = nextArg.split(',').map(s => s.trim());
                    i++; // 次の引数をスキップ
                }
                break;
            case '--format':
                if (nextArg !== undefined) {
                    options.outputFormat = nextArg as 'json' | 'markdown' | 'both';
                    i++; // 次の引数をスキップ
                }
                break;
        }
    }

    await executeIntegratedJobSearch(options);
}

// スクリプト実行
if (require.main === module) {
    main().catch(error => {
        console.error('❌ 実行エラー:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}

export { executeIntegratedJobSearch }; 