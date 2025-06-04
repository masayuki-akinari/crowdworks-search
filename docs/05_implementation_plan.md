# CrowdWorks自動化システム 実装計画書

## 📋 システム概要

### 目的
CrowdWorksの案件情報を自動的に収集・分析し、スクリーニングした結果をメールで通知するシステム

### アーキテクチャ
- **AWS Lambda**: スクレイピング実行（**コンテナイメージ版**）
- **Amazon EventBridge**: スケジュール実行
- **Amazon S3**: データ保存
- **Amazon SES**: メール通知
- **CDK**: Infrastructure as Code

## ⚠️ **最重要: Playwright Lambda制約の最終対応**

### **技術的課題の最終結論**
```yaml
現状分析:
  Lambda ZIP制限: 250MB
  Playwright + Chromium: ~300MB
  結論: ❌ ZIP版は物理的に不可能

最終対応方針:
  ✅ Lambda Container Image採用（確定）
  サイズ制限: 10GB（ZIP: 250MB → Container: 10GB）
  デプロイ方式: ECR + Docker
  月額コスト: $5-10（許容範囲内）
```

### **⚡ 最優先実装タスク（Phase 0）**

#### **1. Lambdaコンテナ環境の動作確認**
```bash
# 最優先事項（今すぐ実行）
priority: P0 - Critical
期限: 次回作業セッション内
目標: Playwright + Chromiumの動作実証
```

**具体的アクション:**
1. **現在のDockerfile修正**（Lambda Container用）
2. **CDKスタックの変更**（DockerImageFunction）
3. **ローカルテスト環境構築**
4. **AWS ECRデプロイテスト**
5. **Lambda実行確認**

#### **2. CDKスタック改修（Phase 0）**

**現在の問題:**
```typescript
// 現在: ZIP形式
new lambda.Function(this, 'CrowdWorksFunction', {
  runtime: lambda.Runtime.NODEJS_18_X,
  code: lambda.Code.fromAsset('./dist'),  // ❌ サイズ超過
  // ...
});
```

**修正方針:**
```typescript
// 修正後: Container形式
new lambda.DockerImageFunction(this, 'CrowdWorksFunction', {
  code: lambda.DockerImageCode.fromImageAsset('./'),  // ✅ 10GBまで対応
  memorySize: 3008,  // Playwright用メモリ
  timeout: Duration.minutes(15),
  architecture: lambda.Architecture.X86_64,
  environment: {
    // 環境変数設定
  }
});
```

## 🎯 **フェーズ別実装ロードマップ**

### **Phase 0: 基盤動作確認（最優先）**
```yaml
期間: 1-2日
目標: Playwrightの動作実証
ブロッカー解除: デプロイ基盤確立
```

**必須タスク:**
- [ ] **CDKスタック修正**（Lambda → DockerImageFunction）
- [ ] **Dockerfile最適化**（Lambda Container用）
- [ ] **ECRリポジトリ設定**
- [ ] **ローカルテスト環境**（Lambda Runtime Interface Emulator）
- [ ] **基本動作確認**（Chromium起動テスト）
- [ ] **AWS デプロイテスト**

### **Phase 1: コアスクレイピング実装**
```yaml
期間: 3-5日  
前提: Phase 0完了
目標: CrowdWorks案件取得
```

**実装内容:**
- [ ] **CrowdWorksログイン機能**
- [ ] **案件検索・リスト取得**
- [ ] **案件詳細データ抽出**
- [ ] **エラーハンドリング強化**
- [ ] **データ正規化処理**

### **Phase 2: AI評価・通知機能**
```yaml
期間: 2-3日
前提: Phase 1完了
目標: OpenAI連携・メール通知
```

**実装内容:**
- [ ] **OpenAI API連携**
- [ ] **案件品質評価ロジック**
- [ ] **評価結果フィルタリング**
- [ ] **SES/SNS メール通知**
- [ ] **通知テンプレート作成**

### **Phase 3: 運用最適化**
```yaml
期間: 2-3日
前提: Phase 2完了  
目標: 本番運用準備
```

**実装内容:**
- [ ] **S3データ保存・履歴管理**
- [ ] **監視・アラート設定**
- [ ] **コスト最適化**
- [ ] **パフォーマンスチューニング**
- [ ] **ドキュメント最終化**

## 🔧 **Phase 0詳細: 技術的実装ガイド**

### **1. Dockerfile修正（Lambda Container用）**

**現在の問題:**
```dockerfile
# 現在: 一般的なPlaywright環境
FROM mcr.microsoft.com/playwright/python:v1.45.0-jammy
# → Lambda Containerとして不完全
```

**修正方針:**
```dockerfile
# Lambda Container対応版
FROM public.ecr.aws/lambda/nodejs:18

# Playwright + Chromium インストール
RUN yum update -y && \
    yum install -y \
    chromium \
    nss \
    freetype \
    freetype-devel \
    harfbuzz \
    ca-certificates \
    ttf-liberation

# Node.js アプリケーション
COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./
COPY node_modules/ ./node_modules/

# Lambda エントリポイント
CMD ["lambda/handler.lambdaHandler"]
```

### **2. CDKスタック修正（infrastructure/）**

**ファイル:** `src/infrastructure/lambda-stack.ts`

