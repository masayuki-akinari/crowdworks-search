require('dotenv').config();

import { readFileSync, writeFileSync } from 'fs';
import { OpenAI } from 'openai';

// 型定義
interface AnalysisResult {
    jobId: string;
    title: string;
    工数_見積もり: string;
    想定時給: string;
    難易度: string;
    gpt_summary: string;
    category?: string;
}

interface ScoredJob extends AnalysisResult {
    hourly_rate_numeric: number;
    workload_hours: number;
    difficulty_score: number;
    skill_fit_score: number;
    recommendation_score: number;
    link: string;
    original_title?: string;
    proposal_greeting?: string;
    specification_questions?: string;
    skill_analysis?: string;
    proposal_amount?: number; // 提案金額
    estimated_finish_date?: string; // 完了予定日（ISO文字列）
}

// .envからAPIキー取得
const apiKey = process.env['OPENAI_API_KEY'];
if (!apiKey) {
    console.error('❌ OPENAI_API_KEYが設定されていません');
    process.exit(1);
}

const openai = new OpenAI({ apiKey });

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

// 工数文字列を数値（時間）に変換する関数
function parseWorkloadHours(workloadString: string): number {
    if (!workloadString || workloadString.trim() === '') {
        return 40; // デフォルト値
    }

    // 「120時間」「2週間」「1ヶ月」などを解析
    const hourMatch = workloadString.match(/([0-9,]+)\s*時間/);
    if (hourMatch && hourMatch[1]) {
        return parseInt(hourMatch[1].replace(/,/g, ''), 10);
    }

    const dayMatch = workloadString.match(/([0-9,]+)\s*日/);
    if (dayMatch && dayMatch[1]) {
        return parseInt(dayMatch[1].replace(/,/g, ''), 10) * 8; // 1日8時間想定
    }

    const weekMatch = workloadString.match(/([0-9,]+)\s*週間/);
    if (weekMatch && weekMatch[1]) {
        return parseInt(weekMatch[1].replace(/,/g, ''), 10) * 40; // 1週間40時間想定
    }

    const monthMatch = workloadString.match(/([0-9,]+)\s*ヶ?月/);
    if (monthMatch && monthMatch[1]) {
        return parseInt(monthMatch[1].replace(/,/g, ''), 10) * 160; // 1ヶ月160時間想定
    }

    return 40; // デフォルト値
}

// 難易度を点数に変換する関数（簡単ほど高得点）
function parseDifficultyScore(difficultyString: string): number {
    const difficulty = difficultyString.trim().toLowerCase();

    if (difficulty.includes('簡単') || difficulty.includes('かんたん')) {
        return 10; // 簡単 = 高得点
    } else if (difficulty.includes('普通') || difficulty.includes('ふつう') || difficulty.includes('標準')) {
        return 6; // 普通 = 中得点
    } else if (difficulty.includes('難しい') || difficulty.includes('むずかしい') || difficulty.includes('困難')) {
        return 3; // 難しい = 低得点
    }

    return 5; // 不明な場合はデフォルト
}

// 評価係数の定数
const EVALUATION_COEFFICIENTS = {
    HOURLY: 2.0,        // 時給の重み
    WORKLOAD: 1.0,      // 工数の重み  
    SKILL_FIT: 3.0      // スキル適性の重み
};

// 提案文生成対象の最低時給基準
const PROPOSAL_GENERATION_MIN_HOURLY_RATE = 3000; // 円

