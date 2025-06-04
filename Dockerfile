# ベースイメージ
FROM node:18-alpine as base

# 必要なシステムパッケージのインストール
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    chromium \
    && rm -rf /var/cache/apk/*

# 作業ディレクトリの設定
WORKDIR /app

# package.jsonとpackage-lock.jsonをコピー（依存関係キャッシュ用）
COPY package*.json ./

# === 依存関係インストールステージ ===
FROM base as dependencies

# 全ての依存関係をインストール
RUN npm ci

# === ビルドステージ ===
FROM dependencies as build

# ソースコードをコピー
COPY . .

# TypeScriptのビルド
RUN npm run build

# 不要なdevDependenciesを削除
RUN npm prune --production

# === テスト用ステージ ===
FROM dependencies as test

# ソースコードをコピー
COPY . .

# TypeScriptのビルド（テスト用）
RUN npm run build

# Playwrightの設定
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# テスト実行
CMD ["npm", "run", "test:coverage"]

# === 開発用ステージ ===
FROM dependencies as development

# ソースコードをコピー
COPY . .

# 開発用のポート公開
EXPOSE 3000 9229

# 開発用のデフォルトコマンド
CMD ["npm", "run", "dev"]

# === 本番用ステージ ===
FROM node:18-alpine as production

# 作業ディレクトリの設定
WORKDIR /app

# 本番用の最小限のパッケージのみインストール
RUN apk add --no-cache dumb-init

# 非rootユーザーの作成
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# ビルド成果物と本番用依存関係をコピー
COPY --from=build --chown=nextjs:nodejs /app/dist ./dist
COPY --from=build --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/package.json ./package.json

# 非rootユーザーに切り替え
USER nextjs

# ヘルスチェック追加
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node --version || exit 1

# 本番用のデフォルトコマンド
CMD ["dumb-init", "node", "dist/index.js"] 