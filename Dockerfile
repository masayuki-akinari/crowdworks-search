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
    chromium \
    && yum clean all

# AWS CLIのインストール
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
    ./aws/install && \
    rm -rf awscliv2.zip aws

# AWS CDKのインストール
RUN npm install -g aws-cdk@latest

# 作業ディレクトリの設定
WORKDIR /workspace

# package.jsonとpackage-lock.jsonをコピー
COPY package*.json ./

# 依存関係のインストール
RUN npm ci

# Playwrightの設定（Chromiumは既にインストール済み）
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# === 開発用ステージ ===
FROM base as development

# ソースコードをコピー
COPY . .

# TypeScriptのビルド
RUN npm run build

# 開発用のデフォルトコマンド
CMD ["npm", "run", "dev"]

# === テスト用ステージ ===
FROM base as test

# ソースコードをコピー
COPY . .

# TypeScriptのビルド
RUN npm run build

# テスト実行
CMD ["npm", "test"]

# === 本番用ステージ ===
FROM base as production

# 本番用の依存関係のみインストール
RUN npm ci --only=production

# ソースコードをコピー
COPY . .

# TypeScriptのビルド
RUN npm run build

# 本番用のデフォルトコマンド
CMD ["npm", "start"] 