```typescript
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';

export class CrowdWorksLambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ❌ 削除: 従来のZIP版Lambda
    // const crowdWorksFunction = new lambda.Function(...)

    // ✅ 追加: Container版Lambda
    const crowdWorksFunction = new lambda.DockerImageFunction(this, 'CrowdWorksFunction', {
      code: lambda.DockerImageCode.fromImageAsset('./'),
      memorySize: 3008,
      timeout: cdk.Duration.minutes(15),
      architecture: lambda.Architecture.X86_64,
      environment: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: '/usr/bin/chromium-browser'
      },
      deadLetterQueue: dlq,  // DLQ設定
      retryAttempts: 2,
      logRetention: logs.RetentionDays.TWO_WEEKS
    });
  }
}
```

### **3. ローカルテスト環境（Phase 0検証用）**

**Lambda Runtime Interface Emulator使用:**
```bash
# 1. Dockerイメージビルド
docker build -t crowdworks-lambda .

# 2. Lambda Runtime Interface Emulator起動
docker run -p 9000:8080 \
  -e AWS_LAMBDA_FUNCTION_NAME=crowdworks-searcher \
  crowdworks-lambda

# 3. ローカルテスト実行
curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -d '{"source":"test","detail":{}}'
```

### **4. 基本動作確認スクリプト**

**ファイル:** `src/lambda/test-playwright.ts`
```typescript
import { chromium } from 'playwright';

export async function testPlaywright() {
  let browser;
  
  try {
    console.log('🚀 Playwright起動テスト開始...');
    
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    
    const page = await context.newPage();
    
    // 基本動作確認
    console.log('📄 Google アクセステスト...');
    await page.goto('https://www.google.com', { waitUntil: 'networkidle' });
    const title = await page.title();
    console.log(`✅ ページタイトル: ${title}`);
    
    // スクリーンショット取得（確認用）
    await page.screenshot({ path: '/tmp/test-screenshot.png' });
    console.log('📸 スクリーンショット保存完了');
    
    return {
      success: true,
      title,
      message: 'Playwright動作確認成功'
    };
    
  } catch (error) {
    console.error('❌ Playwright テスト失敗:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '不明なエラー'
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
```

### **5. CI/CD対応（GitHub Actions修正）**

**.github/workflows/ci.yml 修正点:**
```yaml
# Docker Build段階を修正
docker-build:
  name: Docker Build Test (Lambda Container)
  runs-on: ubuntu-latest
  steps:
    - name: Build Lambda Container
      run: |
        docker build -t crowdworks-lambda:test .
        
    - name: Test Lambda Container
      run: |
        # Lambda Runtime Interface Emulatorでテスト
        docker run --rm -d -p 9000:8080 --name lambda-test crowdworks-lambda:test
        sleep 10
        
        # 基本動作確認
        curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
          -d '{"source":"test","detail":{}}' || exit 1
        
        docker stop lambda-test
```

## 📊 **リスク評価と対策**

### **高リスク要素**
1. **Lambda Container初回デプロイ** → ローカル十分検証
2. **Chromium動作不安定性** → エラーハンドリング強化
3. **メモリ・タイムアウト調整** → 段階的チューニング

### **リスク軽減策**
```yaml
デプロイ戦略:
  1. ローカル環境での十分な検証
  2. Staging環境での段階テスト
  3. Production環境への段階ロールアウト

監視強化:
  - CloudWatch Logs詳細ログ
  - Lambda実行メトリクス監視
  - エラー率アラート設定
```

## 💰 **コスト見積もり（確定版）**

### **Lambda Container版 月額コスト**
```yaml
Lambda実行:
  実行回数: 96回/日 × 30日 = 2,880回/月
  実行時間: 平均30秒/回
  メモリ: 3,008MB
  料金: ~$4-6/月

ECRストレージ:
  Dockerイメージ: ~1GB
  料金: $0.10/月

CloudWatch:
  ログ保存: ~$1-2/月
  
OpenAI API:
  GPT-4呼び出し: ~$2-3/月

合計: $7-11/月（目標$5を若干上回るが許容範囲）
```

## 🎯 **成功指標（Phase 0）**

### **必達目標**
1. ✅ **Chromium起動成功**: ローカル・AWS両環境
2. ✅ **基本ページアクセス**: Google等の簡単なサイト
3. ✅ **Lambda実行成功**: 15分タイムアウト内
4. ✅ **ログ出力確認**: CloudWatch Logsで詳細確認可能

### **品質目標**
- **起動時間**: 30秒以内
- **成功率**: 95%以上（10回テスト中9回成功）
- **メモリ使用量**: 2GB以下
- **ログレベル**: 十分なデバッグ情報

## 📞 **次のアクション（即時実行推奨）**

### **今すぐ実行すべきタスク**
1. **CDKスタック修正** → `DockerImageFunction`への変更
2. **Dockerfile修正** → Lambda Container用に最適化
3. **ローカル検証環境構築** → 動作確認の前提条件
4. **基本テストスクリプト作成** → 動作確認自動化

### **成功後の次ステップ**
- Phase 1へ進行（CrowdWorksスクレイピング実装）
- 運用監視設定
- パフォーマンスチューニング

---

**📌 最重要**: Phase 0の基盤確立なしには以降の実装が不可能です。**Playwright Lambda Container動作確認を最優先で実行してください。**