# システム設計書

## 1. システム概要

### 1.1 システム構成図

```
                        ┌─────────────────────────────────────┐
                        │             AWS Cloud                │
                        │                                     │
    ┌──────────────────────────────────────────────────────────────┐
    │                    EventBridge (15分間隔)                      │
    └──────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
    ┌──────────────────────────────────────────────────────────────┐
    │                 Lambda Function (Main)                       │
    │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │
    │  │ Scheduler   │  │   Scraper    │  │   AI Evaluator   │    │
    │  │   Logic     │─▶│ (Playwright) │─▶│  (ChatGPT API)   │    │
    │  └─────────────┘  └──────────────┘  └──────────────────┘    │
    └──────────────────────┬───────────────────────┬───────────────┘
                           │                       │
                           ▼                       │
    ┌──────────────────────────────────────────────┼───────────────┐
    │                     S3 Bucket                │               │
    │  ┌─────────────────┐  ┌─────────────────┐   │               │
    │  │ jobs/           │  │   logs/         │   │               │
    │  │ (案件データ)      │  │ (実行ログ)       │   │               │
    │  └─────────────────┘  └─────────────────┘   │               │
    │  ┌─────────────────┐  ┌─────────────────┐   │               │
    │  │ evaluations/    │  │  config/        │   │               │
    │  │ (評価結果)        │  │ (設定ファイル)    │   │               │
    │  └─────────────────┘  └─────────────────┘   │               │
    └──────────────────────────────────────────────┘               │
                           │                                       │
                           ▼                                       │
    ┌──────────────────────────────────────────────────────────────┘
    │                 支援サービス（最小構成）
    │  ┌─────────────────┐  ┌─────────────────┐
    │  │ Parameter Store │  │      SNS        │
    │  │  (Secrets)      │  │ (Error Notify)  │
    │  └─────────────────┘  └─────────────────┘
    └──────────────────────────────────────────────────────────────┘
                           │
                           ▼
                    ┌──────────────────┐
                    │ External Services│
                    │ - CrowdWorks     │
                    │ - ChatGPT API    │
                    └──────────────────┘
```

### 1.2 アーキテクチャ方針

- **コストファースト**: 月$5以下の厳格なコスト制約を最優先
- **S3中心設計**: データストレージ・ログ・設定をすべてS3で管理
- **シンプル・軽量**: 複雑な機能を排除し、コア機能に集中
- **事前フィルタリング**: AI評価前の絞り込みでコスト削減
- **短期データ管理**: 7日間のTTLで自動削除
- **型安全性**: TypeScript strict モードで完全な型定義

### 1.3 技術スタック

**コンピューティング**
- **AWS Lambda** (Node.js 18.x): メイン実行環境
- **EventBridge**: スケジューリング（15分間隔）
- **AWS CDK** (TypeScript): Infrastructure as Code

**データ・ストレージ**
- **S3**: 全データの一元管理（案件・ログ・設定・評価結果）
- **S3 Lifecycle Policy**: 7日後自動削除
- **Parameter Store**: シークレット管理のみ

**言語・ライブラリ**
- **TypeScript** (v5以上): 型安全性確保、any型使用禁止
- **Playwright**: ブラウザ自動化（Lambda Layer）
- **AWS SDK v3**: AWS サービス連携
- **OpenAI SDK**: ChatGPT連携（軽量利用）

**監視・運用（最小構成）**
- **SNS**: エラー通知のみ
- **S3ベースログ**: 構造化JSON形式

## 2. コンポーネント設計

### 2.1 スケジューラー

**責務**
- EventBridge からのトリガー受信
- Lambda関数の実行制御
- 実行時間の最適化（1分以内目標）

**実装方式**
```typescript
// EventBridge Rule
const scheduleRule = new events.Rule(this, 'ScheduleRule', {
  schedule: events.Schedule.rate(Duration.minutes(15)),
  targets: [new targets.LambdaFunction(mainFunction)]
});

interface SchedulerEvent {
  source: 'aws.events';
  'detail-type': 'Scheduled Event';
  detail: {};
}
```

### 2.2 スクレイパー

**責務**
- クラウドワークスへの軽量アクセス
- 効率的なデータ抽出（最大50件/回）
- 事前フィルタリング実行

