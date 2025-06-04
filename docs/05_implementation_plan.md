# 実装計画書

## 1. 開発フェーズ

### Phase 1: AWS基盤構築・環境セットアップ（1-2週間）

**目標**: AWS サーバレス基盤の構築とローカル開発環境の整備

**成果物**
- AWS CDK による Infrastructure as Code
- S3バケット設定とライフサイクルポリシー
- Lambda関数の基本構造
- EventBridge スケジュール設定
- Parameter Store シークレット管理
- ローカル開発・テスト環境

**主要タスク**
```typescript
// CDK Stack 構成
interface CrowdWorksSearcherStackProps {
  s3Bucket: 'crowdworks-searcher-bucket';
  lambdaFunction: 'crowdworks-searcher-main';
  eventBridgeRule: '15分間隔実行';
  parameterStore: 'シークレット管理';
  iamRoles: '最小権限設定';
}
```

**完了基準**
- [ ] CDK deploy が成功
- [ ] S3バケットが作成され、ライフサイクルポリシーが設定済み
- [ ] Lambda関数が EventBridge から呼び出し可能
- [ ] Parameter Store でシークレット管理が機能
- [ ] ローカルでの開発環境が構築済み
- [ ] コスト監視アラートが設定済み

### Phase 2: スクレイピング機能実装（2-3週間）

**目標**: クラウドワークスからの案件データ自動取得機能

**成果物**
- Playwright によるブラウザ自動化
- 認証・ログイン機能
- 案件データ抽出・正規化機能
- エラーハンドリング・リトライ機能
- S3への案件データ保存機能

**主要タスク**
```typescript
// スクレイピングサービス実装
class CrowdWorksScrapingService {
  async initialize(): Promise<void>;
  async authenticate(credentials: LoginCredentials): Promise<void>;
  async searchJobs(conditions: SearchCondition[]): Promise<JobData[]>;
  async extractJobData(element: ElementHandle): Promise<JobData>;
  async cleanup(): Promise<void>;
}

// データ保存サービス実装
class S3DataService {
  async saveJobs(jobs: JobData[], timestamp: string): Promise<void>;
  async getRecentJobs(hours: number): Promise<JobData[]>;
  async getExistingJobIds(hours: number): Promise<Set<string>>;
}
```

**完了基準**
- [ ] クラウドワークスへの自動ログインが成功
- [ ] 検索条件に基づく案件データ取得が動作
- [ ] 取得データが正しくS3に保存される
- [ ] 重複チェック機能が正常動作
- [ ] エラー時の適切なリトライ処理
- [ ] Lambda実行時間が10分以内

### Phase 3: AI評価機能実装（2週間）

**目標**: ChatGPT API による案件評価とコスト制御

**成果物**
- ChatGPT API 連携機能
- 評価プロンプト最適化
- レート制限・コスト制限機能
- 評価結果の S3 保存機能
- デフォルト評価フォールバック機能

**主要タスク**
```typescript
// AI評価サービス実装
class ChatGPTAPIService {
  private rateLimiter: RateLimiter;
  private costTracker: CostTracker;
  
  async evaluateJob(job: JobData): Promise<JobEvaluation>;
  async evaluateJobsBatch(jobs: JobData[]): Promise<JobEvaluation[]>;
  private createEvaluationPrompt(job: JobData): string;
  private parseEvaluationResponse(content: string): JobEvaluation;
}

// コスト制御実装
class CostTracker {
  private monthlyUsage: number = 0;
  private readonly monthlyLimit: number = 3.0; // $3制限
  
  addUsage(cost: number): void;
  isOverLimit(): boolean;
  getRemainingBudget(): number;
}
```

**完了基準**
- [ ] ChatGPT API 連携が正常動作
- [ ] 月$3のコスト制限が機能
- [ ] レート制限対応が実装済み
- [ ] 評価結果がS3に正しく保存
- [ ] API障害時のフォールバック動作確認
- [ ] 評価精度の初期検証完了

