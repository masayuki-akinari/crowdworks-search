require('dotenv').config();

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import OpenAI from 'openai';
// import { chromium } from 'playwright';
// import { AppliedJobsService } from '../src/services/AppliedJobsService';
// import { CrowdWorksCredentials } from '../src/types';

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
    delivery_estimate?: string; // 納期見込み
}

// 処理済み案件のキャッシュインターface
interface ProcessedJobCache {
    jobId: string;
    skill_fit_score: number;
    skill_analysis: string;
    proposal_greeting: string;
    delivery_estimate: string;
    specification_questions: string;
    processed_at: string;
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
    HOURLY: 1.0,
    WORKLOAD: 0.5,
    SKILL_FIT: 2.0
};

// 提案文生成対象の最低時給基準
const PROPOSAL_GENERATION_MIN_HOURLY_RATE = 3000; // 円

// キャッシュファイルのパス
const PROCESSED_JOBS_CACHE_FILE = 'output/processed-jobs.json';

// 応募済み案件を取得する関数（現在は無効化）
// async function getAppliedJobIds(): Promise<Set<string>> {
//     // 応募済み案件の取得処理は現在無効化されています
//     return new Set<string>();
// }

// 処理済み案件キャッシュを読み込む
function loadProcessedJobsCache(): Map<string, ProcessedJobCache> {
    const cacheMap = new Map<string, ProcessedJobCache>();

    if (existsSync(PROCESSED_JOBS_CACHE_FILE)) {
        try {
            const cacheData: ProcessedJobCache[] = JSON.parse(readFileSync(PROCESSED_JOBS_CACHE_FILE, 'utf8'));
            cacheData.forEach(item => {
                cacheMap.set(item.jobId, item);
            });
            console.log(`📋 処理済み案件キャッシュを読み込み: ${cacheData.length}件`);
        } catch (error) {
            console.log(`⚠️ キャッシュファイルの読み込みに失敗: ${error}`);
        }
    } else {
        console.log(`📋 新規キャッシュファイルを作成します`);
    }

    return cacheMap;
}

// 処理済み案件キャッシュを保存する
function saveProcessedJobsCache(cacheMap: Map<string, ProcessedJobCache>): void {
    try {
        const cacheArray = Array.from(cacheMap.values());
        writeFileSync(PROCESSED_JOBS_CACHE_FILE, JSON.stringify(cacheArray, null, 2), 'utf8');
        console.log(`💾 処理済み案件キャッシュを保存: ${cacheArray.length}件`);
    } catch (error) {
        console.error(`❌ キャッシュファイルの保存に失敗: ${error}`);
    }
}

