// 案件データ型（軽量版）
export interface JobData {
    id: string;                    // 案件ID（ユニーク）
    title: string;                 // 案件タイトル
    description: string;           // 案件詳細（最大500文字）
    url: string;                   // 案件URL
    budget: number;                // 予算（円）
    deadline: Date;                // 納期
    workType: 'fixed' | 'hourly'; // 固定報酬 or 時間単価
    category: string;              // カテゴリ
    clientName: string;            // クライアント名
    clientRating: number;          // クライアント評価（1-5）
    clientReviews: number;         // レビュー数
    skills: string[];              // 必要スキル（最大5個）
    experience: 'beginner' | 'intermediate' | 'expert'; // 経験レベル
    scrapedAt: Date;              // 取得日時
    source: 'crowdworks';         // 取得元（将来拡張用）
}

// 評価結果型（軽量版）
export interface JobEvaluation {
    jobId: string;                // 対象案件ID
    evaluatedAt: Date;           // 評価日時
    score: number;               // おすすめ度（1-10）
    reason: string;              // 評価理由（最大50文字）
    aiModel: 'gpt-3.5-turbo';    // 使用AIモデル
    tokenUsed: number;           // 使用トークン数
    costEstimate: number;        // 推定コスト（USD）
    strengths: string[];         // 強み（最大3個）
    concerns: string[];          // 懸念点（最大3個）
}

// 実行ログ型
export interface ExecutionLog {
    executionId: string;         // 実行ID（タイムスタンプベース）
    timestamp: string;           // 実行開始時刻（ISO形式）
    status: 'success' | 'error' | 'partial'; // 実行ステータス
    duration: number;            // 実行時間（ミリ秒）
    jobsScraped: number;         // スクレイピング件数
    newJobs: number;             // 新規案件数
    aiEvaluated: number;         // AI評価件数
    highScoreJobs: number;       // 高評価案件数（閾値以上）
    costEstimate: number;        // 推定コスト（USD）
    error?: {
        type: string;              // エラータイプ
        message: string;           // エラーメッセージ
        stack?: string;            // スタックトレース
    };
}

// システム設定型
export interface SystemConfig {
    scraping: {
        maxJobsPerExecution: number;
        preFilterEnabled: boolean;
        minBudget: number;
        minClientRating: number;
        maxDescriptionLength: number;
    };
    ai: {
        enabled: boolean;
        model: 'gpt-3.5-turbo';
        maxJobsForEvaluation: number;
        monthlyBudgetLimit: number;
        maxTokensPerRequest: number;
        temperature: number;
    };
    notification: {
        enabled: boolean;
        scoreThreshold: number;
        errorNotificationEnabled: boolean;
        dailySummaryEnabled: boolean;
    };
    storage: {
        retentionDays: number;
        compressionEnabled: boolean;
        backupEnabled: boolean;
    };
    performance: {
        timeoutSeconds: number;
        retryCount: number;
        concurrentLimit: number;
    };
}

// 検索条件型
export interface SearchCondition {
    id: string;
    name: string;
    enabled: boolean;
    keywords: string[];
    budgetMin: number;
    budgetMax: number;
    category: string;
    workType: 'fixed' | 'hourly' | 'both';
    clientRatingMin: number;
    experienceLevel: 'beginner' | 'intermediate' | 'expert' | 'any';
    excludeKeywords: string[];
    excludeClients: string[];
}

// 検索条件設定型
export interface SearchConditions {
    version: string;
    lastUpdated: Date;
    conditions: SearchCondition[];
}

// ログイン認証情報型
export interface LoginCredentials {
    email: string;
    password: string;
}

// Lambda イベント型
export interface ScheduledExecutionEvent {
    source: 'aws.events';
    'detail-type': 'Scheduled Event';
    detail: Record<string, unknown>;
    time: string; // ISO形式
}

// Lambda レスポンス型
export interface ScheduledExecutionResponse {
    status: 'success' | 'error' | 'partial';
    executionId: string;
    timestamp: string;
    results: {
        jobsScraped: number;
        newJobs: number;
        aiEvaluated: number;
        highScoreJobs: number;
        duration: number;
        costEstimate: number;
    };
    error?: {
        type: string;
        message: string;
    };
}

// エラー型
export enum ErrorType {
    AUTHENTICATION_ERROR = 'AUTH_ERROR',
    LAMBDA_TIMEOUT = 'LAMBDA_TIMEOUT',
    S3_ACCESS_ERROR = 'S3_ACCESS_ERROR',
    SCRAPING_ERROR = 'SCRAPING_ERROR',
    AI_API_ERROR = 'AI_API_ERROR',
    NETWORK_ERROR = 'NETWORK_ERROR',
}

export class AppError extends Error {
    constructor(
        public type: ErrorType,
        message: string,
        public retryable: boolean = false
    ) {
        super(message);
        this.name = 'AppError';
    }
} 