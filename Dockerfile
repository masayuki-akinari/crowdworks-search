# Lambda環境に近いAmazon Linux 2ベース（Node.js 18）
FROM public.ecr.aws/lambda/nodejs:18 as base

# 開発ツールをインストール
USER root

# 必要なシステムパッケージのインストール
RUN yum update -y && \
    yum install -y \
    git \
    tar \
    gzip \
    unzip \
    which \
    procps \
    && yum clean all

# AWS CLI v2のインストール
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
    ./aws/install && \
    rm -rf awscliv2.zip aws

# AWS CDK CLIのグローバルインストール
RUN npm install -g aws-cdk@latest

# 作業ディレクトリの設定
WORKDIR /workspace

# package.jsonとpackage-lock.jsonをコピー（依存関係のキャッシュ効率化）
COPY package*.json ./

# 依存関係のインストール
RUN npm ci

# Playwrightブラウザのインストール（Lambda Layer用）
RUN npx playwright install --with-deps chromium

# === 開発用ステージ ===
FROM base as development

# 開発用の追加パッケージ
RUN npm install -g nodemon ts-node

# アプリケーションのソースコードをコピー
COPY . .

# TypeScriptのビルド
RUN npm run build

# 開発用ポートを公開（将来的なAPI Gateway Local用）
EXPOSE 3000

# 開発用のデフォルトコマンド
CMD ["npm", "run", "dev"]

# === 本番用ステージ ===
FROM base as production

# 本番用の最小限パッケージのみインストール
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ビルド済みアプリケーションをコピー
COPY --from=development /workspace/dist ./dist

# Lambda関数ハンドラーの設定
CMD ["dist/lambda/handler.lambdaHandler"] 