### Phase 4: 通知・監視機能実装（1-2週間）

**目標**: エラー通知と高評価案件通知の実装

**成果物**
- SNS/SES による通知機能
- エラー監視とアラート機能
- 高評価案件の即座通知
- 日次サマリーレポート機能
- システム状況監視API

**主要タスク**
```typescript
// 通知サービス実装
class NotificationService {
  async sendErrorAlert(error: Error, executionId: string): Promise<void>;
  async sendHighScoreAlert(jobs: JobEvaluation[]): Promise<void>;
  async sendDailySummary(summary: DailySummary): Promise<void>;
}

// 監視サービス実装
class MonitoringService {
  async checkSystemHealth(): Promise<SystemStatus>;
  async calculateMonthlyStats(): Promise<MonthlyStats>;
  async generateDailySummary(): Promise<DailySummary>;
}
```

**完了基準**
- [ ] エラー発生時のSNS通知が動作
- [ ] 高評価案件の即座通知が機能
- [ ] 日次サマリーメール送信が動作
- [ ] システム状況監視APIが利用可能
- [ ] 通知内容の適切性確認

### Phase 5: 運用・改善・最適化（継続的）

**目標**: 安定運用とコスト最適化、機能改善

**成果物**
- 運用手順書・トラブルシューティングガイド
- パフォーマンス最適化
- コスト監視・最適化
- セキュリティ強化
- 機能拡張対応

**主要タスク**
- コスト分析とさらなる最適化
- 実行時間短縮とパフォーマンス改善
- エラー率削減と安定性向上
- セキュリティ監査と改善
- ユーザビリティ向上

**完了基準**
- [ ] 月$5以下のコスト目標達成
- [ ] 稼働率95%以上の安定運用
- [ ] 平均実行時間1分以内
- [ ] エラー率5%以下
- [ ] セキュリティベストプラクティス適用

## 2. マイルストーン

### 2.1 短期目標（1-2週間）

**Week 1: AWS基盤構築**
- Day 1-2: プロジェクト初期化、CDK セットアップ
- Day 3-4: S3バケット、Lambda、EventBridge 構築
- Day 5-7: Parameter Store、IAM設定、初期テスト

**Week 2: スクレイピング基盤**
- Day 8-10: Playwright セットアップ、Lambda Layer作成
- Day 11-12: 認証機能実装、基本スクレイピング
- Day 13-14: データ抽出・正規化、S3保存機能

**成果物チェックリスト**
```typescript
interface Week2Deliverables {
  infrastructure: {
    cdkDeployment: '✅ 成功';
    s3Bucket: '✅ 作成・設定完了';
    lambdaFunction: '✅ 基本実装';
    eventBridge: '✅ スケジュール設定';
  };
  
  scraping: {
    authentication: '✅ ログイン機能';
    dataExtraction: '✅ 基本抽出';
    s3Integration: '✅ データ保存';
    errorHandling: '✅ 基本エラー処理';
  };
}
```

### 2.2 中期目標（1ヶ月）

**Week 3-4: AI機能・通知機能完成**
- Week 3: ChatGPT API連携、評価機能実装
- Week 4: 通知機能、監視機能実装

**Month 1 完了目標**
- 全機能の基本実装完了
- 15分間隔での自動実行が安定動作
- コスト$5以下での運用確認
- 基本的なエラーハンドリングが機能

**品質基準**
```typescript
interface Month1QualityGates {
  functionality: {
    scraping: '90%以上の成功率';
    aiEvaluation: '80%以上の成功率';
    notification: '95%以上の送信成功率';
  };
  
  performance: {
    executionTime: '平均2分以内';
    errorRate: '10%以下';
    costPerMonth: '$5以下';
  };
  
  reliability: {
    uptime: '90%以上';
    dataIntegrity: '99%以上';
  };
}
```

