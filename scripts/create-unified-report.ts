import * as fs from 'fs';
import * as path from 'path';

// Job型定義
interface Job {
    id: string;
    title: string;
    platform: string;
    url: string;
    budget: {
        amount: number;
        currency: string;
        type: string;
    };
    hourlyRate: number;
    category: string;
    subcategory?: string;
    description: string;
    client?: string;
    clientRating?: number;
    clientOrderCount?: number;
    postedAt?: Date | string;
    deadline?: string;
    tags?: string[];
    workType?: string;
    isUrgent?: boolean;
    isPremium?: boolean;
    industry?: string;
    workRank?: string;
    appliedCount?: number;
    recruitCount?: number;
    scrapedAt: string;
}

// interface AnalyzedJob {
//     jobId: string;
//     title: string;
//     工数_見積もり: string;
//     想定時給: string;
//     難易度: string;
//     gpt_summary: string;
// }

interface ProcessedAnalyzedJob {
    hourlyRate: number;
    workHours: number;
    title: string;
    description: string;
    url: string;
    category: string;
    difficulty: string;
    analysis: string;
}

class UnifiedReportGenerator {
    private outputDir: string;

    constructor() {
        this.outputDir = path.join(process.cwd(), 'output');
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    // 最新のランサーズファイルを取得


    // 最新のクラウドワークス分析ファイルを取得
    // private getLatestCrowdWorksFiles(): string[] {
    //     const files = fs.readdirSync(this.outputDir)
    //         .filter(file => file.startsWith('analyzed-') && file.endsWith('.json'))
    //         .map(file => path.join(this.outputDir, file));

    //     return files;
    // }

    /**
     * データファイル読み込み
     */
    private loadJobData(): { lancers: any[], crowdworks: any[] } {
        console.log('📚 データ読み込み中...');

        // ランサーズデータ読み込み（最新のファイルを使用）
        const lancersData: any[] = [];

        // 既存のランサーズファイル
        const existingLancersFile = 'output/lancers-details-2025-06-09T17-38-02-401Z.json';
        if (fs.existsSync(existingLancersFile)) {
            const data = JSON.parse(fs.readFileSync(existingLancersFile, 'utf8'));
            lancersData.push(...data);
            console.log(`📁 既存ランサーズデータ読み込み: ${data.length}件`);
        }

        // GPT分析結果読み込み
        const gptAnalysisData: any[] = [];
        const analysisFiles = [
            'output/analysis-ec.json',
            'output/analysis-web_products.json',
            'output/analysis-software_development.json',
            'output/analysis-development.json'  // 新しい分析結果のみ
        ];

        // GPT分析結果のマップを作成
        const gptAnalysisMap = new Map();
        for (const file of analysisFiles) {
            if (fs.existsSync(file)) {
                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                gptAnalysisData.push(...data);
                data.forEach((analysis: any) => {
                    // jobIdまたはurlをキーとして使用
                    if (analysis.jobId) {
                        gptAnalysisMap.set(analysis.jobId, analysis);
                    }
                    if (analysis.url) {
                        gptAnalysisMap.set(analysis.url, analysis);
                    }
                });
                console.log(`🤖 GPT分析結果読み込み (${file}): ${data.length}件`);
        }
        }

        // ランサーズデータにGPT分析結果を統合
        const processedLancersData = lancersData.map((job: any) => {
            const gptAnalysis = gptAnalysisMap.get(job.jobId) || gptAnalysisMap.get(job.url);
            return {
                ...job,
                想定時給: this.extractHourlyRateFromGptAnalysis(gptAnalysis),
                工数_見積もり: gptAnalysis?.工数_見積もり || '未算出',
                難易度: gptAnalysis?.難易度 || 'unknown',
                簡易設計: gptAnalysis?.簡易設計 || '設計情報なし',
                gpt_summary: gptAnalysis?.gpt_summary || ''
            };
        });

        // CrowdWorksデータ読み込み（新しい詳細データファイルを使用）
        const crowdworksData: any[] = [];
        const detailsFiles = [
            'output/details-ec.json',
            'output/details-web_products.json',
            'output/details-software_development.json',
            'output/details-development.json'
        ];

        for (const file of detailsFiles) {
            if (fs.existsSync(file)) {
                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                // 有効なデータのみをフィルタリング（詳細説明があり、GPT分析結果があるもの）
                const validData = data.filter((job: any) => {
                    const hasDetailedDescription = job.detailedDescription && job.detailedDescription.trim() !== '';
                    const hasGptAnalysis = gptAnalysisMap.has(job.jobId) || gptAnalysisMap.has(job.url);
                    return hasDetailedDescription && hasGptAnalysis;
                });
                
                // 新しい詳細データにGPT分析結果を統合
                const processedData = validData.map((job: any) => {
                    const gptAnalysis = gptAnalysisMap.get(job.jobId) || gptAnalysisMap.get(job.url);
                    return {
                ...job,
                        想定時給: this.extractHourlyRateFromGptAnalysis(gptAnalysis),
                        工数_見積もり: gptAnalysis?.工数_見積もり || '未算出',
                        難易度: gptAnalysis?.難易度 || 'unknown',
                        簡易設計: gptAnalysis?.簡易設計 || '設計情報なし',
                        gpt_summary: gptAnalysis?.gpt_summary || ''
                    };
                });
                crowdworksData.push(...processedData);
                console.log(`📁 CrowdWorks詳細データ読み込み (${file}): ${processedData.length}件（有効データのみ）`);
            }
        }

        // 古いテストデータは読み込まない（新しいデータのみ使用）

        console.log(`🤖 GPT分析済み案件: ${gptAnalysisData.length}件`);
        console.log(`📊 総データ: ランサーズ${processedLancersData.length}件, クラウドワークス${crowdworksData.length}件`);
        return { lancers: processedLancersData, crowdworks: crowdworksData };
    }

    /**
     * GPT分析結果のみから時給を取得（推定アルゴリズムは削除）
     */
    private extractHourlyRateFromGptAnalysis(gptAnalysis?: any): number {
        if (!gptAnalysis) {
            console.log(`❌ GPT分析結果なし - 時給情報取得不可`);
            return 0;
        }

        // GPT分析結果から時給を抽出
        if (gptAnalysis.想定時給) {
            const gptRate = this.extractRateFromGptAnalysis(gptAnalysis.想定時給);
            if (gptRate > 0) {
                console.log(`🤖 GPT分析から時給取得: ${gptRate}円/時`);
                return gptRate;
            }
        }

        // GPT分析結果があっても時給が抽出できない場合
        console.log(`❌ GPT分析結果から時給抽出失敗`);
        return 0;
    }

    /**
     * GPT分析結果から時給を抽出
     */
    private extractRateFromGptAnalysis(gptRate: string): number {
        if (!gptRate) return 0;
        
        // 「2500円」「1500円/時」などの形式から数値を抽出
        const rateMatch = gptRate.match(/([0-9,]+)\s*円/);
        if (rateMatch && rateMatch[1]) {
            const rate = parseInt(rateMatch[1].replace(/,/g, ''));
            // 妥当な時給範囲でバリデーション
            if (rate >= 500 && rate <= 50000) {
                return rate;
            }
        }
        
        return 0;
    }









    /**
     * 予算額を数値で抽出
     */
    private extractBudgetAmount(budget: string): number {
        if (!budget) return 0;
        
        // 「～」や「-」で区切られた範囲の場合は上限値を取得
        const rangeMatch = budget.match(/([0-9,]+)\s*円\s*[~～-]\s*([0-9,]+)\s*円/);
        if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
            const min = parseInt(rangeMatch[1].replace(/,/g, '')) || 0;
            const max = parseInt(rangeMatch[2].replace(/,/g, '')) || 0;
            return Math.max(min, max); // 上限値を返す
        }

        // 単一の金額
        const singleMatch = budget.match(/([0-9,]+)\s*円/);
        if (singleMatch && singleMatch[1]) {
            return parseInt(singleMatch[1].replace(/,/g, '')) || 0;
        }
        
        return 0;
    }

