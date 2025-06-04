# データ設計書

## 1. データストレージ設計

### 1.1 S3バケット構造

```
crowdworks-searcher-bucket/
├── jobs/                           # 案件データ
│   ├── 2024-01-15T14-30.json     # タイムスタンプ形式
│   ├── 2024-01-15T14-45.json
│   └── ...
├── evaluations/                    # AI評価結果
│   ├── 2024-01-15T14-30.json
│   ├── 2024-01-15T14-45.json
│   └── ...
├── logs/                           # 実行・エラーログ
│   ├── execution/
│   │   ├── 2024-01-15T14-30-execution.json
│   │   └── ...
│   ├── error/
│   │   ├── 2024-01-15T14-30-error.json
│   │   └── ...
│   └── daily-summary/
│       ├── 2024-01-15.json
│       └── ...
└── config/                         # 設定ファイル
    ├── search-conditions.json     # 検索条件
    └── system-config.json         # システム設定
```

### 1.2 ファイル命名規則

```typescript
interface FileNamingConvention {
  jobs: 'YYYY-MM-DDTHH-mm.json';           // 2024-01-15T14-30.json
  evaluations: 'YYYY-MM-DDTHH-mm.json';   // 2024-01-15T14-30.json
  executionLogs: 'YYYY-MM-DDTHH-mm-execution.json';
  errorLogs: 'YYYY-MM-DDTHH-mm-error.json';
  dailySummary: 'YYYY-MM-DD.json';         // 2024-01-15.json
  searchConditions: 'search-conditions.json';
  systemConfig: 'system-config.json';
}
```

### 1.3 ライフサイクル管理

```typescript
interface S3LifecyclePolicy {
  rules: [
    {
      id: 'DeleteOldData';
      status: 'Enabled';
      transitions: [];
      expiration: {
        days: 7; // 7日後自動削除
      };
      filter: {
        prefix: 'jobs/'; // jobs/, evaluations/, logs/ 対象
      };
    },
    {
      id: 'KeepConfig';
      status: 'Enabled';
      expiration: null; // config/ は削除しない
      filter: {
        prefix: 'config/';
      };
    }
  ];
}
```

## 2. データ型定義

### 2.1 TypeScript型定義

#### 2.1.1 案件データ型（軽量版）

```typescript
interface JobData {
  // 基本情報
  id: string;                    // 案件ID（ユニーク）
  title: string;                 // 案件タイトル
  description: string;           // 案件詳細（最大500文字）
  url: string;                   // 案件URL
  
  // 条件情報
  budget: number;                // 予算（円）
  deadline: Date;                // 納期
  workType: 'fixed' | 'hourly'; // 固定報酬 or 時間単価
  category: string;              // カテゴリ
  
  // クライアント情報
  clientName: string;            // クライアント名
  clientRating: number;          // クライアント評価（1-5）
  clientReviews: number;         // レビュー数
  
  // スキル・要件
  skills: string[];              // 必要スキル（最大5個）
  experience: 'beginner' | 'intermediate' | 'expert'; // 経験レベル
  
  // メタ情報
  scrapedAt: Date;              // 取得日時
  source: 'crowdworks';         // 取得元（将来拡張用）
}

// バリデーション関数
const validateJobData = (job: JobData): boolean => {
  return (
    job.id.length > 0 &&
    job.title.length > 0 &&
    job.description.length <= 500 &&
    job.budget > 0 &&
    job.skills.length <= 5 &&
    job.clientRating >= 1 && job.clientRating <= 5
  );
};
```

#### 2.1.2 評価結果型（軽量版）

```typescript
interface JobEvaluation {
  // 関連情報
  jobId: string;                // 対象案件ID
  evaluatedAt: Date;           // 評価日時
  
  // 評価結果
  score: number;               // おすすめ度（1-10）
  reason: string;              // 評価理由（最大50文字）
  
  // メタ情報
  aiModel: 'gpt-3.5-turbo';    // 使用AIモデル
  tokenUsed: number;           // 使用トークン数
  costEstimate: number;        // 推定コスト（USD）
  
  // 評価詳細（簡素化）
  strengths: string[];         // 強み（最大3個）
  concerns: string[];          // 懸念点（最大3個）
}

// デフォルト評価（AI失敗時）
const createDefaultEvaluation = (jobId: string): JobEvaluation => ({
  jobId,
  evaluatedAt: new Date(),
  score: 5, // デフォルトスコア
  reason: 'AI評価失敗のため暫定スコア',
  aiModel: 'gpt-3.5-turbo',
  tokenUsed: 0,
  costEstimate: 0,
  strengths: [],
  concerns: ['AI評価未実施']
});
```

