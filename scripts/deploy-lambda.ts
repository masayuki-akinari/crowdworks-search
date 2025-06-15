#!/usr/bin/env node

/**
 * AWS Lambda関数デプロイスクリプト
 * CrowdWorks & Lancers統合スクレイピングシステム
 */

import { LambdaClient, CreateFunctionCommand, UpdateFunctionCodeCommand, GetFunctionCommand } from '@aws-sdk/client-lambda';
import * as fs from 'fs';
import * as path from 'path';

// Lambda設定の読み込み
const configPath = path.join(__dirname, '../lambda-config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Lambda クライアントの初期化
const lambda = new LambdaClient({ region: 'ap-northeast-1' });

/**
 * Lambda関数の存在確認
 */
async function checkFunctionExists(functionName: string): Promise<boolean> {
  try {
    await lambda.send(new GetFunctionCommand({ FunctionName: functionName }));
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Lambda関数の作成
 */
async function createFunction(config: any, zipBuffer: Buffer): Promise<void> {
  const params = {
    ...config,
    Code: {
      ZipFile: zipBuffer
    }
  };

  try {
    const result = await lambda.send(new CreateFunctionCommand(params));
    console.log('✅ Lambda関数を作成しました:', result.FunctionArn);
  } catch (error) {
    console.error('❌ Lambda関数の作成に失敗しました:', error);
    throw error;
  }
}

/**
 * Lambda関数の更新
 */
async function updateFunction(functionName: string, zipBuffer: Buffer): Promise<void> {
  const params = {
    FunctionName: functionName,
    ZipFile: zipBuffer
  };

  try {
    const result = await lambda.send(new UpdateFunctionCodeCommand(params));
    console.log('✅ Lambda関数を更新しました:', result.FunctionArn);
  } catch (error) {
    console.error('❌ Lambda関数の更新に失敗しました:', error);
    throw error;
  }
}

/**
 * メイン実行関数
 */
async function main(): Promise<void> {
  try {
    console.log('🚀 Lambda デプロイプロセス開始');
    
    // ZIPファイルの読み込み
    const zipPath = path.join(__dirname, '../lambda-function.zip');
    
    if (!fs.existsSync(zipPath)) {
      console.error('❌ lambda-function.zip が見つかりません');
      console.log('💡 まず `npm run lambda:build` を実行してください');
      process.exit(1);
    }
    
    const zipBuffer = fs.readFileSync(zipPath);
    console.log(`📦 ZIPファイル読み込み完了: ${(zipBuffer.length / 1024 / 1024).toFixed(2)}MB`);
    
    // 関数の存在確認
    const functionExists = await checkFunctionExists(config.FunctionName);
    
    if (functionExists) {
      console.log('🔄 既存の関数を更新します...');
      await updateFunction(config.FunctionName, zipBuffer);
    } else {
      console.log('🆕 新しい関数を作成します...');
      await createFunction(config, zipBuffer);
    }
    
    console.log('🎉 デプロイが完了しました！');
    console.log('');
    console.log('📋 Lambda関数情報:');
    console.log(`   関数名: ${config.FunctionName}`);
    console.log(`   ハンドラー: ${config.Handler}`);
    console.log(`   ランタイム: ${config.Runtime}`);
    console.log(`   メモリ: ${config.MemorySize}MB`);
    console.log(`   タイムアウト: ${config.Timeout}秒`);
    console.log('');
    console.log('🔥 テスト実行コマンド:');
    console.log('   aws lambda invoke --function-name crowdworks-scraper --payload \'{"action":"full-pipeline","minHourlyRate":2000,"count":10}\' response.json');
    
  } catch (error) {
    console.error('❌ デプロイプロセスでエラーが発生しました:', error);
    process.exit(1);
  }
}

// CLI実行時の処理
if (require.main === module) {
  main().catch(error => {
    console.error('❌ デプロイエラー:', error);
    process.exit(1);
  });
}

export { main as deployLambda }; 