# CrowdWorks Search - ローカル開発セットアップ手順

## 🔐 認証情報設定

### 方法1: 環境変数設定（推奨：ローカル開発用）

1. **環境変数ファイル作成**:
```bash
# env.example を .env にコピー
cp env.example .env

# .env ファイルを編集して実際の認証情報を設定
# Windows PowerShell の場合:
notepad .env

# 以下の値を設定:
CROWDWORKS_EMAIL=your-crowdworks-email@example.com
CROWDWORKS_PASSWORD=your-crowdworks-password
```

2. **環境変数を読み込んでテスト実行**:
```bash
# PowerShell で環境変数読み込み
Get-Content .env | ForEach-Object {
    $name, $value = $_.split('=', 2)
    Set-Item -Path "env:$name" -Value $value
}

# ローカルテスト実行
npm run test:login:local
```

### 方法2: AWS Parameter Store設定（本番用）

1. **Parameter Store に認証情報を設定**:
```bash
# CrowdWorks メールアドレス
aws ssm put-parameter \
  --name "/crowdworks-search/crowdworks/email" \
  --value "your-crowdworks-email@example.com" \
  --type "SecureString" \
  --region ap-northeast-1

# CrowdWorks パスワード
aws ssm put-parameter \
  --name "/crowdworks-search/crowdworks/password" \
  --value "your-crowdworks-password" \
  --type "SecureString" \
  --region ap-northeast-1
```

2. **Parameter Store パラメータ確認**:
```bash
# パラメータ一覧表示
aws ssm describe-parameters --region ap-northeast-1

# 特定パラメータの値確認（復号化して表示）
aws ssm get-parameter \
  --name "/crowdworks-search/crowdworks/email" \
  --with-decryption \
  --region ap-northeast-1
```

## 🧪 ローカルテスト実行

### 1. 依存関係インストール
```bash
npm install
```

### 2. TypeScriptビルド
```bash
npm run build
```

### 3. CrowdWorksログインテスト
```bash
# 環境変数から認証情報取得
npm run test:login:local

# または直接実行
npx ts-node src/test/crowdworks-scraping-test.ts
```

### 4. テスト結果確認
```
🚀 CrowdWorksログインテスト開始...
🔐 CrowdWorks認証情報を取得中...
✅ 環境変数から認証情報取得完了
📄 CrowdWorksログインページアクセス中...
✅ ログインページ読み込み完了
📧 メールアドレス入力中...
🔑 パスワード入力中...
📸 ログイン前スクリーンショット保存: login-before.png
🖱️ ログインボタンクリック中...
⏳ ログイン処理完了待機中...
📸 ログイン後スクリーンショット保存: login-after.png
🔍 ログイン状態確認中...
✅ ログイン成功！
⏸️ 5秒間待機（ログイン状態確認）...
🔒 ブラウザクローズ完了
🎉 CrowdWorksログインテスト完了
```

## 🚀 Lambda Container デプロイ

### 1. CDK スタック確認
```bash
npm run cdk:synth
```

### 2. Lambda Container デプロイ
```bash
npm run cdk:deploy:container
```

## 🔧 トラブルシューティング

### 認証エラーの場合
```bash
# AWS CLI設定確認
aws configure list

# Parameter Store アクセス権限確認
aws ssm describe-parameters --region ap-northeast-1

# IAM ユーザーの権限確認
aws sts get-caller-identity
```

### Playwright ブラウザエラーの場合
```bash
# Playwright ブラウザインストール
npx playwright install chromium

# 依存関係確認
npx playwright install-deps
```

## 📁 生成されるファイル

ローカルテスト実行時に以下のファイルが生成されます:
- `login-before.png`: ログイン前のスクリーンショット
- `login-after.png`: ログイン後のスクリーンショット

## 🔒 セキュリティ注意事項

1. **`.env` ファイルはコミットしない**（`.gitignore` で除外済み）
2. **認証情報をコードに直接書かない**
3. **Parameter Store は `SecureString` タイプを使用**
4. **本番環境では Parameter Store を使用**
5. **ローカル開発時のみ環境変数を使用** 