#### 2.1.3 実行ログ型

```typescript
interface ExecutionLog {
  // 実行情報
  executionId: string;         // 実行ID（タイムスタンプベース）
  timestamp: string;           // 実行開始時刻（ISO形式）
  status: 'success' | 'error' | 'partial'; // 実行ステータス
  duration: number;            // 実行時間（ミリ秒）
  
  // 処理結果
  jobsScraped: number;         // スクレイピング件数
  newJobs: number;             // 新規案件数
  aiEvaluated: number;         // AI評価件数
  highScoreJobs: number;       // 高評価案件数（閾値以上）
  
  // コスト情報
  costEstimate: number;        // 推定コスト（USD）
  
  // エラー情報（該当時のみ）
  error?: {
    type: string;              // エラータイプ
    message: string;           // エラーメッセージ
    stack?: string;            // スタックトレース
  };
}
```

#### 2.1.4 設定型

```typescript
// システム設定（config/system-config.json）
interface SystemConfig {
  scraping: {
    maxJobsPerExecution: 50;          // 最大処理件数
    preFilterEnabled: true;           // 事前フィルタ有効
    minBudget: 50000;                 // 最低予算（円）
    minClientRating: 4.0;             // 最低クライアント評価
    maxDescriptionLength: 500;        // 説明文最大長
  };
  
  ai: {
    enabled: true;                    // AI評価有効
    model: 'gpt-3.5-turbo';          // 使用モデル
    maxJobsForEvaluation: 10;        // 最大AI評価件数
    monthlyBudgetLimit: 3.0;         // 月間予算制限（USD）
    maxTokensPerRequest: 200;        // リクエスト最大トークン
    temperature: 0.3;                // 応答の一貫性
  };
  
  notification: {
    enabled: true;                   // 通知有効
    scoreThreshold: 7;               // 高評価閾値
    errorNotificationEnabled: true;   // エラー通知有効
    dailySummaryEnabled: true;       // 日次サマリー有効
  };
  
  storage: {
    retentionDays: 7;                // データ保持日数
    compressionEnabled: false;        // 圧縮無効（コスト削減）
    backupEnabled: false;            // バックアップ無効（コスト削減）
  };
  
  performance: {
    timeoutSeconds: 600;             // タイムアウト（10分）
    retryCount: 2;                   // リトライ回数
    concurrentLimit: 1;              // 同時実行数制限
  };
}

// 検索条件設定（config/search-conditions.json）
interface SearchConditions {
  version: string;                   // 設定バージョン
  lastUpdated: Date;                 // 最終更新日時
  
  conditions: Array<{
    id: string;                      // 条件ID
    name: string;                    // 条件名
    enabled: boolean;                // 有効フラグ
    
    // 基本条件
    keywords: string[];              // キーワード（最大10個）
    budgetMin: number;               // 最低予算
    budgetMax: number;               // 最高予算
    category: string;                // カテゴリ
    workType: 'fixed' | 'hourly' | 'both'; // 作業形式
    
    // フィルタ条件
    clientRatingMin: number;         // 最低クライアント評価
    experienceLevel: 'beginner' | 'intermediate' | 'expert' | 'any';
    
    // 除外条件
    excludeKeywords: string[];       // 除外キーワード
    excludeClients: string[];        // 除外クライアント
  }>;
}
```

## 3. データ操作設計

### 3.1 S3データサービス