// クローズした案件を古い順から削除する
function cleanupClosedJobs(): void {
    console.log(`\n🧹 クローズした案件の削除開始...`);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 各カテゴリのファイルを処理
    const categories = ['ec', 'web_products', 'software_development', 'development'];
    let totalRemovedDetails = 0;
    let totalRemovedAnalyzed = 0;
    let totalRemovedCache = 0;

    categories.forEach(category => {
        // 詳細データのクリーンアップ
        const detailsFile = `output/details-${category}.json`;
        if (existsSync(detailsFile)) {
            try {
                const detailsData = JSON.parse(readFileSync(detailsFile, 'utf8'));
                const originalCount = detailsData.length;

                // 応募締切が過ぎた案件を特定
                const closedJobs: any[] = [];
                const activeJobs = detailsData.filter((detail: any) => {
                    if (!detail.applicationDeadline) {
                        return true; // 締切が設定されていない場合は残す
                    }

                    try {
                        // 日本語の日付形式（YYYY年MM月DD日）をパース
                        const deadlineStr = detail.applicationDeadline;
                        const match = deadlineStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
                        if (!match) {
                            return true; // パースできない場合は残す
                        }

                        const year = parseInt(match[1]);
                        const month = parseInt(match[2]) - 1; // Dateオブジェクトは0ベース
                        const day = parseInt(match[3]);
                        const deadline = new Date(year, month, day);

                        if (deadline < today) {
                            closedJobs.push({
                                jobId: detail.jobId,
                                title: detail.title,
                                deadline: deadline,
                                applicationDeadline: deadlineStr
                            });
                            return false; // 削除対象
                        }
                        return true; // 有効案件として残す
                    } catch (error) {
                        return true; // エラーの場合は残す
                    }
                });

                if (closedJobs.length > 0) {
                    // 古い順（締切日が早い順）にソート
                    closedJobs.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());

                    // ファイルを更新
                    writeFileSync(detailsFile, JSON.stringify(activeJobs, null, 2), 'utf8');
                    totalRemovedDetails += closedJobs.length;

                    console.log(`🗑️ ${category} 詳細データ: ${closedJobs.length}件削除 (${originalCount}件 → ${activeJobs.length}件)`);
                    console.log(`   最古の削除案件: ${closedJobs[0].applicationDeadline} - ${closedJobs[0].title.substring(0, 30)}...`);
                }
            } catch (error) {
                console.log(`⚠️ ${category} 詳細データのクリーンアップに失敗: ${error}`);
            }
        }

        // 分析データのクリーンアップ
        const analyzedFile = `output/analyzed-${category}.json`;
        if (existsSync(analyzedFile)) {
            try {
                const analyzedData = JSON.parse(readFileSync(analyzedFile, 'utf8'));
                const originalCount = analyzedData.length;

                // 対応する詳細データが存在する分析データのみ残す
                const activeDetailsJobIds = new Set();
                const detailsFile = `output/details-${category}.json`;
                if (existsSync(detailsFile)) {
                    const detailsData = JSON.parse(readFileSync(detailsFile, 'utf8'));
                    detailsData.forEach((detail: any) => activeDetailsJobIds.add(detail.jobId));
                }

                const activeAnalyzedData = analyzedData.filter((analyzed: any) =>
                    activeDetailsJobIds.has(analyzed.jobId)
                );

                const removedCount = originalCount - activeAnalyzedData.length;
                if (removedCount > 0) {
                    writeFileSync(analyzedFile, JSON.stringify(activeAnalyzedData, null, 2), 'utf8');
                    totalRemovedAnalyzed += removedCount;
                    console.log(`🗑️ ${category} 分析データ: ${removedCount}件削除 (${originalCount}件 → ${activeAnalyzedData.length}件)`);
                }
            } catch (error) {
                console.log(`⚠️ ${category} 分析データのクリーンアップに失敗: ${error}`);
            }
        }
    });

    // 処理済みキャッシュのクリーンアップ
    if (existsSync(PROCESSED_JOBS_CACHE_FILE)) {
        try {
            const cacheData = JSON.parse(readFileSync(PROCESSED_JOBS_CACHE_FILE, 'utf8'));
            const originalCount = cacheData.length;

            // 有効な詳細データが存在するキャッシュのみ残す
            const allActiveJobIds = new Set();
            categories.forEach(category => {
                const detailsFile = `output/details-${category}.json`;
                if (existsSync(detailsFile)) {
                    const detailsData = JSON.parse(readFileSync(detailsFile, 'utf8'));
                    detailsData.forEach((detail: any) => allActiveJobIds.add(detail.jobId));
                }
            });

            const activeCacheData = cacheData.filter((cache: any) =>
                allActiveJobIds.has(cache.jobId)
            );

            const removedCount = originalCount - activeCacheData.length;
            if (removedCount > 0) {
                writeFileSync(PROCESSED_JOBS_CACHE_FILE, JSON.stringify(activeCacheData, null, 2), 'utf8');
                totalRemovedCache += removedCount;
                console.log(`🗑️ 処理済みキャッシュ: ${removedCount}件削除 (${originalCount}件 → ${activeCacheData.length}件)`);
            }
        } catch (error) {
            console.log(`⚠️ 処理済みキャッシュのクリーンアップに失敗: ${error}`);
        }
    }

    const totalRemoved = totalRemovedDetails + totalRemovedAnalyzed + totalRemovedCache;
    if (totalRemoved > 0) {
        console.log(`\n🎯 クリーンアップ完了:`);
        console.log(`   詳細データ: ${totalRemovedDetails}件削除`);
        console.log(`   分析データ: ${totalRemovedAnalyzed}件削除`);
        console.log(`   キャッシュ: ${totalRemovedCache}件削除`);
        console.log(`   合計: ${totalRemoved}件削除`);
    } else {
        console.log(`🎉 削除対象のクローズした案件はありませんでした`);
    }
}

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
function getOriginalJobData(jobId: string, detailsData: any[], lancersJobs?: any[]): any {
    // まずCrowdWorksの詳細データから検索
    const crowdWorksJob = detailsData.find(job => job.jobId === jobId);
    if (crowdWorksJob) {
        return crowdWorksJob;
    }

    // ランサーズの案件データから検索
    if (lancersJobs) {
        const lancersJob = lancersJobs.find(item => item.id === jobId);
        if (lancersJob) {
            return {
                jobId: lancersJob.id,
                title: lancersJob.title,
                detailedDescription: lancersJob.description,
                url: lancersJob.url,
                source: 'lancers'
            };
        }
    }

    return null;
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
async function main(): Promise<void> {
    console.log('🚀 おすすめ案件の計算を開始します...');

    // 応募済み案件IDを取得（現在は無効化）
    console.log('\n📋 応募済み案件の取得はスキップします（APIキー未設定のため）');

    // クローズした案件を削除
    cleanupClosedJobs();

    const startTime = Date.now();

    try {
        // 処理済み案件キャッシュを読み込み
        const processedCache = loadProcessedJobsCache();
        console.log(`📋 処理済みキャッシュ読み込み: ${processedCache.size}件`);

        const scoredJobs: ScoredJob[] = [];

        // 詳細データも読み込む（元のタイトル取得用）
        let ecDetailsData: any[] = [];
        let webDetailsData: any[] = [];
        let softwareDetailsData: any[] = [];
        let developmentDetailsData: any[] = [];
        let lancersDetailsData: any[] = [];

        // CrowdWorks詳細データの読み込み
        try {
            ecDetailsData = JSON.parse(readFileSync('output/details-ec.json', 'utf8'));
            console.log(`📂 CrowdWorks EC詳細データ: ${ecDetailsData.length}件読み込み`);
        } catch (error) {
            console.log(`⚠️ CrowdWorks EC詳細データの読み込みに失敗: ${error}`);
        }

        try {
            webDetailsData = JSON.parse(readFileSync('output/details-web_products.json', 'utf8'));
            console.log(`📂 CrowdWorks Web製品詳細データ: ${webDetailsData.length}件読み込み`);
        } catch (error) {
            console.log(`⚠️ CrowdWorks Web製品詳細データの読み込みに失敗: ${error}`);
        }

        try {
            softwareDetailsData = JSON.parse(readFileSync('output/details-software_development.json', 'utf8'));
            console.log(`📂 CrowdWorks ソフトウェア開発詳細データ: ${softwareDetailsData.length}件読み込み`);
        } catch (error) {
            console.log(`⚠️ CrowdWorks ソフトウェア開発詳細データの読み込みに失敗: ${error}`);
        }

        try {
            developmentDetailsData = JSON.parse(readFileSync('output/details-development.json', 'utf8'));
            console.log(`📂 CrowdWorks 開発詳細データ: ${developmentDetailsData.length}件読み込み`);
        } catch (error) {
            console.log(`⚠️ CrowdWorks 開発詳細データの読み込みに失敗: ${error}`);
        }

        // ランサーズ詳細データの読み込み
        console.log(`🔍 ランサーズ詳細データの読み込みを開始...`);
        try {
            const lancersAllDetails = JSON.parse(readFileSync('output/lancers-all-details.json', 'utf8'));
            lancersDetailsData = lancersAllDetails.details || [];
            console.log(`📂 ランサーズ詳細データ: ${lancersDetailsData.length}件読み込み SUCCESS`);
        } catch (error) {
            console.log(`⚠️ ランサーズ詳細データの読み込みに失敗: ${error}`);
        }

        // AI分析済みデータの読み込み（オプション）
        let ecAnalyzedData: any[] = [];
        let webAnalyzedData: any[] = [];
        let softwareAnalyzedData: any[] = [];
        let developmentAnalyzedData: any[] = [];
        let lancersAnalyzedData: any[] = [];

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

        try {
            softwareAnalyzedData = JSON.parse(readFileSync('output/analyzed-software_development.json', 'utf8'));
            console.log(`🧠 ソフトウェア開発 AI分析データ: ${softwareAnalyzedData.length}件読み込み`);
        } catch (error) {
            console.log(`⚠️ ソフトウェア開発カテゴリファイルが見つかりません: analyzed-software_development.json`);
        }

        try {
            developmentAnalyzedData = JSON.parse(readFileSync('output/analyzed-development.json', 'utf8'));
            console.log(`🧠 開発 AI分析データ: ${developmentAnalyzedData.length}件読み込み`);
        } catch (error) {
            console.log(`⚠️ 開発カテゴリファイルが見つかりません: analyzed-development.json`);
        }

        // ランサーズ分析データの読み込み
        console.log(`🔍 ランサーズ分析データの読み込みを開始...`);
        try {
            lancersAnalyzedData = JSON.parse(readFileSync('output/analyzed-lancers.json', 'utf8'));
            console.log(`🧠 ランサーズ AI分析データ: ${lancersAnalyzedData.length}件読み込み SUCCESS`);
        } catch (error) {
            console.log(`⚠️ ランサーズカテゴリファイルが見つかりません: analyzed-lancers.json - ${error}`);
        }

        // 全カテゴリの分析データをマージして終了案件を除外
        const allAnalyzedJobs = [
            ...ecAnalyzedData,
            ...webAnalyzedData,
            ...softwareAnalyzedData,
            ...developmentAnalyzedData,
            ...lancersAnalyzedData
        ];

        console.log(`📊 統合後の全案件数: ${allAnalyzedJobs.length}件`);
        console.log(`📊 EC: ${ecAnalyzedData.length}件, Web: ${webAnalyzedData.length}件, Software: ${softwareAnalyzedData.length}件, Development: ${developmentAnalyzedData.length}件, Lancers: ${lancersAnalyzedData.length}件`);

        // 現在の日付を取得
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // ランサーズの案件データも読み込み
        console.log(`🔍 ランサーズ案件データの読み込みを開始...`);
        let lancersJobsData: any[] = [];
        try {
            const lancersAllJobs = JSON.parse(readFileSync('output/lancers-all-jobs.json', 'utf8'));
            lancersJobsData = lancersAllJobs.jobs || [];
            console.log(`📂 ランサーズ案件データ: ${lancersJobsData.length}件読み込み SUCCESS`);
        } catch (error) {
            console.log(`⚠️ ランサーズ案件データの読み込みに失敗: ${error}`);
        }

        // 全詳細データをマージ
        const allDetailsData = [
            ...ecDetailsData,
            ...webDetailsData,
            ...softwareDetailsData,
            ...developmentDetailsData,
            ...lancersDetailsData
        ];

        // 🚀 統合前のLancers案件確認
        const lancersInAll = allAnalyzedJobs.filter(job => job.jobId.includes('lancers_test'));
        console.log(`🚀 デバッグ - allAnalyzedJobsにLancers案件: ${lancersInAll.length}件`);
        lancersInAll.forEach(job => {
            console.log(`   - ${job.jobId}: ${job.title}`);
        });

        // 終了している案件を除外（応募締切が過ぎた案件）
        const activeJobs = allAnalyzedJobs.filter(job => {
            // 対応する詳細データを検索
            const detailData = allDetailsData.find(detail => detail.jobId === job.jobId);



            if (!detailData || !detailData.applicationDeadline) {
                return true; // 詳細データまたは締切が設定されていない場合は有効とする
            }

            try {
                // 日本語の日付形式（YYYY年MM月DD日）をパース
                const deadlineStr = detailData.applicationDeadline;
                const match = deadlineStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
                if (!match) {
                    return true; // パースできない場合は有効とする
                }

                const deadlineDate = new Date(
                    parseInt(match[1]),
                    parseInt(match[2]) - 1, // 月は0ベース
                    parseInt(match[3])
                );

                return deadlineDate >= today; // 今日以降なら有効
            } catch (error) {
                console.log(`⚠️ 締切日パースエラー (jobId: ${job.jobId}): ${detailData.applicationDeadline}`);
                return true; // エラーの場合は有効とする
            }
        });

        const excludedCount = allAnalyzedJobs.length - activeJobs.length;
        console.log(`📅 応募締切チェック: 総${allAnalyzedJobs.length}件中、${excludedCount}件の終了案件を除外`);
        console.log(`✅ 有効案件: ${activeJobs.length}件で処理を継続`);

        // 応募済み案件を除外（現在は無効化）
        const notAppliedJobs = activeJobs; // 除外処理をスキップ
        console.log(`📝 応募済み案件チェック: スキップ（APIキー未設定）`);
        console.log(`✅ 最終対象案件: ${notAppliedJobs.length}件で処理を継続`);

        console.log(`\n📊 有効案件の分布:`);

        // フィルタリング済みの有効案件のみを処理
        notAppliedJobs.forEach(item => {
            const hourlyRate = parseHourlyRate(item.想定時給);
            const workloadHours = parseWorkloadHours(item.工数_見積もり);
            const difficultyScore = parseDifficultyScore(item.難易度);
            const skillFitScore = 5; // 仮のスキル適性スコア（後で更新）
            const recommendationScore = calculateRecommendationScore(hourlyRate, workloadHours, skillFitScore);

            // カテゴリに応じて詳細データを取得
            let originalJob;
            let categoryName = '';

            if (ecAnalyzedData.some(job => job.jobId === item.jobId)) {
                originalJob = getOriginalJobData(item.jobId, ecDetailsData, lancersJobsData);
                categoryName = 'EC';
            } else if (webAnalyzedData.some(job => job.jobId === item.jobId)) {
                originalJob = getOriginalJobData(item.jobId, webDetailsData, lancersJobsData);
                categoryName = 'Web製品';
            } else if (softwareAnalyzedData.some(job => job.jobId === item.jobId)) {
                originalJob = getOriginalJobData(item.jobId, softwareDetailsData, lancersJobsData);
                categoryName = 'ソフトウェア開発';
            } else if (developmentAnalyzedData.some(job => job.jobId === item.jobId)) {
                originalJob = getOriginalJobData(item.jobId, developmentDetailsData, lancersJobsData);
                categoryName = '開発';
            } else if (lancersAnalyzedData.some(job => job.jobId === item.jobId)) {
                originalJob = getOriginalJobData(item.jobId, lancersDetailsData, lancersJobsData);
                categoryName = 'ランサーズ';
                console.log(`🚀 Lancers案件処理: ${item.jobId} - ${item.title}`);
            }

            const proposalAmount = Math.round(workloadHours * PROPOSAL_GENERATION_MIN_HOURLY_RATE);
            const finishDays = Math.ceil((workloadHours / 6) * 2);
            const finishDate = new Date();
            finishDate.setDate(finishDate.getDate() + finishDays);
            const estimatedFinishDate = finishDate.toISOString().split('T')[0];

            // リンクの生成（プラットフォームに応じて）
            let jobLink = `https://crowdworks.jp/public/jobs/${item.jobId}`;
            if (categoryName === 'ランサーズ') {
                jobLink = originalJob?.url || `https://www.lancers.jp/work/detail/${item.jobId}`;
            }

            scoredJobs.push({
                ...item,
                category: categoryName,
                hourly_rate_numeric: hourlyRate,
                workload_hours: workloadHours,
                difficulty_score: difficultyScore,
                skill_fit_score: skillFitScore,
                recommendation_score: recommendationScore,
                link: jobLink,
                original_title: originalJob?.title || item.title,
                proposal_amount: proposalAmount,
                estimated_finish_date: estimatedFinishDate
            });
        });

        console.log(`✅ 有効案件処理完了: ${notAppliedJobs.length}件`);

        if (scoredJobs.length === 0) {
            console.error('❌ データが読み込めませんでした');
            return;
        }

        // 全案件のスキル適性評価を実行
        console.log(`\n🧠 全案件のスキル適性評価中（最大10件並列）...`);

        const limiter = new ConcurrencyLimiter(10);
        let skillAnalysisCount = 0;
        let cacheHitCount = 0;
        let newProcessingCount = 0;

        const skillAnalysisPromises = scoredJobs.map(async (job, index) => {
            try {
                // キャッシュから既存の結果を確認
                const cachedResult = processedCache.get(job.jobId);

                if (cachedResult) {
                    // キャッシュヒット：既存の結果を使用
                    job.skill_fit_score = cachedResult.skill_fit_score;
                    job.skill_analysis = cachedResult.skill_analysis;

                    // スキル適性スコアでおすすめ点数を再計算
                    job.recommendation_score = calculateRecommendationScore(
                        job.hourly_rate_numeric,
                        job.workload_hours,
                        cachedResult.skill_fit_score
                    );

                    cacheHitCount++;
                    console.log(`💾 [${skillAnalysisCount + cacheHitCount}/${scoredJobs.length}] ${job.original_title?.substring(0, 40)}... キャッシュから取得`);

                    return { success: true, index, fromCache: true };
                } else {
                    // キャッシュミス：新規でGPT処理
                    const allDetailsData = [...ecDetailsData, ...webDetailsData, ...softwareDetailsData, ...developmentDetailsData, ...lancersDetailsData];
                    const originalJob = getOriginalJobData(job.jobId, allDetailsData, lancersJobsData);

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

                    // キャッシュに追加（提案文は後で追加）
                    processedCache.set(job.jobId, {
                        jobId: job.jobId,
                        skill_fit_score: score,
                        skill_analysis: analysis,
                        proposal_greeting: '', // 後で更新
                        delivery_estimate: '', // 後で更新
                        specification_questions: '', // 後で更新
                        processed_at: new Date().toISOString()
                    });

                    newProcessingCount++;
                    console.log(`✅ [${newProcessingCount}/${scoredJobs.length - cacheHitCount}] ${job.original_title?.substring(0, 40)}... スキル適性評価完了（新規処理）`);

                    return { success: true, index, fromCache: false };
                }
            } catch (error) {
                console.error(`❌ [${index + 1}/${scoredJobs.length}] スキル適性評価エラー:`, error);
                return { success: false, index, fromCache: false };
            }
        });

        await Promise.allSettled(skillAnalysisPromises);
        skillAnalysisCount = cacheHitCount + newProcessingCount;
        console.log(`🎯 スキル適性評価完了: ${skillAnalysisCount}/${scoredJobs.length}件成功（キャッシュ: ${cacheHitCount}件、新規: ${newProcessingCount}件）`);

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

        // 全案件に提案文生成を追加
        console.log(`\n🤖 全案件の提案文生成中（最大8件並列）...`);
        console.log(`対象案件: ${sortedJobs.length}件`);

        const proposalLimiter = new ConcurrencyLimiter(8); // 提案文生成は8件並列
        let proposalCount = 0;
        let proposalCacheHitCount = 0;
        let newProposalProcessingCount = 0;

        const proposalPromises = sortedJobs.map(async (job, index) => {
            try {
                // キャッシュから既存の提案文を確認
                const cachedResult = processedCache.get(job.jobId);

                if (cachedResult && cachedResult.proposal_greeting && cachedResult.proposal_greeting.trim() !== '') {
                    // キャッシュヒット：既存の提案文を使用
                    job.proposal_greeting = cachedResult.proposal_greeting;
                    job.delivery_estimate = cachedResult.delivery_estimate;
                    job.specification_questions = cachedResult.specification_questions;

                    proposalCacheHitCount++;
                    console.log(`💾 [${proposalCount + proposalCacheHitCount}/${sortedJobs.length}] ${job.original_title?.substring(0, 40)}... 提案文をキャッシュから取得`);

                    return { success: true, index, fromCache: true };
                } else {
                    // キャッシュミス：新規でGPT処理
                    const allDetailsData = [...ecDetailsData, ...webDetailsData, ...softwareDetailsData, ...developmentDetailsData, ...lancersDetailsData];
                    const originalJob = getOriginalJobData(job.jobId, allDetailsData, lancersJobsData);

                    const { greeting, delivery_estimate, questions } = await proposalLimiter.execute(() =>
                        generateProposalContent(job, originalJob)
                    );

                    job.proposal_greeting = greeting;
                    job.delivery_estimate = delivery_estimate;
                    job.specification_questions = questions;

                    // キャッシュを更新
                    if (processedCache.has(job.jobId)) {
                        const existingCache = processedCache.get(job.jobId)!;
                        existingCache.proposal_greeting = greeting;
                        existingCache.delivery_estimate = delivery_estimate;
                        existingCache.specification_questions = questions;
                    } else {
                        // スキル適性評価がキャッシュから取得された場合でも、提案文は新規作成
                        processedCache.set(job.jobId, {
                            jobId: job.jobId,
                            skill_fit_score: job.skill_fit_score,
                            skill_analysis: job.skill_analysis || '',
                            proposal_greeting: greeting,
                            delivery_estimate: delivery_estimate,
                            specification_questions: questions,
                            processed_at: new Date().toISOString()
                        });
                    }

                    newProposalProcessingCount++;
                    console.log(`✅ [${newProposalProcessingCount}/${sortedJobs.length - proposalCacheHitCount}] ${job.original_title?.substring(0, 40)}... 提案文生成完了（新規処理）`);

                    return { success: true, index, fromCache: false };
                }
            } catch (error) {
                console.error(`❌ [${index + 1}/${sortedJobs.length}] 提案文生成エラー:`, error);
                return { success: false, index, fromCache: false };
            }
        });

        await Promise.allSettled(proposalPromises);
        proposalCount = proposalCacheHitCount + newProposalProcessingCount;
        console.log(`🎯 提案文生成完了: ${proposalCount}/${sortedJobs.length}件成功（キャッシュ: ${proposalCacheHitCount}件、新規: ${newProposalProcessingCount}件）`);

        // キャッシュを保存
        saveProcessedJobsCache(processedCache);

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

            // 提案文があれば表示
            if (job.proposal_greeting) {
                console.log(`   💬 提案文: ${job.proposal_greeting.substring(0, 60)}...`);
            }
            console.log('');
        });

        // 時給3000円以上の案件のみをMarkdownに出力
        const highValueJobs = sortedJobs.filter(job => job.hourly_rate_numeric >= PROPOSAL_GENERATION_MIN_HOURLY_RATE);

        // 時給分布の詳細を表示
        console.log(`\n📊 時給分布の詳細:`);
        const hourlyRateDistribution = sortedJobs.reduce((acc, job) => {
            const rate = job.hourly_rate_numeric;
            if (rate >= 4000) acc['4000円以上']++;
            else if (rate >= 3500) acc['3500円以上']++;
            else if (rate >= 3000) acc['3000円以上']++;
            else if (rate >= 2500) acc['2500円以上']++;
            else if (rate >= 2000) acc['2000円以上']++;
            else if (rate >= 1500) acc['1500円以上']++;
            else if (rate >= 1000) acc['1000円以上']++;
            else acc['1000円未満']++;
            return acc;
        }, {
            '4000円以上': 0,
            '3500円以上': 0,
            '3000円以上': 0,
            '2500円以上': 0,
            '2000円以上': 0,
            '1500円以上': 0,
            '1000円以上': 0,
            '1000円未満': 0
        });

        Object.entries(hourlyRateDistribution).forEach(([range, count]) => {
            if (count > 0) {
                console.log(`   ${range}: ${count}件`);
            }
        });

        console.log(`\n📝 時給${PROPOSAL_GENERATION_MIN_HOURLY_RATE}円以上の案件: ${highValueJobs.length}件をMarkdownに出力`);

        // 全案件データ用のMarkdownファイルを生成
        const allJobsMarkdown = generateAllJobsMarkdown(sortedJobs);
        writeFileSync('output/all-jobs-ranked.md', allJobsMarkdown, 'utf8');
        console.log(`📄 全案件ランキングを保存: output/all-jobs-ranked.md (${sortedJobs.length}件)`);

        // 高時給案件データ用のMarkdownファイルを生成（既存）
        const highValueMarkdown = generateRecommendationMarkdown(highValueJobs, sortedJobs.length); // 時給3000円以上のみ表示
        writeFileSync('output/recommended-jobs.md', highValueMarkdown, 'utf8');
        console.log(`📄 高時給案件おすすめを保存: output/recommended-jobs.md (${highValueJobs.length}件)`);

        // 一時的に生成されたJSONファイルを削除
        try {
            const tempFiles = [
                'output/jobs-with-recommendation-scores.json',
                'output/high-hourly-jobs-3000+.md'
            ];
            tempFiles.forEach(file => {
                if (existsSync(file)) {
                    unlinkSync(file);
                    console.log(`��️ 一時ファイルを削除: ${file}`);
                }
            });
        } catch (error) {
            console.warn('⚠️ 一時ファイル削除中にエラー:', error);
        }

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);
        console.log(`🎉 おすすめ案件の計算が完了しました。処理時間: ${duration}秒`);
    } catch (error) {
        console.error(`❌ おすすめ案件の計算中にエラーが発生しました:`, error);
    }
}