### 2.3 長期目標（3ヶ月）

**Month 2: 安定化・最適化**
- パフォーマンス最適化（実行時間1分以内）
- エラー率5%以下達成
- コスト$4以下への削減
- セキュリティ強化

**Month 3: 運用改善・機能拡張**
- 高度な監視・アラート機能
- 評価精度向上
- レポート機能強化
- 将来拡張の準備

**3ヶ月後の目標状態**
```typescript
interface ThreeMonthTarget {
  operational: {
    uptime: '95%以上';
    avgExecutionTime: '60秒以内';
    errorRate: '5%以下';
    monthlyCost: '$4以下';
  };
  
  quality: {
    dataAccuracy: '95%以上';
    aiEvaluationPrecision: '85%以上';
    notificationReliability: '99%以上';
  };
  
  business: {
    jobDiscoveryRate: '高評価案件を80%キャッチ';
    falsePositiveRate: '20%以下';
    userSatisfaction: '運用負荷ほぼゼロ';
  };
}
```

## 3. タスク分解

### 3.1 環境構築タスク

**AWS CDK セットアップ**
```typescript
// CDK プロジェクト初期化
interface CDKSetupTasks {
  initialization: [
    'npm install -g aws-cdk',
    'cdk init app --language typescript',
    'npm install @aws-cdk/aws-*の必要パッケージ',
    'cdk bootstrap（初回のみ）'
  ];
  
  stackImplementation: [
    'S3BucketStack実装',
    'LambdaStack実装', 
    'EventBridgeStack実装',
    'IAMRoleStack実装',
    'ParameterStoreStack実装'
  ];
  
  validation: [
    'cdk synth でテンプレート確認',
    'cdk deploy --dry-run',
    'cdk deploy で実環境デプロイ',
    'AWS Console で設定確認'
  ];
}
```

**ローカル開発環境**
```typescript
interface LocalDevEnvironment {
  tools: [
    'Node.js 18.x',
    'TypeScript 5.x',
    'AWS CLI v2',
    'AWS CDK CLI',
    'Docker（Playwright用）'
  ];
  
  configuration: [
    'AWS認証情報設定',
    'VS Code拡張機能インストール',
    'ESLint/Prettier設定',
    'Jest テスト環境',
    'TypeScript strict設定'
  ];
  
  validation: [
    'aws sts get-caller-identity',
    'cdk --version',
    'npm test',
    'TypeScript型チェック'
  ];
}
```

### 3.2 開発タスク

**Phase 1 開発タスク（AWS基盤）**
```typescript
interface Phase1DevelopmentTasks {
  infrastructure: {
    priority: 'High';
    tasks: [
      {
        name: 'S3バケット作成';
        description: 'データ保存用S3バケット、ライフサイクルポリシー設定';
        estimatedHours: 4;
        dependencies: [];
      },
      {
        name: 'Lambda関数基盤';
        description: 'メイン実行用Lambda関数、Layer設定';
        estimatedHours: 8;
        dependencies: ['S3バケット作成'];
      },
      {
        name: 'EventBridge設定';
        description: '15分間隔スケジュール設定';
        estimatedHours: 2;
        dependencies: ['Lambda関数基盤'];
      },
      {
        name: 'Parameter Store';
        description: 'シークレット管理、暗号化設定';
        estimatedHours: 4;
        dependencies: [];
      }
    ];
  };
}
```

**Phase 2 開発タスク（スクレイピング）**
```typescript
interface Phase2DevelopmentTasks {
  scraping: {
    priority: 'High';
    tasks: [
      {
        name: 'Playwright Lambda Layer';
        description: 'ブラウザバイナリ含むLayer作成';
        estimatedHours: 12;
        technicalRisk: 'High - Lambda容量制限';
      },
      {
        name: '認証機能';
        description: 'クラウドワークスログイン自動化';
        estimatedHours: 8;
        technicalRisk: 'Medium - サイト仕様変更リスク';
      },
      {
        name: 'データ抽出';
        description: '案件情報のスクレイピング・正規化';
        estimatedHours: 16;
        technicalRisk: 'High - HTML構造依存';
      },
      {
        name: '重複チェック';
        description: '既存案件との重複排除機能';
        estimatedHours: 6;
        technicalRisk: 'Low';
      }
    ];
  };
}
```

