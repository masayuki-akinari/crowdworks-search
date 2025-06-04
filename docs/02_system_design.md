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
    │                 DynamoDB                     │               │
    │  ┌─────────────────┐  ┌─────────────────┐   │               │
    │  │ search_conditions│  │   job_data      │   │               │
    │  └─────────────────┘  └─────────────────┘   │               │
    │  ┌─────────────────┐  ┌─────────────────┐   │               │
    │  │   evaluations   │  │execution_logs   │   │               │
    │  └─────────────────┘  └─────────────────┘   │               │
    └──────────────────────────────────────────────┘               │
                           │                                       │
                           ▼                                       │
    ┌──────────────────────────────────────────────────────────────┘
    │                 支援サービス                                  
    │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐
    │  │ CloudWatch      │  │ Parameter Store │  │    SNS/SES   │
    │  │ (Logs/Alarms)   │  │  (Secrets)      │  │ (Notification)│
    │  └─────────────────┘  └─────────────────┘  └──────────────┘
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

- **サーバレスファースト**: AWS Lambdaを中心としたイベント駆動アーキテクチャ
- **マネージドサービス活用**: DynamoDB、EventBridge、CloudWatch等のフルマネージドサービス
- **Infrastructure as Code**: AWS CDKによる完全なインフラ管理
- **セキュリティ重視**: IAMロール、Parameter Store、VPC等でのセキュリティ強化
- **コスト最適化**: サーバレス課金とOn-Demand課金の活用
- **型安全性**: TypeScript strict モードで完全な型定義

### 1.3 技術スタック

**コンピューティング**
- **AWS Lambda** (Node.js 18.x): メイン実行環境
- **EventBridge**: スケジューリング（15分間隔）
- **AWS CDK** (TypeScript): Infrastructure as Code

**データ・ストレージ**
- **DynamoDB**: NoSQLデータベース（On-Demand課金）
- **Parameter Store**: シークレット・設定管理
- **S3**: ログ・レポートファイル保存（必要に応じて）

**言語・ライブラリ**
- **TypeScript** (v5以上): 型安全性確保、any型使用禁止
- **Playwright**: ブラウザ自動化（Lambda Layer）
- **AWS SDK v3**: AWS サービス連携
- **OpenAI SDK**: ChatGPT連携

**監視・運用**
- **CloudWatch**: ログ・メトリクス・アラーム
- **AWS X-Ray**: 分散トレーシング
- **SNS/SES**: 通知機能

## 2. コンポーネント設計

### 2.1 スケジューラー

**責務**
- EventBridge からのトリガー受信
- Lambda関数の実行制御
- 実行状態の管理
- 実行履歴の記録

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
- クラウドワークスへのアクセス
- 認証・ログイン処理
- 案件データの抽出
- HTMLパースとデータ正規化

**Lambda Layer構成**
```typescript
// Playwright Layer (Chrome Binary含む)
const playwrightLayer = new lambda.LayerVersion(this, 'PlaywrightLayer', {
  code: lambda.Code.fromAsset('layers/playwright'),
  compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
  description: 'Playwright with Chrome for Lambda'
});

interface IScrapperService {
  authenticateUser(credentials: LoginCredentials): Promise<void>;
  searchJobs(condition: SearchCondition): Promise<JobData[]>;
  extractJobDetails(jobUrl: string): Promise<JobDetail>;
  validateJobData(job: JobData): boolean;
}
```

### 2.3 データストレージ

**責務**
- DynamoDBテーブル操作
- データの永続化・取得
- 重複チェック
- データ整合性保証

**DynamoDB テーブル設計**
```typescript
// 検索条件テーブル
const searchConditionsTable = new dynamodb.Table(this, 'SearchConditions', {
  partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.ON_DEMAND,
  encryption: dynamodb.TableEncryption.AWS_MANAGED,
  pointInTimeRecovery: true
});

// 案件データテーブル
const jobsTable = new dynamodb.Table(this, 'Jobs', {
  partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'scrapedAt', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.ON_DEMAND,
  encryption: dynamodb.TableEncryption.AWS_MANAGED,
  timeToLiveAttribute: 'ttl' // 90日で自動削除
});

// GlobalSecondaryIndex for queries
jobsTable.addGlobalSecondaryIndex({
  indexName: 'ScoreIndex',
  partitionKey: { name: 'score', type: dynamodb.AttributeType.NUMBER },
  sortKey: { name: 'scrapedAt', type: dynamodb.AttributeType.STRING }
});
```