// おすすめ点数を計算する関数（スキル適性考慮版）
function calculateRecommendationScore(
    hourlyRate: number,
    workloadHours: number,
    skillFitScore: number
): number {
    // 時給スコア（0-10点）: 時給が高いほど高得点
    let hourlyScore = 0;
    if (hourlyRate >= 4000) hourlyScore = 10;
    else if (hourlyRate >= 3500) hourlyScore = 9;
    else if (hourlyRate >= 3000) hourlyScore = 8;
    else if (hourlyRate >= 2500) hourlyScore = 7;
    else if (hourlyRate >= 2000) hourlyScore = 6;
    else if (hourlyRate >= 1500) hourlyScore = 5;
    else if (hourlyRate >= 1000) hourlyScore = 4;
    else if (hourlyRate >= 500) hourlyScore = 3;
    else if (hourlyRate > 0) hourlyScore = 2;
    else hourlyScore = 0;

    // 工数スコア（0-10点）: 適度な工数（20-80時間）が高得点
    let workloadScore = 0;
    if (workloadHours >= 20 && workloadHours <= 80) {
        workloadScore = 10; // 最適範囲
    } else if (workloadHours >= 10 && workloadHours <= 120) {
        workloadScore = 8; // 良い範囲
    } else if (workloadHours >= 5 && workloadHours <= 160) {
        workloadScore = 6; // 許容範囲
    } else if (workloadHours > 0 && workloadHours <= 200) {
        workloadScore = 4; // 微妙な範囲
    } else {
        workloadScore = 2; // 極端な工数
    }

    // 係数システムによる総合スコア計算（スキル適性重視）
    const totalScore = (hourlyScore * EVALUATION_COEFFICIENTS.HOURLY) +
        (workloadScore * EVALUATION_COEFFICIENTS.WORKLOAD) +
        (skillFitScore * EVALUATION_COEFFICIENTS.SKILL_FIT);

    return Math.round(totalScore * 10) / 10; // 小数点1位まで
}

// 詳細データから元のタイトルを取得する関数
function getOriginalJobData(jobId: string, detailsData: any[]): any {
    return detailsData.find(job => job.jobId === jobId);
}

// 並列実行制御クラス
class ConcurrencyLimiter {
    private runningCount = 0;
    private queue: (() => Promise<void>)[] = [];

    constructor(private maxConcurrency: number) { }

    async execute<T>(task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const wrappedTask = async () => {
                try {
                    this.runningCount++;
                    const result = await task();
                    resolve(result);
                } catch (error) {
                    reject(error);
                } finally {
                    this.runningCount--;
                    this.processQueue();
                }
            };

            if (this.runningCount < this.maxConcurrency) {
                wrappedTask();
            } else {
                this.queue.push(wrappedTask);
            }
        });
    }

    private processQueue() {
        if (this.queue.length > 0 && this.runningCount < this.maxConcurrency) {
            const nextTask = this.queue.shift();
            if (nextTask) {
                nextTask();
            }
        }
    }
}