**軽量化設計**
```typescript
interface IScrapperService {
  authenticateUser(credentials: LoginCredentials): Promise<void>;
  searchJobsLight(condition: SearchCondition): Promise<JobData[]>;
  applyPreFilter(jobs: JobData[]): JobData[]; // AI評価前フィルタ
  validateJobData(job: JobData): boolean;
}

// 事前フィルタリング例
const applyPreFilter = (jobs: JobData[]): JobData[] => {
  return jobs.filter(job => 
    job.budget >= 50000 &&           // 最低予算
    job.clientRating >= 4.0 &&       // クライアント評価
    hasTargetSkills(job.skills) &&   // スキルマッチング
    isReasonableDeadline(job.deadline) // 納期チェック
  );
};
```

### 2.3 データストレージ（S3ベース）

**責務**
- S3での構造化データ管理
- JSON形式でのシンプルな読み書き
- TTL機能による自動削除

**ファイル構造設計**
```typescript
// S3 Bucket構造
interface S3Structure {
  'jobs/': {
    pattern: 'YYYY-MM-DDTHH-mm.json';
    example: '2024-01-15T14-30.json';
    ttl: '7 days';
  };
  'evaluations/': {
    pattern: 'YYYY-MM-DDTHH-mm.json';
    example: '2024-01-15T14-30.json';
    ttl: '7 days';
  };
  'logs/': {
    execution: 'YYYY-MM-DDTHH-mm-execution.json';
    error: 'YYYY-MM-DDTHH-mm-error.json';
    daily: 'daily-summary/YYYY-MM-DD.json';
    ttl: '7 days';
  };
  'config/': {
    searchConditions: 'search-conditions.json';
    system: 'system-config.json';
    ttl: 'none';
  };
}

// データ操作サービス
class S3DataService {
  async saveJobs(jobs: JobData[]): Promise<void> {
    const timestamp = new Date().toISOString().slice(0, 16);
    await this.s3.putObject({
      Bucket: this.bucketName,
      Key: `jobs/${timestamp}.json`,
      Body: JSON.stringify(jobs, null, 2),
      ServerSideEncryption: 'AES256'
    }).promise();
  }

  async getRecentJobs(hours: number = 24): Promise<JobData[]> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const objects = await this.listObjectsSince('jobs/', cutoff);
    
    const allJobs: JobData[] = [];
    for (const obj of objects) {
      const data = await this.getObject(obj.Key);
      allJobs.push(...JSON.parse(data));
    }
    return allJobs;
  }

  async getExistingJobIds(hours: number = 48): Promise<Set<string>> {
    const recentJobs = await this.getRecentJobs(hours);
    return new Set(recentJobs.map(job => job.id));
  }
}
```

### 2.4 AI評価エンジン（軽量版）

**責務**
- 事前フィルタ済み案件のみ評価
- バッチ処理での効率化
- コスト監視機能

**軽量実装**
```typescript
class LightAIEvaluatorService {
  private monthlyUsage: number = 0;
  private readonly MONTHLY_LIMIT = 3; // $3/月制限

  async evaluateFilteredJobs(jobs: JobData[]): Promise<JobEvaluation[]> {
    // コスト制限チェック
    if (this.monthlyUsage >= this.MONTHLY_LIMIT) {
      throw new Error('Monthly AI budget exceeded');
    }

    // 最重要案件のみ評価（さらなる絞り込み）
    const priorityJobs = this.selectPriorityJobs(jobs);
    
    const evaluations: JobEvaluation[] = [];
    for (const job of priorityJobs) {
      try {
        const evaluation = await this.evaluateJob(job);
        evaluations.push(evaluation);
        
        // 使用量追跡
        this.monthlyUsage += this.estimateTokenCost(job);
        
      } catch (error) {
        // AI評価失敗時はデフォルトスコア
        evaluations.push(this.createDefaultEvaluation(job));
      }
    }
    
    return evaluations;
  }

  private selectPriorityJobs(jobs: JobData[]): JobData[] {
    return jobs
      .sort((a, b) => b.budget - a.budget) // 高予算順
      .slice(0, 10); // 上位10件のみ
  }

  private estimateTokenCost(job: JobData): number {
    const tokenCount = (job.title.length + job.description.length) / 4;
    return tokenCount * 0.002 / 1000; // GPT-3.5-turbo価格
  }
}
```

### 2.5 設定管理（S3ベース）

