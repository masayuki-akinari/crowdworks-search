/**
 * AWS Lambda Handler for CrowdWorks Search System
 * EventBridge スケジュール実行用のメインハンドラー
 */

import type { Context } from 'aws-lambda';

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

  try {
    // TODO: メイン処理の実装
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
  }
};