    // 分析済みジョブの処理
    // private processAnalyzedJob(job: AnalyzedJob): ProcessedAnalyzedJob {
    //     // 時給の抽出（例："2500円" → 2500）
    //     let hourlyRate = 0;
    //     if (job.想定時給) {
    //         const rateMatch = job.想定時給.match(/(\d+)/);
    //         if (rateMatch && rateMatch[1]) {
    //             hourlyRate = parseInt(rateMatch[1]);
    //         }
    //     }

    //     // 工数の抽出（例："20時間" → 20）
    //     let workHours = 0;
    //     if (job.工数_見積もり) {
    //         const hoursMatch = job.工数_見積もり.match(/(\d+)/);
    //         if (hoursMatch && hoursMatch[1]) {
    //             workHours = parseInt(hoursMatch[1]);
    //         }
    //     }

    //     return {
    //         hourlyRate,
    //         workHours,
    //         title: job.title || '',
    //         description: job.gpt_summary || '',
    //         url: `https://crowdworks.jp/public/jobs/${job.jobId}`,
    //         category: 'プログラミング',
    //         difficulty: job.難易度 || '',
    //         analysis: job.gpt_summary || ''
    //     };
    // }

    /**
     * おすすめスコアを計算
     */
    private calculateRecommendationScore(job: any): number {
        let score = 0;
        
        // 基本スコア（時給）
        const hourlyRate = job.hourlyRate || 0;
        score += hourlyRate;
        
        // 技術スキル重み付け
        const techKeywords = ['React', 'Vue', 'Angular', 'TypeScript', 'Node.js', 'Python', 'AI', 'Machine Learning', 'Bubble', 'Figma'];
        let techScore = 0;
        const description = (job.description || '').toLowerCase();
        techKeywords.forEach(keyword => {
            if (description.includes(keyword.toLowerCase())) {
                techScore += 1000; // 技術スキルボーナス
            }
        });
        score += techScore;
        
        // 継続性ボーナス
        if (description.includes('継続') || description.includes('長期') || description.includes('パートナー')) {
            score += 2000;
        }
        
        // 急募ボーナス
        if (description.includes('急募') || description.includes('即戦力')) {
            score += 1500;
        }
        
        // 経験者優遇ボーナス
        if (description.includes('経験者') || description.includes('エキスパート') || description.includes('スペシャリスト')) {
            score += 1000;
        }
        
        // フルリモートボーナス
        if (description.includes('フルリモート') || description.includes('完全在宅') || description.includes('在宅')) {
            score += 500;
        }
        
        // 高額案件ボーナス（時給10000円以上）
        if (hourlyRate >= 10000) {
            score += 3000;
        }
        
        return score;
    }

