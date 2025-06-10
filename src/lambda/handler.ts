/**
 * AWS Lambda Handler for CrowdWorks Search System
 * スクレイピング + AI分析の統合システム
 */

// ローカル開発時の環境変数読み込み
if (!process.env['AWS_LAMBDA_FUNCTION_NAME']) {
  try {
    require('dotenv').config();
    console.log('🏠 ローカル環境: .envファイルを読み込みました');
  } catch (error) {
    console.log('⚠️ dotenvが見つかりません（Lambda環境では正常）');
  }
}

import { Context } from 'aws-lambda';
import { chromium, Browser, Page } from 'playwright';
import { LancersService, LancersJob, LancersJobDetail, LancersScrapingResult } from '../services/LancersService';

// Lambda Event Types
interface ScheduledExecutionEvent {
  source: string;
  'detail-type': string;
  detail: Record<string, any>;
  time?: string;
}

interface ScheduledExecutionResponse {
  statusCode: number;
  body: string;
  executionTime: number;
  timestamp: string;
}

// CrowdWorks案件データ型
interface CrowdWorksJob {
  id: string;
  title: string;
  description: string;
  url: string;
  budget: {
    type: 'fixed' | 'hourly' | 'unknown';
    amount: number;
    currency: string;
  };
  category: string;
  tags: string[];
  client: {
    name: string;
    rating: number;
    reviewCount: number;
  };
  postedAt: string;
  deadline?: string;
  applicants: number;
  scrapedAt: string;
}

// スクレイピング結果型
interface ScrapingResult {
  success: boolean;
  jobsFound: number;
  jobs: CrowdWorksJob[];
  error?: string;
  executionTime: number;
}

// 案件詳細情報の型定義
interface CrowdWorksJobDetail {
  jobId: string;
  title: string;
  category: string;
  url: string;
  paymentType: string;
  budget: string;
  deliveryDate: string;
  postDate: string;
  applicationDeadline: string;
  desiredImages: string[];
  applicantCount: number;
  contractCount: number;
  recruitmentCount: number;
  favoriteCount: number;
  detailedDescription: string;
  client: {
    name: string;
    url: string;
    overallRating: string;
    orderHistory: string;
    completionRate: string;
    thankCount: string;
    identityVerified: boolean;
    orderRuleCheck: boolean;
    description: string;
  };
  recentApplicants: Array<{
    name: string;
    url: string;
    applicationDate: string;
  }>;
  scrapedAt: string;
}

// ファイル読み込み用ユーティリティ
async function readFileAsync(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const fs = require('fs');
    fs.readFile(filePath, 'utf8', (err: any, data: string) => {
      if (err) resolve(null);
      else resolve(data);
    });
  });
}

/**
 * カテゴリ別CrowdWorks案件スクレイピング（メイン機能）
 */
