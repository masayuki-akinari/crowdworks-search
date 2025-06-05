# AWS CI/CD デプロイメント セットアップガイド

このガイドでは、GitHub ActionsからAWSに自動デプロイするためのCI/CDパイプラインの設定方法について説明します。

## 🏗️ アーキテクチャ概要

```
GitHub Actions → OIDC認証 → AWS IAMロール → AWS CDK → Lambda + ECR
```

### デプロイフロー
- **develop**ブランチ → **staging**環境 (自動デプロイ)
- **main**ブランチ → **production**環境 (自動デプロイ + 承認フロー)
- **手動実行** → 任意の環境

## 📋 前提条件

1. **AWS CLI**がインストール済み、設定済み
2. **AWS CDK**がインストール済み
3. **適切なAWS権限**を持つIAMユーザーでログイン済み
4. **GitHub リポジトリ**の管理者権限

## 🚀 セットアップ手順

### Step 1: AWS OIDC認証の設定

GitHub ActionsからAWSにセキュアにアクセスするためのOIDC認証を設定します。

```bash
# スクリプトの実行（Windows環境では Git Bash または WSL を使用）
./scripts/setup-github-oidc.sh <YOUR_GITHUB_USERNAME> <REPOSITORY_NAME>

# 例
./scripts/setup-github-oidc.sh myusername crowdworks-search
```

このスクリプトは以下を自動作成します：
- GitHub OIDC Identity Provider
- Staging環境用IAMロール
- Production環境用IAMロール

### Step 2: GitHubシークレットの設定

1. GitHubリポジトリの **Settings** → **Secrets and variables** → **Actions**
2. 以下のシークレットを追加：

#### 必須シークレット
```bash
# AWS IAMロール ARN（Step 1で出力される）
STAGING_AWS_ROLE_ARN=arn:aws:iam::123456789012:role/GitHubActions-CrowdWorksSearch-Staging
PRODUCTION_AWS_ROLE_ARN=arn:aws:iam::123456789012:role/GitHubActions-CrowdWorksSearch-Production

# アプリケーション設定（Parameter Storeに保存される値）
STAGING_OPENAI_API_KEY=sk-...（Staging用OpenAI APIキー）
PRODUCTION_OPENAI_API_KEY=sk-...（Production用OpenAI APIキー）

STAGING_CROWDWORKS_EMAIL=your-email@example.com
STAGING_CROWDWORKS_PASSWORD=your-password
PRODUCTION_CROWDWORKS_EMAIL=your-email@example.com
PRODUCTION_CROWDWORKS_PASSWORD=your-password
```

#### オプションシークレット
```bash
# Slack通知（任意）
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Codecov（任意）
CODECOV_TOKEN=xxx...
```

### Step 3: GitHub Environments設定

保護機能とデプロイ承認を設定します。

1. GitHubリポジトリの **Settings** → **Environments**
2. **New environment** をクリック

#### Staging環境
- 環境名: `staging`
- 保護ルール: なし（自動デプロイ）

#### Production環境
- 環境名: `production`
- 保護ルール設定：
  - ✅ **Required reviewers**: 1人以上
  - ✅ **Wait timer**: 0分
  - ✅ **Deployment branches**: Selected branches only → `main`

### Step 4: AWS Parameter Storeにシークレット保存

アプリケーションが使用するシークレットをAWS Parameter Storeに保存します。

```bash
# Staging環境
aws ssm put-parameter \
  --name "/crowdworks-search/staging/openai-api-key" \
  --value "sk-your-staging-key" \
  --type "SecureString" \
  --region ap-northeast-1

aws ssm put-parameter \
  --name "/crowdworks-search/staging/crowdworks-email" \
  --value "your-staging-email@example.com" \
  --type "SecureString" \
  --region ap-northeast-1

aws ssm put-parameter \
  --name "/crowdworks-search/staging/crowdworks-password" \
  --value "your-staging-password" \
  --type "SecureString" \
  --region ap-northeast-1

# Production環境
aws ssm put-parameter \
  --name "/crowdworks-search/production/openai-api-key" \
  --value "sk-your-production-key" \
  --type "SecureString" \
  --region ap-northeast-1

aws ssm put-parameter \
  --name "/crowdworks-search/production/crowdworks-email" \
  --value "your-production-email@example.com" \
  --type "SecureString" \
  --region ap-northeast-1

aws ssm put-parameter \
  --name "/crowdworks-search/production/crowdworks-password" \
  --value "your-production-password" \
  --type "SecureString" \
  --region ap-northeast-1
```

## 🔄 CI/CDパイプライン動作

### 自動デプロイ

#### Staging環境デプロイ
```bash
# developブランチにpushすると自動実行
git checkout develop
git add .
git commit -m "feat: 新機能を追加"
git push origin develop
```

#### Production環境デプロイ
```bash
# mainブランチにpushすると自動実行（承認フロー付き）
git checkout main
git merge develop
git push origin main
```

### 手動デプロイ

GitHubリポジトリの **Actions** タブから手動実行可能：

1. **Actions** タブをクリック
2. **CI/CD Pipeline** ワークフローを選択
3. **Run workflow** をクリック
4. 環境を選択（staging / production）

## 📊 デプロイ状況の確認

### GitHub Actions
- **Actions** タブでワークフロー実行状況を確認
- ログの詳細確認とエラー対応

### AWS Console
```bash
# Lambda関数の確認
aws lambda list-functions --query 'Functions[?contains(FunctionName, `crowdworks-searcher`)]'

# CloudFormation Stack確認
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE

# CloudWatch Logs確認
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/crowdworks-searcher"
```

## 🛠️ トラブルシューティング

### よくあるエラーと対処法

#### 1. OIDC認証エラー
```
Error: Could not assume role with OIDC
```
**対処法:**
- IAMロールの信頼関係を確認
- GitHubリポジトリ名、ブランチ名が正しいか確認

#### 2. ECRログインエラー
```
Error: Cannot perform an interactive login from a non TTY device
```
**対処法:**
- ECRリポジトリの存在確認
- IAMロールにECR権限があるか確認

#### 3. CDKデプロイエラー
```
Error: Stack with id does not exist
```
**対処法:**
- CDK bootstrapが実行済みか確認
- AWSアカウント、リージョンが正しいか確認

```bash
# CDK Bootstrap実行
npx cdk bootstrap aws://ACCOUNT-ID/REGION
```

#### 4. Lambda関数デプロイエラー
```
Error: Code storage limit exceeded
```
**対処法:**
- 古いLambdaバージョンの削除
- Container Imageの使用（Playwright対応）

## 📈 監視とアラート

### CloudWatch メトリクス
- Lambda実行時間、エラー率
- コスト監視
- ログ監視

### Slackアラート（設定済みの場合）
- デプロイ成功・失敗通知
- リアルタイムステータス更新

## 🔒 セキュリティベストプラクティス

1. **最小権限の原則**: IAMロールは必要最小限の権限のみ
2. **シークレット管理**: Parameter Store使用、Gitコミットしない
3. **環境分離**: Staging/Production環境の完全分離
4. **監査ログ**: CloudTrailによる操作ログ記録
5. **定期的な権限レビュー**: 四半期毎のアクセス権限見直し

## 💡 Tips

- **デプロイ前テスト**: PRでテストパイプラインを確認
- **ロールバック戦略**: 問題発生時の手動ロールバック準備
- **コスト最適化**: 不要なリソースの定期削除
- **ドキュメント更新**: 設定変更時のドキュメント同期

---

これでCI/CD上でのAWSデプロイが完全に自動化されます！🎉 