    /**
     * 重複除去
     */
    private removeDuplicates(jobs: any[]): any[] {
        const uniqueJobs = new Map<string, any>();
        
        jobs.forEach(job => {
            const key = `${job.title}-${job.platform}-${job.url}`;
            if (!uniqueJobs.has(key)) {
                uniqueJobs.set(key, job);
            }
        });
        
        return Array.from(uniqueJobs.values());
    }

    /**
     * 技術キーワード分析
     */
    private getTechKeywords(jobs: any[]): Array<{keyword: string, count: number}> {
        const techKeywords = ['React', 'Vue', 'Angular', 'TypeScript', 'Node.js', 'Python', 'AI', 'Machine Learning', 'Bubble', 'Figma', 'WordPress', 'Laravel', 'Next.js', 'Flutter', 'Swift', 'Kotlin'];
        const keywordCounts = new Map<string, number>();
        
        techKeywords.forEach(keyword => {
            const count = jobs.filter(job => {
                const description = (job.description || '').toLowerCase();
                return description.includes(keyword.toLowerCase());
            }).length;
            if (count > 0) {
                keywordCounts.set(keyword, count);
            }
        });
        
        return Array.from(keywordCounts.entries())
            .map(([keyword, count]) => ({keyword, count}))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * 高時給案件フィルタリング
     */
    private filterHighPayingJobs(
        lancersJobs: any[],
        crowdWorksJobs: ProcessedAnalyzedJob[],
        minHourlyRate: number
    ): { lancers: Job[], crowdworks: ProcessedAnalyzedJob[] } {

        // ランサーズデータを処理（GPT分析結果を活用）
        const processedLancers: Job[] = lancersJobs
            .map(job => {
                // GPT分析結果から時給を取得
                const gptHourlyRate = job.想定時給 || 0;
                const budgetAmount = this.extractBudgetAmount(job.budget || '');

                console.log(`🔍 ランサーズ案件: ${job.title}`);
                console.log(`🤖 GPT想定時給: ${gptHourlyRate}円/時`);

                return {
                    id: job.jobId || '',
                    title: job.title || '',
                    description: job.detailedDescription || job.gpt_summary || '',
                    url: job.url || '',
                    budget: {
                        amount: budgetAmount,
                        currency: 'JPY',
                        type: 'fixed' as const
                    },
                    hourlyRate: gptHourlyRate,
                    platform: 'lancers' as const,
                    category: job.category || 'unknown',
                    tags: [],
                    postedAt: job.scrapedAt || new Date().toISOString(),
                    scrapedAt: job.scrapedAt || new Date().toISOString()
                };
            })
            .filter(job => job.hourlyRate >= minHourlyRate);

        // クラウドワークスデータもGPT分析結果を活用
        const filteredCrowdWorks = crowdWorksJobs.filter(job => {
            const hourlyRate = (job as any).想定時給 || 0;
            console.log(`🔍 CrowdWorks案件: ${(job as any).title}`);
            console.log(`🤖 GPT想定時給: ${hourlyRate}円/時`);
            return hourlyRate >= minHourlyRate;
        });

        return {
            lancers: processedLancers,
            crowdworks: filteredCrowdWorks
        };
    }

    // 統合レポートの生成
    private generateUnifiedReport(
        highPayingJobs: { lancers: any[], crowdworks: ProcessedAnalyzedJob[] },
        minHourlyRate: number
    ): string {
        const now = new Date();
        const dateStr = now.toLocaleDateString('ja-JP');
        const timeStr = now.toLocaleTimeString('ja-JP');

        const allJobs = [
            ...highPayingJobs.lancers.map(job => ({
                ...job,
                platform: 'ランサーズ',
                hourlyRate: job.hourlyRate || 0
            })),
            ...highPayingJobs.crowdworks.map(job => ({
                ...job,
                platform: 'クラウドワークス',
                hourlyRate: (job as any).想定時給 || 0,
                工数_見積もり: (job as any).工数_見積もり || '未算出',
                簡易設計: (job as any).簡易設計 || '設計情報なし'
            }))
        ];

        // 重複を除去
        const uniqueJobs = this.removeDuplicates(allJobs);

        // おすすめスコアで並び替え
        const sortedJobs = uniqueJobs
            .map(job => ({
                ...job,
                recommendationScore: this.calculateRecommendationScore(job)
            }))
            .sort((a, b) => b.recommendationScore - a.recommendationScore);

        const totalJobs = sortedJobs.length;
        const hourlyRates = sortedJobs.map(job => job.hourlyRate || 0).filter(rate => rate > 0);
        const maxHourlyRate = hourlyRates.length > 0 ? Math.max(...hourlyRates) : 0;
        const minHourlyRateActual = hourlyRates.length > 0 ? Math.min(...hourlyRates) : 0;
        const avgHourlyRate = hourlyRates.length > 0 ? Math.round(hourlyRates.reduce((sum, rate) => sum + rate, 0) / hourlyRates.length) : 0;

        let report = `# 統合フリーランス案件分析レポート（時給${minHourlyRate}円以上）

> **生成日時**: ${dateStr} ${timeStr}  
> **対象**: Webエンジニア向け高時給案件  
> **最低時給**: ${minHourlyRate.toLocaleString()}円以上  
> **おすすめ順**: 時給 + 技術要件 + 継続性 + 急募度などを総合評価

## 📊 統合サマリー

| 項目 | ランサーズ | クラウドワークス | 合計 |
|------|------------|------------------|------|
| 高時給案件数 | ${highPayingJobs.lancers.length}件 | ${highPayingJobs.crowdworks.length}件 | ${totalJobs}件（重複除去後） |
| 最高時給 | ${highPayingJobs.lancers.length > 0 ? Math.max(...highPayingJobs.lancers.map(j => j.hourlyRate || 0)).toLocaleString() : '0'}円 | ${highPayingJobs.crowdworks.length > 0 ? Math.max(...highPayingJobs.crowdworks.map(j => (j as any).想定時給 || 0)).toLocaleString() : '0'}円 | ${maxHourlyRate.toLocaleString()}円 |
| 平均時給 | ${highPayingJobs.lancers.length > 0 ? Math.round(highPayingJobs.lancers.reduce((sum, j) => sum + (j.hourlyRate || 0), 0) / highPayingJobs.lancers.length).toLocaleString() : '0'}円 | ${highPayingJobs.crowdworks.length > 0 ? Math.round(highPayingJobs.crowdworks.reduce((sum, j) => sum + ((j as any).想定時給 || 0), 0) / highPayingJobs.crowdworks.length).toLocaleString() : '0'}円 | ${avgHourlyRate.toLocaleString()}円 |

## 🎯 市場分析

### 💡 **主要な発見**

- **高時給案件の総数**: ${totalJobs}件（重複除去後）
- **最高時給**: ${maxHourlyRate.toLocaleString()}円
- **時給分布**: ${minHourlyRateActual.toLocaleString()}円 〜 ${maxHourlyRate.toLocaleString()}円
- **平均時給**: ${avgHourlyRate.toLocaleString()}円

### 📈 **プラットフォーム比較**

${highPayingJobs.lancers.length > 0 ? '- **ランサーズ**: ' + highPayingJobs.lancers.length + '件の高時給案件（競争が少なく穴場の可能性）' : '- **ランサーズ**: 高時給案件なし'}
${highPayingJobs.crowdworks.length > 0 ? '- **クラウドワークス**: ' + highPayingJobs.crowdworks.length + '件の高時給案件（案件数豊富）' : '- **クラウドワークス**: 高時給案件なし'}

## 💼 おすすめ案件ランキング（総合評価順）

`;

        // おすすめ順でソート表示
        sortedJobs.forEach((job, index) => {
            const platform = job.platform === 'ランサーズ' ? '🟦' : '🟨';
            const urgent = job.isUrgent ? '🔥 **急募** ' : '';



            report += `### ${index + 1}位: ${platform} ${urgent}${job.title || 'タイトル不明'}

**💰 想定時給:** ${(job.hourlyRate || 0).toLocaleString()}円  
**⏱️ 見込み時間:** ${job.工数_見積もり || '未算出'}  
**🏗️ 簡易設計:** ${job.簡易設計 || '設計情報なし'}  
**📊 おすすめスコア:** ${job.recommendationScore.toLocaleString()}pt  
**🏷️ カテゴリ:** ${job.category || 'カテゴリ不明'}  
**📱 プラットフォーム:** ${job.platform}  
**🔗 案件URL:** ${job.url || '#'}

**📝 概要:**  
${job.detailedDescription ? job.detailedDescription.substring(0, 300) + '...' : job.gpt_summary || '詳細情報なし'}

---

`;
        });

        // 技術キーワード分析
        const techKeywords = this.getTechKeywords(sortedJobs);

        report += `
## 🎯 戦略的提案

### 📋 **おすすめアクション**

1. **即座に応募すべき案件**: 上位5件（おすすめスコア${sortedJobs.length > 4 ? sortedJobs[4].recommendationScore.toLocaleString() : '10,000'}pt以上）
2. **ポートフォリオ強化**: ${highPayingJobs.lancers.length > 0 && highPayingJobs.crowdworks.length > 0 ? '両プラットフォームでの実績作り' : '主要プラットフォームでの実績作り'}
3. **スキルアップ領域**: システム開発、API連携、高度なフロントエンド技術

### 💡 **市場戦略**

- **ランサーズ**: ${highPayingJobs.lancers.length > 0 ? '競争が少なく高時給を狙いやすい' : '高時給案件が少ないため要注意'}
- **クラウドワークス**: ${highPayingJobs.crowdworks.length > 0 ? '案件数が豊富で安定収入を期待できる' : '高時給案件獲得に向けた戦略的アプローチが必要'}

### 🔥 **注目技術キーワード**

${techKeywords.map(tech => `- **${tech.keyword}**: ${tech.count}件`).join('\n')}

---

*このレポートは${now.toLocaleString('ja-JP')}に自動生成されました。*
`;

        return report;
    }

    // メイン実行
    async execute(minHourlyRate: number): Promise<void> {
        console.log('🚀 統合レポート生成を開始します...');
        console.log(`💰 最低時給: ${minHourlyRate}円`);

        // データ読み込み
        console.log('\n📚 データ読み込み中...');
        const { lancers, crowdworks } = this.loadJobData();

        if (lancers.length === 0 && crowdworks.length === 0) {
            console.error('❌ データが見つかりません。先にスクレイピングを実行してください。');
            return;
        }

        // 高時給案件の抽出
        console.log('\n🔍 高時給案件を抽出中...');
        const highPayingJobs = this.filterHighPayingJobs(lancers, crowdworks, minHourlyRate);

        console.log(`🔥 高時給案件 (${minHourlyRate}円以上):`);
        console.log(`   ランサーズ: ${highPayingJobs.lancers.length}件`);
        console.log(`   クラウドワークス: ${highPayingJobs.crowdworks.length}件`);

        if (highPayingJobs.lancers.length === 0 && highPayingJobs.crowdworks.length === 0) {
            console.log(`⚠️ 時給${minHourlyRate}円以上の案件が見つかりませんでした。`);
            return;
        }

        // レポート生成
        console.log('\n📄 統合レポートを生成中...');
        const report = this.generateUnifiedReport(highPayingJobs, minHourlyRate);

        // ファイル保存
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const filename = `unified-high-paying-jobs-${timestamp}.md`;
        const filepath = path.join(this.outputDir, filename);

        fs.writeFileSync(filepath, report, 'utf8');

        console.log('\n✅ 統合レポート生成完了！');
        console.log(`📁 保存先: ${filepath}`);
        console.log(`📊 総案件数: ${highPayingJobs.lancers.length + highPayingJobs.crowdworks.length}件`);
    }
}

// メイン実行
async function main() {
    try {
        const args = process.argv.slice(2);
        const minHourlyRate = args.length > 0 && args[0] ? parseInt(args[0]) : 2000; // デフォルトを2000円に変更

    const generator = new UnifiedReportGenerator();
    await generator.execute(minHourlyRate);
    } catch (error) {
        console.error('❌ レポート生成中にエラーが発生しました:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

export { UnifiedReportGenerator };