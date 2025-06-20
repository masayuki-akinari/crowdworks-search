# 要件定義書

## 1. プロジェクト概要

### 1.1 プロジェクト名
クラウドワークス案件自動検索・評価システム（CrowdWorks Auto Job Searcher）

### 1.2 目的・背景
クラウドワークス上で適切な案件を効率的に発見し、案件の品質やマッチング度を自動評価することで、フリーランサーの案件選定業務を自動化・効率化する。

**背景**
- 手動での案件チェックは時間がかかる
- 良い案件を見逃すリスクがある
- 案件の評価に主観が入りやすい
- 定期的なチェックが困難
- 個人利用でのコスト効率性を重視

### 1.3 スコープ
**対象範囲**
- クラウドワークス上の案件情報の自動取得
- AI（ChatGPT）による案件評価
- 検索条件の管理・保存
- 定期実行による継続監視
- AWSサーバレス環境での運用
- 直近1週間のデータ管理（案件のcloseが早いため）

**対象外**
- 他のクラウドソーシングサイト
- 案件への自動応募機能
- クライアントとのやり取り自動化
- オンプレミス環境での運用
- 長期間のデータ分析・トレンド分析

## 2. 機能要件

### 2.1 Must（必須機能）
- **検索条件管理機能**
  - 検索条件の保存・読み込み（S3 JSON形式）
  - 複数の検索条件セットの管理
- **自動取得機能**
  - 15分間隔での自動実行（EventBridge）
  - AWSサーバレス環境での安定動作
  - ブラウザ自動操作によるデータ取得（Playwright on Lambda）
- **AI評価機能（軽量版）**
  - ChatGPT APIを使用した案件評価（事前フィルタ後）
  - おすすめ度のスコアリング（1-10点）
  - 評価理由の文章生成
- **データ保存機能**
  - 取得した案件データの永続化（S3 JSON形式）
  - 評価結果の履歴保存（1週間）
  - 重複案件の検出・除外（過去24-48時間分）

### 2.2 Should（重要機能）
- **通知機能**
  - 高評価案件の即座通知（SNS/SES）
  - 実行エラー時の通知
- **フィルタリング機能**
  - 予算範囲での絞り込み
  - スキルセットマッチング
  - 納期条件でのフィルタ
- **ログ・監視機能**
  - 実行ログの記録（S3 JSON形式）
  - エラー発生時の通知
  - 日次サマリー生成

### 2.3 Could（あれば良い機能）
- **簡易レポート機能**
  - 週次の案件動向サマリー
  - 高評価案件の傾向分析
- **Webダッシュボード**
  - S3データを読み込む静的サイト（Vercel等）
  - 設定変更用の簡易UI

## 3. 非機能要件

### 3.1 パフォーマンス要件
- 15分間隔での実行を確実に実行
- Lambda関数のタイムアウト: 最大10分
- 1回の実行で最大50件の案件を処理
- 実行時間1分以内を目標（コスト削減のため）
- AI評価は高ポテンシャル案件のみ（コスト削減）

### 3.2 可用性要件
- AWSサーバレス環境での24時間365日稼働
- システム障害時の自動復旧機能
- ネットワーク障害時のリトライ機能（最大3回）
- 稼働率: 95%以上（個人利用レベル）

### 3.3 セキュリティ要件
- AWS Systems Manager Parameter Store でのシークレット管理
- IAMロールによる最小権限アクセス制御
- S3バケットのプライベート設定
- 取得データの保護（S3暗号化）
- ログの機密情報マスキング

### 3.4 運用・保守性要件
- S3での構造化ログ管理
- AWS CDK での Infrastructure as Code
- Lambda関数のバージョン管理
- エラー時のSNS通知
- 7日間の自動データ削除（S3 Lifecycle Policy）

### 3.5 コスト要件
- **月額運用コスト: $5以下を厳守**
- Lambda実行時間の最適化（1分以内）
- S3使用量の最小化
- CloudWatch使用の完全廃止
- ChatGPT API使用量の制限（事前フィルタリング）

## 4. 制約事項

### 4.1 技術的制約
- AWS サーバレス環境での開発・運用
- TypeScript での型安全性確保（any型の使用禁止）
- Lambda関数の実行時間制限（最大10分）
- Playwrightブラウザのメモリ制限
- S3での構造化データ管理（NoSQL機能なし）
- クラウドワークスの利用規約遵守

### 4.2 運用制約
- ChatGPT API の利用料金制限（月$3以下）
- AWS サービス利用料金制限（月$2以下）
- クラウドワークスへのアクセス頻度制限
- 1日あたりの最大実行回数: 96回（15分×4×24時間）
- Lambda同時実行数制限
- データ保持期間: 最大7日間

### 4.3 その他制約
- 個人利用目的に限定
- 商用利用は別途検討が必要
- スクレイピング対象サイトの仕様変更リスク
- AWSアカウントの利用可能リージョン制限
- リアルタイム分析機能なし

## 5. 前提条件
- AWSアカウントが作成済み
- 適切なIAM権限が設定済み
- ChatGPT API キーが取得済み
- クラウドワークスアカウントが作成済み
- インターネット接続が安定している
- AWS CLI/CDK の実行環境
- 案件は1週間程度でcloseするため短期データ管理で十分

## 6. 用語定義
| 用語 | 定義 |
|------|------|
| 案件 | クラウドワークス上で公開されている仕事の依頼 |
| 検索条件 | 案件を絞り込むためのフィルター設定 |
| 評価スコア | AI が算出する案件のおすすめ度（1-10点） |
| 実行履歴 | システムが自動実行した記録 |
| スクレイピング | ブラウザ自動操作によるデータ取得 |
| サーバレス | AWS Lambda等のサーバー管理不要なコンピューティングサービス |
| EventBridge | AWSのイベント駆動型サービス（旧CloudWatch Events） |
| 事前フィルタ | AI評価前の予算・キーワード等による絞り込み |
| TTL | Time To Live、S3での自動削除設定 | 