import fs from 'fs';

interface Job {
    title: string;
    budget: string;
    url: string;
    description: string;
    hourlyRate: number;
    platform: string;
}

interface LancersJob {
    jobId: string;
    title: string;
    budget: string;
    url: string;
    detailedDescription: string;
}

interface CrowdWorksJob {
    jobId: string;
    title: string;
    budget: string;
    url: string;
    description: string;
}

class SmallUnifiedReportGenerator {

    constructor() { }

    /**
     * 新しいデータから統合レポートを生成
     */
    async generateReport(): Promise<void> {
        console.log('🚀 小規模統合レポート生成開始...');

        // データ読み込み
        const data = this.loadJobData();

        console.log(`📊 読み込み結果:`);
        console.log(`   ランサーズ: ${data.lancers.length}件`);
        console.log(`   CrowdWorks: ${data.crowdworks.length}件`);

        // 高時給案件抽出（1000円以上）
        const minHourlyRate = 1000;
        const highPayingJobs = this.filterHighPayingJobs(data.lancers, data.crowdworks, minHourlyRate);

        console.log(`\n🔥 高時給案件 (${minHourlyRate}円以上):`);
        console.log(`   ランサーズ: ${highPayingJobs.lancers.length}件`);
        console.log(`   CrowdWorks: ${highPayingJobs.crowdworks.length}件`);

        if (highPayingJobs.lancers.length === 0 && highPayingJobs.crowdworks.length === 0) {
            console.log(`⚠️ 時給${minHourlyRate}円以上の案件が見つかりませんでした。`);
            return;
        }

        // レポート生成
        const report = this.createMarkdownReport(highPayingJobs.lancers, highPayingJobs.crowdworks, minHourlyRate);

        // ファイル保存
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `output/unified-small-report-${timestamp}.md`;
        fs.writeFileSync(filename, report, 'utf8');

        console.log(`\n📄 レポート生成完了！`);
        console.log(`💾 保存先: ${filename}`);
    }

    /**
     * データ読み込み
     */
    private loadJobData(): { lancers: LancersJob[], crowdworks: CrowdWorksJob[] } {
        console.log('📚 データ読み込み中...');

        // ランサーズデータ読み込み
        const lancersData: LancersJob[] = [];
        const lancersFile = 'output/lancers-details-2025-06-09T17-38-02-401Z.json';
        if (fs.existsSync(lancersFile)) {
            const data = JSON.parse(fs.readFileSync(lancersFile, 'utf8'));
            lancersData.push(...data);
            console.log(`📁 ランサーズデータ読み込み: ${data.length}件`);
        }

        // CrowdWorksデータ読み込み（新しい50件データを優先使用）
        const crowdworksData: CrowdWorksJob[] = [];

        // 新しい50件データファイル
        const newCrowdWorksFile = 'output/crowdworks-web-jobs-2025-06-09T18-47-49-913Z.json';
        if (fs.existsSync(newCrowdWorksFile)) {
            const data = JSON.parse(fs.readFileSync(newCrowdWorksFile, 'utf8'));
            crowdworksData.push(...data);
            console.log(`📁 CrowdWorks修正データ読み込み: ${data.length}件`);
        } else {
            // フォールバック：前のデータ
            const oldCrowdWorksFile = 'output/crowdworks-web-jobs-2025-06-09T18-39-50-670Z.json';
            if (fs.existsSync(oldCrowdWorksFile)) {
                const data = JSON.parse(fs.readFileSync(oldCrowdWorksFile, 'utf8'));
                crowdworksData.push(...data);
                console.log(`📁 CrowdWorks旧データ読み込み: ${data.length}件`);
            }
        }

        return { lancers: lancersData, crowdworks: crowdworksData };
    }

    /**
     * 予算文字列から時給を推定
     */
    private estimateHourlyRate(budgetText: string): number {
        if (!budgetText || budgetText === '未取得' || budgetText === 'エラー') return 0;

        // タイトルが混入している場合は除外
        if (budgetText.length > 100 || budgetText.includes('募集') || budgetText.includes('開発')) {
            return 0;
        }

        // 金額を抽出
        const amounts = budgetText.match(/(\d{1,3}(?:,\d{3})*)/g);
        if (!amounts || amounts.length === 0) return 0;

        let amount = parseInt(amounts[0].replace(/,/g, ''));

        // 時給表記の場合
        if (budgetText.includes('時間') || budgetText.includes('/時') || budgetText.includes('時給')) {
            return amount;
        }

        // 範囲がある場合は最大値を使用
        if (amounts.length > 1) {
            const lastAmount = amounts[amounts.length - 1];
            if (lastAmount) {
                amount = parseInt(lastAmount.replace(/,/g, ''));
            }
        }

        // 固定報酬の場合
        // 異常に高い金額（月100万円以上）の場合は年額と仮定して月額に変換
        if (amount > 1000000) {
            // 年額の場合は12で割って月額に変換
            const monthlyAmount = amount / 12;
            // 月額を160時間（月20日×8時間）で割って時給を推定
            return Math.round(monthlyAmount / 160);
        }

        // 通常の月額報酬の場合は160時間で割る
        if (amount > 50000) {
            return Math.round(amount / 160);
        }

        // 小額の場合は時給として扱う
        return amount;
    }