### 2.4 AI評価エンジン

**責務**
- ChatGPT APIとの通信
- プロンプト管理・最適化
- 評価結果の解析・バリデーション
- レート制限対応

**実装**
```typescript
interface IAIEvaluatorService {
  evaluateJob(job: JobData): Promise<JobEvaluation>;
  evaluateJobsBatch(jobs: JobData[]): Promise<JobEvaluation[]>;
  createEvaluationPrompt(job: JobData): string;
  parseEvaluationResponse(response: string): JobEvaluation;
}

class AIEvaluatorService implements IAIEvaluatorService {
  private openAI: OpenAI;
  private rateLimiter: RateLimiter;
  
  constructor(apiKey: string) {
    this.openAI = new OpenAI({ apiKey });
    this.rateLimiter = new RateLimiter({
      requestsPerMinute: 60,
      requestsPerDay: 10000
    });
  }
}
```

### 2.5 設定管理

**責務**
- Parameter Store からの設定読み込み
- 検索条件の管理
- シークレット情報の安全な取得

**Parameter Store構成**
```typescript
// システム設定
const systemConfig = new ssm.StringParameter(this, 'SystemConfig', {
  parameterName: '/crowdworks-searcher/config/system',
  stringValue: JSON.stringify({
    maxJobsPerExecution: 100,
    aiModel: 'gpt-4',
    scoreThreshold: 7,
    notificationEnabled: true
  })
});

// シークレット設定
const secrets = new ssm.StringParameter(this, 'Secrets', {
  parameterName: '/crowdworks-searcher/secrets',
  stringValue: JSON.stringify({
    openaiApiKey: '${OpenAI_API_KEY}',
    crowdworksEmail: '${CROWDWORKS_EMAIL}',
    crowdworksPassword: '${CROWDWORKS_PASSWORD}'
  }),
  type: ssm.ParameterType.SECURE_STRING
});
```

## 3. データフロー

### 3.1 データフロー図

```
EventBridge ──15分──▶ Lambda Function (Main Handler)
                            │
                            ▼
                    Parameter Store ──設定取得──▶ Scraper Service
                            │                          │
                            ▼                          ▼
                    DynamoDB ◀──検索条件取得──── CrowdWorks Site
                    (SearchConditions)             │
                            │                      ▼
                            ▼                 案件データ
                    DynamoDB ◀────保存────── Data Normalizer
                    (Jobs)                        │
                            │                      ▼
                            ▼                 AI Evaluator
                    DynamoDB ◀────評価結果─── (ChatGPT API)
                    (Evaluations)                 │
                            │                      ▼
                            ▼                 Notification
                    CloudWatch ◀──ログ出力─── (SNS/SES)
                    (Logs)
```

### 3.2 処理フロー

**メイン処理フロー（Lambda Handler）**
```typescript
export const handler = async (event: SchedulerEvent): Promise<void> => {
  const executionId = uuidv4();
  const logger = new Logger({ executionId });
  
  try {
    // 1. 設定・認証情報取得
    const config = await configService.getSystemConfig();
    const credentials = await configService.getCredentials();
    
    // 2. 検索条件取得
    const searchConditions = await dataService.getActiveSearchConditions();
    
    // 3. スクレイピング実行
    const scraper = new ScraperService(credentials);
    const allJobs: JobData[] = [];
    
    for (const condition of searchConditions) {
      const jobs = await scraper.searchJobs(condition);
      allJobs.push(...jobs);
    }
    
    // 4. 重複排除・新規案件フィルタ
    const newJobs = await dataService.filterNewJobs(allJobs);
    
    // 5. データ保存
    await dataService.saveJobs(newJobs);
    
    // 6. AI評価実行
    const evaluator = new AIEvaluatorService(config.openaiApiKey);
    const evaluations = await evaluator.evaluateJobsBatch(newJobs);
    
    // 7. 評価結果保存
    await dataService.saveEvaluations(evaluations);
    
    // 8. 高評価案件通知
    const highScoreJobs = evaluations.filter(e => e.score >= config.scoreThreshold);
    if (highScoreJobs.length > 0) {
      await notificationService.sendHighScoreAlert(highScoreJobs);
    }
    
    // 9. 実行ログ記録
    await dataService.saveExecutionLog({
      status: 'success',
      jobsFound: allJobs.length,
      newJobs: newJobs.length,
      highScoreJobs: highScoreJobs.length,
      executionTime: Date.now() - startTime
    });
    
  } catch (error) {
    logger.error('Execution failed', { error });
    await handleError(error, executionId);
  }
};
```