```typescript
class S3DataService {
  private s3: S3Client;
  private bucketName: string;

  // 案件データ操作
  async saveJobs(jobs: JobData[], timestamp: string): Promise<void> {
    const key = `jobs/${timestamp}.json`;
    const body = JSON.stringify(jobs.map(this.sanitizeJobData), null, 2);
    
    await this.s3.putObject({
      Bucket: this.bucketName,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      ServerSideEncryption: 'AES256',
      Metadata: {
        'job-count': jobs.length.toString(),
        'created-at': new Date().toISOString()
      }
    });
  }

  async getRecentJobs(hours: number = 24): Promise<JobData[]> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const objects = await this.listObjectsSince('jobs/', cutoff);
    
    const allJobs: JobData[] = [];
    for (const obj of objects.slice(0, 10)) { // 最大10ファイル
      const data = await this.getObject(obj.Key!);
      const jobs: JobData[] = JSON.parse(data);
      allJobs.push(...jobs);
    }
    
    return allJobs;
  }

  async getExistingJobIds(hours: number = 48): Promise<Set<string>> {
    const recentJobs = await this.getRecentJobs(hours);
    return new Set(recentJobs.map(job => job.id));
  }

  // 設定操作
  async getSystemConfig(): Promise<SystemConfig> {
    try {
      const data = await this.getObject('config/system-config.json');
      return JSON.parse(data);
    } catch (error) {
      return this.getDefaultSystemConfig();
    }
  }

  async getSearchConditions(): Promise<SearchConditions> {
    try {
      const data = await this.getObject('config/search-conditions.json');
      return JSON.parse(data);
    } catch (error) {
      return this.getDefaultSearchConditions();
    }
  }

  // ユーティリティメソッド
  private async listObjectsSince(prefix: string, since: Date): Promise<_Object[]> {
    const response = await this.s3.listObjectsV2({
      Bucket: this.bucketName,
      Prefix: prefix,
      MaxKeys: 50 // コスト削減
    });

    return (response.Contents || [])
      .filter(obj => obj.LastModified && obj.LastModified >= since)
      .sort((a, b) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0));
  }

  private async getObject(key: string): Promise<string> {
    const response = await this.s3.getObject({
      Bucket: this.bucketName,
      Key: key
    });

    return response.Body?.transformToString() || '';
  }

  private sanitizeJobData(job: JobData): JobData {
    return {
      ...job,
      description: job.description.slice(0, 500), // 長さ制限
      skills: job.skills.slice(0, 5), // 配列長制限
      clientName: job.clientName.replace(/[^\w\s-]/g, '') // 特殊文字除去
    };
  }
}
```

### 3.2 重複チェック機能

```typescript
class DuplicateChecker {
  constructor(private dataService: S3DataService) {}

  async filterNewJobs(jobs: JobData[]): Promise<JobData[]> {
    // 過去48時間のジョブIDを取得
    const existingJobIds = await this.dataService.getExistingJobIds(48);
    
    // 重複除外
    const newJobs = jobs.filter(job => !existingJobIds.has(job.id));
    
    // さらに同一実行内での重複もチェック
    const uniqueJobs = this.removeDuplicatesInBatch(newJobs);
    
    return uniqueJobs;
  }

  private removeDuplicatesInBatch(jobs: JobData[]): JobData[] {
    const seen = new Set<string>();
    return jobs.filter(job => {
      if (seen.has(job.id)) {
        return false;
      }
      seen.add(job.id);
      return true;
    });
  }
}
```

## 4. データ移行・初期化

### 4.1 初期データ設定

```typescript
class DataInitializer {
  constructor(private dataService: S3DataService) {}

  async initializeSystem(): Promise<void> {
    // システム設定の初期化
    await this.initializeSystemConfig();
    
    // 検索条件の初期化
    await this.initializeSearchConditions();
    
    // S3バケットの設定確認
    await this.setupS3Bucket();
  }

  private async initializeSystemConfig(): Promise<void> {
    const defaultConfig: SystemConfig = {
      scraping: {
        maxJobsPerExecution: 50,
        preFilterEnabled: true,
        minBudget: 50000,
        minClientRating: 4.0,
        maxDescriptionLength: 500
      },
      ai: {
        enabled: true,
        model: 'gpt-3.5-turbo',
        maxJobsForEvaluation: 10,
        monthlyBudgetLimit: 3.0,
        maxTokensPerRequest: 200,
        temperature: 0.3
      },
      notification: {
        enabled: true,
        scoreThreshold: 7,
        errorNotificationEnabled: true,
        dailySummaryEnabled: true
      },
      storage: {
        retentionDays: 7,
        compressionEnabled: false,
        backupEnabled: false
      },
      performance: {
        timeoutSeconds: 600,
        retryCount: 2,
        concurrentLimit: 1
      }
    };

    await this.dataService.saveConfig('config/system-config.json', defaultConfig);
  }

  private async initializeSearchConditions(): Promise<void> {
    const defaultConditions: SearchConditions = {
      version: '1.0.0',
      lastUpdated: new Date(),
      conditions: [
        {
          id: 'web-development',
          name: 'Webアプリ開発',
          enabled: true,
          keywords: ['React', 'TypeScript', 'Next.js', 'Node.js'],
          budgetMin: 100000,
          budgetMax: 1000000,
          category: 'システム開発',
          workType: 'fixed',
          clientRatingMin: 4.0,
          experienceLevel: 'intermediate',
          excludeKeywords: ['WordPress', 'PHP'],
          excludeClients: []
        },
        {
          id: 'ai-development',
          name: 'AI・機械学習',
          enabled: true,
          keywords: ['Python', 'AI', '機械学習', 'データ分析'],
          budgetMin: 150000,
          budgetMax: 2000000,
          category: 'システム開発',
          workType: 'fixed',
          clientRatingMin: 4.5,
          experienceLevel: 'expert',
          excludeKeywords: ['Excel', '単純作業'],
          excludeClients: []
        }
      ]
    };

    await this.dataService.saveConfig('config/search-conditions.json', defaultConditions);
  }
}
```