// Markdown生成関数
function generateRecommendationMarkdown(jobs: ScoredJob[], totalJobs?: number): string {
    // 日本時間で秒まで含む詳細な時刻を取得
    const now = new Date();
    const jstOffset = 9 * 60; // JST = UTC+9
    const jstTime = new Date(now.getTime() + jstOffset * 60 * 1000);
    const currentDateTime = jstTime.toISOString().replace('T', ' ').replace('Z', '').substring(0, 19) + ' JST';

    let markdown = `# Webエンジニア向けおすすめ案件ランキング（時給${PROPOSAL_GENERATION_MIN_HOURLY_RATE}円以上）\n\n`;
    markdown += `> **生成日時**: ${currentDateTime}  \n`;
    markdown += `> 評価基準: 係数システム（時給×${EVALUATION_COEFFICIENTS.HOURLY} + 工数×${EVALUATION_COEFFICIENTS.WORKLOAD} + スキル適性×${EVALUATION_COEFFICIENTS.SKILL_FIT}）  \n`;
    markdown += `> 対象者: 高スキルWebエンジニア（デザインスキル低め）  \n`;
    markdown += `> 最高得点: ${Math.max(...jobs.map(j => j.recommendation_score))}点  \n`;
    markdown += `> 表示件数: ${jobs.length}件（全${totalJobs || jobs.length}件から時給${PROPOSAL_GENERATION_MIN_HOURLY_RATE}円以上を抽出）\n\n`;

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
        markdown += `### ${rank}位: ${job.recommendation_score}点 - ${job.original_title || job.title}\n\n`;
        markdown += `**💰 想定時給:** ${job.hourly_rate_numeric.toLocaleString()}円  \n`;
        markdown += `**🎯 難易度:** ${job.難易度}  \n`;
        markdown += `**⏰ 見積工数:** ${job.工数_見積もり}  \n`;
        markdown += `**🧠 スキル適性:** ${job.skill_fit_score?.toFixed(1)}点/10点  \n`;
        markdown += `**🏷️ カテゴリ:** ${job.category}  \n`;
        markdown += `**🔗 案件URL:** ${job.link}\n\n`;

        // 提案金額と納期を追加
        if (job.proposal_amount && job.delivery_estimate) {
            markdown += `**💴 提案金額:** ${job.proposal_amount.toLocaleString()}円  \n`;
            markdown += `**📅 納期提案:** ${job.delivery_estimate}  \n\n`;
        }

        markdown += `**📝 分析概要:**  \n`;
        markdown += `${job.gpt_summary}\n\n`;

        if (job.skill_analysis) {
            markdown += `**🧠 スキル適性分析:**  \n`;
            markdown += `${job.skill_analysis}\n\n`;
        }

        // 提案文と質問を追加
        if (job.proposal_greeting && job.specification_questions) {
            markdown += `**💬 戦略的提案文:**  \n`;
            markdown += `${job.proposal_greeting}\n\n`;

            markdown += `**❓ 仕様確認質問:**  \n`;
            markdown += `${job.specification_questions}\n\n`;
        }

        markdown += `---\n\n`;
    });

    // 案件一覧を表形式で出力
    if (jobs.length > 0) {
        markdown += `\n## 💴 案件一覧（時給${PROPOSAL_GENERATION_MIN_HOURLY_RATE}円以上）\n\n`;
        markdown += `| 案件名 | 提案金額 | 納期提案 | 提案文（抜粋） |\n`;
        markdown += `|---|---|---|---|\n`;
        jobs.forEach(job => {
            const title = job.original_title || job.title || '案件名不明';
            const amount = job.proposal_amount?.toLocaleString() || '要相談';
            const delivery = job.delivery_estimate || '要相談';
            const greeting = (job.proposal_greeting || '').replace(/\n/g, ' ').substring(0, 80);
            markdown += `| [${title}](${job.link}) | ${amount}円 | ${delivery} | ${greeting}... |\n`;
        });
        markdown += `\n`;
    }

    return markdown;
}

