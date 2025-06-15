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

// メイン処理
function extractHighHourlyJobs(): void {
    console.log('🔄 時給2000円以上かつ工数20時間以下のWebエンジニア向け案件抽出を開始...');

    const highHourlyJobs: HighHourlyJob[] = [];
    const minHourlyRate = 2000;
    const maxWorkHours = 20;

    // カテゴリ定義（webエンジニア向け）
    const WEB_ENGINEER_CATEGORIES = [
        { key: 'web_products', label: 'Web製品' },
        { key: 'software_development', label: 'ソフトウェア開発' },
        { key: 'development', label: '開発' }
    ] as const;

    WEB_ENGINEER_CATEGORIES.forEach(({ key, label }) => {
        let detailsData: AnalysisResult[] = [];
        let analyzedData: AnalysisResult[] = [];
        // 詳細データの読み込み
        try {
            detailsData = JSON.parse(readFileSync(`output/details-${key}.json`, 'utf8'));
            console.log(`📂 ${label}詳細データ: ${detailsData.length}件読み込み`);
        } catch (error) {
            console.log(`⚠️ ${label}詳細データの読み込みに失敗: ${error}`);
        }
        // AI分析済みデータの読み込み
        try {
            analyzedData = JSON.parse(readFileSync(`output/analyzed-${key}.json`, 'utf8'));
            console.log(`🧠 ${label}AI分析データ: ${analyzedData.length}件読み込み`);
        } catch (error) {
            console.log(`⚠️ ${label}AI分析データの読み込みに失敗: ${error}`);
        }
        // 抽出処理
        analyzedData.forEach((item: AnalysisResult) => {
            const hourlyRate = parseHourlyRate(item.想定時給);
            const workHours = parseWorkHours(item.工数_見積もり);
            if (hourlyRate >= minHourlyRate && workHours > 0 && workHours <= maxWorkHours) {
                const originalJob = getOriginalJobData(item.jobId, detailsData);
                highHourlyJobs.push({
                    ...item,
                    category: label,
                    hourly_rate_numeric: hourlyRate,
                    link: `https://crowdworks.jp/public/jobs/${item.jobId}`,
                    original_title: originalJob?.title || item.title
                });
            }
        });
        console.log(`✅ ${label}: ${analyzedData.length}件中 ${analyzedData.filter(item => parseHourlyRate(item.想定時給) >= minHourlyRate && parseWorkHours(item.工数_見積もり) > 0 && parseWorkHours(item.工数_見積もり) <= maxWorkHours).length}件が対象`);
    });

    if (highHourlyJobs.length === 0) {
        console.error('❌ 対象案件が見つかりませんでした');
        return;
    }

    // 時給順でソート（高額順）
    const sortedJobs = highHourlyJobs.sort((a, b) => b.hourly_rate_numeric - a.hourly_rate_numeric);

    // Markdownファイル生成
    const markdown = generateMarkdown(sortedJobs, minHourlyRate);
    const outputFileName = `output/high-hourly-jobs-web-engineer-2000+.md`;

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

// 工数文字列から時間数を抽出する関数
function parseWorkHours(workHoursString: string): number {
    if (!workHoursString) return 0;
    const match = workHoursString.match(/([0-9]+)\s*時間/);
    if (match && match[1]) {
        return parseInt(match[1], 10);
    }
    return 0;
}

// 詳細データから元のタイトルを取得する関数
function getOriginalJobData(jobId: string, detailsData: any[]): any {
    return detailsData.find(job => job.jobId === jobId);
}

// 実行
extractHighHourlyJobs(); 