async function scrapeCrowdWorksJobsByCategory(
  page: Page,
  category: string,
  maxJobs: number = 20
): Promise<ScrapingResult> {
  const startTime = Date.now();

  try {
    const categoryUrls: { [key: string]: string } = {
      'ec': 'https://crowdworks.jp/public/jobs/group/ec',
      'web_products': 'https://crowdworks.jp/public/jobs/group/web_products',
      'software_development': 'https://crowdworks.jp/public/jobs/group/software_development',
      'development': 'https://crowdworks.jp/public/jobs/group/development',
      'writing': 'https://crowdworks.jp/public/jobs/category/141',
      'translation': 'https://crowdworks.jp/public/jobs/category/406',
      'marketing': 'https://crowdworks.jp/public/jobs/category/539',
      'system_development': 'https://crowdworks.jp/public/jobs/group/development',
      'app_development': 'https://crowdworks.jp/public/jobs/group/software_development'
    };

    const baseUrl = categoryUrls[category];
    if (!baseUrl) {
      throw new Error(`未知のカテゴリ: ${category}`);
    }

    console.log(`📂 カテゴリ「${category}」のスクレイピング開始 (最大${maxJobs}件)`);

    const jobs: CrowdWorksJob[] = [];
    let currentPage = 1;
    let consecutiveEmptyPages = 0;
    const maxConsecutiveEmptyPages = 3;
    const maxPages = Math.ceil(maxJobs / 20) + 2; // 1ページ約20件として計算し、余裕をもたせる

    while (jobs.length < maxJobs && currentPage <= maxPages && consecutiveEmptyPages < maxConsecutiveEmptyPages) {
      const pageUrl = currentPage === 1 ? baseUrl : `${baseUrl}?page=${currentPage}`;
      console.log(`📄 ページ ${currentPage} を処理中: ${pageUrl}`);

      try {
        await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000); // ページロード後の待機

        // 案件リストの取得
        const pageJobs = await page.evaluate(() => {
          // 実際のDOM構造に合わせたセレクタ
          const jobListContainer = document.querySelector('main list, [role="list"], ul:has(li h3)');
          if (!jobListContainer) {
            console.log('案件リスト容器が見つかりません');
            return [];
          }

          const jobElements = jobListContainer.querySelectorAll('listitem, [role="listitem"], li:has(h3)');
          console.log(`取得した案件要素数: ${jobElements.length}`);
          
          const pageJobs: any[] = [];

          jobElements.forEach((element: Element, index: number) => {
            try {
              // タイトルの取得
              let titleElement = element.querySelector('h3 a, [level="3"] a, heading a');
              let titleText = '';
              let jobUrl = '';
              
              if (titleElement) {
                titleText = titleElement.textContent?.trim() || '';
                jobUrl = (titleElement as HTMLAnchorElement).href || '';
              }

              // カテゴリーの取得（案件内のカテゴリーリンクから）
              let categoryElement = element.querySelector('a[href*="/category/"]');
              let categoryText = categoryElement?.textContent?.trim() || '';

              // 説明文の取得
              let descriptionElement = element.querySelector('paragraph, p');
              let descriptionText = descriptionElement?.textContent?.trim() || '';

              // 報酬情報の取得
              let priceText = '';
              const priceElements = element.querySelectorAll('generic');
              for (const generic of Array.from(priceElements)) {
                const text = generic.textContent?.trim() || '';
                if (text.includes('円') && (text.includes('〜') || text.includes('固定') || text.includes('時間'))) {
                  priceText = text;
                  break;
                }
              }

              // 契約数・応募期限の取得
              let contractsText = '';
              let deadlineText = '';
              for (const generic of Array.from(priceElements)) {
                const text = generic.textContent?.trim() || '';
                if (text.includes('契約数')) {
                  contractsText = text;
                } else if (text.includes('あと') && (text.includes('日') || text.includes('時間'))) {
                  deadlineText = text;
                }
              }

              // クライアント名の取得
              let clientElement = element.querySelector('a[href*="/employers/"]');
              let clientName = clientElement?.textContent?.trim() || '';

              // URLが相対パスの場合は絶対パスに変換
              if (jobUrl && jobUrl.startsWith('/')) {
                jobUrl = 'https://crowdworks.jp' + jobUrl;
              }

              // 必要な情報が取得できた場合のみ追加
              if (titleText && jobUrl) {
                console.log(`案件${index + 1}: ${titleText}`);
                pageJobs.push({
                  title: titleText,
                  url: jobUrl,
                  description: descriptionText.substring(0, 200), // 200文字で切り詰め
                  price: priceText,
                  client: clientName,
                  category: categoryText,
                  contracts: contractsText,
                  deadline: deadlineText,
                  scraped_at: new Date().toISOString()
                });
              } else {
                console.log(`案件${index + 1}: 必要な情報が不足 - title: ${titleText}, url: ${jobUrl}`);
              }
            } catch (error) {
              console.log(`案件${index + 1}の処理でエラー:`, error);
            }
          });

          console.log(`ページから取得された案件数: ${pageJobs.length}`);
          return pageJobs;
        });

        if (pageJobs.length === 0) {
          consecutiveEmptyPages++;
          console.log(`⚠️ ページ ${currentPage}: 案件が見つかりません (連続${consecutiveEmptyPages}回目)`);
        } else {
          consecutiveEmptyPages = 0;
          jobs.push(...pageJobs);
          console.log(`✅ ページ ${currentPage}: ${pageJobs.length}件取得 (累計: ${jobs.length}件)`);
        }

      } catch (error) {
        console.log(`❌ ページ ${currentPage} 処理エラー:`, error instanceof Error ? error.message : String(error));
        consecutiveEmptyPages++;
      }

      currentPage++;
    }

    // 最大件数に制限
    const limitedJobs = jobs.slice(0, maxJobs);
    const executionTime = Date.now() - startTime;

    console.log(`✅ カテゴリ「${category}」完了: ${limitedJobs.length}件取得 (${executionTime}ms)`);

    return {
      success: true,
      jobsFound: limitedJobs.length,
      jobs: limitedJobs,
      executionTime
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ カテゴリ「${category}」スクレイピングエラー:`, errorMessage);

    return {
      success: false,
      jobsFound: 0,
      jobs: [],
      error: errorMessage,
      executionTime
    };
  }
}

/**
 * 案件詳細スクレイピング
 */
export async function scrapeCrowdWorksJobDetail(page: Page, jobUrl: string): Promise<CrowdWorksJobDetail> {
  console.log(`🔍 詳細取得: ${jobUrl}`);

  try {
    await page.goto(jobUrl, { waitUntil: 'networkidle', timeout: 30000 });

    const detail = await page.evaluate(() => {
      const getNumbers = (text: string): number => {
        const match = text.match(/(\d+)/);
        return match?.[1] ? parseInt(match[1]) : 0;
      };

      // タイトルの取得（実際のDOM構造に基づく）
      const title = (() => {
        // メインのh1要素から抽出
        const h1 = document.querySelector('heading[level="1"]');
        if (h1) {
          const fullText = h1.textContent?.trim() || '';
          // "★★スーツケースベルトの推薦をしてくださる方を募集します★★ 商品紹介文作成の仕事の依頼"から案件名を抽出
          const jobMatch = fullText.split('の仕事の依頼')[0];
          if (jobMatch) {
            // さらに最後のカテゴリ名を除去
            const titleParts = jobMatch.split(' ');
            if (titleParts.length > 1) {
              // 最後の要素がカテゴリ名の場合は除去
              const lastPart = titleParts[titleParts.length - 1];
              if (lastPart && (lastPart.includes('作成') || lastPart.includes('開発') || lastPart.includes('運営'))) {
                titleParts.pop();
              }
            }
            return titleParts.join(' ').trim();
          }
        }
        return '';
      })();

      // テーブルから基本情報を取得（role="table"で検索）
      const tables = document.querySelectorAll('table, [role="table"]');
      let paymentType = '';
      let budget = '';
      let deliveryDate = '';
      let postDate = '';
      let applicationDeadline = '';
      let applicantCount = 0;
      let contractCount = 0;
      let recruitmentCount = 0;
      let favoriteCount = 0;
      
      // 仕事の概要テーブル（1番目）から取得
      if (tables.length > 0) {
        const conceptTable = tables[0];
        if (conceptTable) {
          // rowで検索してセル情報を取得
          const rows = conceptTable.querySelectorAll('row, tr, [role="row"]');
          rows.forEach(row => {
            const cells = row.querySelectorAll('cell, td, [role="cell"]');
            if (cells.length >= 2) {
              const label = cells[0]?.textContent?.trim() || '';
              const value = cells[1]?.textContent?.trim() || '';
              
              if (label.includes('固定報酬制') || label.includes('時間単価')) {
                paymentType = label;
                budget = value;
              } else if (label.includes('納品希望日')) {
                deliveryDate = value;
              } else if (label.includes('掲載日')) {
                postDate = value;
              } else if (label.includes('応募期限')) {
                applicationDeadline = value;
              }
            }
          });
        }
      }

      // 応募状況テーブル（2番目）から取得
      if (tables.length > 1) {
        const statusTable = tables[1];
        if (statusTable) {
          const rows = statusTable.querySelectorAll('row, tr, [role="row"]');
          rows.forEach(row => {
            const cells = row.querySelectorAll('cell, td, [role="cell"]');
            if (cells.length >= 2) {
              const label = cells[0]?.textContent?.trim() || '';
              const value = cells[1]?.textContent?.trim() || '';
              
              if (label.includes('応募した人')) {
                applicantCount = getNumbers(value);
              } else if (label.includes('契約した人')) {
                contractCount = getNumbers(value);
              } else if (label.includes('募集人数')) {
                recruitmentCount = getNumbers(value);
              } else if (label.includes('気になる')) {
                favoriteCount = getNumbers(value);
              }
            }
          });
        }
      }

      // 詳細説明の取得（仕事の詳細テーブルから）
      let detailedDescription = '';
      if (tables.length > 2) {
        const detailTable = tables[2];
        if (detailTable) {
          const rows = detailTable.querySelectorAll('row, tr, [role="row"]');
          if (rows.length > 0) {
            const firstRow = rows[0];
            if (firstRow) {
              const cell = firstRow.querySelector('cell, td, [role="cell"]');
              if (cell) {
                detailedDescription = cell.textContent?.trim() || '';
              }
            }
          }
        }
      }

      // クライアント情報の取得（正確なセレクタで）
      let clientName = '';
      let clientUrl = '';
      let overallRating = '';
      let orderHistory = '';
      let completionRate = '';
      let thankCount = '';
      let identityVerified = false;
      let orderRuleCheck = false;
      let clientDescription = '';

      // クライアント名とURLの取得
      const clientLink = document.querySelector('link[href*="employers"]:not([href*="user_occupations"])');
      if (clientLink) {
        clientName = clientLink.textContent?.trim() || '';
        const href = (clientLink as any).getAttribute('href');
        if (href) {
          clientUrl = href.startsWith('http') ? href : `https://crowdworks.jp${href}`;
        }
      }

      // 評価・実績情報（definition要素から）
      const definitions = document.querySelectorAll('definition, [role="definition"]');
      definitions.forEach((def) => {
        const text = def.textContent?.trim() || '';
        if (text.match(/^\d+(\.\d+)?$/)) { // 数値のみ（評価）
          overallRating = text;
        } else if (text.includes('件') && text.match(/^\d+/)) { // ○○件（募集実績）
          orderHistory = text;
        } else if (text.includes('%')) { // ○○%（完了率）
          completionRate = text;
        }
      });

      // ありがとう件数
      const thankElements = document.querySelectorAll('text');
      thankElements.forEach(textEl => {
        const text = textEl.textContent?.trim() || '';
        if (text.includes('ありがとう') && text.includes('件')) {
          thankCount = text;
        } else if (text.includes('本人確認')) {
          identityVerified = !text.includes('未提出');
        } else if (text.includes('発注ルール')) {
          orderRuleCheck = text.includes('済み');
        }
      });

      // クライアント説明（事業内容）
      const businessElements = document.querySelectorAll('generic');
      businessElements.forEach(el => {
        const text = el.textContent?.trim() || '';
        if (text && text.includes('事業') && text.length > 5 && text.length < 50) {
          clientDescription = text;
        }
      });

      return {
        title,
        paymentType,
        budget,
        deliveryDate,
        postDate,
        applicationDeadline,
        applicantCount,
        contractCount,
        recruitmentCount,
        favoriteCount,
        detailedDescription,
        client: {
          name: clientName,
          url: clientUrl,
          overallRating,
          orderHistory,
          completionRate,
          thankCount,
          identityVerified,
          orderRuleCheck,
          description: clientDescription
        },
        recentApplicants: []
      };
    });

    // URLからjobIdを抽出
    const jobId = jobUrl.match(/\/jobs\/(\d+)/)?.[1] || '';

    return {
      jobId,
      category: '',
      url: jobUrl,
      desiredImages: [],
      scrapedAt: new Date().toISOString(),
      ...detail
    };

  } catch (error) {
    console.error(`❌ 詳細取得エラー (${jobUrl}):`, error);
    throw error;
  }
}