**Phase 3 開発タスク（AI評価）**
```typescript
interface Phase3DevelopmentTasks {
  aiEvaluation: {
    priority: 'Medium';
    tasks: [
      {
        name: 'ChatGPT API連携';
        description: 'OpenAI SDK統合、API呼び出し';
        estimatedHours: 8;
        technicalRisk: 'Medium - API変更リスク';
      },
      {
        name: 'プロンプト最適化';
        description: '評価精度向上のためのプロンプト調整';
        estimatedHours: 12;
        technicalRisk: 'Medium - 評価精度確保';
      },
      {
        name: 'コスト制御';
        description: 'レート制限、月額予算制限実装';
        estimatedHours: 6;
        technicalRisk: 'Low';
      },
      {
        name: 'フォールバック';
        description: 'API障害時のデフォルト評価';
        estimatedHours: 4;
        technicalRisk: 'Low';
      }
    ];
  };
}
```

### 3.3 テストタスク

**単体テスト**
```typescript
interface UnitTestStrategy {
  coverage: {
    target: '80%以上';
    priority: 'ビジネスロジック100%、インフラ層60%';
  };
  
  testSuites: [
    {
      name: 'S3DataService';
      tests: ['データ保存', 'データ取得', '重複チェック'];
      mockStrategy: 'AWS SDK v3 mock';
    },
    {
      name: 'ChatGPTAPIService';
      tests: ['API呼び出し', 'レスポンス解析', 'エラーハンドリング'];
      mockStrategy: 'OpenAI API mock';
    },
    {
      name: 'CrowdWorksScrapingService';
      tests: ['認証', 'データ抽出', 'エラー処理'];
      mockStrategy: 'Playwright Page mock';
    }
  ];
  
  tools: ['Jest', '@types/jest', 'aws-sdk-client-mock'];
}
```

**結合テスト**
```typescript
interface IntegrationTestStrategy {
  scope: 'AWS サービス間連携、外部API連携';
  
  testSuites: [
    {
      name: 'Lambda-S3連携';
      description: 'データ保存・取得の一連の流れ';
      environment: 'テスト用AWSアカウント';
    },
    {
      name: 'EventBridge-Lambda連携';
      description: 'スケジュール実行の動作確認';
      environment: 'テスト用AWSアカウント';
    },
    {
      name: 'ChatGPT API連携';
      description: '実際のAPI呼び出しとレスポンス処理';
      environment: 'テスト用APIキー';
    }
  ];
}
```

**E2Eテスト**
```typescript
interface E2ETestStrategy {
  scope: 'システム全体の動作確認';
  
  scenarios: [
    {
      name: '正常フロー';
      steps: [
        'EventBridge トリガー',
        'スクレイピング実行',
        'AI評価実行',
        'S3データ保存',
        '通知送信'
      ];
      expectedResult: '全て成功、適切なデータ保存';
    },
    {
      name: 'エラー回復フロー';
      steps: [
        'スクレイピング失敗',
        'リトライ実行',
        'エラー通知送信'
      ];
      expectedResult: 'エラー通知が送信される';
    }
  ];
}
```

### 3.4 デプロイタスク

