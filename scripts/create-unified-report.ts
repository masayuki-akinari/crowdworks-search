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

interface AnalyzedJob {
    jobId: string;
    title: string;
    工数_見積もり: string;
    想定時給: string;
    難易度: string;
    gpt_summary: string;
}

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
    private getLatestCrowdWorksFiles(): string[] {
        const files = fs.readdirSync(this.outputDir)
            .filter(file => file.startsWith('analyzed-') && file.endsWith('.json'))
            .map(file => path.join(this.outputDir, file));

        return files;
    }

    /**
     * データファイル読み込み
     */
    private loadJobData(): { lancers: any[], crowdworks: any[] } {
        console.log('📚 データ読み込み中...');

        // ランサーズデータ読み込み（最新のファイルを使用）
        const lancersData: any[] = [];

        // 新しいランサーズデータファイル
        const newLancersFile = 'output/lancers-details-2025-06-09T17-38-02-401Z.json';
        if (fs.existsSync(newLancersFile)) {
            const newData = JSON.parse(fs.readFileSync(newLancersFile, 'utf8'));
            lancersData.push(...newData);
            console.log(`📁 新ランサーズデータ読み込み: ${newData.length}件`);
        }

        // CrowdWorksデータ読み込み（テストデータを使用）
        const crowdworksData: any[] = [];
        const testCrowdWorksFile = 'output/test-scraping-results-2025-06-09T17-44-05-602Z.json';
        if (fs.existsSync(testCrowdWorksFile)) {
            const testData = JSON.parse(fs.readFileSync(testCrowdWorksFile, 'utf8'));
            // テストデータの構造に合わせて処理
            crowdworksData.push(...testData.map((job: any) => ({
                ...job,
                想定時給: this.estimateHourlyRateFromBudget(job.budget || ''),
                工数_見積もり: 40, // デフォルト値
                難易度: 'medium'
            })));
            console.log(`📁 CrowdWorksテストデータ読み込み: ${testData.length}件`);
        }

        return { lancers: lancersData, crowdworks: crowdworksData };
    }

    /**
     * 予算文字列から時給を推定
     */
    private estimateHourlyRateFromBudget(budgetText: string): number {
        if (!budgetText) return 0;

        // 金額を抽出
        const amounts = budgetText.match(/(\\d{1,3}(?:,\\d{3})*)/g);
        if (!amounts || amounts.length === 0) return 0;

        const amount = parseInt(amounts[0].replace(/,/g, ''));

        // 時給か固定報酬かを判定
        if (budgetText.includes('時間') || budgetText.includes('/時')) {
            return amount;
        }

        // 固定報酬の場合は40時間で割って時給を推定
        return Math.round(amount / 40);
    }

    // 分析済みジョブの処理
    private processAnalyzedJob(job: AnalyzedJob): ProcessedAnalyzedJob {
        // 時給の抽出（例："2500円" → 2500）
        let hourlyRate = 0;
        if (job.想定時給) {
            const rateMatch = job.想定時給.match(/(\d+)/);
            if (rateMatch && rateMatch[1]) {
                hourlyRate = parseInt(rateMatch[1]);
            }
        }

        // 工数の抽出（例："20時間" → 20）
        let workHours = 0;
        if (job.工数_見積もり) {
            const hoursMatch = job.工数_見積もり.match(/(\d+)/);
            if (hoursMatch && hoursMatch[1]) {
                workHours = parseInt(hoursMatch[1]);
            }
        }

        return {
            hourlyRate,
            workHours,
            title: job.title || '',
            description: job.gpt_summary || '',
            url: `https://crowdworks.jp/public/jobs/${job.jobId}`,
            category: 'プログラミング',
            difficulty: job.難易度 || '',
            analysis: job.gpt_summary || ''
        };
    }

    /**
     * 高時給案件フィルタリング
     */
    private filterHighPayingJobs(
        lancersJobs: any[],
        crowdWorksJobs: ProcessedAnalyzedJob[],
        minHourlyRate: number
    ): { lancers: Job[], crowdworks: ProcessedAnalyzedJob[] } {

        // ランサーズデータを処理（新しいデータ構造対応）
        const processedLancers: Job[] = lancersJobs
            .filter(job => job.budget && job.budget.trim() !== '')
            .map(job => {
                // 予算から金額を抽出
                const budgetText = job.budget || '';
                const amounts = budgetText.match(/(\d{1,3}(?:,\d{3})*)/g);

                let amount = 0;
                if (amounts && amounts.length > 0) {
                    // 最初の金額を使用（通常は最低金額）
                    amount = parseInt(amounts[0].replace(/,/g, ''));
                }

                // 時給を推定（固定報酬を40時間で割る概算）
                const estimatedHourlyRate = amount > 0 ? Math.round(amount / 40) : 0;

                return {
                    id: job.jobId || '',
                    title: job.title || '',
                    description: job.detailedDescription || '',
                    url: job.url || '',
                    budget: {
                        amount: amount,
                        currency: 'JPY',
                        type: 'fixed' as const
                    },
                    hourlyRate: estimatedHourlyRate,
                    platform: 'lancers' as const,
                    category: job.category || 'unknown',
                    tags: [],
                    postedAt: job.scrapedAt || new Date().toISOString(),
                    scrapedAt: job.scrapedAt || new Date().toISOString()
                };
            })
            .filter(job => job.hourlyRate >= minHourlyRate);

        // クラウドワークスデータはそのまま
        const filteredCrowdWorks = crowdWorksJobs.filter(job => {
            const hourlyRate = (job as any).想定時給 || 0;
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
                hourlyRate: (job as any).想定時給 || 0
            }))
        ].sort((a, b) => (b.hourlyRate || 0) - (a.hourlyRate || 0));

        const totalJobs = allJobs.length;
        const hourlyRates = allJobs.map(job => job.hourlyRate || 0).filter(rate => rate > 0);
        const maxHourlyRate = hourlyRates.length > 0 ? Math.max(...hourlyRates) : 0;
        const minHourlyRateActual = hourlyRates.length > 0 ? Math.min(...hourlyRates) : 0;
        const avgHourlyRate = hourlyRates.length > 0 ? Math.round(hourlyRates.reduce((sum, rate) => sum + rate, 0) / hourlyRates.length) : 0;

        let report = `# 統合フリーランス案件分析レポート（時給${minHourlyRate}円以上）

> **生成日時**: ${dateStr} ${timeStr}  
> **対象**: Webエンジニア向け高時給案件  
> **最低時給**: ${minHourlyRate.toLocaleString()}円以上  

## 📊 統合サマリー

| 項目 | ランサーズ | クラウドワークス | 合計 |
|------|------------|------------------|------|
| 高時給案件数 | ${highPayingJobs.lancers.length}件 | ${highPayingJobs.crowdworks.length}件 | ${totalJobs}件 |
| 最高時給 | ${highPayingJobs.lancers.length > 0 ? Math.max(...highPayingJobs.lancers.map(j => j.hourlyRate || 0)).toLocaleString() : '0'}円 | ${highPayingJobs.crowdworks.length > 0 ? Math.max(...highPayingJobs.crowdworks.map(j => (j as any).想定時給 || 0)).toLocaleString() : '0'}円 | ${maxHourlyRate.toLocaleString()}円 |
| 平均時給 | ${highPayingJobs.lancers.length > 0 ? Math.round(highPayingJobs.lancers.reduce((sum, j) => sum + (j.hourlyRate || 0), 0) / highPayingJobs.lancers.length).toLocaleString() : '0'}円 | ${highPayingJobs.crowdworks.length > 0 ? Math.round(highPayingJobs.crowdworks.reduce((sum, j) => sum + ((j as any).想定時給 || 0), 0) / highPayingJobs.crowdworks.length).toLocaleString() : '0'}円 | ${avgHourlyRate.toLocaleString()}円 |

## 🎯 市場分析

### 💡 **主要な発見**

- **高時給案件の総数**: ${totalJobs}件
- **最高時給**: ${maxHourlyRate.toLocaleString()}円
- **時給分布**: ${minHourlyRateActual.toLocaleString()}円 〜 ${maxHourlyRate.toLocaleString()}円
- **平均時給**: ${avgHourlyRate.toLocaleString()}円

### 📈 **プラットフォーム比較**

${highPayingJobs.lancers.length > 0 ? '- **ランサーズ**: ' + highPayingJobs.lancers.length + '件の高時給案件（競争が少なく穴場の可能性）' : '- **ランサーズ**: 高時給案件なし'}
${highPayingJobs.crowdworks.length > 0 ? '- **クラウドワークス**: ' + highPayingJobs.crowdworks.length + '件の高時給案件（案件数豊富）' : '- **クラウドワークス**: 高時給案件なし'}

## 💼 高時給案件ランキング（時給順）

`;

        // 全案件を時給順でソート表示
        allJobs.forEach((job, index) => {
            const platform = job.platform === 'ランサーズ' ? '🟦' : '🟨';
            const urgent = job.isUrgent ? '🔥 **急募** ' : '';

            report += `### ${index + 1}位: ${platform} ${urgent}${job.title || 'タイトル不明'}

**💰 想定時給:** ${(job.hourlyRate || 0).toLocaleString()}円  
**🏷️ カテゴリ:** ${job.category || 'カテゴリ不明'}  
**📱 プラットフォーム:** ${job.platform}  
**🔗 案件URL:** ${job.url || '#'}

**📝 概要:**  
${job.description ? job.description.substring(0, 200) + '...' : job.analysis || '詳細情報なし'}

---

`;
        });

        report += `
## 🎯 戦略的提案

### 📋 **おすすめアクション**

1. **即座に応募すべき案件**: 上位5件（時給${Math.round(maxHourlyRate * 0.8).toLocaleString()}円以上）
2. **ポートフォリオ強化**: ${highPayingJobs.lancers.length > 0 && highPayingJobs.crowdworks.length > 0 ? '両プラットフォームでの実績作り' : '主要プラットフォームでの実績作り'}
3. **スキルアップ領域**: システム開発、API連携、高度なフロントエンド技術

### 💡 **市場戦略**

- **ランサーズ**: ${highPayingJobs.lancers.length > 0 ? '競争が少なく高時給を狙いやすい' : '高時給案件が少ないため要注意'}
- **クラウドワークス**: ${highPayingJobs.crowdworks.length > 0 ? '案件数が豊富で安定収入を期待できる' : '高時給案件獲得に向けた戦略的アプローチが必要'}

---

*このレポートは${now.toLocaleString('ja-JP')}に自動生成されました。*
`;

        return report;
    }

    // メイン実行
    async execute(minHourlyRate: number = 3000): Promise<void> {
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
    console.log('🚀 統合レポート生成を開始します...');

    // 設定
    const minHourlyRate = 1000; // 3000から1000に変更
    console.log(`💰 最低時給: ${minHourlyRate}円`);

    const generator = new UnifiedReportGenerator();
    await generator.execute(minHourlyRate);
}

if (require.main === module) {
    main().catch(console.error);
}

export { UnifiedReportGenerator };