// 全案件用のMarkdown生成関数
function generateAllJobsMarkdown(jobs: ScoredJob[]): string {
    // 日本時間で秒まで含む詳細な時刻を取得
    const now = new Date();
    const jstOffset = 9 * 60; // JST = UTC+9
    const jstTime = new Date(now.getTime() + jstOffset * 60 * 1000);
    const currentDateTime = jstTime.toISOString().replace('T', ' ').replace('Z', '').substring(0, 19) + ' JST';

    let markdown = `# 全案件ランキング（おすすめ度順）\n\n`;
    markdown += `> **生成日時**: ${currentDateTime}  \n`;
    markdown += `> 評価基準: 係数システム（時給×${EVALUATION_COEFFICIENTS.HOURLY} + 工数×${EVALUATION_COEFFICIENTS.WORKLOAD} + スキル適性×${EVALUATION_COEFFICIENTS.SKILL_FIT}）  \n`;
    markdown += `> 対象者: 高スキルWebエンジニア（デザインスキル低め）  \n`;
    markdown += `> 最高得点: ${Math.max(...jobs.map(j => j.recommendation_score))}点  \n`;
    markdown += `> 総案件数: ${jobs.length}件（提案文生成対象外の案件も含む）\n\n`;

    // 時給分布を表示
    const hourlyRateDistribution = jobs.reduce((acc, job) => {
        const rate = job.hourly_rate_numeric;
        if (rate >= 4000) acc['4000円以上']++;
        else if (rate >= 3500) acc['3500円以上']++;
        else if (rate >= 3000) acc['3000円以上']++;
        else if (rate >= 2500) acc['2500円以上']++;
        else if (rate >= 2000) acc['2000円以上']++;
        else if (rate >= 1500) acc['1500円以上']++;
        else if (rate >= 1000) acc['1000円以上']++;
        else acc['1000円未満']++;
        return acc;
    }, {
        '4000円以上': 0,
        '3500円以上': 0,
        '3000円以上': 0,
        '2500円以上': 0,
        '2000円以上': 0,
        '1500円以上': 0,
        '1000円以上': 0,
        '1000円未満': 0
    });

    markdown += `## 📊 時給分布\n\n`;
    Object.entries(hourlyRateDistribution).forEach(([range, count]) => {
        if (count > 0) {
            markdown += `- ${range}: ${count}件\n`;
        }
    });
    markdown += `\n`;

    markdown += `## 🏆 全案件ランキング\n\n`;

    jobs.forEach((job, index) => {
        const rank = index + 1;
        markdown += `### ${rank}位: ${job.recommendation_score}点 - ${job.original_title || job.title}\n\n`;
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

        // 提案文がある場合のみ表示（時給3000円以上の案件）
        if (job.proposal_greeting && job.specification_questions) {
            markdown += `**💬 戦略的提案文:**  \n`;
            markdown += `${job.proposal_greeting}\n\n`;

            markdown += `**❓ 仕様確認質問:**  \n`;
            markdown += `${job.specification_questions}\n\n`;

            if (job.proposal_amount && job.delivery_estimate) {
                markdown += `**💴 提案金額:** ${job.proposal_amount.toLocaleString()}円  \n`;
                markdown += `**📅 納期提案:** ${job.delivery_estimate}  \n\n`;
            }
        } else {
            markdown += `**💡 注意:** この案件は時給${PROPOSAL_GENERATION_MIN_HOURLY_RATE}円未満のため、提案文は生成されていません。\n\n`;
        }

        markdown += `---\n\n`;
    });

    // 案件一覧を表形式で出力
    if (jobs.length > 0) {
        markdown += `\n## 📋 案件一覧（全${jobs.length}件）\n\n`;
        markdown += `| 順位 | 案件名 | 時給 | おすすめ度 | カテゴリ |\n`;
        markdown += `|---|---|---|---|---|\n`;
        jobs.forEach((job, index) => {
            const rank = index + 1;
            const title = job.original_title || job.title || '案件名不明';
            const hourlyRate = job.hourly_rate_numeric.toLocaleString() + '円';
            const score = job.recommendation_score;
            const category = job.category || 'N/A';
            markdown += `| ${rank} | [${title.substring(0, 40)}...](${job.link}) | ${hourlyRate} | ${score}点 | ${category} |\n`;
        });
        markdown += `\n`;
    }

    return markdown;
}