## 5. データバックアップ・復旧

### 5.1 バックアップ方針（コスト重視）

```typescript
interface BackupStrategy {
  // 基本方針：コスト削減のため最小限のバックアップ
  configBackup: {
    enabled: true;
    frequency: 'on-change';  // 設定変更時のみ
    retention: '30 days';
    location: 'same-bucket/backups/config/';
  };
  
  dataBackup: {
    enabled: false;          // データは7日で削除されるためバックアップなし
    reason: 'Cost optimization - data has short lifecycle';
  };
  
  logBackup: {
    enabled: false;          // ログも7日で削除
    reason: 'Cost optimization - short retention period';
  };
}

class BackupService {
  constructor(private dataService: S3DataService) {}

  // 設定ファイルのバックアップ（変更時のみ）
  async backupConfigOnChange(configType: 'system' | 'search-conditions'): Promise<void> {
    const timestamp = new Date().toISOString().split('T')[0];
    const sourceKey = `config/${configType === 'system' ? 'system-config.json' : 'search-conditions.json'}`;
    const backupKey = `backups/config/${configType}-${timestamp}.json`;

    try {
      const data = await this.dataService.getObject(sourceKey);
      await this.dataService.putObject(backupKey, data);
    } catch (error) {
      console.warn(`Config backup failed: ${error}`);
    }
  }
}
```

## 6. データ品質管理

### 6.1 データ検証

```typescript
class DataValidator {
  // 案件データの検証
  static validateJobData(job: JobData): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 必須フィールドチェック
    if (!job.id || job.id.trim().length === 0) {
      errors.push('Job ID is required');
    }
    if (!job.title || job.title.trim().length === 0) {
      errors.push('Job title is required');
    }
    if (!job.url || !this.isValidUrl(job.url)) {
      errors.push('Valid job URL is required');
    }

    // 数値検証
    if (job.budget <= 0) {
      errors.push('Budget must be positive');
    }
    if (job.clientRating < 1 || job.clientRating > 5) {
      errors.push('Client rating must be between 1 and 5');
    }

    // 配列長制限
    if (job.skills.length > 5) {
      errors.push('Skills array cannot exceed 5 items');
    }
    if (job.description.length > 500) {
      errors.push('Description cannot exceed 500 characters');
    }

    // 日付検証
    if (!(job.scrapedAt instanceof Date) || isNaN(job.scrapedAt.getTime())) {
      errors.push('Invalid scraped date');
    }
    if (!(job.deadline instanceof Date) || isNaN(job.deadline.getTime())) {
      errors.push('Invalid deadline');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // 評価データの検証
  static validateEvaluation(evaluation: JobEvaluation): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!evaluation.jobId || evaluation.jobId.trim().length === 0) {
      errors.push('Job ID is required');
    }
    if (evaluation.score < 1 || evaluation.score > 10) {
      errors.push('Score must be between 1 and 10');
    }
    if (!evaluation.reason || evaluation.reason.length > 50) {
      errors.push('Reason must be 1-50 characters');
    }
    if (evaluation.tokenUsed < 0) {
      errors.push('Token usage cannot be negative');
    }
    if (evaluation.costEstimate < 0) {
      errors.push('Cost estimate cannot be negative');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return url.includes('crowdworks.jp');
    } catch {
      return false;
    }
  }
}

// データクリーニング
class DataCleaner {
  static cleanJobData(job: JobData): JobData {
    return {
      ...job,
      title: job.title.trim().slice(0, 200),
      description: job.description.trim().slice(0, 500),
      skills: job.skills.slice(0, 5).map(skill => skill.trim()),
      clientName: job.clientName.trim().replace(/[^\w\s-]/g, ''),
      budget: Math.max(0, Math.round(job.budget)),
      clientRating: Math.max(1, Math.min(5, job.clientRating))
    };
  }

  static cleanEvaluation(evaluation: JobEvaluation): JobEvaluation {
    return {
      ...evaluation,
      score: Math.max(1, Math.min(10, Math.round(evaluation.score))),
      reason: evaluation.reason.trim().slice(0, 50),
      strengths: evaluation.strengths.slice(0, 3),
      concerns: evaluation.concerns.slice(0, 3),
      tokenUsed: Math.max(0, evaluation.tokenUsed),
      costEstimate: Math.max(0, evaluation.costEstimate)
    };
  }
}
```

**これでS3ベース設計に最適化されたデータ設計書が完成しました！**

コスト制約（月$5以下）を満たしながら、必要な機能を提供できる軽量なデータ構造になっています。 