**責務**
- S3での設定ファイル管理
- Parameter Store でのシークレット管理
- 軽量な設定読み込み

**設定構造**
```typescript
// config/system-config.json
interface SystemConfig {
  scraping: {
    maxJobsPerExecution: 50;
    preFilterEnabled: true;
    minBudget: 50000;
    minClientRating: 4.0;
  };
  ai: {
    enabled: true;
    model: 'gpt-3.5-turbo';
    maxJobsForEvaluation: 10;
    monthlyBudgetLimit: 3.0;
  };
  notification: {
    enabled: true;
    scoreThreshold: 7;
    errorNotificationEnabled: true;
  };
  storage: {
    retentionDays: 7;
    compressionEnabled: false;
  };
}

// config/search-conditions.json
interface SearchConditions {
  conditions: Array<{
    id: string;
    name: string;
    keywords: string[];
    budgetMin: number;
    budgetMax: number;
    category: string;
    workType: 'fixed' | 'hourly';
    enabled: boolean;
  }>;
}
```

## 3. データフロー

### 3.1 データフロー図

```
EventBridge ──15分──▶ Lambda Function (Main Handler)
                            │
                            ▼
                    Parameter Store ──シークレット取得──▶ Scraper Service
                            │                              │
                            ▼                              ▼
                    S3 Config ◀──設定読み込み──────── CrowdWorks Site
                    (search-conditions.json)           │
                            │                          ▼
                            ▼                     案件データ取得
                    S3 Jobs ◀──重複チェック────── Pre-Filter
                    (過去48時間分)                    │
                            │                          ▼
                            ▼                     新規案件
                    S3 Jobs ◀────新規案件保存──── Light AI Evaluator
                    (timestamp.json)                  │
                            │                          ▼
                            ▼                     評価結果
                    S3 Evaluations ◀──評価保存─── High Score Filter
                    (timestamp.json)                  │
                            │                          ▼
                            ▼                     通知判定
                    S3 Logs ◀────実行ログ────── SNS Notification
                    (execution.json)              (エラー・高評価)
```

### 3.2 処理フロー

**最適化されたメイン処理フロー**
```typescript
export const handler = async (event: SchedulerEvent): Promise<void> => {
  const executionId = Date.now().toString();
  const startTime = Date.now();
  const timestamp = new Date().toISOString().slice(0, 16);
  
  const log: ExecutionLog = {
    executionId,
    timestamp,
    status: 'success',
    duration: 0,
    jobsScraped: 0,
    newJobs: 0,
    aiEvaluated: 0,
    highScoreJobs: 0,
    costEstimate: 0
  };

  try {
    // 1. 設定とシークレット取得（並列）
    const [config, credentials] = await Promise.all([
      s3DataService.getSystemConfig(),
      parameterService.getCredentials()
    ]);

    // 2. 重複チェック用データ取得
    const existingJobIds = await s3DataService.getExistingJobIds(48);

    // 3. スクレイピング実行
    const scraper = new ScraperService(credentials);
    const allJobs = await scraper.searchJobsLight(config.searchConditions);
    log.jobsScraped = allJobs.length;

    // 4. 重複排除
    const newJobs = allJobs.filter(job => !existingJobIds.has(job.id));
    log.newJobs = newJobs.length;

    if (newJobs.length === 0) {
      log.duration = Date.now() - startTime;
      await s3DataService.saveExecutionLog(log, timestamp);
      return; // 新規案件なしで終了
    }

    // 5. 新規案件保存
    await s3DataService.saveJobs(newJobs, timestamp);

    // 6. 事前フィルタ実行
    const filteredJobs = scraper.applyPreFilter(newJobs);

    // 7. AI評価（フィルタ後の優先案件のみ）
    let evaluations: JobEvaluation[] = [];
    if (config.ai.enabled && filteredJobs.length > 0) {
      const aiEvaluator = new LightAIEvaluatorService();
      evaluations = await aiEvaluator.evaluateFilteredJobs(filteredJobs);
      log.aiEvaluated = evaluations.length;
      log.costEstimate = aiEvaluator.getSessionCost();

      // 8. 評価結果保存
      await s3DataService.saveEvaluations(evaluations, timestamp);
    }

    // 9. 高評価案件通知
    const highScoreJobs = evaluations.filter(e => e.score >= config.notification.scoreThreshold);
    log.highScoreJobs = highScoreJobs.length;

    if (highScoreJobs.length > 0) {
      await notificationService.sendHighScoreAlert(highScoreJobs);
    }

    // 10. 実行ログ保存
    log.duration = Date.now() - startTime;
    await s3DataService.saveExecutionLog(log, timestamp);

  } catch (error) {
    log.status = 'error';
    log.error = {
      type: error.constructor.name,
      message: error.message,
      stack: error.stack
    };
    log.duration = Date.now() - startTime;

    // エラーログ保存
    await s3DataService.saveErrorLog(log, timestamp);

    // 重要エラーの通知
    if (shouldNotifyError(error)) {
      await notificationService.sendErrorAlert(error, executionId);
    }

    throw error; // Lambda失敗として記録
  }
};
```