**デプロイ戦略**
```typescript
interface DeploymentStrategy {
  environments: {
    development: {
      description: 'ローカル開発・単体テスト';
      deployment: 'npm run dev';
      dataSource: 'モックデータ';
    };
    
    staging: {
      description: '結合テスト・E2Eテスト';
      deployment: 'cdk deploy --profile staging';
      dataSource: 'テスト用クラウドワークス（サンドボックス）';
    };
    
    production: {
      description: '本番運用';
      deployment: 'cdk deploy --profile production';
      dataSource: '実際のクラウドワークス';
    };
  };
  
  process: [
    'ローカルでの全テスト実行',
    'staging環境へのデプロイ',
    'staging環境での結合テスト',
    'production環境へのデプロイ',
    'production環境での動作確認',
    '監視アラート設定確認'
  ];
}
```

**デプロイ自動化**
```typescript
interface DeploymentAutomation {
  cicd: {
    tool: 'GitHub Actions（無料枠）';
    triggers: ['main branch push', 'release tag'];
  };
  
  pipeline: [
    {
      stage: 'Test';
      actions: ['npm test', 'lint check', 'type check'];
    },
    {
      stage: 'Build';
      actions: ['npm run build', 'cdk synth'];
    },
    {
      stage: 'Deploy to Staging';
      actions: ['cdk deploy staging'];
      condition: 'branch == main';
    },
    {
      stage: 'E2E Test';
      actions: ['run e2e tests on staging'];
    },
    {
      stage: 'Deploy to Production';
      actions: ['cdk deploy production'];
      condition: 'tag release';
      approval: 'manual';
    }
  ];
}
```

## 4. リスク管理

### 4.1 技術的リスク

**高リスク項目**
```typescript
interface HighTechnicalRisks {
  playwrightLambda: {
    risk: 'Playwright on Lambda の容量・実行時間制限';
    probability: 'High';
    impact: 'High';
    mitigation: [
      'Lambda Layer最適化（不要ファイル削除）',
      'ブラウザオプション調整（軽量化）',
      'タイムアウト処理の充実',
      'フォールバック機能実装'
    ];
    contingency: 'Fargate への移行検討';
  };
  
  crowdworksChanges: {
    risk: 'クラウドワークスサイト仕様変更';
    probability: 'Medium';
    impact: 'High';
    mitigation: [
      'セレクタの柔軟な指定',
      '複数の抽出方法用意',
      '定期的な動作確認',
      'エラー検知・アラート機能'
    ];
    contingency: '手動バックアップ手順の準備';
  };
  
  chatgptApiChanges: {
    risk: 'ChatGPT API仕様変更・価格変更';
    probability: 'Medium';
    impact: 'Medium';
    mitigation: [
      'API バージョン固定',
      'コスト監視アラート',
      'フォールバック評価ロジック',
      '他LLM APIの調査'
    ];
    contingency: 'ルールベース評価への切り替え';
  };
}
```

**中リスク項目**
```typescript
interface MediumTechnicalRisks {
  awsCostOverrun: {
    risk: 'AWS利用料金の予想外の増加';
    probability: 'Medium';
    impact: 'Medium';
    mitigation: [
      'AWS Cost Explorer での監視',
      'Billing Alerts 設定',
      'リソース利用量の定期確認',
      'コスト最適化の継続的実施'
    ];
  };
  
  performanceDegradation: {
    risk: 'Lambda実行時間の増加';
    probability: 'Medium';
    impact: 'Medium';
    mitigation: [
      'パフォーマンス監視',
      'コード最適化',
      'プロファイリング実施',
      'アーキテクチャ見直し'
    ];
  };
}
```

### 4.2 スケジュールリスク