/**
 * カテゴリ別案件取得（詳細付き）- メイン機能
 */
export async function scrapeCrowdWorksJobsByCategoryWithDetails(params: {
  category: string;
  maxJobs: number;
  maxDetails?: number;
}): Promise<{
  jobs: CrowdWorksJob[];
  jobDetails: CrowdWorksJobDetail[];
}> {
  const startTime = Date.now();
  let browser: Browser | null = null;

  try {
    console.log(`🚀 カテゴリ「${params.category}」詳細取得開始`);

    // ブラウザ起動
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    const page = await context.newPage();

    // 既存詳細の読み込み
    let existingDetails: CrowdWorksJobDetail[] = [];
    const detailsFile = `output/details-${params.category}.json`;

    try {
      const existingData = await readFileAsync(detailsFile);
      if (existingData) {
        existingDetails = JSON.parse(existingData);
        console.log(`📂 既存詳細データ: ${existingDetails.length}件`);
      }
    } catch (e) {
      console.log('📝 詳細データファイルなし（新規作成）');
    }

    // 案件一覧の取得
    const scrapingResult = await scrapeCrowdWorksJobsByCategory(page, params.category, params.maxJobs);

    if (!scrapingResult.success) {
      throw new Error(scrapingResult.error || 'スクレイピング失敗');
    }

    const jobs = scrapingResult.jobs;
    const maxDetails = params.maxDetails ?? params.maxJobs;

    // 詳細取得（重複チェック付き）
    const existingJobIds = new Set(existingDetails.map(d => d.jobId));
    const newJobs = jobs.filter(job => !existingJobIds.has(job.id));
    const jobsToDetail = newJobs.slice(0, maxDetails);

    console.log(`📊 詳細取得対象: ${jobsToDetail.length}件 (既存除外: ${jobs.length - newJobs.length}件)`);

    const newDetails: CrowdWorksJobDetail[] = [];
    for (let i = 0; i < jobsToDetail.length; i++) {
      const job = jobsToDetail[i];
      if (!job) continue; // null/undefined チェック

      try {
        const detail = await scrapeCrowdWorksJobDetail(page, job.url);
        detail.category = params.category;
        newDetails.push(detail);
        console.log(`✅ [${i + 1}/${jobsToDetail.length}] ${job.title.substring(0, 50)}...`);

        // API制限対応
        await page.waitForTimeout(1000);
      } catch (error) {
        console.error(`❌ 詳細取得失敗: ${job.title}`);
      }
    }

    // 全詳細をマージして保存
    const allDetails = [...existingDetails, ...newDetails];
    const fs = require('fs');
    fs.writeFileSync(detailsFile, JSON.stringify(allDetails, null, 2), 'utf8');
    console.log(`💾 詳細保存完了: ${detailsFile} (${allDetails.length}件)`);

    const executionTime = Date.now() - startTime;
    console.log(`🎯 カテゴリ「${params.category}」完了: ${jobs.length}件一覧, ${newDetails.length}件新規詳細 (${Math.round(executionTime / 1000)}秒)`);

    return {
      jobs,
      jobDetails: allDetails
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ カテゴリ「${params.category}」エラー:`, errorMessage);
    return { jobs: [], jobDetails: [] };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Lambda関数エントリーポイント
 */
export const lambdaHandler = async (
  event: ScheduledExecutionEvent,
  _context: Context
): Promise<ScheduledExecutionResponse> => {
  const startTime = Date.now();

  try {
    console.log('⚡ Lambda実行開始:', JSON.stringify(event, null, 2));

    const result = await executeFullAnalysisWorkflow({
      maxJobsPerCategory: 20,
      maxDetailsPerCategory: 20
    });

    const executionTime = Date.now() - startTime;

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: result.success,
        summary: result.summary,
        reportFile: result.reportFile,
        executionTime
      }),
      executionTime,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error('❌ Lambda実行エラー:', errorMessage);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: errorMessage,
        executionTime
      }),
      executionTime,
      timestamp: new Date().toISOString()
    };
  }
};

/**
 * 全カテゴリスクレイピング→AI分析→レポート生成を統合実行
 */
export async function executeFullAnalysisWorkflow(params?: {
  maxJobsPerCategory?: number;
  maxDetailsPerCategory?: number;
}): Promise<{
  success: boolean;
  summary: {
    totalCategories: number;
    successfulCategories: number;
    totalJobs: number;
    totalDetails: number;
    analysisResults?: { [key: string]: number };
    reportGenerated: boolean;
  };
  reportFile?: string;
  error?: string;
  executionTime: number;
}> {
  const startTime = Date.now();
  const maxJobs = params?.maxJobsPerCategory ?? 50;
  const maxDetails = params?.maxDetailsPerCategory ?? 50;

  try {
    console.log('🚀 統合分析ワークフロー開始...');
    console.log(`📊 設定: 各カテゴリ ${maxJobs}件取得, 詳細 ${maxDetails}件`);

    // ステップ1: 全カテゴリスクレイピング
    console.log('\n📂 ステップ1: 全カテゴリスクレイピング実行中...');
    const categories = ['ec', 'web_products', 'software_development', 'development'];
    let totalJobs = 0;
    let totalDetails = 0;
    let successfulCategories = 0;

    for (const category of categories) {
      try {
        console.log(`\n📈 ${category} カテゴリ処理中...`);
        const result = await scrapeCrowdWorksJobsByCategoryWithDetails({
          category,
          maxJobs,
          maxDetails
        });

        if (result.jobs.length > 0) {
          console.log(`✅ ${category}: ${result.jobs.length}件一覧, ${result.jobDetails.length}件詳細`);
          totalJobs += result.jobs.length;
          totalDetails += result.jobDetails.length;
          successfulCategories++;
        }

        // カテゴリ間で待機
        if (categories.indexOf(category) < categories.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (e) {
        console.log(`❌ ${category}: エラー -`, e instanceof Error ? e.message : String(e));
      }
    }

    console.log(`\n📊 スクレイピング完了: ${successfulCategories}/${categories.length}カテゴリ成功`);

    // ステップ2: AI分析実行
    console.log('\n🧠 ステップ2: AI分析実行中...');
    const analysisResults: { [key: string]: number } = {};

    for (const category of categories) {
      try {
        const detailsFile = `output/details-${category}.json`;
        const fs = require('fs');

        if (!fs.existsSync(detailsFile)) {
          console.log(`⚠️ ${category}: 詳細ファイルが見つかりません`);
          continue;
        }

        await new Promise<void>((resolve, reject) => {
          const { exec } = require('child_process');
          const analysisCmd = `npx ts-node scripts/analyze-details.ts ${detailsFile} output/analyzed-${category}.json`;
          exec(analysisCmd, (error: any) => {
            if (error) {
              console.log(`❌ ${category} AI分析エラー:`, error.message);
              reject(error);
            } else {
              console.log(`✅ ${category} AI分析完了`);
              try {
                const analyzedData = JSON.parse(fs.readFileSync(`output/analyzed-${category}.json`, 'utf8'));
                analysisResults[category] = analyzedData.length;
                console.log(`📊 ${category}: ${analyzedData.length}件分析完了`);
              } catch (parseError) {
                console.log(`⚠️ ${category}: 分析結果ファイルの読み込みエラー`);
              }
              resolve();
            }
          });
        });

        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (e) {
        console.log(`❌ ${category} AI分析失敗:`, e instanceof Error ? e.message : String(e));
      }
    }

    // ステップ3: おすすめ度計算
    console.log('\n⭐ ステップ3: おすすめ度計算実行中...');
    try {
      await new Promise<void>((resolve, reject) => {
        const { exec } = require('child_process');
        const recommendCmd = 'npx ts-node scripts/calculate-recommendation-score.ts';
        exec(recommendCmd, (error: any) => {
          if (error) {
            console.log('❌ おすすめ度計算エラー:', error.message);
            reject(error);
          } else {
            console.log('✅ おすすめ度計算完了');
            resolve();
          }
        });
      });
    } catch (e) {
      console.log('❌ おすすめ度計算失敗:', e instanceof Error ? e.message : String(e));
    }

    // ステップ4: 高時給案件抽出
    console.log('\n💰 ステップ4: 高時給案件抽出中...');
    try {
      await new Promise<void>((resolve, reject) => {
        const { exec } = require('child_process');
        const extractCmd = 'npx ts-node scripts/extract-high-hourly-jobs.ts';
        exec(extractCmd, (error: any) => {
          if (error) {
            console.log('❌ 高時給案件抽出エラー:', error.message);
            reject(error);
          } else {
            console.log('✅ 高時給案件抽出完了');
            resolve();
          }
        });
      });
    } catch (e) {
      console.log('❌ 高時給案件抽出失敗:', e instanceof Error ? e.message : String(e));
    }

    // ステップ5: 統合レポート生成
    console.log('\n📋 ステップ5: 統合レポート生成中...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFile = `output/crowdworks-analysis-report-${timestamp}.md`;

    try {
      const reportContent = await generateComprehensiveReport({
        totalCategories: categories.length,
        successfulCategories,
        totalJobs,
        totalDetails,
        analysisResults,
        timestamp: new Date().toISOString()
      });

      const fs = require('fs');
      fs.writeFileSync(reportFile, reportContent, 'utf8');
      console.log(`✅ 統合レポート生成完了: ${reportFile}`);

    } catch (e) {
      console.log('❌ レポート生成失敗:', e instanceof Error ? e.message : String(e));
    }

    const executionTime = Date.now() - startTime;

    console.log('\n🎉 統合分析ワークフロー完了！');
    console.log(`⏱️ 総実行時間: ${Math.round(executionTime / 1000)}秒`);

    return {
      success: true,
      summary: {
        totalCategories: categories.length,
        successfulCategories,
        totalJobs,
        totalDetails,
        analysisResults,
        reportGenerated: true
      },
      reportFile,
      executionTime
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ 統合分析ワークフローエラー:', errorMessage);

    return {
      success: false,
      summary: {
        totalCategories: 0,
        successfulCategories: 0,
        totalJobs: 0,
        totalDetails: 0,
        reportGenerated: false
      },
      error: errorMessage,
      executionTime
    };
  }
}

/**
 * 統合レポート生成
 */
async function generateComprehensiveReport(data: {
  totalCategories: number;
  successfulCategories: number;
  totalJobs: number;
  totalDetails: number;
  analysisResults?: { [key: string]: number };
  timestamp: string;
}): Promise<string> {
  const date = new Date().toLocaleDateString('ja-JP');

  let report = `# CrowdWorks案件分析レポート

> 生成日: ${date}  
> 実行時刻: ${data.timestamp}  
> 対象: 全カテゴリ自動分析  

## 📊 実行サマリー

| 項目 | 結果 |
|------|------|
| 対象カテゴリ数 | ${data.totalCategories} |
| 成功カテゴリ数 | ${data.successfulCategories} |
| 総案件取得数 | ${data.totalJobs} |
| 総詳細取得数 | ${data.totalDetails} |
| AI分析完了 | ${data.analysisResults ? Object.keys(data.analysisResults).length : 0}カテゴリ |

## 🎯 カテゴリ別結果

`;

  if (data.analysisResults) {
    for (const [category, count] of Object.entries(data.analysisResults)) {
      const categoryName = category === 'ec' ? 'EC・ネットショップ' :
        category === 'web_products' ? 'Web制作・Webデザイン' :
          category === 'software_development' ? 'ソフトウェア開発' :
            category === 'development' ? 'システム開発' :
              category;
      report += `### ${categoryName}\n- AI分析件数: ${count}件\n\n`;
    }
  }

  // 高時給案件があれば追加
  try {
    const fs = require('fs');
    if (fs.existsSync('output/high-hourly-jobs-3000+.md')) {
      const highHourlyContent = fs.readFileSync('output/high-hourly-jobs-3000+.md', 'utf8');
      report += `\n## 💰 高時給案件抽出結果\n\n`;
      report += highHourlyContent.split('\n').slice(10).join('\n');
    }
  } catch (e) {
    report += `\n## 💰 高時給案件抽出結果\n\n高時給案件ファイルの読み込みに失敗しました。\n\n`;
  }

  // おすすめ案件があれば追加
  try {
    const fs = require('fs');
    if (fs.existsSync('output/recommended-jobs-top30.md')) {
      const recommendedContent = fs.readFileSync('output/recommended-jobs-top30.md', 'utf8');
      report += `\n## ⭐ おすすめ案件TOP30\n\n`;
      report += recommendedContent.split('\n').slice(5).join('\n');
    }
  } catch (e) {
    report += `\n## ⭐ おすすめ案件TOP30\n\nおすすめ案件ファイルの読み込みに失敗しました。\n\n`;
  }

  report += `\n---\n\n*このレポートは自動生成されました*\n`;

  return report;
}