## 4. インターフェース設計

### 4.1 外部API連携

**ChatGPT API（軽量版）**
```typescript
interface LightChatGPTRequest {
  model: 'gpt-3.5-turbo'; // GPT-4は使用しない（コスト削減）
  messages: ChatCompletionMessage[];
  max_tokens: 200; // 短縮
  temperature: 0.3; // 一貫性重視
  response_format: { type: 'json_object' };
}

const LIGHT_EVALUATION_PROMPT = `
案件を簡潔に評価してください（予算:{budget}円、クライアント評価:{clientRating}）：

{title}

スキル: {skills}
詳細: {description}

JSON形式で回答:
{"score": 1-10, "reason": "50文字以内"}
`;
```

### 4.2 内部データ構造

**軽量化データ型**
```typescript
interface JobData {
  id: string;
  title: string;
  description: string; // 500文字まで
  budget: number;
  deadline: Date;
  clientRating: number;
  skills: string[]; // 最大5個
  url: string;
  scrapedAt: Date;
}

interface JobEvaluation {
  jobId: string;
  score: number; // 1-10
  reason: string; // 50文字以内
  evaluatedAt: Date;
  tokenUsed: number; // コスト追跡
}

interface ExecutionLog {
  executionId: string;
  timestamp: string;
  status: 'success' | 'error' | 'partial';
  duration: number;
  jobsScraped: number;
  newJobs: number;
  aiEvaluated: number;
  highScoreJobs: number;
  costEstimate: number;
  error?: {
    type: string;
    message: string;
    stack?: string;
  };
}
```

## 5. セキュリティ設計

### 5.1 認証・認可（最小権限）