// メイン処理（非同期版）
async function calculateRecommendationScores(minHourlyRate: number = 3000): Promise<void> {
    console.log('🔄 おすすめ点数計算を開始...');

    const scoredJobs: ScoredJob[] = [];

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
            const workloadHours = parseWorkloadHours(item.工数_見積もり);
            const difficultyScore = parseDifficultyScore(item.難易度);
            const skillFitScore = 5; // 仮のスキル適性スコア（後で更新）
            const recommendationScore = calculateRecommendationScore(hourlyRate, workloadHours, skillFitScore);

            const originalJob = getOriginalJobData(item.jobId, ecDetailsData);

            const proposalAmount = Math.round(workloadHours * minHourlyRate);
            const finishDays = Math.ceil((workloadHours / 6) * 2);
            const finishDate = new Date();
            finishDate.setDate(finishDate.getDate() + finishDays);
            const estimatedFinishDate = finishDate.toISOString().split('T')[0];

            scoredJobs.push({
                ...item,
                category: 'EC',
                hourly_rate_numeric: hourlyRate,
                workload_hours: workloadHours,
                difficulty_score: difficultyScore,
                skill_fit_score: skillFitScore,
                recommendation_score: recommendationScore,
                link: `https://crowdworks.jp/public/jobs/${item.jobId}`,
                original_title: originalJob?.title || item.title,
                proposal_amount: proposalAmount,
                estimated_finish_date: estimatedFinishDate
            });
        });
        console.log(`✅ ECカテゴリ: ${ecAnalyzedData.length}件処理完了`);
    } catch (e) {
        console.log('⚠️ ECカテゴリファイルが見つかりません: analyzed-ec.json');
    }

    // Web製品カテゴリの分析データ読み込み
    try {
        webAnalyzedData.forEach(item => {
            const hourlyRate = parseHourlyRate(item.想定時給);
            const workloadHours = parseWorkloadHours(item.工数_見積もり);
            const difficultyScore = parseDifficultyScore(item.難易度);
            const skillFitScore = 5; // 仮のスキル適性スコア（後で更新）
            const recommendationScore = calculateRecommendationScore(hourlyRate, workloadHours, skillFitScore);

            const originalJob = getOriginalJobData(item.jobId, webDetailsData);

            const proposalAmount = Math.round(workloadHours * minHourlyRate);
            const finishDays = Math.ceil((workloadHours / 6) * 2);
            const finishDate = new Date();
            finishDate.setDate(finishDate.getDate() + finishDays);
            const estimatedFinishDate = finishDate.toISOString().split('T')[0];

            scoredJobs.push({
                ...item,
                category: 'Web製品',
                hourly_rate_numeric: hourlyRate,
                workload_hours: workloadHours,
                difficulty_score: difficultyScore,
                skill_fit_score: skillFitScore,
                recommendation_score: recommendationScore,
                link: `https://crowdworks.jp/public/jobs/${item.jobId}`,
                original_title: originalJob?.title || item.title,
                proposal_amount: proposalAmount,
                estimated_finish_date: estimatedFinishDate
            });
        });
        console.log(`✅ Web製品カテゴリ: ${webAnalyzedData.length}件処理完了`);
    } catch (e) {
        console.log('⚠️ Web製品カテゴリファイルが見つかりません: analyzed-web_products.json');
    }

    if (scoredJobs.length === 0) {
        console.error('❌ データが読み込めませんでした');
        return;
    }

    // 全案件のスキル適性評価を実行
    console.log(`\n🧠 全案件のスキル適性評価中（最大5件並列）...`);

    const limiter = new ConcurrencyLimiter(5);
    let skillAnalysisCount = 0;

    const skillAnalysisPromises = scoredJobs.map(async (job, index) => {
        try {
            const allDetailsData = [...ecDetailsData, ...webDetailsData];
            const originalJob = getOriginalJobData(job.jobId, allDetailsData);

            const { score, analysis } = await limiter.execute(() =>
                analyzeSkillFit(job, originalJob)
            );

            job.skill_fit_score = score;
            job.skill_analysis = analysis;

            // スキル適性スコアでおすすめ点数を再計算
            job.recommendation_score = calculateRecommendationScore(
                job.hourly_rate_numeric,
                job.workload_hours,
                score
            );

            skillAnalysisCount++;
            console.log(`✅ [${skillAnalysisCount}/${scoredJobs.length}] ${job.original_title?.substring(0, 40)}... スキル適性評価完了`);

            return { success: true, index };
        } catch (error) {
            console.error(`❌ [${index + 1}/${scoredJobs.length}] スキル適性評価エラー:`, error);
            return { success: false, index };
        }
    });

    await Promise.allSettled(skillAnalysisPromises);
    console.log(`🎯 スキル適性評価完了: ${skillAnalysisCount}/${scoredJobs.length}件成功`);

    // おすすめ点数順でソート（高得点順）
    const sortedJobs = scoredJobs.sort((a, b) => b.recommendation_score - a.recommendation_score);

    // 統計情報表示
    const validJobs = sortedJobs.filter(j => j.hourly_rate_numeric > 0);
    if (validJobs.length > 0) {
        const maxScore = Math.max(...validJobs.map(j => j.recommendation_score));
        const minScore = Math.min(...validJobs.map(j => j.recommendation_score));
        const avgScore = Math.round((validJobs.reduce((sum, j) => sum + j.recommendation_score, 0) / validJobs.length) * 10) / 10;
        const avgSkillFit = Math.round((validJobs.reduce((sum, j) => sum + j.skill_fit_score, 0) / validJobs.length) * 10) / 10;

        console.log(`\n📈 統計情報:`);
        console.log(`最高おすすめ点数: ${maxScore}点`);
        console.log(`最低おすすめ点数: ${minScore}点`);
        console.log(`平均おすすめ点数: ${avgScore}点`);
        console.log(`平均スキル適性: ${avgSkillFit}点`);
        console.log(`有効案件: ${validJobs.length}件 / 全${sortedJobs.length}件`);
    }

    // 時給3000円以上の案件に提案文生成を追加
    const highValueJobs = sortedJobs.filter(job => job.hourly_rate_numeric >= PROPOSAL_GENERATION_MIN_HOURLY_RATE);
    console.log(`\n🤖 時給${PROPOSAL_GENERATION_MIN_HOURLY_RATE}円以上の案件の提案文生成中（最大3件並列）...`);
    console.log(`対象案件: ${highValueJobs.length}件`);

    const proposalLimiter = new ConcurrencyLimiter(3); // 提案文生成は3件並列
    let proposalCount = 0;

    const proposalPromises = highValueJobs.map(async (job, index) => {
        try {
            const allDetailsData = [...ecDetailsData, ...webDetailsData];
            const originalJob = getOriginalJobData(job.jobId, allDetailsData);

            const { greeting, questions } = await proposalLimiter.execute(() =>
                generateProposalContent(job, originalJob)
            );

            job.proposal_greeting = greeting;
            job.specification_questions = questions;

            proposalCount++;
            console.log(`✅ [${proposalCount}/${highValueJobs.length}] ${job.original_title?.substring(0, 40)}... 提案文生成完了`);

            return { success: true, index };
        } catch (error) {
            console.error(`❌ [${index + 1}/${highValueJobs.length}] 提案文生成エラー:`, error);
            return { success: false, index };
        }
    });

    await Promise.allSettled(proposalPromises);
    console.log(`🎯 提案文生成完了: ${proposalCount}/${highValueJobs.length}件成功`);

    // 結果表示（上位20件）
    console.log(`\n🏆 Webエンジニア向けおすすめ案件ランキング TOP20:\n`);

    sortedJobs.slice(0, 20).forEach((job, index) => {
        const rank = index + 1;
        const score = job.recommendation_score;
        const hourlyRate = job.hourly_rate_numeric.toLocaleString() + '円';
        const category = job.category || 'N/A';
        const difficulty = job.難易度 || 'N/A';
        const workload = job.工数_見積もり || 'N/A';
        const skillFit = job.skill_fit_score?.toFixed(1) || 'N/A';
        const summary = (job.gpt_summary || '').substring(0, 60) + '...';

        console.log(`${rank}位: ${score}点 | ${hourlyRate} (${category}) | 難易度: ${difficulty} | スキル適性: ${skillFit}点`);
        console.log(`   工数: ${workload}`);
        console.log(`   概要: ${summary}`);

        if (job.skill_analysis) {
            console.log(`   🧠 適性: ${job.skill_analysis.substring(0, 80)}...`);
        }

        // 時給3000円以上なら提案文と質問も追加
        if (job.hourly_rate_numeric >= PROPOSAL_GENERATION_MIN_HOURLY_RATE && job.proposal_greeting && job.specification_questions) {
            console.log(`   💬 提案文: ${job.proposal_greeting.substring(0, 60)}...`);
        }
        console.log('');
    });

    // 結果をJSONファイルに保存
    writeFileSync('output/jobs-with-recommendation-scores.json', JSON.stringify(sortedJobs, null, 2), 'utf8');
    console.log(`💾 結果を保存: output/jobs-with-recommendation-scores.json (${sortedJobs.length}件)`);

    // Markdownファイルに保存
    const markdown = generateRecommendationMarkdown(sortedJobs.slice(0, 30)); // TOP30
    writeFileSync('output/recommended-jobs-top30.md', markdown, 'utf8');
    console.log(`📄 Markdownファイルを保存: output/recommended-jobs-top30.md`);
}

