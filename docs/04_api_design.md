# API設計書

## 1. API概要

### 1.1 API方針

**基本方針**
- **コストファースト**: 月$5以下の予算制約を最優先
- **サーバレス中心**: Lambda関数間の軽量な内部API
- **外部API最小限**: ChatGPT API（軽量利用）とスクレイピングのみ
- **RESTful設計**: 標準的なHTTPメソッドとステータスコード
- **JSON形式**: 全てのリクエスト・レスポンスはJSON
- **型安全性**: TypeScriptでの完全な型定義

**API構成**
- **内部API**: Lambda関数間の連携（EventBridge + 直接呼び出し）
- **管理用API**: 設定確認・手動実行用の最小限API（API Gateway）
- **外部API**: ChatGPT API、クラウドワークススクレイピング
- **通知API**: SNS/SESによるエラー・高評価案件通知

### 1.2 認証方式

**内部API認証**
```typescript
// Lambda関数間: IAMロールによる認証
interface LambdaInvocationAuth {
  type: 'IAM_ROLE';
  role: 'arn:aws:iam::account:role/CrowdWorksSearcherRole';
  permissions: ['lambda:InvokeFunction', 's3:GetObject', 's3:PutObject'];
}

// EventBridge: サービス間認証
interface EventBridgeAuth {
  type: 'SERVICE_PRINCIPAL';
  principal: 'events.amazonaws.com';
  targetFunction: 'CrowdWorksSearcherMainFunction';
}
```

**外部API認証**
```typescript
// Parameter Store での安全な管理
interface ExternalAPIAuth {
  chatgpt: {
    type: 'Bearer Token';
    storage: 'AWS Systems Manager Parameter Store';
    path: '/crowdworks-searcher/secrets/openai-api-key';
    encryption: 'SecureString';
  };
  
  crowdworks: {
    type: 'Session Cookie';
    storage: 'AWS Systems Manager Parameter Store';
    credentials: {
      email: '/crowdworks-searcher/secrets/crowdworks-email';
      password: '/crowdworks-searcher/secrets/crowdworks-password';
    };
    encryption: 'SecureString';
  };
}
```

### 1.3 エラーレスポンス共通仕様

```typescript
// 標準エラーレスポンス
interface APIErrorResponse {
  error: {
    code: string;           // エラーコード
    message: string;        // エラーメッセージ
    timestamp: string;      // エラー発生時刻（ISO形式）
    requestId: string;      // リクエストID（トレース用）
    retryable: boolean;     // リトライ可能かどうか
    details?: Record<string, any>; // 詳細情報（オプション）
  };
}

// エラーコード定義
enum APIErrorCode {
  // クライアントエラー (4xx)
  INVALID_REQUEST = 'INVALID_REQUEST',
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  AUTHORIZATION_FAILED = 'AUTHORIZATION_FAILED',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // サーバーエラー (5xx)
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  
  // ビジネスロジックエラー
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',
  SCRAPING_FAILED = 'SCRAPING_FAILED',
  AI_EVALUATION_FAILED = 'AI_EVALUATION_FAILED',
  S3_OPERATION_FAILED = 'S3_OPERATION_FAILED'
}
```

## 2. 内部API設計

### 2.1 メイン処理API（Lambda関数）

#### 2.1.1 スケジュール実行

```typescript
// EventBridge → Lambda実行
interface ScheduledExecutionEvent {
  source: 'aws.events';
  'detail-type': 'Scheduled Event';
  detail: {};
  time: string; // ISO形式
}

interface ScheduledExecutionResponse {
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

// Lambda Handler実装
export const scheduledExecutionHandler = async (
  event: ScheduledExecutionEvent
): Promise<ScheduledExecutionResponse> => {
  const executionId = Date.now().toString();
  const startTime = Date.now();
  
  try {
    // メイン処理フローの実行
    const result = await executeMainFlow(executionId);
    
    return {
      status: 'success',
      executionId,
      timestamp: new Date().toISOString(),
      results: {
        ...result,
        duration: Date.now() - startTime
      }
    };
  } catch (error) {
    return {
      status: 'error',
      executionId,
      timestamp: new Date().toISOString(),
      results: {
        jobsScraped: 0,
        newJobs: 0,
        aiEvaluated: 0,
        highScoreJobs: 0,
        duration: Date.now() - startTime,
        costEstimate: 0
      },
      error: {
        type: error.constructor.name,
        message: error.message
      }
    };
  }
};
```

