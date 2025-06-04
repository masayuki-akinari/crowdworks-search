/**
 * AWS Lambda Handler for CrowdWorks Search System
 * EventBridge スケジュール実行用のメインハンドラー
 */

import type { Context } from 'aws-lambda';
import { APIGatewayProxyHandler } from 'aws-lambda';
import { chromium } from 'playwright-core';
import chromium_binary from '@sparticuz/chromium';

import { ScheduledExecutionEvent, ScheduledExecutionResponse } from '@/types';

/**
 * Lambda関数のメインハンドラー
 * EventBridgeからのスケジュール実行を処理
 */
export const lambdaHandler = async (
  event: ScheduledExecutionEvent,
  context: Context
): Promise<ScheduledExecutionResponse> => {
  const executionId = Date.now().toString();
  const startTime = Date.now();

  console.log('🔄 Lambda execution started', {
    executionId,
    functionName: context.functionName,
    remainingTimeInMillis: context.getRemainingTimeInMillis(),
    eventSource: event.source,
  });

  let browser;

  try {
    // Lambda環境用のChromium起動設定
    browser = await chromium.launch({
      args: [
        ...chromium_binary.args,
        '--disable-gpu',
        '--no-sandbox',
        '--single-process',
        '--disable-dev-shm-usage',
        '--no-zygote',
        '--disable-setuid-sandbox'
      ],
      headless: true,
      executablePath: await chromium_binary.executablePath()
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    const page = await context.newPage();

    // TODO: CrowdWorksスクレイピングロジック実装
    // await page.goto('https://crowdworks.jp/public/jobs');
    // const jobData = await page.evaluate(() => {
    //   // スクレイピング処理
    // });

    console.log('✅ Playwright動作確認成功');

    const response: ScheduledExecutionResponse = {
      status: 'success',
      executionId,
      timestamp: new Date().toISOString(),
      results: {
        jobsScraped: 0,
        newJobs: 0,
        aiEvaluated: 0,
        highScoreJobs: 0,
        duration: Date.now() - startTime,
        costEstimate: 0,
      },
    };

    console.log('✅ Lambda execution completed', response);
    return response;
  } catch (error) {
    console.error('❌ エラー:', error);
    const errorResponse: ScheduledExecutionResponse = {
      status: 'error',
      executionId,
      timestamp: new Date().toISOString(),
      results: {
        jobsScraped: 0,
        newJobs: 0,
        aiEvaluated: 0,
        highScoreJobs: 0,
        duration: Date.now() - startTime,
        costEstimate: 0,
      },
      error: {
        type: error instanceof Error ? error.constructor.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      },
    };

    console.error('❌ Lambda execution failed', errorResponse);
    return errorResponse;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

export const handler: APIGatewayProxyHandler = async (event) => {
  let browser;

  try {
    // Lambda環境用のChromium起動設定
    browser = await chromium.launch({
      args: [
        ...chromium_binary.args,
        '--disable-gpu',
        '--no-sandbox',
        '--single-process',
        '--disable-dev-shm-usage',
        '--no-zygote',
        '--disable-setuid-sandbox'
      ],
      headless: true,
      executablePath: await chromium_binary.executablePath()
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    const page = await context.newPage();

    // TODO: CrowdWorksスクレイピングロジック実装
    // await page.goto('https://crowdworks.jp/public/jobs');
    // const jobData = await page.evaluate(() => {
    //   // スクレイピング処理
    // });

    console.log('✅ Playwright動作確認成功');

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'スクレイピング準備完了',
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error('❌ エラー:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