// Markdown生成関数
function generateRecommendationMarkdown(jobs: ScoredJob[]): string {
    const currentDate = new Date().toISOString().split('T')[0];

    let markdown = `# Webエンジニア向けおすすめ案件ランキング TOP30\n\n`;
    markdown += `> 生成日: ${currentDate}  \n`;
    markdown += `> 評価基準: 係数システム（時給×${EVALUATION_COEFFICIENTS.HOURLY} + 工数×${EVALUATION_COEFFICIENTS.WORKLOAD} + スキル適性×${EVALUATION_COEFFICIENTS.SKILL_FIT}）  \n`;
    markdown += `> 対象者: 高スキルWebエンジニア（デザインスキル低め）  \n`;
    markdown += `> 最高得点: ${Math.max(...jobs.map(j => j.recommendation_score))}点  \n`;
    markdown += `> 対象件数: ${jobs.length}件\n`;
    markdown += `> 💬 時給${PROPOSAL_GENERATION_MIN_HOURLY_RATE}円以上の案件には戦略的提案文・質問を生成\n\n`;

    markdown += `## 👨‍💻 対象スキルプロフィール\n\n`;
    markdown += `- **高スキルWebエンジニア**（フロントエンド・バックエンド両方）\n`;
    markdown += `- **得意分野**: プログラミング・システム開発・API連携・DB設計・パフォーマンス最適化\n`;
    markdown += `- **苦手分野**: グラフィックデザイン・UI/UXデザイン（CSSスタイリング程度なら対応可能）\n\n`;

    markdown += `## 📊 評価基準の詳細\n\n`;
    markdown += `### 💰 時給スコア（係数：${EVALUATION_COEFFICIENTS.HOURLY}）\n`;
    markdown += `- 4000円以上: 10点 → ${10 * EVALUATION_COEFFICIENTS.HOURLY}点\n`;
    markdown += `- 3500円以上: 9点 → ${9 * EVALUATION_COEFFICIENTS.HOURLY}点\n`;
    markdown += `- 3000円以上: 8点 → ${8 * EVALUATION_COEFFICIENTS.HOURLY}点\n`;
    markdown += `- 2500円以上: 7点 → ${7 * EVALUATION_COEFFICIENTS.HOURLY}点\n`;
    markdown += `- 2000円以上: 6点 → ${6 * EVALUATION_COEFFICIENTS.HOURLY}点\n\n`;

    markdown += `### ⏰ 工数スコア（係数：${EVALUATION_COEFFICIENTS.WORKLOAD}）\n`;
    markdown += `- 20-80時間: 10点 → ${10 * EVALUATION_COEFFICIENTS.WORKLOAD}点（最適な工数）\n`;
    markdown += `- 10-120時間: 8点 → ${8 * EVALUATION_COEFFICIENTS.WORKLOAD}点（良い範囲）\n`;
    markdown += `- 5-160時間: 6点 → ${6 * EVALUATION_COEFFICIENTS.WORKLOAD}点（許容範囲）\n\n`;

    markdown += `### 🧠 スキル適性スコア（係数：${EVALUATION_COEFFICIENTS.SKILL_FIT}）\n`;
    markdown += `- 10点: 技術力を最大限活かせる案件（システム開発、API連携、パフォーマンス改善等）\n`;
    markdown += `- 8-9点: 技術スキルが重要な案件（WordPressカスタマイズ、EC機能開発等）\n`;
    markdown += `- 6-7点: 技術とデザインが半々（既存サイト修正、簡単なスタイリング等）\n`;
    markdown += `- 4-5点: デザイン要素が多い（レイアウト作成、ビジュアル重視等）\n`;
    markdown += `- 1-3点: 純粋なデザイン案件（グラフィック制作、UI/UXデザイン等）\n`;
    markdown += `- 0点: 完全にスキル外（イラスト制作、動画編集等）\n\n`;

    markdown += `## 🔧 係数の意味\n\n`;
    markdown += `- **時給係数 ${EVALUATION_COEFFICIENTS.HOURLY}**: 収益性重視\n`;
    markdown += `- **工数係数 ${EVALUATION_COEFFICIENTS.WORKLOAD}**: 適度な作業量をバランス評価\n`;
    markdown += `- **スキル適性係数 ${EVALUATION_COEFFICIENTS.SKILL_FIT}**: スキル適性を最重視（技術案件を優遇）\n`;
    markdown += `- **難易度**: 参考情報として表示（点数計算には含めない）\n\n`;

    const maxScore = (10 * EVALUATION_COEFFICIENTS.HOURLY) + (10 * EVALUATION_COEFFICIENTS.WORKLOAD) + (10 * EVALUATION_COEFFICIENTS.SKILL_FIT);
    markdown += `**最高理論値**: ${10 * EVALUATION_COEFFICIENTS.HOURLY} + ${10 * EVALUATION_COEFFICIENTS.WORKLOAD} + ${10 * EVALUATION_COEFFICIENTS.SKILL_FIT} = ${maxScore}点\n\n`;

    markdown += `## 🏆 ランキング\n\n`;

    jobs.forEach((job, index) => {
        const rank = index + 1;
        markdown += `### ${rank}位: ${job.recommendation_score}点 - [${job.original_title}](${job.link})\n\n`;
        markdown += `**💰 想定時給:** ${job.hourly_rate_numeric.toLocaleString()}円  \n`;
        markdown += `**🎯 難易度:** ${job.難易度}  \n`;
        markdown += `**⏰ 見積工数:** ${job.工数_見積もり}  \n`;
        markdown += `**🧠 スキル適性:** ${job.skill_fit_score?.toFixed(1)}点/10点  \n`;
        markdown += `**🏷️ カテゴリ:** ${job.category}  \n`;
        markdown += `**🔗 案件URL:** ${job.link}\n\n`;

        markdown += `**📝 分析概要:**  \n`;
        markdown += `${job.gpt_summary}\n\n`;

        if (job.skill_analysis) {
            markdown += `**🧠 スキル適性分析:**  \n`;
            markdown += `${job.skill_analysis}\n\n`;
        }

        // 時給3000円以上なら提案文と質問も追加
        if (job.hourly_rate_numeric >= PROPOSAL_GENERATION_MIN_HOURLY_RATE && job.proposal_greeting && job.specification_questions) {
            markdown += `**💬 戦略的提案文:**  \n`;
            markdown += `${job.proposal_greeting}\n\n`;

            markdown += `**❓ 仕様確認質問:**  \n`;
            markdown += `${job.specification_questions}\n\n`;
        }

        markdown += `---\n\n`;
    });

    // 3000円以上の案件を表形式で出力
    const filtered = jobs.filter(j => j.hourly_rate_numeric >= PROPOSAL_GENERATION_MIN_HOURLY_RATE);
    if (filtered.length > 0) {
        markdown += `\n## 💴 ${PROPOSAL_GENERATION_MIN_HOURLY_RATE}円以上の案件一覧\n\n`;
        markdown += `| タイトル | 提案金額 | 完了予定日 | 紹介文 |\n`;
        markdown += `|---|---|---|---|\n`;
        filtered.forEach(job => {
            markdown += `| [${job.original_title}](${job.link}) | ${job.proposal_amount?.toLocaleString()}円 | ${job.estimated_finish_date} | ${(job.proposal_greeting || '').replace(/\n/g, ' ')} |\n`;
        });
        markdown += `\n`;
    }

    return markdown;
}

