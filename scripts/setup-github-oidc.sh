#!/bin/bash

# GitHub Actions OIDC用のIAMロール作成スクリプト
# 使用方法: ./scripts/setup-github-oidc.sh <YOUR_GITHUB_USERNAME> <REPOSITORY_NAME>

set -e

# パラメータチェック
if [ $# -ne 2 ]; then
    echo "使用方法: $0 <GITHUB_USERNAME> <REPOSITORY_NAME>"
    echo "例: $0 myusername crowdworks-search"
    exit 1
fi

GITHUB_USERNAME=$1
REPOSITORY_NAME=$2
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(aws configure get region || echo "ap-northeast-1")

echo "🚀 GitHub Actions OIDC認証セットアップを開始します..."
echo "GitHub: ${GITHUB_USERNAME}/${REPOSITORY_NAME}"
echo "AWS Account: ${AWS_ACCOUNT_ID}"
echo "AWS Region: ${AWS_REGION}"

# OIDC Identity Providerの作成（存在しない場合のみ）
echo "📋 OIDC Identity Providerをチェック中..."
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com" 2>/dev/null; then
    echo "📝 OIDC Identity Providerを作成中..."
    aws iam create-open-id-connect-provider \
        --url "https://token.actions.githubusercontent.com" \
        --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" \
        --client-id-list "sts.amazonaws.com"
    echo "✅ OIDC Identity Providerを作成しました"
else
    echo "✅ OIDC Identity Providerは既に存在します"
fi

# Staging環境用IAMロール作成
echo "📝 Staging環境用IAMロールを作成中..."
STAGING_ROLE_NAME="GitHubActions-CrowdWorksSearch-Staging"

# 信頼ポリシー
cat > /tmp/staging-trust-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
                },
                "StringLike": {
                    "token.actions.githubusercontent.com:sub": [
                        "repo:${GITHUB_USERNAME}/${REPOSITORY_NAME}:ref:refs/heads/develop",
                        "repo:${GITHUB_USERNAME}/${REPOSITORY_NAME}:environment:staging"
                    ]
                }
            }
        }
    ]
}
EOF

# Production環境用IAMロール作成
echo "📝 Production環境用IAMロールを作成中..."
PRODUCTION_ROLE_NAME="GitHubActions-CrowdWorksSearch-Production"

# 信頼ポリシー
cat > /tmp/production-trust-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
                },
                "StringLike": {
                    "token.actions.githubusercontent.com:sub": [
                        "repo:${GITHUB_USERNAME}/${REPOSITORY_NAME}:ref:refs/heads/main",
                        "repo:${GITHUB_USERNAME}/${REPOSITORY_NAME}:environment:production"
                    ]
                }
            }
        }
    ]
}
EOF

# 権限ポリシー
cat > /tmp/deploy-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "cloudformation:*",
                "s3:*",
                "lambda:*",
                "iam:*",
                "logs:*",
                "events:*",
                "ecr:*",
                "ssm:GetParameter",
                "ssm:GetParameters",
                "sts:AssumeRole"
            ],
            "Resource": "*"
        }
    ]
}
EOF

# Stagingロール作成
if aws iam get-role --role-name "${STAGING_ROLE_NAME}" 2>/dev/null; then
    echo "⚠️  Stagingロールは既に存在します。削除して再作成しますか？ (y/N)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        aws iam delete-role --role-name "${STAGING_ROLE_NAME}" || true
    else
        echo "Stagingロールの作成をスキップします"
    fi
fi

if ! aws iam get-role --role-name "${STAGING_ROLE_NAME}" 2>/dev/null; then
    aws iam create-role \
        --role-name "${STAGING_ROLE_NAME}" \
        --assume-role-policy-document file:///tmp/staging-trust-policy.json \
        --description "GitHub Actions deployment role for staging environment"
    
    aws iam put-role-policy \
        --role-name "${STAGING_ROLE_NAME}" \
        --policy-name "DeploymentPolicy" \
        --policy-document file:///tmp/deploy-policy.json
    
    echo "✅ Stagingロールを作成しました"
fi

# Productionロール作成
if aws iam get-role --role-name "${PRODUCTION_ROLE_NAME}" 2>/dev/null; then
    echo "⚠️  Productionロールは既に存在します。削除して再作成しますか？ (y/N)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        aws iam delete-role --role-name "${PRODUCTION_ROLE_NAME}" || true
    else
        echo "Productionロールの作成をスキップします"
    fi
fi

if ! aws iam get-role --role-name "${PRODUCTION_ROLE_NAME}" 2>/dev/null; then
    aws iam create-role \
        --role-name "${PRODUCTION_ROLE_NAME}" \
        --assume-role-policy-document file:///tmp/production-trust-policy.json \
        --description "GitHub Actions deployment role for production environment"
    
    aws iam put-role-policy \
        --role-name "${PRODUCTION_ROLE_NAME}" \
        --policy-name "DeploymentPolicy" \
        --policy-document file:///tmp/deploy-policy.json
    
    echo "✅ Productionロールを作成しました"
fi

# クリーンアップ
rm -f /tmp/staging-trust-policy.json /tmp/production-trust-policy.json /tmp/deploy-policy.json

echo ""
echo "🎉 セットアップが完了しました！"
echo ""
echo "次の手順:"
echo "1. GitHubリポジトリの Settings > Secrets and variables > Actions で以下のシークレットを設定してください："
echo ""
echo "   STAGING_AWS_ROLE_ARN=arn:aws:iam::${AWS_ACCOUNT_ID}:role/${STAGING_ROLE_NAME}"
echo "   PRODUCTION_AWS_ROLE_ARN=arn:aws:iam::${AWS_ACCOUNT_ID}:role/${PRODUCTION_ROLE_NAME}"
echo ""
echo "2. (オプション) Slack通知用："
echo "   SLACK_WEBHOOK_URL=<your-slack-webhook-url>"
echo ""
echo "3. GitHubでEnvironmentsを設定："
echo "   - Settings > Environments"
echo "   - 'staging' 環境を作成"
echo "   - 'production' 環境を作成（保護ルール設定推奨）"
echo ""
echo "これでCI/CDパイプラインでAWSデプロイが可能になります！" 