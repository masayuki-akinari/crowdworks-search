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
        const pageJobs = await page.evaluate((category) => {
          // 実際のページ構造に合わせたセレクタ
          const jobElements = document.querySelectorAll('ul li, .job_list_item, .job-list-item');
          const pageJobs: any[] = [];

          jobElements.forEach((element: Element) => {
            try {
              // タイトルとURLの取得（複数のセレクタパターンを試行）
              let titleLink = element.querySelector('h3 a, .job_title a, a[href*="/jobs/"]');

              if (!titleLink) {
                // hrefにjobsが含まれるリンクを探す
                const allLinks = element.querySelectorAll('a');
                for (const link of Array.from(allLinks)) {
                  if (link.getAttribute('href')?.includes('/jobs/')) {
                    titleLink = link;
                    break;
                  }
                }
              }

              if (!titleLink) return;

              const title = titleLink.textContent?.trim() || '';
              const url = titleLink.getAttribute('href') || '';
              const id = url.match(/\/jobs\/(\d+)/)?.[1] || '';

              if (!id || !title) return;

              // 説明文の取得
              const description = element.querySelector('p, .job_summary, .description')?.textContent?.trim() || '';

              // 予算情報の取得（複数パターン）
              let budgetText = '';
              const budgetSelectors = ['.job_price', '.price', '.budget', '[class*="price"]', '[class*="budget"]'];
              for (const selector of budgetSelectors) {
                const budgetElement = element.querySelector(selector);
                if (budgetElement) {
                  budgetText = budgetElement.textContent?.trim() || '';
                  break;
                }
              }

              // クライアント名の取得
              let clientName = '';
              const clientSelectors = ['.client_name', '.client', '[class*="client"]'];
              for (const selector of clientSelectors) {
                const clientElement = element.querySelector(selector);
                if (clientElement) {
                  clientName = clientElement.textContent?.trim() || '';
                  break;
                }
              }

              // 応募数の取得
              let applicantsText = '0';
              const applicantSelectors = ['.entry_count', '.applicants', '[class*="entry"]', '[class*="applicant"]'];
              for (const selector of applicantSelectors) {
                const applicantElement = element.querySelector(selector);
                if (applicantElement) {
                  applicantsText = applicantElement.textContent?.trim() || '0';
                  break;
                }
              }

              // 予算の解析
              let budgetAmount = 0;
              let budgetType: 'fixed' | 'hourly' | 'unknown' = 'unknown';
              if (budgetText.includes('円')) {
                const match = budgetText.match(/([0-9,]+)/);
                if (match?.[1]) {
                  budgetAmount = parseInt(match[1].replace(/,/g, ''));
                  budgetType = budgetText.includes('時給') ? 'hourly' : 'fixed';
                }
              }

              pageJobs.push({
                id,
                title,
                description,
                url: `https://crowdworks.jp${url}`,
                budget: {
                  type: budgetType,
                  amount: budgetAmount,
                  currency: 'JPY'
                },
                category,
                tags: [],
                client: {
                  name: clientName,
                  rating: 0,
                  reviewCount: 0
                },
                postedAt: new Date().toISOString(),
                applicants: parseInt(applicantsText.match(/\d+/)?.[0] || '0'),
                scrapedAt: new Date().toISOString()
              });
            } catch (error) {
              console.log('案件要素の解析エラー:', error);
            }
          });

          return pageJobs;
        }, category);

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
      const getTextContent = (selector: string): string => {
        const element = document.querySelector(selector);
        return element?.textContent?.trim() || '';
      };

      const getNumbers = (text: string): number => {
        const match = text.match(/(\d+)/);
        return match?.[1] ? parseInt(match[1]) : 0;
      };

      // 基本情報の取得
      const title = getTextContent('h1.job_title, .job-detail-title h1');
      const paymentType = getTextContent('.job_detail_content .job_price_table tr:nth-child(1) td:nth-child(2)');
      const budget = getTextContent('.job_detail_content .job_price_table tr:nth-child(2) td:nth-child(2)');
      const deliveryDate = getTextContent('.job_detail_content .job_price_table tr:nth-child(3) td:nth-child(2)');
      const postDate = getTextContent('.job_detail_content .job_price_table tr:nth-child(4) td:nth-child(2)');
      const applicationDeadline = getTextContent('.job_detail_content .job_price_table tr:nth-child(5) td:nth-child(2)');

      // 応募状況
      const applicantCount = getNumbers(getTextContent('.job_application_status .status_number'));
      const contractCount = getNumbers(getTextContent('.job_application_status .status_number:nth-child(2)'));
      const recruitmentCount = getNumbers(getTextContent('.job_recruitment_count'));
      const favoriteCount = getNumbers(getTextContent('.favorite_count'));

      // 詳細説明
      const detailedDescription = getTextContent('.job_detail_content .job_description');

      // クライアント情報
      const clientName = getTextContent('.client_info .client_name');
      const clientUrl = (document.querySelector('.client_info .client_name a') as HTMLAnchorElement)?.href || '';
      const overallRating = getTextContent('.client_info .overall_rating');
      const orderHistory = getTextContent('.client_info .order_history');
      const completionRate = getTextContent('.client_info .completion_rate');
      const thankCount = getTextContent('.client_info .thank_count');

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
          identityVerified: document.querySelector('.client_info .verified') !== null,
          orderRuleCheck: document.querySelector('.client_info .rule_check') !== null,
          description: getTextContent('.client_info .client_description')
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
    console.log('');
    console.log('例: npm run handler full-analysis 20');
    console.log('例: npm run handler scrape-ec 30');
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
