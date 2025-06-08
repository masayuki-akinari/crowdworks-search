import * as fs from 'fs';
import * as path from 'path';

// Job型定義
interface Job {
    id: string;
    title: string;
    platform: 'ランサーズ' | 'クラウドワークス';
    url: string;
    budget: string;
    hourlyRate: number;
    category: string;
    subcategory: string;
    description: string;
    client: string;
    clientRating: number;
    clientOrderCount: number;
    postedAt: Date | string;
    deadline: string;
    tags: string[];
    workType: string;
    isUrgent: boolean;
    isPremium: boolean;
    industry: string;
    workRank: string;
    appliedCount: number;
    recruitCount: number;
}

class JobFilter {
    private outputDir: string;

    constructor() {
        this.outputDir = path.join(process.cwd(), 'output');
    }

    // 終了済み案件を判定
    private isJobClosed(job: Job): boolean {
        const closedKeywords = [
            '募集終了',
            '締切済み',
            '終了済み',
            '募集停止',
            '募集中止',
            '受付終了'
        ];

        const textToCheck = [
            job.title,
            job.description,
            job.budget
        ].join(' ');

        return closedKeywords.some(keyword => textToCheck.includes(keyword));
    }

    // ランサーズファイルをフィルタリング
    async filterLancersJobs(): Promise<void> {
        console.log('🔍 ランサーズファイルを検索中...');

        const files = fs.readdirSync(this.outputDir)
            .filter(file => file.includes('lancers-jobs') && file.endsWith('.json'))
            .sort();

        for (const filename of files) {
            const filePath = path.join(this.outputDir, filename);

            try {
                console.log(`📄 処理中: ${filename}`);

                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                if (!Array.isArray(data)) {
                    console.log(`⚠️ スキップ: ${filename} (配列形式ではありません)`);
                    continue;
                }

                const originalCount = data.length;
                const activeJobs = data.filter((job: Job) => !this.isJobClosed(job));
                const removedCount = originalCount - activeJobs.length;

                if (removedCount > 0) {
                    // フィルタリング後のファイルを保存
                    const newFilename = filename.replace('.json', '-active.json');
                    const newFilePath = path.join(this.outputDir, newFilename);

                    fs.writeFileSync(newFilePath, JSON.stringify(activeJobs, null, 2));

                    console.log(`✅ ${filename}:`);
                    console.log(`   元の案件数: ${originalCount}`);
                    console.log(`   有効案件数: ${activeJobs.length}`);
                    console.log(`   除外案件数: ${removedCount}`);
                    console.log(`   保存先: ${newFilename}`);
                } else {
                    console.log(`✨ ${filename}: 終了済み案件なし (${originalCount}件すべて有効)`);
                }

            } catch (error) {
                console.error(`❌ エラー処理 ${filename}:`, error);
            }
        }
    }

    // 統計情報を表示
    async showFilterStatistics(): Promise<void> {
        console.log('\n📊 フィルタリング統計:');

        const files = fs.readdirSync(this.outputDir)
            .filter(file => file.includes('lancers-jobs') && file.endsWith('.json'));

        const originalFiles = files.filter(f => !f.includes('-active'));
        const activeFiles = files.filter(f => f.includes('-active'));

        let totalOriginal = 0;
        let totalActive = 0;

        for (const filename of originalFiles) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(this.outputDir, filename), 'utf8'));
                if (Array.isArray(data)) totalOriginal += data.length;
            } catch (error) {
                // エラーは無視
            }
        }

        for (const filename of activeFiles) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(this.outputDir, filename), 'utf8'));
                if (Array.isArray(data)) totalActive += data.length;
            } catch (error) {
                // エラーは無視
            }
        }

        console.log(`🔢 元の総案件数: ${totalOriginal}`);
        console.log(`✅ 有効案件数: ${totalActive}`);
        console.log(`⏹️ 除外案件数: ${totalOriginal - totalActive}`);
        console.log(`📈 有効案件率: ${totalOriginal > 0 ? ((totalActive / totalOriginal) * 100).toFixed(1) : 0}%`);
    }

    async run(): Promise<void> {
        console.log('🚀 ランサーズ案件フィルタリングを開始します...');

        await this.filterLancersJobs();
        await this.showFilterStatistics();

        console.log('🎉 フィルタリング完了！');
    }
}

// メイン実行部分
async function main(): Promise<void> {
    const filter = new JobFilter();
    await filter.run();
}

if (require.main === module) {
    main().catch(console.error);
}

export { JobFilter };