/**
 * CLIインターフェース
 */
export async function runHandlerCLI(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('🎯 利用可能なコマンド:');
    console.log('  full-analysis [件数] - 🚀 全処理統合実行 (スクレイピング→AI分析→レポート)');
    console.log('  scrape-ec [件数]     - EC案件取得 (デフォルト: 50件)');
    console.log('  scrape-web [件数]    - Web製品案件取得 (デフォルト: 50件)');
    console.log('  scrape-dev [件数]    - システム開発案件取得 (デフォルト: 50件)');
    console.log('  scrape-app [件数]    - アプリ開発案件取得 (デフォルト: 50件)');
    console.log('  lancers-system [件数] - ランサーズシステム開発案件取得 (デフォルト: 20件)');
    console.log('  lancers-web [件数]    - ランサーズWeb案件取得 (デフォルト: 20件)');
    console.log('  lancers-app [件数]    - ランサーズアプリ案件取得 (デフォルト: 20件)');
    console.log('  lancers-design [件数] - ランサーズデザイン案件取得 (デフォルト: 20件)');
    console.log('');
    console.log('📝 環境変数 LANCERS_EMAIL, LANCERS_PASSWORD を設定するとログインして取得します');
    console.log('例: npm run handler full-analysis 20');
    console.log('例: npm run handler scrape-ec 30');
    console.log('例: npm run handler lancers-system 15');
    return;
  }

  const command = args[0];
  const maxJobs = args[1] ? parseInt(args[1]) : 50;

  try {
    switch (command) {
      case 'full-analysis':
        console.log('🚀 全処理統合実行中...');
        const fullAnalysisResult = await executeFullAnalysisWorkflow({
          maxJobsPerCategory: maxJobs,
          maxDetailsPerCategory: maxJobs
        });
        console.log(JSON.stringify(fullAnalysisResult, null, 2));
        break;

      case 'scrape-ec':
        console.log(`📈 EC案件取得実行中 (${maxJobs}件)...`);
        const ecResult = await scrapeCrowdWorksJobsByCategoryWithDetails({
          category: 'ec',
          maxJobs,
          maxDetails: maxJobs
        });
        console.log(`✅ EC取得完了: ${ecResult.jobs.length}件一覧, ${ecResult.jobDetails.length}件詳細`);
        break;

      case 'scrape-web':
        console.log(`🌐 Web製品案件取得実行中 (${maxJobs}件)...`);
        const webResult = await scrapeCrowdWorksJobsByCategoryWithDetails({
          category: 'web_products',
          maxJobs,
          maxDetails: maxJobs
        });
        console.log(`✅ Web製品取得完了: ${webResult.jobs.length}件一覧, ${webResult.jobDetails.length}件詳細`);
        break;

      case 'scrape-dev':
        console.log(`💻 システム開発案件取得実行中 (${maxJobs}件)...`);
        const devResult = await scrapeCrowdWorksJobsByCategoryWithDetails({
          category: 'development',
          maxJobs,
          maxDetails: maxJobs
        });
        console.log(`✅ システム開発取得完了: ${devResult.jobs.length}件一覧, ${devResult.jobDetails.length}件詳細`);
        break;

      case 'scrape-app':
        console.log(`📱 アプリ開発案件取得実行中 (${maxJobs}件)...`);
        const appResult = await scrapeCrowdWorksJobsByCategoryWithDetails({
          category: 'software_development',
          maxJobs,
          maxDetails: maxJobs
        });
        console.log(`✅ アプリ開発取得完了: ${appResult.jobs.length}件一覧, ${appResult.jobDetails.length}件詳細`);
        break;

      case 'lancers-system':
        console.log(`💻 ランサーズシステム開発案件取得実行中 (${maxJobs}件)...`);
        const lancersSystemResult = await scrapeLancersJobsByCategory({
          category: 'system',
          maxJobs,
          ...(process.env['LANCERS_EMAIL'] && process.env['LANCERS_PASSWORD'] && { 
            email: process.env['LANCERS_EMAIL'], 
            password: process.env['LANCERS_PASSWORD'] 
          })
        });
        console.log(`✅ ランサーズシステム開発取得完了: ${lancersSystemResult.jobs.length}件取得`);
        break;

      case 'lancers-web':
        console.log(`🌐 ランサーズWeb案件取得実行中 (${maxJobs}件)...`);
        const lancersWebResult = await scrapeLancersJobsByCategory({
          category: 'web',
          maxJobs,
          ...(process.env['LANCERS_EMAIL'] && process.env['LANCERS_PASSWORD'] && { 
            email: process.env['LANCERS_EMAIL'], 
            password: process.env['LANCERS_PASSWORD'] 
          })
        });
        console.log(`✅ ランサーズWeb取得完了: ${lancersWebResult.jobs.length}件取得`);
        break;

      case 'lancers-app':
        console.log(`📱 ランサーズアプリ案件取得実行中 (${maxJobs}件)...`);
        const lancersAppResult = await scrapeLancersJobsByCategory({
          category: 'app',
          maxJobs,
          ...(process.env['LANCERS_EMAIL'] && process.env['LANCERS_PASSWORD'] && { 
            email: process.env['LANCERS_EMAIL'], 
            password: process.env['LANCERS_PASSWORD'] 
          })
        });
        console.log(`✅ ランサーズアプリ取得完了: ${lancersAppResult.jobs.length}件取得`);
        break;

      case 'lancers-design':
        console.log(`🎨 ランサーズデザイン案件取得実行中 (${maxJobs}件)...`);
        const lancersDesignResult = await scrapeLancersJobsByCategory({
          category: 'design',
          maxJobs,
          ...(process.env['LANCERS_EMAIL'] && process.env['LANCERS_PASSWORD'] && { 
            email: process.env['LANCERS_EMAIL'], 
            password: process.env['LANCERS_PASSWORD'] 
          })
        });
        console.log(`✅ ランサーズデザイン取得完了: ${lancersDesignResult.jobs.length}件取得`);
        break;

      default:
        console.log(`❌ 不明なコマンド: ${command}`);
        console.log('利用可能なコマンドを確認するには引数なしで実行してください。');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ 実行エラー:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// CLI実行時の処理
if (require.main === module) {
  runHandlerCLI().catch(error => {
    console.error('❌ CLI実行エラー:', error);
    process.exit(1);
  });
}

/**
 * ランサーズ案件スクレイピング（ログイン機能付き）
 */
export async function scrapeLancersJobsByCategory(params: {
  category: string;
  maxJobs: number;
  email?: string;
  password?: string;
}): Promise<LancersScrapingResult> {
  const { category, maxJobs, email, password } = params;
  
  let browser: Browser | null = null;
  
  try {
    console.log(`🚀 ランサーズ「${category}」カテゴリスクレイピング開始`);
    
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    
    // User-Agentを設定
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    const lancersService = new LancersService(page);
    
    // ログイン処理（認証情報がある場合）
    if (email && password) {
      console.log('🔐 ランサーズログイン実行中...');
      const loginSuccess = await lancersService.login(email, password);
      if (loginSuccess) {
        console.log('✅ ランサーズログイン成功');
      } else {
        console.log('⚠️ ランサーズログイン失敗 - 公開案件のみ取得します');
      }
    } else {
      console.log('ℹ️ 認証情報なし - 公開案件のみ取得します');
    }
    
    // 案件スクレイピング実行
    const jobsResult = await lancersService.scrapeJobs(category, maxJobs);
    
    console.log(`✅ ランサーズスクレイピング完了: ${jobsResult.length}件取得`);
    
    return {
      jobs: jobsResult,
      jobDetails: []
    };
    
  } catch (error) {
    console.error('❌ ランサーズスクレイピングエラー:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * ランサーズ案件詳細取得
 */
export async function scrapeLancersJobDetail(jobUrl: string, email?: string, password?: string): Promise<LancersJobDetail | null> {
  let browser: Browser | null = null;
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    const lancersService = new LancersService(page);
    
    // ログイン処理（認証情報がある場合）
    if (email && password) {
      const loginSuccess = await lancersService.login(email, password);
      if (!loginSuccess) {
        console.log('⚠️ ランサーズログイン失敗 - 詳細取得に失敗する可能性があります');
      }
    }
    
    // 詳細取得
    const detail = await lancersService.scrapeJobDetail(jobUrl);
    
    return detail;
    
  } catch (error) {
    console.error('❌ ランサーズ詳細取得エラー:', error);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * ランサーズ案件スクレイピング（詳細付き・ログイン機能付き）
 */
export async function scrapeLancersJobsByCategoryWithDetails(params: {
  category: string;
  maxJobs: number;
  maxDetails?: number;
  email?: string;
  password?: string;
}): Promise<{
  jobs: LancersJob[];
  jobDetails: LancersJobDetail[];
}> {
  const { category, maxJobs, maxDetails = 10, email, password } = params;
  
  try {
    console.log(`🚀 ランサーズ「${category}」カテゴリ詳細付きスクレイピング開始`);
    
    // 案件リスト取得
    const scrapingResult = await scrapeLancersJobsByCategory({
      category,
      maxJobs,
      ...(email && password && { email, password })
    });
    
    if (scrapingResult.jobs.length === 0) {
      console.log('⚠️ 案件が見つかりませんでした');
      return { jobs: [], jobDetails: [] };
    }
    
    console.log(`📋 ${scrapingResult.jobs.length}件の案件から詳細を取得中...`);
    
    // 詳細取得対象を制限
    const jobsForDetails = scrapingResult.jobs.slice(0, maxDetails);
    const jobDetails: LancersJobDetail[] = [];
    
    for (let i = 0; i < jobsForDetails.length; i++) {
      const job = jobsForDetails[i];
      if (!job) continue; // undefined チェック
      
      console.log(`📋 詳細取得中 ${i + 1}/${jobsForDetails.length}: ${job.title}`);

      try {
        const detail = await scrapeLancersJobDetail(job.url, email, password);
        if (detail) {
          jobDetails.push(detail);
        }
        
        // レート制限対策（詳細取得間隔）
        if (i < jobsForDetails.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
      } catch (error) {
        console.error(`❌ 詳細取得エラー (${job.url}):`, error);
      }
    }
    
    console.log(`✅ ランサーズ詳細付きスクレイピング完了: 案件${scrapingResult.jobs.length}件, 詳細${jobDetails.length}件`);
    
    return {
      jobs: scrapingResult.jobs,
      jobDetails
    };
    
  } catch (error) {
    console.error('❌ ランサーズ詳細付きスクレイピングエラー:', error);
    return { jobs: [], jobDetails: [] };
  }
}
