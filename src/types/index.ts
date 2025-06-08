// 案件データ型（軽量版）
export interface JobData {
  id: string; // 案件ID（ユニーク）
  title: string; // 案件タイトル
  description: string; // 案件詳細（最大500文字）
  url: string; // 案件URL
  budget: number; // 予算（円）
  deadline: Date; // 納期
  workType: 'fixed' | 'hourly'; // 固定報酬 or 時間単価
  category: string; // カテゴリ
  clientName: string; // クライアント名
  clientRating: number; // クライアント評価（1-5）
  clientReviews: number; // レビュー数
  skills: string[]; // 必要スキル（最大5個）
  experience: 'beginner' | 'intermediate' | 'expert'; // 経験レベル
  scrapedAt: Date; // 取得日時
  source: 'crowdworks' | 'upwork'; // 取得元（拡張済み）
}

// 評価結果型（軽量版）
export interface JobEvaluation {
  jobId: string; // 対象案件ID
  evaluatedAt: Date; // 評価日時
  score: number; // おすすめ度（1-10）
  reason: string; // 評価理由（最大50文字）
  aiModel: 'gpt-3.5-turbo'; // 使用AIモデル
  tokenUsed: number; // 使用トークン数
  costEstimate: number; // 推定コスト（USD）
  strengths: string[]; // 強み（最大3個）
  concerns: string[]; // 懸念点（最大3個）
}

