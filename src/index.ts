/**
 * CrowdWorks Search System - Main Entry Point
 * Docker環境での開発用エントリーポイント
 */

import { ExecutionLog } from '@/types';

// 環境変数の検証
function validateEnvironment(): void {
    const required = ['NODE_ENV', 'AWS_REGION'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}

// メイン実行関数
async function main(): Promise<void> {
    try {
        validateEnvironment();

        const log: ExecutionLog = {
            executionId: Date.now().toString(),
            timestamp: new Date().toISOString(),
            status: 'success',
            duration: 0,
            jobsScraped: 0,
            newJobs: 0,
            aiEvaluated: 0,
            highScoreJobs: 0,
            costEstimate: 0,
        };

        console.log('🚀 CrowdWorks Search System - Development Mode');
        console.log(`Environment: ${process.env.NODE_ENV}`);
        console.log(`AWS Region: ${process.env.AWS_REGION}`);
        console.log(`Execution ID: ${log.executionId}`);

        // TODO: 実際の処理を実装
        console.log('✅ Development setup completed');

    } catch (error) {
        console.error('❌ Failed to start application:', error);
        process.exit(1);
    }
}

// 開発環境でのみ実行
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export { main }; 