**開発遅延リスク**
```typescript
interface ScheduleRisks {
  playwrightIntegration: {
    plannedDuration: '1週間';
    riskFactor: '技術的困難により2-3週間に延長の可能性';
    mitigation: [
      '事前調査・プロトタイプ作成',
      '代替案（Puppeteer等）の準備',
      'バッファ期間の確保'
    ];
  };
  
  aiPromptOptimization: {
    plannedDuration: '1週間';
    riskFactor: '評価精度確保で反復が必要';
    mitigation: [
      '評価基準の明確化',
      'テストデータセット準備',
      '段階的改善アプローチ'
    ];
  };
  
  awsLearningCurve: {
    plannedDuration: '継続的';
    riskFactor: 'CDK・サーバレス技術の習得時間';
    mitigation: [
      '事前学習期間の確保',
      'AWSドキュメント・チュートリアル活用',
      'コミュニティからの情報収集'
    ];
  };
}
```

### 4.3 対策・回避策

**リスク軽減戦略**
```typescript
interface RiskMitigationStrategy {
  proactiveApproach: {
    prototypeFirst: '本格実装前のPoC実施';
    incrementalDevelopment: '機能を段階的に実装・検証';
    continuousMonitoring: '継続的な監視・アラート';
    documentationFirst: '設計書の事前作成';
  };
  
  contingencyPlans: {
    technicalAlternatives: {
      playwright: 'Puppeteer、Selenium';
      chatgpt: 'Claude、Gemini、ルールベース';
      lambda: 'Fargate、EC2';
    };
    
    fallbackMechanisms: {
      scrapingFailure: 'エラー通知 + 手動実行手順';
      aiFailure: 'デフォルトスコア + 基本フィルタリング';
      notificationFailure: 'ログ出力 + CloudWatch監視';
    };
  };
  
  qualityAssurance: {
    codeReview: '全PRのレビュー必須';
    testing: '各機能80%以上のテストカバレッジ';
    monitoring: 'リアルタイム監視・アラート';
    backup: '設定ファイルのバージョン管理';
  };
}
```

## 5. 品質管理

### 5.1 コードレビュー方針

**レビュー基準**
```typescript
interface CodeReviewStandards {
  mandatory: {
    typeDefinitions: '全関数・クラスの型定義必須';
    errorHandling: '適切なエラーハンドリング';
    testing: '新機能の単体テスト必須';
    documentation: 'TSDocコメント';
    security: 'シークレット情報のハードコーディング禁止';
  };
  
  performance: {
    lambdaOptimization: 'メモリ・実行時間の最適化';
    s3Operations: '最小限のAPI呼び出し';
    costConsciousness: 'コストインパクトの考慮';
  };
  
  maintainability: {
    codeStructure: '適切な関数・クラス分割';
    naming: '意味的な変数・関数名';
    constants: 'マジックナンバーの排除';
    comments: '複雑なロジックの説明';
  };
}
```

**レビュープロセス**
```typescript
interface ReviewProcess {
  steps: [
    '開発者による自己レビュー',
    'ESLint・Prettier による自動チェック',
    'TypeScript型チェック',
    '単体テスト実行',
    'Pull Request 作成',
    'コードレビュー実施',
    '修正・再レビュー（必要に応じて）',
    'マージ・デプロイ'
  ];
  
  criteria: {
    functionalCorrectness: '期待される動作の確認';
    codeQuality: 'Clean Code 原則の遵守';
    testCoverage: '80%以上のカバレッジ';
    documentation: '必要な説明の追加';
    security: 'セキュリティベストプラクティス';
  };
}
```

### 5.2 テスト方針

**テスト戦略**
```typescript
interface TestStrategy {
  pyramid: {
    unit: {
      coverage: '80%以上';
      focus: 'ビジネスロジック、ユーティリティ関数';
      tools: ['Jest', '@types/jest'];
      mocking: 'AWS SDK、外部API';
    };
    
    integration: {
      coverage: '主要フロー100%';
      focus: 'AWS サービス間連携';
      environment: 'テスト用AWSアカウント';
      tools: ['Jest', 'aws-sdk-client-mock'];
    };
    
    e2e: {
      coverage: '重要シナリオ100%';
      focus: 'エンドツーエンドの動作確認';
      environment: 'staging環境';
      tools: ['Jest', '実際のAWS環境'];
    };
  };
  
  testTypes: {
    functional: '機能要件の確認';
    performance: '実行時間・メモリ使用量';
    reliability: 'エラー処理・回復機能';
    security: '認証・認可・データ保護';
    cost: 'AWS利用料金の想定内確認';
  };
}
```

