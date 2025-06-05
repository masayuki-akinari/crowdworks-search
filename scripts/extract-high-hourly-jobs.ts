require('dotenv').config();

import { readFileSync, writeFileSync } from 'fs';

// 型定義
interface AnalysisResult {
    jobId: string;
    title: string;
    工数_見積もり: string;
    想定時給: string;
    gpt_summary: string;
    category?: string;
}

interface HighHourlyJob extends AnalysisResult {
    hourly_rate_numeric: number;
    link: string;
    original_title?: string;
}

// 時給文字列を数値に変換する関数
function parseHourlyRate(hourlyRateString: string): number {
    if (!hourlyRateString || hourlyRateString.trim() === '' || hourlyRateString === '0円') {
        return 0;
    }

    const match = hourlyRateString.match(/([0-9,]+)/);
    if (match && match[1]) {
        const numericString = match[1].replace(/,/g, '');
        return parseInt(numericString, 10);
    }

    return 0;
}

// 詳細データから元のタイトルを取得する関数
function getOriginalJobData(jobId: string, detailsData: any[]): any {
    return detailsData.find(job => job.jobId === jobId);
}

// メイン処理
function extractHighHourlyJobs(): void {
    console.log('🔄 時給3000円以上の案件抽出を開始...');

    const highHourlyJobs: HighHourlyJob[] = [];
    const minHourlyRate = 3000;

    // 詳細データも読み込む（元のタイトル取得用）
    let ecDetailsData: any[] = [];
    let webDetailsData: any[] = [];

    // EC詳細データの読み込み
    try {
        ecDetailsData = JSON.parse(readFileSync('output/details-ec.json', 'utf8'));
        console.log(`📂 EC詳細データ: ${ecDetailsData.length}件読み込み`);
    } catch (error) {
        console.log(`⚠️ EC詳細データの読み込みに失敗: ${error}`);
    }

    // Web製品詳細データの読み込み
    try {
        webDetailsData = JSON.parse(readFileSync('output/details-web_products.json', 'utf8'));
        console.log(`📂 Web製品詳細データ: ${webDetailsData.length}件読み込み`);
    } catch (error) {
        console.log(`⚠️ Web製品詳細データの読み込みに失敗: ${error}`);
    }

    // AI分析済みデータの読み込み（オプション）
    let ecAnalyzedData: any[] = [];
    let webAnalyzedData: any[] = [];

    try {
        ecAnalyzedData = JSON.parse(readFileSync('output/analyzed-ec.json', 'utf8'));
        console.log(`🧠 EC AI分析データ: ${ecAnalyzedData.length}件読み込み`);
    } catch (error) {
        console.log(`⚠️ ECカテゴリファイルが見つかりません: analyzed-ec.json`);
    }

    try {
        webAnalyzedData = JSON.parse(readFileSync('output/analyzed-web_products.json', 'utf8'));
        console.log(`🧠 Web製品 AI分析データ: ${webAnalyzedData.length}件読み込み`);
    } catch (error) {
        console.log(`⚠️ Web製品カテゴリファイルが見つかりません: analyzed-web_products.json`);
    }

    // ECカテゴリの分析データ読み込み
    try {
        ecAnalyzedData.forEach(item => {
            const hourlyRate = parseHourlyRate(item.想定時給);
            if (hourlyRate >= minHourlyRate) {
                const originalJob = getOriginalJobData(item.jobId, ecDetailsData);
                highHourlyJobs.push({
                    ...item,
                    category: 'EC',
                    hourly_rate_numeric: hourlyRate,
                    link: `https://crowdworks.jp/public/jobs/${item.jobId}`,
                    original_title: originalJob?.title || item.title
                });
            }
        });
        console.log(`✅ ECカテゴリ: ${ecAnalyzedData.length}件中 ${ecAnalyzedData.filter(item => parseHourlyRate(item.想定時給) >= minHourlyRate).length}件が対象`);
    } catch (e) {
        console.log('⚠️ ECカテゴリファイルが見つかりません: analyzed-ec.json');
    }

    // Web製品カテゴリの分析データ読み込み
    try {
        webAnalyzedData.forEach(item => {
            const hourlyRate = parseHourlyRate(item.想定時給);
            if (hourlyRate >= minHourlyRate) {
                const originalJob = getOriginalJobData(item.jobId, webDetailsData);
                highHourlyJobs.push({
                    ...item,
                    category: 'Web製品',
                    hourly_rate_numeric: hourlyRate,
                    link: `https://crowdworks.jp/public/jobs/${item.jobId}`,
                    original_title: originalJob?.title || item.title
                });
            }
        });
        console.log(`✅ Web製品カテゴリ: ${webAnalyzedData.length}件中 ${webAnalyzedData.filter(item => parseHourlyRate(item.想定時給) >= minHourlyRate).length}件が対象`);
    } catch (e) {
        console.log('⚠️ Web製品カテゴリファイルが見つかりません: analyzed-web_products.json');
    }

    if (highHourlyJobs.length === 0) {
        console.error('❌ 対象案件が見つかりませんでした');
        return;
    }

    // 時給順でソート（高額順）
    const sortedJobs = highHourlyJobs.sort((a, b) => b.hourly_rate_numeric - a.hourly_rate_numeric);

    // Markdownファイル生成
    const markdown = generateMarkdown(sortedJobs, minHourlyRate);
    const outputFileName = `output/high-hourly-jobs-3000+.md`;

    writeFileSync(outputFileName, markdown, 'utf8');
    console.log(`💾 Markdownファイルを保存: ${outputFileName}`);
    console.log(`📊 抽出件数: ${sortedJobs.length}件`);
    console.log(`💰 最高時給: ${Math.max(...sortedJobs.map(j => j.hourly_rate_numeric)).toLocaleString()}円`);
}