**IAM ロール設計**
```typescript
const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  managedPolicies: [
    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
  ],
  inlinePolicies: {
    S3Access: new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            's3:GetObject',
            's3:PutObject',
            's3:ListBucket'
          ],
          resources: [
            s3Bucket.bucketArn,
            `${s3Bucket.bucketArn}/*`
          ]
        })
      ]
    }),
    ParameterStoreAccess: new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ssm:GetParameter'],
          resources: [`arn:aws:ssm:${region}:${account}:parameter/crowdworks-searcher/secrets`]
        })
      ]
    }),
    SNSAccess: new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sns:Publish'],
          resources: [errorTopic.topicArn]
        })
      ]
    })
  }
});
```

### 5.2 データ保護

**S3セキュリティ設定**
```typescript
const s3Bucket = new s3.Bucket(this, 'CrowdWorksSearcherBucket', {
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  lifecycleRules: [
    {
      id: 'DeleteOldData',
      enabled: true,
      expiration: Duration.days(7), // 7日後自動削除
      abortIncompleteMultipartUploadAfter: Duration.days(1)
    }
  ],
  versioning: false, // コスト削減
  removalPolicy: RemovalPolicy.DESTROY
});
```

## 6. エラーハンドリング設計

### 6.1 エラー分類（簡素化）

```typescript
export enum ErrorType {
  // 重要エラー（通知必要）
  AUTHENTICATION_ERROR = 'AUTH_ERROR',
  LAMBDA_TIMEOUT = 'LAMBDA_TIMEOUT',
  S3_ACCESS_ERROR = 'S3_ACCESS_ERROR',
  
  // 軽微エラー（ログのみ）
  SCRAPING_ERROR = 'SCRAPING_ERROR',
  AI_API_ERROR = 'AI_API_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR'
}

export class LightAppError extends Error {
  constructor(
    public type: ErrorType,
    message: string,
    public retryable: boolean = false
  ) {
    super(message);
  }
}
```

### 6.2 エラー処理方針

**軽量エラーハンドリング**
```typescript
class LightRetryHandler {
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 2 // 削減
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxRetries) throw error;
        await this.sleep(1000 * attempt); // シンプルなバックオフ
      }
    }
    throw new Error('Max retries exceeded');
  }
}

const shouldNotifyError = (error: Error): boolean => {
  const criticalErrors = [
    'AUTHENTICATION_ERROR',
    'LAMBDA_TIMEOUT', 
    'S3_ACCESS_ERROR'
  ];
  return criticalErrors.includes(error.constructor.name);
};
```

## 7. ログ設計（S3ベース）

### 7.1 S3ログ構造

```typescript
interface S3LogStructure {
  'logs/execution/': {
    pattern: 'YYYY-MM-DDTHH-mm-execution.json';
    content: ExecutionLog;
    retention: '7 days';
  };
  'logs/error/': {
    pattern: 'YYYY-MM-DDTHH-mm-error.json';
    content: ExecutionLog; // status = 'error'
    retention: '7 days';
  };
  'logs/daily-summary/': {
    pattern: 'YYYY-MM-DD.json';
    content: DailySummary;
    retention: '7 days';
  };
}

interface DailySummary {
  date: string;
  totalExecutions: number;
  successfulExecutions: number;
  totalJobsFound: number;
  totalNewJobs: number;
  averageScore: number;
  highScoreJobs: number;
  totalAICost: number;
  errors: string[];
}
```

### 7.2 ログ実装

**軽量ログサービス**
```typescript
class S3LogService {
  async saveExecutionLog(log: ExecutionLog, timestamp: string): Promise<void> {
    await this.s3.putObject({
      Bucket: this.bucketName,
      Key: `logs/execution/${timestamp}-execution.json`,
      Body: JSON.stringify(log, null, 2),
      ContentType: 'application/json'
    }).promise();
  }

  async saveErrorLog(log: ExecutionLog, timestamp: string): Promise<void> {
    await this.s3.putObject({
      Bucket: this.bucketName,
      Key: `logs/error/${timestamp}-error.json`,
      Body: JSON.stringify(log, null, 2),
      ContentType: 'application/json'
    }).promise();
  }

  async generateDailySummary(date: string): Promise<DailySummary> {
    const dayLogs = await this.getLogsForDate(date);
    
    return {
      date,
      totalExecutions: dayLogs.length,
      successfulExecutions: dayLogs.filter(l => l.status === 'success').length,
      totalJobsFound: dayLogs.reduce((sum, l) => sum + l.jobsScraped, 0),
      totalNewJobs: dayLogs.reduce((sum, l) => sum + l.newJobs, 0),
      averageScore: this.calculateAverageScore(dayLogs),
      highScoreJobs: dayLogs.reduce((sum, l) => sum + l.highScoreJobs, 0),
      totalAICost: dayLogs.reduce((sum, l) => sum + l.costEstimate, 0),
      errors: dayLogs.filter(l => l.error).map(l => l.error!.message)
    };
  }
}
```

## 8. コスト最適化戦略

### 8.1 コスト監視

```typescript
interface CostMonitor {
  trackLambdaExecution(duration: number, memoryMB: number): void;
  trackS3Operations(operations: S3Operation[]): void;
  trackAIUsage(tokens: number, model: string): void;
  generateMonthlyCostReport(): MonthlyCostReport;
}

interface MonthlyCostReport {
  lambda: { executions: number; cost: number };
  s3: { operations: number; storage: number; cost: number };
  ai: { tokens: number; cost: number };
  other: { sns: number; parameterStore: number };
  total: number;
  budgetRemaining: number;
}
```

### 8.2 自動コスト制御

```typescript
class CostController {
  private monthlyBudget = 5.0; // $5制限

  async checkBudgetBeforeExecution(): Promise<boolean> {
    const currentCost = await this.getCurrentMonthlyCost();
    return currentCost < this.monthlyBudget * 0.9; // 90%で制限
  }

  async suspendExpensiveFeatures(): Promise<void> {
    // AI評価を一時停止
    await this.updateConfig({ ai: { enabled: false } });
    
    // 通知送信
    await this.notifyBudgetExceeded();
  }
}
```

**これで月$5以下での運用が可能な設計になりました！** 