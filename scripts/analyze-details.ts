require('dotenv').config();

import { readFileSync, writeFileSync } from 'fs';
import { OpenAI } from 'openai';
import * as path from 'path';

// 型定義
interface CrowdWorksJobDetail {
    jobId: string;
    title: string;
    detailedDescription: string;
    [key: string]: any;
}

interface AnalysisResult {
    jobId: string;
    title: string;
    工数_見積もり: string;
    想定時給: string;
    難易度: string;
    gpt_summary: string;
}

// .envからAPIキー取得
const apiKey = process.env['OPENAI_API_KEY'];
if (!apiKey) {
    console.error('❌ OPENAI_API_KEYが設定されていません');
    process.exit(1);
}

const openai = new OpenAI({ apiKey });

// 引数: 入力ファイル, 出力ファイル
const [, , inputFile, outputFile] = process.argv;
if (!inputFile || !outputFile) {
    console.error('Usage: ts-node scripts/analyze-details.ts <input.json> <output.json>');
    process.exit(1);
}

const inputPath = path.resolve(inputFile);
const outputPath = path.resolve(outputFile);

const details: CrowdWorksJobDetail[] = JSON.parse(readFileSync(inputPath, 'utf8'));

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

const limiter = new ConcurrencyLimiter(5); // 最大5件並列

async function analyzeDetail(detail: CrowdWorksJobDetail): Promise<AnalysisResult> {
    const prompt = `以下はクラウドワークスの案件詳細です。内容を読んで、
1. この仕事にかかるおおよその工数（何時間くらいか）
2. 想定される時給（日本円・固定値で1つの数値のみ）
3. 案件の難易度（簡単/普通/難しい のいずれか）
4. その根拠や注意点
を日本語で簡潔にまとめてください。

【重要な工数見積もりのポイント】
- 記載された作業内容だけでなく、以下の前作業・付帯作業も必ず含めて計算してください：
  * 要件定義・要件整理（クライアントとの認識合わせ）
  * 初回打ち合わせ・ヒアリング（1-3回程度）
  * 提案書・企画書・仕様書の作成
  * 作業中の進捗報告・中間確認
  * 修正・調整作業（通常2-3回は発生）
  * テスト・検証・品質チェック
  * 納品作業・説明・引き継ぎ
  * 納品後の軽微なサポート・質問対応

【重要な難易度判定のポイント】
- **簡単**: 初心者・未経験者でも対応可能、基本的なスキルで十分、テンプレート作業中心
- **普通**: 一般的なスキルレベルが必要、多少の学習や調査が必要、標準的な業務
- **難しい**: 高度な専門知識・技術が必要、豊富な経験が前提、複雑な要件や新技術

【重要な注意点】
- クラウドワークスの案件は玉石混交で、タイトルで指定した価格が案件詳細では嘘だと書かれていたりします
- 詳細説明を注意深く読み、実際の作業内容と報酬を正確に把握してください
- タイトルの金額に惑わされず、詳細に書かれた実際の条件から確からしい想定時給を算出してください
- 「〇〇円スタート」「能力に応じて」などの曖昧な表現にも注意してください
- 初回は低価格で「継続で単価アップ」という案件は、初回価格を基準に計算してください
- **時給は必ず1つの具体的な数値で回答してください（例：2500円）。範囲や曖昧な表現は禁止です**
- **難易度は必ず「簡単」「普通」「難しい」のいずれか1つで回答してください**
- **実際のフリーランス作業の現実を反映した、十分な工数を見積もってください**

---
タイトル: ${detail.title}

詳細説明: ${detail.detailedDescription}
---

【出力フォーマット】
工数: <例: 8時間>
時給: <例: 2500円>
難易度: <例: 普通>
要約: <根拠や注意点を1-2文で>`;

    return limiter.execute(async () => {
        const res = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'あなたは日本のフリーランス市場の専門家で、クラウドワークス案件の現実的な工数見積もりと時給推定の専門家です。実際のフリーランス作業では要件定義や打ち合わせ、修正作業なども必要で、記載された作業以外にも多くの付帯作業が発生することを理解しています。' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 512,
            temperature: 0.2,
        });

        const text = res.choices[0]?.message?.content || '';
        // シンプルなパース
        const 工数 = text.match(/工数[:：]\s*(.+)/)?.[1]?.trim() || '';
        const 時給 = text.match(/時給[:：]\s*(.+)/)?.[1]?.trim() || '';
        const 難易度 = text.match(/難易度[:：]\s*(.+)/)?.[1]?.trim() || '';
        const 要約 = text.match(/要約[:：]\s*([\s\S]*)/)?.[1]?.trim() || text;

        return {
            jobId: detail.jobId,
            title: detail.title,
            工数_見積もり: 工数,
            想定時給: 時給,
            難易度: 難易度,
            gpt_summary: 要約,
        };
    });
}

(async () => {
    console.log(`🚀 並列分析開始: ${details.length}件（最大5件並列）`);
    const results: AnalysisResult[] = [];
    let completed = 0;

    // 全ての案件を並列で処理開始
    const promises = details.map(async (detail, index) => {
        try {
            const result = await analyzeDetail(detail);
            results.push(result);
            completed++;
            console.log(`✅ [${completed}/${details.length}] ${detail.title.substring(0, 50)}...`);

            // 定期的に中間結果を保存
            if (completed % 5 === 0 || completed === details.length) {
                // 結果をjobId順にソートして保存
                const sortedResults = results.sort((a, b) => a.jobId.localeCompare(b.jobId));
                writeFileSync(outputPath, JSON.stringify(sortedResults, null, 2), 'utf8');
                console.log(`💾 中間保存: ${completed}件完了`);
            }

            return { success: true, result, index };
        } catch (e) {
            console.error(`❌ [${index + 1}/${details.length}] ${detail.title.substring(0, 50)}... - エラー:`, e);
            return { success: false, error: e, index };
        }
    });

    // 全ての処理が完了するまで待機
    const settledResults = await Promise.allSettled(promises);

    // 最終結果の統計
    const successful = settledResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = settledResults.length - successful;

    console.log(`\n🎯 並列分析完了:`)
    console.log(`✅ 成功: ${successful}件`);
    console.log(`❌ 失敗: ${failed}件`);
    console.log(`📁 出力ファイル: ${outputPath}`);

    // 最終保存（jobId順でソート）
    const finalResults = results.sort((a, b) => a.jobId.localeCompare(b.jobId));
    writeFileSync(outputPath, JSON.stringify(finalResults, null, 2), 'utf8');
    console.log(`💾 最終保存完了: ${finalResults.length}件`);
})(); 