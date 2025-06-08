import { readFileSync, writeFileSync } from 'fs';
import OpenAI from 'openai';

require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env['OPENAI_API_KEY'],
});

/**
 * ランサーズ案件からCrowdWorks互換のAI分析データを生成
 */
interface LancersJob {
    id: string;
    title: string;
    description: string;
    url: string;
    budget: {
        type: 'fixed' | 'hourly' | 'unknown';
        amount: number;
        currency: string;
    };
    category: string;
    tags: string[];
    client: {
        name: string;
        rating: number;
        reviewCount: number;
    };
    postedAt: string;
    deadline?: string;
    applicants: number;
    scrapedAt: string;
}

interface AnalysisResult {
    jobId: string;
    title: string;
    工数_見積もり: string;
    想定時給: string;
    難易度: string;
    gpt_summary: string;
    category?: string;
}

/**
 * ランサーズ案件をAI分析する関数
 */
async function analyzeLancersJob(job: LancersJob): Promise<AnalysisResult | null> {
    const prompt = `以下のランサーズ案件を分析して、下記の項目を出力してください。

【案件情報】
タイトル: ${job.title}
詳細説明: ${job.description}
予算: ${job.budget.amount}円 (${job.budget.type === 'fixed' ? '固定' : job.budget.type === 'hourly' ? '時給' : '不明'})
カテゴリ: ${job.category}
タグ: ${job.tags.join(', ')}
応募者数: ${job.applicants}人

【出力項目】
1. 工数見積もり（例：10時間、30時間、100時間など）
2. 想定時給（例：3000円、4500円など - 予算と工数から逆算）
3. 難易度（初級、中級、上級、エキスパート）
4. 案件概要（50文字程度の簡潔な要約）

【評価の観点】
- 技術的な複雑さ
- 作業規模
- 求められるスキルレベル
- 納期の余裕度

【出力フォーマット】
工数見積もり: <時間数>
想定時給: <金額>
難易度: <レベル>
概要: <50文字程度の要約>`;

    try {
        const res = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'あなたはフリーランス案件の分析専門家です。技術案件の工数見積もりと難易度評価に長けています。' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 500,
            temperature: 0.3,
        });

        const text = res.choices[0]?.message?.content || '';

        // 結果をパース
        const workloadMatch = text.match(/工数見積もり[:：]\s*([^\n]+)/);
        const hourlyRateMatch = text.match(/想定時給[:：]\s*([^\n]+)/);
        const difficultyMatch = text.match(/難易度[:：]\s*([^\n]+)/);
        const summaryMatch = text.match(/概要[:：]\s*([^\n]+)/);

        const workload = workloadMatch?.[1]?.trim() || '不明';
        const hourlyRate = hourlyRateMatch?.[1]?.trim() || '不明';
        const difficulty = difficultyMatch?.[1]?.trim() || '不明';
        const summary = summaryMatch?.[1]?.trim() || '';

        return {
            jobId: job.id,
            title: job.title,
            工数_見積もり: workload,
            想定時給: hourlyRate,
            難易度: difficulty,
            gpt_summary: summary,
            category: job.category
        };

    } catch (error) {
        console.error(`❌ 案件分析エラー (${job.id}):`, error);
        return null;
    }
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
    console.log('🚀 ランサーズ案件のAI分析を開始します...');

    // ランサーズ案件データを読み込み
    let lancersJobs: LancersJob[] = [];
    try {
        const lancersData = JSON.parse(readFileSync('output/lancers-all-jobs.json', 'utf8'));
        lancersJobs = lancersData.jobs || [];
        console.log(`📂 ランサーズ案件データ読み込み: ${lancersJobs.length}件`);
    } catch (error) {
        console.error('❌ ランサーズ案件データの読み込みに失敗:', error);
        return;
    }

    if (lancersJobs.length === 0) {
        console.log('⚠️ 分析対象の案件がありません');
        return;
    }

    // システム開発関連の案件のみをフィルタリング
    const targetJobs = lancersJobs.filter(job => {
        const title = job.title.toLowerCase();
        const description = job.description.toLowerCase();
        const category = job.category.toLowerCase();

        // システム開発・Web関連のキーワード
        const keywords = [
            'システム', 'web', 'api', 'データベース', 'javascript', 'typescript', 'react', 'node',
            'php', 'python', 'java', 'sql', 'database', 'サイト', 'アプリ', 'cms', 'wordpress',
            'ec', 'ecommerce', 'ショッピング', 'プログラミング', '開発', 'フロントエンド', 'バックエンド'
        ];

        return keywords.some(keyword =>
            title.includes(keyword) ||
            description.includes(keyword) ||
            category.includes(keyword)
        );
    });

    console.log(`🎯 技術案件をフィルタリング: ${targetJobs.length}件 (全${lancersJobs.length}件中)`);

    if (targetJobs.length === 0) {
        console.log('⚠️ 技術関連の案件が見つかりませんでした');
        return;
    }

    // 案件を順次分析
    const analyzedJobs: AnalysisResult[] = [];
    const batchSize = 5; // 5件ずつ処理

    for (let i = 0; i < targetJobs.length; i += batchSize) {
        const batch = targetJobs.slice(i, i + batchSize);
        console.log(`\n📋 バッチ ${Math.floor(i / batchSize) + 1}: ${i + 1}~${Math.min(i + batchSize, targetJobs.length)}件目を分析中...`);

        // バッチ内の案件を並列で分析
        const batchPromises = batch.map(async (job, index) => {
            const globalIndex = i + index + 1;
            try {
                console.log(`🔍 [${globalIndex}/${targetJobs.length}] 分析中: ${job.title.substring(0, 40)}...`);
                const result = await analyzeLancersJob(job);

                if (result) {
                    console.log(`✅ [${globalIndex}/${targetJobs.length}] 分析完了: ${result.想定時給}, ${result.難易度}`);
                    return result;
                } else {
                    console.log(`❌ [${globalIndex}/${targetJobs.length}] 分析失敗`);
                    return null;
                }
            } catch (error) {
                console.error(`❌ [${globalIndex}/${targetJobs.length}] エラー:`, error);
                return null;
            }
        });

        const batchResults = await Promise.allSettled(batchPromises);

        // 成功した結果のみを追加
        batchResults.forEach((result) => {
            if (result.status === 'fulfilled' && result.value) {
                analyzedJobs.push(result.value);
            }
        });

        // バッチ間の待機時間（API制限対策）
        if (i + batchSize < targetJobs.length) {
            console.log('⏱️ 次のバッチまで3秒待機...');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    console.log(`\n🎉 ランサーズ案件AI分析完了!`);
    console.log(`📊 結果: ${analyzedJobs.length}件成功 / ${targetJobs.length}件処理`);

    // 結果をファイルに保存
    if (analyzedJobs.length > 0) {
        const outputFile = 'output/analyzed-lancers.json';
        writeFileSync(outputFile, JSON.stringify(analyzedJobs, null, 2), 'utf8');
        console.log(`💾 分析結果を保存: ${outputFile}`);

        // 統計情報を表示
        console.log(`\n📈 分析結果統計:`);

        // 難易度分布
        const difficultyDist = analyzedJobs.reduce((acc, job) => {
            acc[job.難易度] = (acc[job.難易度] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        console.log(`難易度分布:`);
        Object.entries(difficultyDist).forEach(([level, count]) => {
            console.log(`  ${level}: ${count}件`);
        });

        // 想定時給分布
        const hourlyRates = analyzedJobs
            .map(job => {
                const match = job.想定時給.match(/(\d+)/);
                return match && match[1] ? parseInt(match[1]) : 0;
            })
            .filter(rate => rate > 0);

        if (hourlyRates.length > 0) {
            const avgRate = Math.round(hourlyRates.reduce((sum, rate) => sum + rate, 0) / hourlyRates.length);
            const maxRate = Math.max(...hourlyRates);
            const minRate = Math.min(...hourlyRates);

            console.log(`想定時給統計:`);
            console.log(`  平均: ${avgRate}円`);
            console.log(`  最高: ${maxRate}円`);
            console.log(`  最低: ${minRate}円`);
        }
    }
}

// スクリプト実行
if (require.main === module) {
    main().catch(error => {
        console.error('💥 スクリプト実行エラー:', error);
        process.exit(1);
    });
}

export default main; 