## 4. インターフェース設計

### 4.1 外部API連携

**ChatGPT API**
```typescript
interface ChatGPTRequest {
  model: 'gpt-4' | 'gpt-3.5-turbo';
  messages: ChatCompletionMessage[];
  max_tokens: number;
  temperature: number;
  response_format: { type: 'json_object' };
}

const EVALUATION_PROMPT_TEMPLATE = `
以下の案件情報を評価して、JSON形式で回答してください：

案件情報:
- タイトル: {title}
- 予算: {budget}円
- 納期: {deadline}
- クライアント評価: {clientRating}/5.0
- 必要スキル: {skills}
- 詳細: {description}

評価基準:
1. 予算の妥当性（相場との比較）
2. スキルマッチング度
3. クライアントの信頼性
4. 案件説明の明確性
5. 納期の現実性

回答形式:
{
  "score": 1-10の整数,
  "reason": "評価理由の詳細説明",
  "strengths": ["強み1", "強み2"],
  "concerns": ["懸念点1", "懸念点2"]
}
`;
```

### 4.2 内部API設計

**管理用API（API Gateway + Lambda）**
```typescript
// GET /api/status - システム状態取得
export const getSystemStatus = async (): Promise<SystemStatus> => {
  const lastExecution = await getLastExecutionLog();
  const jobStats = await getJobStatistics();
  
  return {
    schedulerStatus: 'running',
    lastExecution: lastExecution?.executedAt,
    nextExecution: getNextExecutionTime(),
    totalJobs: jobStats.total,
    highScoreJobs: jobStats.highScore,
    averageScore: jobStats.averageScore
  };
};

// GET /api/jobs - 案件一覧取得
export const getJobs = async (query: JobQuery): Promise<JobsResponse> => {
  const { scoreMin, limit = 20, lastKey } = query;
  
  return await dynamoService.queryJobs({
    IndexName: 'ScoreIndex',
    KeyConditionExpression: 'score >= :scoreMin',
    ExpressionAttributeValues: { ':scoreMin': scoreMin },
    Limit: limit,
    ExclusiveStartKey: lastKey
  });
};
```

## 5. セキュリティ設計

### 5.1 認証・認可