// GPTで提案用挨拶文と仕様質問を生成する関数
async function generateProposalContent(job: AnalysisResult, originalJob: any): Promise<{ greeting: string; delivery_estimate: string; questions: string }> {
    const prompt = `以下のクラウドワークス案件について、下記3点を日本語で出力してください。

【案件情報】
タイトル: ${job.title}
詳細説明: ${originalJob?.detailedDescription || '詳細不明'}
想定時給: ${job.想定時給}
見積工数: ${job.工数_見積もり}
難易度: ${job.難易度}

【出力内容】
1. 戦略的提案文（プロフェッショナルで親しみやすい、簡潔な自己紹介・案件への取り組み姿勢 2-3行）
2. 納期見込み（何日で納品できそうか。根拠も1文で）
3. 仕様確認質問（案件を確実に成功させるための具体的な質問を3-5個）

【提案文のポイント】
- 経験と専門性をアピール
- 案件への真剣な取り組み姿勢を示す
- クライアントの課題解決に焦点

【出力フォーマット】
提案文:
<プロフェッショナルで簡潔な提案文>

納期見込み:
<例: 10日（要件定義・修正対応含む）>

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

        // 提案文、納期見込み、質問を分離
        const greetingMatch = text.match(/提案文[:：]\s*([\s\S]*?)(?=納期見込み[:：]|$)/);
        const deliveryMatch = text.match(/納期見込み[:：]\s*([\s\S]*?)(?=質問[:：]|$)/);
        const questionsMatch = text.match(/質問[:：]\s*([\s\S]*)/);

        const greeting = greetingMatch?.[1]?.trim() || '';
        const delivery_estimate = deliveryMatch?.[1]?.trim() || '';
        const questions = questionsMatch?.[1]?.trim() || '';

        return { greeting, delivery_estimate, questions };
    } catch (e) {
        console.error(`❌ 提案文・納期・質問生成エラー (${job.jobId}):`, e);
        return { greeting: '', delivery_estimate: '', questions: '' };
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
(async () => {
    await main();
})(); 