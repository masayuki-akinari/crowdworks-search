import * as fs from 'fs';
import * as path from 'path';

// Job型定義
interface Job {
    id: string;
    title: string;
    platform: string;
    url: string;
    budget: string;
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
}

interface AnalyzedJob {
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
    private getLatestLancersFile(): string | null {
        const files = fs.readdirSync(this.outputDir)
            .filter(file => file.startsWith('lancers-jobs-') && file.endsWith('.json'))
            .sort()
            .reverse();

        return files.length > 0 ? path.join(this.outputDir, files[0]!) : null;
    }

    // 最新のクラウドワークス分析ファイルを取得
    private getLatestCrowdWorksFiles(): string[] {
        const files = fs.readdirSync(this.outputDir)
            .filter(file => file.startsWith('analyzed-') && file.endsWith('.json'))
            .map(file => path.join(this.outputDir, file));

        return files;
    }

    // ランサーズデータの読み込み
    private loadLancersData(): Job[] {
        const filePath = this.getLatestLancersFile();
        if (!filePath || !fs.existsSync(filePath)) {
            console.log('⚠️ ランサーズデータが見つかりません');
            return [];
        }

        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            console.log(`📁 ランサーズデータ読み込み: ${data.length}件`);
            return data;
        } catch (error) {
            console.error('❌ ランサーズデータの読み込みエラー:', error);
            return [];
        }
    }

    // クラウドワークス分析データの読み込み
    private loadCrowdWorksData(): AnalyzedJob[] {
        const files = this.getLatestCrowdWorksFiles();
        let allJobs: AnalyzedJob[] = [];

        for (const file of files) {
            try {
                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (Array.isArray(data)) {
                    allJobs = allJobs.concat(data);
                    console.log(`📁 ${path.basename(file)}: ${data.length}件`);
                }
            } catch (error) {
                console.error(`❌ ${file} の読み込みエラー:`, error);
            }
        }

        console.log(`📊 クラウドワークス合計: ${allJobs.length}件`);
        return allJobs;
    }

    // ランサーズの時給を推定
    private estimateLancersHourlyRate(job: Job): number {
        if (job.hourlyRate && job.hourlyRate > 0) {
            return job.hourlyRate;
        }

        // 予算から時給を推定
        const budgetMatch = job.budget.match(/[\d,]+/);
        if (budgetMatch) {
            const budget = parseInt(budgetMatch[0].replace(/,/g, ''));

            // 難易度と作業時間を推定
            let estimatedHours = 40; // デフォルト

            if (job.description.includes('急募') || job.isUrgent) {
                estimatedHours *= 0.7; // 急募は短時間
            }

            if (job.description.includes('簡単') || job.description.includes('単純')) {
                estimatedHours *= 0.5;
            } else if (job.description.includes('複雑') || job.description.includes('高度')) {
                estimatedHours *= 1.5;
            }

            return Math.round(budget / estimatedHours);
        }

        return 0;
    }

    // 高時給案件のフィルタリング
    private filterHighPayingJobs(
        lancersJobs: Job[],
        crowdWorksJobs: AnalyzedJob[],
        minHourlyRate: number = 3000
    ): { lancers: Job[], crowdworks: AnalyzedJob[] } {

        const filteredLancers = lancersJobs
            .map(job => ({
                ...job,
                estimatedHourlyRate: this.estimateLancersHourlyRate(job)
            }))
            .filter(job => job.estimatedHourlyRate >= minHourlyRate);

        const filteredCrowdWorks = crowdWorksJobs
            .filter(job => job.hourlyRate >= minHourlyRate);

        console.log(`🔥 高時給案件 (${minHourlyRate}円以上):`);
        console.log(`   ランサーズ: ${filteredLancers.length}件`);
        console.log(`   クラウドワークス: ${filteredCrowdWorks.length}件`);

        return {
            lancers: filteredLancers,
            crowdworks: filteredCrowdWorks
        };
    }

    // 統合レポートの生成
    private generateUnifiedReport(
        highPayingJobs: { lancers: any[], crowdworks: AnalyzedJob[] },
        minHourlyRate: number
    ): string {
        const now = new Date();
        const dateStr = now.toLocaleDateString('ja-JP');
        const timeStr = now.toLocaleTimeString('ja-JP');

        const allJobs = [
            ...highPayingJobs.lancers.map(job => ({
                ...job,
                platform: 'ランサーズ',
                hourlyRate: job.estimatedHourlyRate
            })),
            ...highPayingJobs.crowdworks.map(job => ({
                ...job,
                platform: 'クラウドワークス'
            }))
        ].sort((a, b) => b.hourlyRate - a.hourlyRate);

        const totalJobs = allJobs.length;
        const maxHourlyRate = Math.max(...allJobs.map(job => job.hourlyRate));
        const minHourlyRateActual = Math.min(...allJobs.map(job => job.hourlyRate));
        const avgHourlyRate = Math.round(allJobs.reduce((sum, job) => sum + job.hourlyRate, 0) / totalJobs);

        let report = `# 統合フリーランス案件分析レポート（時給${minHourlyRate}円以上）

> **生成日時**: ${dateStr} ${timeStr}  
> **対象**: Webエンジニア向け高時給案件  
> **最低時給**: ${minHourlyRate.toLocaleString()}円以上  

## 📊 統合サマリー

| 項目 | ランサーズ | クラウドワークス | 合計 |
|------|------------|------------------|------|
| 高時給案件数 | ${highPayingJobs.lancers.length}件 | ${highPayingJobs.crowdworks.length}件 | ${totalJobs}件 |
| 最高時給 | ${highPayingJobs.lancers.length > 0 ? Math.max(...highPayingJobs.lancers.map(j => j.hourlyRate)).toLocaleString() : '0'}円 | ${highPayingJobs.crowdworks.length > 0 ? Math.max(...highPayingJobs.crowdworks.map(j => j.hourlyRate)).toLocaleString() : '0'}円 | ${maxHourlyRate.toLocaleString()}円 |
| 平均時給 | ${highPayingJobs.lancers.length > 0 ? Math.round(highPayingJobs.lancers.reduce((sum, j) => sum + j.hourlyRate, 0) / highPayingJobs.lancers.length).toLocaleString() : '0'}円 | ${highPayingJobs.crowdworks.length > 0 ? Math.round(highPayingJobs.crowdworks.reduce((sum, j) => sum + j.hourlyRate, 0) / highPayingJobs.crowdworks.length).toLocaleString() : '0'}円 | ${avgHourlyRate.toLocaleString()}円 |

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

            report += `### ${index + 1}位: ${platform} ${urgent}${job.title}

**💰 想定時給:** ${job.hourlyRate.toLocaleString()}円  
**🏷️ カテゴリ:** ${job.category}  
**📱 プラットフォーム:** ${job.platform}  
**🔗 案件URL:** ${job.url}

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
        const lancersJobs = this.loadLancersData();
        const crowdWorksJobs = this.loadCrowdWorksData();

        if (lancersJobs.length === 0 && crowdWorksJobs.length === 0) {
            console.error('❌ データが見つかりません。先にスクレイピングを実行してください。');
            return;
        }

        // 高時給案件の抽出
        console.log('\n🔍 高時給案件を抽出中...');
        const highPayingJobs = this.filterHighPayingJobs(lancersJobs, crowdWorksJobs, minHourlyRate);

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
    const args = process.argv.slice(2);
    const minHourlyRate = args[0] ? parseInt(args[0]) : 3000;

    const generator = new UnifiedReportGenerator();
    await generator.execute(minHourlyRate);
}

if (require.main === module) {
    main().catch(console.error);
}

export { UnifiedReportGenerator }; 