// GPTで提案用挨拶文と仕様質問を生成する関数
async function generateProposalContent(job: AnalysisResult, originalJob: any): Promise<{ greeting: string; questions: string }> {
    const prompt = `以下のクラウドワークス案件に応募する際の戦略的な挨拶文と仕様確認質問を作成してください。

【案件情報】
タイトル: ${job.title}
詳細説明: ${originalJob?.detailedDescription || '詳細不明'}
想定時給: ${job.想定時給}
見積工数: ${job.工数_見積もり}
難易度: ${job.難易度}

【要求内容】
1. **挨拶文**: プロフェッショナルで親しみやすい、簡潔な自己紹介（2-3行）
2. **仕様確認質問**: 案件を確実に成功させるための具体的な質問（3-5個）

【挨拶文のポイント】
- 経験と専門性をアピール
- 案件への真剣な取り組み姿勢を示す
- クライアントの課題解決に焦点

【質問のポイント】
- 曖昧な部分の明確化
- 成果物の具体的な要求仕様
- 納期やコミュニケーション方法
- 想定される課題やリスクの確認
- 成功基準の明確化

【出力フォーマット】
挨拶文:
<挨拶文をここに>

質問:
1. <質問1>
2. <質問2>
3. <質問3>
4. <質問4>
5. <質問5>`;

    try {
        const res = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'あなたは経験豊富なフリーランサーで、クラウドワークス案件への効果的な提案文作成の専門家です。クライアントの信頼を得て、案件を受注するための戦略的なコミュニケーションに長けています。' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 800,
            temperature: 0.3,
        });

        const text = res.choices[0]?.message?.content || '';

        // 挨拶文と質問を分離
        const greetingMatch = text.match(/挨拶文[:：]\s*([\s\S]*?)(?=質問[:：]|$)/);
        const questionsMatch = text.match(/質問[:：]\s*([\s\S]*)/);

        const greeting = greetingMatch?.[1]?.trim() || '';
        const questions = questionsMatch?.[1]?.trim() || '';

        return { greeting, questions };
    } catch (e) {
        console.error(`❌ 提案文生成エラー (${job.jobId}):`, e);
        return { greeting: '', questions: '' };
    }
}