#### 2.1.2 手動実行API

```typescript
// 緊急時の手動実行用（API Gateway経由）
interface ManualExecutionRequest {
  trigger: 'manual';
  options?: {
    skipCache?: boolean;     // キャッシュスキップ
    forceAIEvaluation?: boolean; // AI評価強制実行
    testMode?: boolean;      // テストモード
  };
}

interface ManualExecutionResponse {
  message: string;
  executionId: string;
  estimatedCompletion: string; // 完了予定時刻
  monitorUrl?: string;         // 実行状況確認URL（S3ログ）
}

// POST /api/execute
export const manualExecutionHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const request: ManualExecutionRequest = JSON.parse(event.body || '{}');
    
    // Lambda関数を非同期実行
    const executionId = await invokeLambdaAsync('main-function', {
      source: 'manual',
      options: request.options
    });
    
    const response: ManualExecutionResponse = {
      message: 'Execution started successfully',
      executionId,
      estimatedCompletion: new Date(Date.now() + 60000).toISOString(),
      monitorUrl: `s3://bucket/logs/execution/${executionId}.json`
    };
    
    return {
      statusCode: 202,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };
  } catch (error) {
    return createErrorResponse(APIErrorCode.INTERNAL_SERVER_ERROR, error.message);
  }
};
```

### 2.2 設定管理API

#### 2.2.1 システム設定取得

```typescript
// GET /api/config/system
interface SystemConfigResponse {
  config: SystemConfig;
  lastModified: string;
  version: string;
}

export const getSystemConfigHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const s3DataService = new S3DataService();
    const config = await s3DataService.getSystemConfig();
    
    const response: SystemConfigResponse = {
      config,
      lastModified: new Date().toISOString(),
      version: '1.0.0'
    };
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };
  } catch (error) {
    return createErrorResponse(APIErrorCode.S3_OPERATION_FAILED, error.message);
  }
};
```

#### 2.2.2 検索条件管理

```typescript
// GET /api/config/search-conditions
interface SearchConditionsResponse {
  conditions: SearchConditions;
  activeCount: number;
  lastModified: string;
}

// PUT /api/config/search-conditions
interface UpdateSearchConditionsRequest {
  conditions: SearchConditions;
  backupCurrent?: boolean; // 現在の設定をバックアップ
}

export const getSearchConditionsHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const s3DataService = new S3DataService();
    const conditions = await s3DataService.getSearchConditions();
    
    const activeCount = conditions.conditions.filter(c => c.enabled).length;
    
    const response: SearchConditionsResponse = {
      conditions,
      activeCount,
      lastModified: conditions.lastUpdated.toISOString()
    };
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };
  } catch (error) {
    return createErrorResponse(APIErrorCode.S3_OPERATION_FAILED, error.message);
  }
};
```

### 2.3 データ取得API

#### 2.3.1 案件データ取得

```typescript
// GET /api/jobs?hours=24&limit=50
interface JobsQuery {
  hours?: number;    // 過去何時間のデータ（デフォルト: 24）
  limit?: number;    // 最大取得件数（デフォルト: 50）
  minScore?: number; // 最低スコア
}

interface JobsResponse {
  jobs: JobData[];
  totalCount: number;
  timeRange: {
    from: string;
    to: string;
  };
  hasMore: boolean;
}

