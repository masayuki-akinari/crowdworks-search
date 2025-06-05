# デプロイガイド

## 1. 前提条件

以下のツールがインストールされていることを確認してください。

```bash
- Node.js 18+
- AWS CLI v2
- Docker Desktop
- AWS CDK CLI
```

## 2. 環境セットアップ

```bash
# リポジトリのクローン
git clone https://github.com/masayuki-akinari/crowdworks-search.git
cd crowdworks-search

# 依存関係のインストール
npm install

# AWS 認証情報設定
aws configure

# CDK 初期化（初回のみ）
npx cdk bootstrap
```

## 3. コンテナイメージ版デプロイ（推奨）

```bash
# ビルド & デプロイ
npm run cdk:deploy

# または手動で段階実行
docker build -t crowdworks-searcher .
npx cdk deploy --context deployMethod=container
```

## 4. パラメータストアへの設定

```bash
aws ssm put-parameter \
  --name "/crowdworks-search/openai-api-key" \
  --value "your-openai-api-key" \
  --type "SecureString"

aws ssm put-parameter \
  --name "/crowdworks-search/crowdworks-email" \
  --value "your-crowdworks-email" \
  --type "SecureString"
```

## 5. CI/CDによる自動デプロイ

GitHub Actionsを使用すれば、`main`や`develop`ブランチへのプッシュを契機に
インフラを自動でデプロイできます。ワークフローの詳細は
[CI/CD セットアップ](./CI_CD_SETUP.md) を参照してください。