// GPTでスキル適性を評価する関数
async function analyzeSkillFit(job: AnalysisResult, originalJob: any): Promise<{ score: number; analysis: string }> {
    const prompt = `以下のクラウドワークス案件を、高スキルWebエンジニアの視点で評価してください。

【依頼者のスキルプロフィール】
- 高スキルWebエンジニア（フロントエンド・バックエンド両方）
- プログラミング・システム開発・API連携が得意
- データベース設計・パフォーマンス最適化などの技術力高い
- デザインスキルは低い（グラフィックデザイン・UI/UXデザインは苦手）
- CSSスタイリング程度なら対応可能

【案件情報】
タイトル: ${job.title}
詳細説明: ${originalJob?.detailedDescription || '詳細不明'}
カテゴリ: ${job.category}
難易度: ${job.難易度}

【評価基準】
スキル適性スコア（0-10点）:
- 10点: 技術力を最大限活かせる案件（システム開発、API連携、パフォーマンス改善等）
- 8-9点: 技術スキルが重要な案件（WordPressカスタマイズ、EC機能開発等）
- 6-7点: 技術とデザインが半々（既存サイト修正、簡単なスタイリング等）
- 4-5点: デザイン要素が多い（レイアウト作成、ビジュアル重視等）
- 1-3点: 純粋なデザイン案件（グラフィック制作、UI/UXデザイン等）
- 0点: 完全にスキル外（イラスト制作、動画編集等）

【出力フォーマット】
スコア: <0-10の数値>
分析: <なぜそのスコアなのか、技術的な観点での評価理由を2-3行で>`;

    try {
        const res = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'あなたは技術人材のスキルマッチング専門家で、Webエンジニアの技術力と案件要件を正確に評価できます。デザインスキルの有無を考慮した実用的な評価を行います。' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 300,
            temperature: 0.2,
        });

        const text = res.choices[0]?.message?.content || '';

        // スコアと分析を分離
        const scoreMatch = text.match(/スコア[:：]\s*([0-9.]+)/);
        const analysisMatch = text.match(/分析[:：]\s*([\s\S]*)/);

        const score = scoreMatch?.[1] ? parseFloat(scoreMatch[1]) : 5;
        const analysis = analysisMatch?.[1]?.trim() || '';

        return { score: Math.max(0, Math.min(10, score)), analysis };
    } catch (e) {
        console.error(`❌ スキル適性分析エラー (${job.jobId}):`, e);
        return { score: 5, analysis: '分析エラー' };
    }
}

// 実行
const minHourlyRateArg = process.argv[2] ? parseInt(process.argv[2], 10) : 3000;
(async () => {
    await calculateRecommendationScores(minHourlyRateArg);
})(); 