export const getJobsHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const query: JobsQuery = event.queryStringParameters || {};
    const hours = parseInt(query.hours || '24');
    const limit = parseInt(query.limit || '50');
    const minScore = query.minScore ? parseFloat(query.minScore) : undefined;
    
    const s3DataService = new S3DataService();
    let jobs = await s3DataService.getRecentJobs(hours);
    
    // スコアフィルタ適用（評価データと結合）
    if (minScore !== undefined) {
      const evaluations = await s3DataService.getRecentEvaluations(hours);
      const highScoreJobIds = new Set(
        evaluations.filter(e => e.score >= minScore).map(e => e.jobId)
      );
      jobs = jobs.filter(job => highScoreJobIds.has(job.id));
    }
    
    // ページング
    const paginatedJobs = jobs.slice(0, limit);
    const hasMore = jobs.length > limit;
    
    const response: JobsResponse = {
      jobs: paginatedJobs,
      totalCount: jobs.length,
      timeRange: {
        from: new Date(Date.now() - hours * 60 * 60 * 1000).toISOString(),
        to: new Date().toISOString()
      },
      hasMore
    };
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };
  } catch (error) {
    return createErrorResponse(APIErrorCode.S3_OPERATION_FAILED, error.message);
  }
};
```

#### 2.3.2 実行状況取得

```typescript
// GET /api/status
interface SystemStatusResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastExecution: {
    id: string;
    timestamp: string;
    status: string;
    duration: number;
    results: {
      jobsScraped: number;
      newJobs: number;
      highScoreJobs: number;
    };
  } | null;
  nextExecution: string; // 次回実行予定時刻
  monthlyStats: {
    executions: number;
    totalJobs: number;
    totalCost: number;
    budgetRemaining: number;
  };
  alerts: string[]; // アラート一覧
}

export const getSystemStatusHandler = async (): Promise<APIGatewayProxyResult> => {
  try {
    const s3DataService = new S3DataService();
    
    // 最新の実行ログを取得
    const lastExecution = await s3DataService.getLatestExecutionLog();
    
    // 月次統計を計算
    const monthlyStats = await calculateMonthlyStats();
    
    // システム健康状態を判定
    const status = determineSystemHealth(lastExecution, monthlyStats);
    
    // アラートをチェック
    const alerts = await checkSystemAlerts(monthlyStats);
    
    const response: SystemStatusResponse = {
      status,
      lastExecution: lastExecution ? {
        id: lastExecution.executionId,
        timestamp: lastExecution.timestamp,
        status: lastExecution.status,
        duration: lastExecution.duration,
        results: {
          jobsScraped: lastExecution.jobsScraped,
          newJobs: lastExecution.newJobs,
          highScoreJobs: lastExecution.highScoreJobs
        }
      } : null,
      nextExecution: getNextExecutionTime(),
      monthlyStats,
      alerts
    };
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };
  } catch (error) {
    return createErrorResponse(APIErrorCode.INTERNAL_SERVER_ERROR, error.message);
  }
};
```

## 3. 外部API連携

### 3.1 ChatGPT API連携

```typescript
// OpenAI API接続設定
interface ChatGPTAPIConfig {
  baseURL: 'https://api.openai.com/v1';
  model: 'gpt-3.5-turbo';
  maxTokens: 200;
  temperature: 0.3;
  timeout: 30000; // 30秒
}