**テスト自動化**
```typescript
interface TestAutomation {
  continuous: {
    trigger: ['コミット時', 'PR作成時', 'マージ時'];
    pipeline: [
      'Lint チェック',
      '型チェック',
      '単体テスト',
      'カバレッジ確認',
      '結合テスト（staging）'
    ];
  };
  
  scheduled: {
    e2eTests: '日次実行（本番環境監視）';
    performanceTests: '週次実行';
    securityTests: '月次実行';
  };
  
  reporting: {
    coverage: 'Codecov 連携';
    results: 'GitHub Actions ログ';
    alerts: 'Slack 通知（失敗時）';
  };
}
```

### 5.3 品質指標

**品質メトリクス**
```typescript
interface QualityMetrics {
  functional: {
    successRate: {
      target: '95%以上';
      measurement: '15分間隔実行の成功率';
    };
    
    dataAccuracy: {
      target: '95%以上';
      measurement: '取得データの正確性';
    };
    
    evaluationPrecision: {
      target: '80%以上';
      measurement: 'AI評価と手動評価の一致率';
    };
  };
  
  performance: {
    executionTime: {
      target: '平均60秒以内';
      measurement: 'Lambda実行時間';
    };
    
    errorRate: {
      target: '5%以下';
      measurement: '実行失敗率';
    };
    
    responseTime: {
      target: 'API呼び出し3秒以内';
      measurement: 'ChatGPT API応答時間';
    };
  };
  
  reliability: {
    uptime: {
      target: '95%以上';
      measurement: 'システム稼働率';
    };
    
    recovery: {
      target: '15分以内';
      measurement: 'エラーからの自動回復時間';
    };
  };
  
  cost: {
    monthlyBudget: {
      target: '$5以下';
      measurement: 'AWS利用料金合計';
    };
    
    costPerExecution: {
      target: '$0.05以下';
      measurement: '1回実行あたりのコスト';
    };
  };
}
```

**品質改善プロセス**
```typescript
interface QualityImprovementProcess {
  monitoring: {
    realtime: 'CloudWatch メトリクス監視';
    daily: '日次サマリーレポート確認';
    weekly: '週次品質レビュー';
    monthly: '月次コスト・パフォーマンス分析';
  };
  
  improvement: {
    threshold: '目標値を下回った場合の改善アクション';
    analysis: '原因分析・根本対策の実施';
    optimization: '継続的な最適化';
    documentation: '改善内容の記録・共有';
  };
  
  feedback: {
    userFeedback: '実際の利用者からのフィードバック収集';
    metrics: 'データに基づく改善判断';
    iteration: '2週間サイクルでの継続改善';
  };
}
```

## 6. 成功基準・完了定義

### 6.1 MVP（Minimum Viable Product）基準

```typescript
interface MVPCriteria {
  core: {
    automated: '15分間隔での自動実行';
    scraping: 'クラウドワークスからの案件取得';
    evaluation: 'ChatGPT による基本評価';
    notification: '高評価案件の通知';
    storage: 'S3 での7日間データ保持';
  };
  
  quality: {
    reliability: '80%以上の成功率';
    cost: '月$5以下の運用コスト';
    performance: '平均実行時間2分以内';
  };
  
  deliverables: [
    '動作するシステム（AWS本番環境）',
    'ソースコード（GitHubリポジトリ）',
    '設計書・運用手順書',
    '基本的な監視・アラート設定'
  ];
}
```

この実装計画書により、S3ベース設計とコスト制約$5/月を満たしながら、段階的かつ確実にシステムを構築できる具体的な道筋が示されました。 