    /**
     * 高時給案件フィルタリング
     */
    private filterHighPayingJobs(
        lancersJobs: LancersJob[],
        crowdworksJobs: CrowdWorksJob[],
        minHourlyRate: number
    ): { lancers: Job[], crowdworks: Job[] } {

        // ランサーズ案件処理
        const processedLancers: Job[] = lancersJobs
            .filter(job => job.budget && job.budget.trim() !== '')
            .map(job => ({
                title: job.title || 'タイトル不明',
                budget: job.budget,
                url: job.url,
                description: job.detailedDescription || '',
                hourlyRate: this.estimateHourlyRate(job.budget),
                platform: 'ランサーズ'
            }))
            .filter(job => job.hourlyRate >= minHourlyRate);

        // CrowdWorks案件処理
        const processedCrowdworks: Job[] = crowdworksJobs
            .filter(job => job.budget && job.budget.trim() !== '')
            .map(job => ({
                title: job.title || 'タイトル不明',
                budget: job.budget,
                url: job.url,
                description: job.description || '',
                hourlyRate: this.estimateHourlyRate(job.budget),
                platform: 'CrowdWorks'
            }))
            .filter(job => job.hourlyRate >= minHourlyRate);

        return { lancers: processedLancers, crowdworks: processedCrowdworks };
    }

    /**
     * Markdownレポート作成
     */
    private createMarkdownReport(lancersJobs: Job[], crowdworksJobs: Job[], minHourlyRate: number): string {
        const allJobs = [...lancersJobs, ...crowdworksJobs]
            .sort((a, b) => b.hourlyRate - a.hourlyRate);

        const timestamp = new Date().toLocaleString('ja-JP');

        let report = `# 統合高時給案件レポート（時給${minHourlyRate}円以上）\n\n`;
        report += `> **生成日時**: ${timestamp}\n`;
        report += `> **データ**: ランサーズ${lancersJobs.length}件 + CrowdWorks${crowdworksJobs.length}件 = 合計${allJobs.length}件\n\n`;

        // 統計情報
        if (allJobs.length > 0) {
            const maxRate = Math.max(...allJobs.map(job => job.hourlyRate));
            const avgRate = Math.round(allJobs.reduce((sum, job) => sum + job.hourlyRate, 0) / allJobs.length);

            report += `## 📊 統計情報\n\n`;
            report += `| 項目 | ランサーズ | CrowdWorks | 合計 |\n`;
            report += `|------|------------|------------|------|\n`;
            report += `| 案件数 | ${lancersJobs.length}件 | ${crowdworksJobs.length}件 | ${allJobs.length}件 |\n`;
            report += `| 最高時給 | ${lancersJobs.length > 0 ? Math.max(...lancersJobs.map(j => j.hourlyRate)).toLocaleString() : '0'}円 | ${crowdworksJobs.length > 0 ? Math.max(...crowdworksJobs.map(j => j.hourlyRate)).toLocaleString() : '0'}円 | ${maxRate.toLocaleString()}円 |\n`;
            report += `| 平均時給 | ${lancersJobs.length > 0 ? Math.round(lancersJobs.reduce((sum, j) => sum + j.hourlyRate, 0) / lancersJobs.length).toLocaleString() : '0'}円 | ${crowdworksJobs.length > 0 ? Math.round(crowdworksJobs.reduce((sum, j) => sum + j.hourlyRate, 0) / crowdworksJobs.length).toLocaleString() : '0'}円 | ${avgRate.toLocaleString()}円 |\n\n`;
        }

        // 案件一覧
        report += `## 🏆 高時給案件ランキング\n\n`;

        allJobs.forEach((job, index) => {
            report += `### ${index + 1}位: ${job.platform} - ${job.title}\n\n`;
            report += `**💰 推定時給:** ${job.hourlyRate.toLocaleString()}円\n`;
            report += `**💵 予算:** ${job.budget}\n`;
            report += `**🔗 URL:** ${job.url}\n\n`;
            report += `**📝 概要:**\n`;
            report += `${job.description.substring(0, 300)}...\n\n`;
            report += `---\n\n`;
        });

        return report;
    }
}

// メイン実行
async function main() {
    const generator = new SmallUnifiedReportGenerator();
    await generator.generateReport();
}

if (require.main === module) {
    main().catch(error => {
        console.error('💥 エラー:', error);
        process.exit(1);
    });
} 