// 実行ログ型
export interface ExecutionLog {
  executionId: string; // 実行ID（タイムスタンプベース）
  timestamp: string; // 実行開始時刻（ISO形式）
  status: 'success' | 'error' | 'partial'; // 実行ステータス
  duration: number; // 実行時間（ミリ秒）
  jobsScraped: number; // スクレイピング件数
  newJobs: number; // 新規案件数
  aiEvaluated: number; // AI評価件数
  highScoreJobs: number; // 高評価案件数（閾値以上）
  costEstimate: number; // 推定コスト（USD）
  error?: {
    type: string; // エラータイプ
    message: string; // エラーメッセージ
    stack?: string; // スタックトレース
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
  source: string;
  'detail-type': string;
  detail: Record<string, any>;
  time?: string; // ISO形式（オプション）
}

// Lambda レスポンス型（新形式）
export interface ScheduledExecutionResponse {
  statusCode: number; // HTTP レスポンスコード
  body: string; // JSON文字列レスポンス
  executionTime: number; // 実行時間（ミリ秒）
  timestamp: string; // ISO形式タイムスタンプ
}

// Playwright動作確認結果型
export interface PlaywrightTestResult {
  success: boolean;
  chromiumVersion?: string;
  title?: string;
  screenshot?: boolean;
  error?: string;
  executionTime: number;
}

// Lambda実行結果型（新形式）
export interface LambdaExecutionResult {
  phases: {
    playwright: PlaywrightTestResult;
    crowdworksLogin: {
      success: boolean;
      loginResult?: CrowdWorksLoginResult;
      error?: string;
      executionTime: number;
    };
    crowdworksScraping: {
      success: boolean;
      scrapingResult?: any; // 実装時に詳細型を追加
      error?: string;
      executionTime: number;
    };
  };
  executionTime: number;
  timestamp: string;
}

// Lambda エラーレスポンス型
export interface LambdaErrorResponse {
  message: string;
  error: string;
  requestId: string;
  timestamp: string;
}

// 旧形式レスポンス型（後方互換性維持）
export interface LegacyScheduledExecutionResponse {
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

// CrowdWorks認証情報
export interface CrowdWorksCredentials {
  email: string;
  password: string;
}

// CrowdWorksログイン結果
export interface CrowdWorksLoginResult {
  success: boolean;
  isLoggedIn: boolean;
  error?: string;
  executionTime: number;
}

// クラウドワークスカテゴリ型
export type CrowdWorksCategory =
  | 'ec'
  | 'web_products'
  | 'software_development'
  | 'development'
  | 'writing'
  | 'translation'
  | 'marketing'
  | 'system_development'
  | 'app_development'
  | 'data_entry'
  | 'others';

// デフォルト設定定数
export const DEFAULT_CONFIG = {
  MAX_JOBS_PER_CATEGORY: 50,
  MAX_DETAILS_PER_CATEGORY: 50,
  ALL_CATEGORIES: [
    'ec',
    'web_products',
    'software_development',
    'development',
    'writing',
    'translation',
    'marketing',
    'system_development',
    'app_development'
  ] as const satisfies readonly CrowdWorksCategory[]
} as const;

// Upwork専用案件データ型
export interface UpworkJobData {
  id: string; // Upwork案件ID
  title: string; // 案件タイトル
  description: string; // 案件詳細
  url: string; // Upwork案件URL
  budget: {
    type: 'fixed' | 'hourly'; // 固定価格 or 時間単価
    amount?: number; // 固定価格の場合の金額（USD）
    min?: number; // 時間単価の場合の最小金額（USD）
    max?: number; // 時間単価の場合の最大金額（USD）
  };
  duration: string; // プロジェクト期間（"Less than 1 month"等）
  experienceLevel: 'entry' | 'intermediate' | 'expert'; // 経験レベル
  jobType: 'fixed-price' | 'hourly'; // 案件タイプ
  category: {
    name: string; // カテゴリ名
    subcategory?: string; // サブカテゴリ
  };
  client: {
    country?: string; // クライアントの国
    memberSince?: string; // 登録日
    totalSpent?: number; // 総支払額（USD）
    hireRate?: number; // 採用率（%）
    totalJobs?: number; // 総案件投稿数
    avgHourlyPaid?: number; // 平均時給支払額（USD）
    paymentVerified: boolean; // 支払い認証済み
  };
  skills: string[]; // 必要スキル
  proposals: number; // 提案数
  postedTime: string; // 投稿時間
  scrapedAt: Date; // 取得日時
}

// Upwork API認証情報型
export interface UpworkCredentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken?: string;
  accessTokenSecret?: string;
  // OAuth2用（将来対応）
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
}

// Upworkログイン結果型
export interface UpworkLoginResult {
  success: boolean;
  isAuthenticated: boolean;
  accessToken?: string;
  error?: string;
  executionTime: number;
}

// 統合案件検索結果型
export interface IntegratedJobSearchResult {
  crowdworks: {
    jobs: JobData[];
    total: number;
    success: boolean;
    error?: string;
    executionTime: number;
  };
  upwork: {
    jobs: UpworkJobData[];
    total: number;
    success: boolean;
    error?: string;
    executionTime: number;
  };
  summary: {
    totalJobs: number;
    highHourlyJobs: number; // 時給一定以上の案件数
    averageHourlyRate: number; // 平均時給（円換算）
    executionTime: number;
    timestamp: Date;
  };
}

// 統合案件レポート型
export interface IntegratedJobReport {
  id: string; // レポートID
  generatedAt: Date; // 生成日時
  criteria: {
    minHourlyRate: number; // 最低時給条件（円）
    categories: string[]; // 対象カテゴリ
    maxJobsPerSource: number; // ソース毎の最大取得件数
  };
  results: IntegratedJobSearchResult;
  highValueJobs: {
    crowdworks: JobData[];
    upwork: UpworkJobData[];
  };
  analysis: {
    marketTrends: string; // 市場動向分析
    recommendations: string[]; // おすすめ案件の理由
    alerts: string[]; // 注意事項
  };
}

// 統合検索設定型
export interface IntegratedSearchConfig {
  enabled: {
    crowdworks: boolean;
    upwork: boolean;
  };
  limits: {
    maxJobsPerSource: number;
    maxExecutionTime: number; // 秒
  };
  filtering: {
    minHourlyRateJPY: number; // 最低時給（円）
    minBudgetJPY: number; // 最低予算（円）
    excludeKeywords: string[]; // 除外キーワード
    requiredSkills: string[]; // 必須スキル
  };
  currency: {
    exchangeRateUSDToJPY: number; // USD→JPY換算レート
    lastUpdated: Date; // レート更新日
  };
}