**IAM ロール設計**
```typescript
// Lambda実行ロール
const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  managedPolicies: [
    iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
  ],
  inlinePolicies: {
    DynamoDBAccess: new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:Query',
            'dynamodb:Scan'
          ],
          resources: [
            jobsTable.tableArn,
            searchConditionsTable.tableArn,
            `${jobsTable.tableArn}/index/*`
          ]
        })
      ]
    }),
    ParameterStoreAccess: new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ssm:GetParameter', 'ssm:GetParameters'],
          resources: [`arn:aws:ssm:${region}:${account}:parameter/crowdworks-searcher/*`]
        })
      ]
    })
  }
});
```

### 5.2 データ保護

**暗号化設定**
```typescript
// DynamoDB暗号化
const table = new dynamodb.Table(this, 'JobsTable', {
  encryption: dynamodb.TableEncryption.AWS_MANAGED,
  pointInTimeRecovery: true
});

// Parameter Store暗号化
const secureParameter = new ssm.StringParameter(this, 'Secrets', {
  type: ssm.ParameterType.SECURE_STRING,
  keyId: kms.Alias.fromAliasName(this, 'ParameterStoreKey', 'alias/aws/ssm')
});

// CloudWatch Logs暗号化
const logGroup = new logs.LogGroup(this, 'LambdaLogs', {
  encryptionKey: new kms.Key(this, 'LogsEncryptionKey'),
  retention: logs.RetentionDays.ONE_MONTH
});
```

## 6. エラーハンドリング設計

### 6.1 エラー分類

```typescript
export enum ErrorType {
  // AWS関連エラー
  LAMBDA_TIMEOUT = 'LAMBDA_TIMEOUT',
  DYNAMODB_ERROR = 'DYNAMODB_ERROR',
  PARAMETER_STORE_ERROR = 'PARAMETER_STORE_ERROR',
  
  // 外部サービスエラー
  OPENAI_API_ERROR = 'OPENAI_API_ERROR',
  SCRAPING_ERROR = 'SCRAPING_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  
  // ビジネスロジックエラー
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  
  // システムエラー
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export class AppError extends Error {
  constructor(
    public type: ErrorType,
    message: string,
    public retryable: boolean = false,
    public context?: Record<string, any>
  ) {
    super(message);
  }
}
```

### 6.2 エラー処理方針

**自動再試行戦略**
```typescript
class RetryHandler {
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    backoffMs: number = 1000
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (!this.isRetryable(error) || attempt === maxRetries) {
          throw error;
        }
        
        const delay = backoffMs * Math.pow(2, attempt - 1);
        await this.sleep(delay);
      }
    }
    
    throw new Error('Max retries exceeded');
  }
  
  private isRetryable(error: any): boolean {
    return error instanceof AppError && error.retryable;
  }
}
```

**CloudWatch Alarms**
```typescript
// Lambda関数エラー率監視
new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
  metric: lambdaFunction.metricErrors(),
  threshold: 5,
  evaluationPeriods: 2,
  alarmDescription: 'Lambda function error rate is high'
});

// DynamoDB エラー監視
new cloudwatch.Alarm(this, 'DynamoDBErrorAlarm', {
  metric: table.metricSystemErrorsForOperations({
    operations: [dynamodb.Operation.PUT_ITEM, dynamodb.Operation.GET_ITEM]
  }),
  threshold: 10,
  evaluationPeriods: 1
});
```

## 7. ログ設計

### 7.1 ログレベル定義

```typescript
export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN', 
  INFO = 'INFO',
  DEBUG = 'DEBUG'
}

export interface StructuredLog {
  timestamp: string;
  level: LogLevel;
  executionId: string;
  component: string;
  message: string;
  context?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack: string;
  };
}
```

### 7.2 ログ出力方針

**構造化ログ実装**
```typescript
export class Logger {
  constructor(private executionId: string) {}
  
  info(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, context);
  }
  
  error(message: string, context?: Record<string, any>, error?: Error): void {
    this.log(LogLevel.ERROR, message, {
      ...context,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined
    });
  }
  
  private log(level: LogLevel, message: string, context?: Record<string, any>): void {
    const logEntry: StructuredLog = {
      timestamp: new Date().toISOString(),
      level,
      executionId: this.executionId,
      component: 'crowdworks-searcher',
      message,
      context: this.sanitizeContext(context)
    };
    
    console.log(JSON.stringify(logEntry));
  }
  
  private sanitizeContext(context?: Record<string, any>): Record<string, any> | undefined {
    if (!context) return undefined;
    
    // 機密情報のマスキング
    const sanitized = { ...context };
    const sensitiveKeys = ['password', 'token', 'apiKey', 'secret'];
    
    for (const key of sensitiveKeys) {
      if (key in sanitized) {
        sanitized[key] = '***MASKED***';
      }
    }
    
    return sanitized;
  }
}
```

**CloudWatch Logs設定**
```typescript
const logGroup = new logs.LogGroup(this, 'LambdaLogGroup', {
  logGroupName: `/aws/lambda/${lambdaFunction.functionName}`,
  retention: logs.RetentionDays.ONE_MONTH,
  removalPolicy: RemovalPolicy.DESTROY
});

// ログメトリクスフィルター
new logs.MetricFilter(this, 'ErrorMetricFilter', {
  logGroup,
  metricNamespace: 'CrowdWorksSearcher',
  metricName: 'Errors',
  filterPattern: logs.FilterPattern.stringValue('$.level', '=', 'ERROR'),
  metricValue: '1'
});
``` 