// Markdown生成関数
function generateMarkdown(jobs: HighHourlyJob[], minRate: number): string {
    const currentDate = new Date().toISOString().split('T')[0];

    let markdown = `# 高時給案件一覧（${minRate}円以上）\n\n`;
    markdown += `> 生成日: ${currentDate}  \n`;
    markdown += `> 対象: 時給${minRate.toLocaleString()}円以上の案件  \n`;
    markdown += `> 総件数: ${jobs.length}件  \n`;
    markdown += `> 注意: 工数見積もりには要件定義、打ち合わせ、修正作業などの前作業も含まれています\n\n`;

    markdown += `## 📊 概要\n\n`;
    markdown += `| 統計項目 | 値 |\n`;
    markdown += `|----------|----|\n`;
    markdown += `| 最高時給 | ${Math.max(...jobs.map(j => j.hourly_rate_numeric)).toLocaleString()}円 |\n`;
    markdown += `| 最低時給 | ${Math.min(...jobs.map(j => j.hourly_rate_numeric)).toLocaleString()}円 |\n`;
    markdown += `| 平均時給 | ${Math.round(jobs.reduce((sum, j) => sum + j.hourly_rate_numeric, 0) / jobs.length).toLocaleString()}円 |\n`;
    markdown += `| EC案件数 | ${jobs.filter(j => j.category === 'EC').length}件 |\n`;
    markdown += `| Web製品案件数 | ${jobs.filter(j => j.category === 'Web製品').length}件 |\n\n`;

    markdown += `## 💼 案件一覧\n\n`;

    jobs.forEach((job, index) => {
        markdown += `### ${index + 1}. [${job.original_title}](${job.link})\n\n`;
        markdown += `**💰 想定時給:** ${job.hourly_rate_numeric.toLocaleString()}円  \n`;
        markdown += `**⏰ 見積工数:** ${job.工数_見積もり}  \n`;
        markdown += `**🏷️ カテゴリ:** ${job.category}  \n`;
        markdown += `**🔗 案件URL:** ${job.link}\n\n`;
        markdown += `**📝 分析概要:**  \n`;
        markdown += `${job.gpt_summary}\n\n`;
        markdown += `---\n\n`;
    });

    markdown += `## 📋 注記\n\n`;
    markdown += `- 時給は「要件定義」「打ち合わせ」「修正作業」「テスト」「納品後サポート」などの付帯作業も含めた現実的な工数見積もりに基づいています\n`;
    markdown += `- 案件の詳細は各リンクをクリックしてクラウドワークスのページでご確認ください\n`;
    markdown += `- 時給計算はGPT-4oによる分析結果であり、実際の作業時間や報酬は異なる場合があります\n`;
    markdown += `- 案件の募集状況は変動するため、リンク先で最新情報をご確認ください\n`;

    return markdown;
}

// 実行
extractHighHourlyJobs(); 