// API呼び出しサービス
class ChatGPTAPIService {
  private client: OpenAI;
  private rateLimiter: RateLimiter;
  private costTracker: CostTracker;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
    this.rateLimiter = new RateLimiter({
      requestsPerMinute: 50,  // レート制限対応
      requestsPerHour: 1000
    });
    this.costTracker = new CostTracker({
      monthlyLimit: 3.0 // $3/月制限
    });
  }

  async evaluateJob(job: JobData): Promise<JobEvaluation> {
    // コスト制限チェック
    if (this.costTracker.isOverLimit()) {
      throw new Error('Monthly AI budget exceeded');
    }

    // レート制限チェック
    await this.rateLimiter.waitIfNeeded();

    try {
      const prompt = this.createEvaluationPrompt(job);
      
      const response = await this.client.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from ChatGPT API');
      }

      const evaluation = this.parseEvaluationResponse(content, job.id);
      
      // コスト追跡
      const cost = this.calculateCost(response.usage);
      this.costTracker.addUsage(cost);
      
      return {
        ...evaluation,
        tokenUsed: response.usage?.total_tokens || 0,
        costEstimate: cost
      };

    } catch (error) {
      if (error.status === 429) {
        throw new APIError(APIErrorCode.RATE_LIMIT_EXCEEDED, 'ChatGPT API rate limit exceeded');
      }
      if (error.status >= 500) {
        throw new APIError(APIErrorCode.EXTERNAL_API_ERROR, 'ChatGPT API server error');
      }
      throw new APIError(APIErrorCode.AI_EVALUATION_FAILED, error.message);
    }
  }

  private createEvaluationPrompt(job: JobData): string {
    return `
案件を評価してJSON形式で回答してください：

案件情報:
- タイトル: ${job.title}
- 予算: ${job.budget.toLocaleString()}円
- 納期: ${job.deadline.toLocaleDateString()}
- クライアント評価: ${job.clientRating}/5.0
- 必要スキル: ${job.skills.join(', ')}
- 概要: ${job.description.slice(0, 200)}

評価基準:
1. 予算の妥当性（相場との比較）
2. スキルマッチング度
3. クライアントの信頼性
4. 案件説明の明確性
5. 納期の現実性

回答形式:
{
  "score": 1-10の整数,
  "reason": "評価理由（50文字以内）",
  "strengths": ["強み1", "強み2"],
  "concerns": ["懸念1", "懸念2"]
}
`;
  }

  private parseEvaluationResponse(content: string, jobId: string): JobEvaluation {
    try {
      const parsed = JSON.parse(content);
      
      return {
        jobId,
        evaluatedAt: new Date(),
        score: Math.max(1, Math.min(10, parseInt(parsed.score))),
        reason: (parsed.reason || '').slice(0, 50),
        aiModel: 'gpt-3.5-turbo',
        tokenUsed: 0, // 後で設定
        costEstimate: 0, // 後で設定
        strengths: (parsed.strengths || []).slice(0, 3),
        concerns: (parsed.concerns || []).slice(0, 3)
      };
    } catch (error) {
      // パース失敗時はデフォルト評価
      return createDefaultEvaluation(jobId);
    }
  }

  private calculateCost(usage: any): number {
    const inputTokens = usage?.prompt_tokens || 0;
    const outputTokens = usage?.completion_tokens || 0;
    
    // GPT-3.5-turbo pricing: $0.0015/1K input, $0.002/1K output
    return (inputTokens * 0.0015 + outputTokens * 0.002) / 1000;
  }
}
```

### 3.2 クラウドワークススクレイピング

```typescript
// スクレイピングサービス設定
interface ScrapingConfig {
  baseURL: 'https://crowdworks.jp';
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  timeout: 30000;
  retryCount: 3;
  retryDelay: 2000;
}

// スクレイピングAPI
class CrowdWorksScrapingService {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private isAuthenticated: boolean = false;

  async initialize(): Promise<void> {
    try {
      this.browser = await playwright.chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Lambda用設定
      });

      this.page = await this.browser.newPage({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      });

      // タイムアウト設定
      this.page.setDefaultTimeout(30000);
      
    } catch (error) {
      throw new APIError(APIErrorCode.SCRAPING_FAILED, `Browser initialization failed: ${error.message}`);
    }
  }

  async authenticate(credentials: { email: string; password: string }): Promise<void> {
    if (!this.page) {
      throw new APIError(APIErrorCode.SCRAPING_FAILED, 'Browser not initialized');
    }

    try {
      // ログインページに移動
      await this.page.goto('https://crowdworks.jp/login');
      
      // ログインフォーム入力
      await this.page.fill('input[name="email"]', credentials.email);
      await this.page.fill('input[name="password"]', credentials.password);
      
      // ログイン実行
      await this.page.click('button[type="submit"]');
      
      // ログイン成功確認
      await this.page.waitForURL('**/dashboard', { timeout: 10000 });
      
      this.isAuthenticated = true;
      
    } catch (error) {
      throw new APIError(APIErrorCode.AUTHENTICATION_FAILED, `CrowdWorks login failed: ${error.message}`);
    }
  }

  async searchJobs(conditions: SearchCondition[]): Promise<JobData[]> {
    if (!this.isAuthenticated || !this.page) {
      throw new APIError(APIErrorCode.AUTHENTICATION_FAILED, 'Not authenticated');
    }

    const allJobs: JobData[] = [];

    for (const condition of conditions) {
      if (!condition.enabled) continue;

      try {
        const jobs = await this.searchWithCondition(condition);
        allJobs.push(...jobs);
        
        // レート制限対応（検索間隔）
        await this.delay(2000);
        
      } catch (error) {
        console.warn(`Search failed for condition ${condition.id}:`, error.message);
        // 個別の検索失敗は全体を止めない
      }
    }

    return allJobs;
  }

  private async searchWithCondition(condition: SearchCondition): Promise<JobData[]> {
    if (!this.page) throw new Error('Page not available');

    const jobs: JobData[] = [];

    try {
      // 検索ページに移動
      await this.page.goto('https://crowdworks.jp/projects/search');
      
      // 検索条件設定
      await this.setSearchFilters(condition);
      
      // 検索実行
      await this.page.click('button[type="submit"]');
      await this.page.waitForSelector('.project-item', { timeout: 10000 });
      
      // 案件リスト取得
      const jobElements = await this.page.$$('.project-item');
      
      for (const element of jobElements.slice(0, 20)) { // 最大20件
        try {
          const jobData = await this.extractJobData(element);
          if (jobData && this.validateJobData(jobData)) {
            jobs.push(jobData);
          }
        } catch (error) {
          console.warn('Failed to extract job data:', error.message);
        }
      }
      
    } catch (error) {
      throw new APIError(APIErrorCode.SCRAPING_FAILED, `Search failed: ${error.message}`);
    }

    return jobs;
  }

  async cleanup(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.isAuthenticated = false;
  }
}
```

## 4. 通知API設計

### 4.1 SNS通知サービス

```typescript
// SNS通知設定
interface NotificationConfig {
  errorTopic: string;          // エラー通知用SNSトピック
  highScoreTopic: string;      // 高評価案件通知用
  email: string;               // 通知先メールアドレス
  enabled: boolean;            // 通知有効フラグ
}

// 通知サービス
class NotificationService {
  private sns: SNSClient;
  private ses: SESClient;
  private config: NotificationConfig;

  constructor(config: NotificationConfig) {
    this.sns = new SNSClient({});
    this.ses = new SESClient({});
    this.config = config;
  }

  // エラー通知
  async sendErrorAlert(error: Error, executionId: string): Promise<void> {
    if (!this.config.enabled) return;

    const message = {
      timestamp: new Date().toISOString(),
      executionId,
      errorType: error.constructor.name,
      errorMessage: error.message,
      severity: this.determineSeverity(error)
    };

    try {
      await this.sns.publish({
        TopicArn: this.config.errorTopic,
        Subject: `[CrowdWorks Searcher] ${message.severity} Error`,
        Message: JSON.stringify(message, null, 2)
      });
    } catch (snsError) {
      console.error('Failed to send error notification:', snsError);
    }
  }

  // 高評価案件通知
  async sendHighScoreAlert(jobs: JobEvaluation[]): Promise<void> {
    if (!this.config.enabled || jobs.length === 0) return;

    const message = {
      timestamp: new Date().toISOString(),
      jobCount: jobs.length,
      jobs: jobs.map(job => ({
        jobId: job.jobId,
        score: job.score,
        reason: job.reason
      }))
    };

    try {
      await this.sns.publish({
        TopicArn: this.config.highScoreTopic,
        Subject: `[CrowdWorks Searcher] ${jobs.length} High Score Job(s) Found`,
        Message: JSON.stringify(message, null, 2)
      });
    } catch (snsError) {
      console.error('Failed to send high score notification:', snsError);
    }
  }
}
```

## 5. エラーハンドリング共通実装

```typescript
// エラー処理ヘルパー
export const createErrorResponse = (
  errorCode: APIErrorCode,
  message: string,
  details?: Record<string, any>
): APIGatewayProxyResult => {
  const error: APIErrorResponse = {
    error: {
      code: errorCode,
      message,
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
      retryable: isRetryableError(errorCode),
      details
    }
  };

  return {
    statusCode: ERROR_STATUS_MAP[errorCode] || 500,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': error.error.requestId
    },
    body: JSON.stringify(error)
  };
};

// カスタムエラークラス
export class APIError extends Error {
  constructor(
    public code: APIErrorCode,
    message: string,
    public retryable: boolean = false,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// リトライ可能エラーの判定
const isRetryableError = (errorCode: APIErrorCode): boolean => {
  return [
    APIErrorCode.SERVICE_UNAVAILABLE,
    APIErrorCode.TIMEOUT_ERROR,
    APIErrorCode.EXTERNAL_API_ERROR,
    APIErrorCode.RATE_LIMIT_EXCEEDED
  ].includes(errorCode);
};
``` 