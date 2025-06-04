/**
 * AWS Lambda Handler for CrowdWorks Search System
 * EventBridge スケジュール実行用のメインハンドラー
 */

import { Context } from 'aws-lambda';
import { chromium, Browser, Page } from 'playwright';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// AWS SSM Client for Parameter Store
const ssmClient = new SSMClient({ region: process.env['AWS_REGION'] || 'ap-northeast-1' });

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

// CrowdWorks認証情報
interface CrowdWorksCredentials {
  email: string;
  password: string;
}

// ログイン結果
interface LoginResult {
  success: boolean;
  isLoggedIn: boolean;
  error?: string;
  executionTime: number;
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
}

// スクレイピング結果型
interface ScrapingResult {
  success: boolean;
  jobsFound: number;
  jobs: CrowdWorksJob[];
  error?: string;
  executionTime: number;
}

/**
 * AWS Parameter Storeから認証情報を取得
 * ローカル開発時は環境変数フォールバック対応
 */
async function getCrowdWorksCredentials(): Promise<CrowdWorksCredentials> {
  try {
    console.log('🔐 CrowdWorks認証情報を取得中...');

    // ローカル開発環境では環境変数を優先
    const isLocal = !process.env['AWS_LAMBDA_FUNCTION_NAME'];

    if (isLocal) {
      console.log('🏠 ローカル環境を検出、環境変数から認証情報を取得...');

      const envEmail = process.env['CROWDWORKS_EMAIL'];
      const envPassword = process.env['CROWDWORKS_PASSWORD'];

      if (envEmail && envPassword) {
        console.log('✅ 環境変数から認証情報取得完了');
        return { email: envEmail, password: envPassword };
      }

      console.log('⚠️ 環境変数が設定されていません。Parameter Storeにフォールバック...');
    }

    // Parameter Storeから取得（Lambda環境またはローカルフォールバック）
    console.log('☁️ AWS Parameter Storeから認証情報を取得中...');

    const [emailParam, passwordParam] = await Promise.all([
      ssmClient.send(new GetParameterCommand({
        Name: '/crowdworks-search/crowdworks/email',
        WithDecryption: true
      })),
      ssmClient.send(new GetParameterCommand({
        Name: '/crowdworks-search/crowdworks/password',
        WithDecryption: true
      }))
    ]);

    const email = emailParam.Parameter?.Value;
    const password = passwordParam.Parameter?.Value;

    if (!email || !password) {
      throw new Error('CrowdWorks認証情報がParameter Storeで見つかりません');
    }

    console.log('✅ Parameter Storeから認証情報取得完了');
    return { email, password };

  } catch (error) {
    console.error('❌ 認証情報取得エラー:', error);

    // エラー詳細情報を提供
    if (error instanceof Error) {
      if (error.message.includes('ParameterNotFound')) {
        throw new Error('Parameter Storeにパラメータが存在しません。以下のコマンドで作成してください:\n' +
          'aws ssm put-parameter --name "/crowdworks-search/crowdworks/email" --value "your-email" --type "SecureString"\n' +
          'aws ssm put-parameter --name "/crowdworks-search/crowdworks/password" --value "your-password" --type "SecureString"');
      }
      if (error.message.includes('AccessDenied')) {
        throw new Error('Parameter Storeへのアクセス権限がありません。IAMポリシーを確認してください。');
      }
    }

    throw new Error(`認証情報取得失敗: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * CrowdWorksログイン実行
 */
async function loginToCrowdWorks(page: Page, credentials: CrowdWorksCredentials): Promise<LoginResult> {
  const startTime = Date.now();

  try {
    console.log('🚪 CrowdWorksログイン開始...');

    // ログインページにアクセス
    console.log('📄 ログインページにアクセス中...');
    await page.goto('https://crowdworks.jp/login', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    console.log('✅ ログインページ読み込み完了');

    // ログインフォームの要素を待機
    console.log('⏳ ログインフォーム読み込み待機中...');
    await page.waitForSelector('input[type="email"], input[name="email"], #login_form input[type="text"]', {
      timeout: 10000
    });

    // メールアドレス入力
    console.log('📧 メールアドレス入力中...');
    const emailSelector = 'input[type="email"], input[name="email"], #login_form input[type="text"]';
    await page.fill(emailSelector, credentials.email);
    console.log('✅ メールアドレス入力完了');

    // パスワード入力
    console.log('🔑 パスワード入力中...');
    const passwordSelector = 'input[type="password"], input[name="password"]';
    await page.fill(passwordSelector, credentials.password);
    console.log('✅ パスワード入力完了');

    // ログインボタンをクリック
    console.log('🖱️ ログインボタンクリック中...');
    const loginButtonSelector = 'input[type="submit"], button[type="submit"], .login-button, #login_button';
    await page.click(loginButtonSelector);

    // ログイン処理完了を待機（リダイレクトまたはページ変更）
    console.log('⏳ ログイン処理完了待機中...');
    try {
      await page.waitForNavigation({
        waitUntil: 'networkidle',
        timeout: 15000
      });
    } catch (navigationError) {
      console.log('ℹ️ ナビゲーション待機タイムアウト（ページが変わらない可能性）');
    }

    // ログイン成功を確認
    console.log('🔍 ログイン状態確認中...');
    const currentUrl = page.url();
    console.log(`📋 現在のURL: ${currentUrl}`);

    // ログイン成功の判定（複数の条件をチェック）
    const isLoggedIn = await page.evaluate(() => {
      // ログアウトリンクまたはユーザーメニューの存在を確認
      const logoutElement = (globalThis as any).document.querySelector('a[href*="logout"], .user-menu, .header-user-menu');
      const loginError = (globalThis as any).document.querySelector('.error, .alert, .notice');

      return {
        hasUserMenu: !!logoutElement,
        hasError: !!loginError,
        currentPath: (globalThis as any).window.location.pathname
      };
    });

    const loginSuccess = isLoggedIn.hasUserMenu &&
      !isLoggedIn.hasError &&
      !currentUrl.includes('/login');

    const executionTime = Date.now() - startTime;

    if (loginSuccess) {
      console.log('✅ CrowdWorksログイン成功！');
      return {
        success: true,
        isLoggedIn: true,
        executionTime
      };
    } else {
      console.log('❌ CrowdWorksログイン失敗');
      return {
        success: false,
        isLoggedIn: false,
        error: 'ログイン後の状態確認でエラーを検出',
        executionTime
      };
    }

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ ログインエラー:', errorMessage);

    return {
      success: false,
      isLoggedIn: false,
      error: errorMessage,
      executionTime
    };
  }
}

/**
 * Playwright基本動作確認テスト
 */
async function testPlaywrightBasic(): Promise<{
  success: boolean;
  chromiumVersion?: string;
  title?: string;
  screenshot?: boolean;
  error?: string;
  executionTime: number;
}> {
  const startTime = Date.now();
  let browser: Browser | null = null;

  try {
    console.log('🚀 Playwright Chromium起動テスト開始...');

    // Chromium起動（Lambda Container最適化設定）
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--disable-software-rasterizer',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
      ],
      // Lambda環境でのChromium実行パス
      executablePath: process.env['PLAYWRIGHT_BROWSERS_PATH']
        ? `${process.env['PLAYWRIGHT_BROWSERS_PATH']}/chromium`
        : '/usr/bin/chromium',
    });

    console.log('✅ Chromium起動成功');

    // ブラウザコンテキスト作成
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });

    const page: Page = await context.newPage();
    console.log('📄 ページオブジェクト作成完了');

    // 基本ページアクセステスト
    console.log('🌐 Google アクセステスト開始...');
    await page.goto('https://www.google.com', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    const title = await page.title();
    console.log(`📋 ページタイトル取得: "${title}"`);

    // スクリーンショット取得（Lambda環境確認用）
    try {
      await page.screenshot({
        path: '/tmp/test-screenshot.png',
        fullPage: false
      });
      console.log('📸 スクリーンショット保存成功: /tmp/test-screenshot.png');
    } catch (screenshotError) {
      console.warn('⚠️ スクリーンショット保存失敗:', screenshotError);
    }

    // Chromiumバージョン情報取得（ブラウザ環境内で実行）
    const chromiumVersion = await page.evaluate(() => {
      // ブラウザ環境内なのでnavigatorオブジェクトが利用可能
      return (globalThis as any).navigator.userAgent;
    });

    await context.close();

    const executionTime = Date.now() - startTime;
    console.log(`✅ Playwright基本テスト完了 (${executionTime}ms)`);

    return {
      success: true,
      chromiumVersion,
      title,
      screenshot: true,
      executionTime,
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Playwright テスト失敗:', errorMessage);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');

    return {
      success: false,
      error: errorMessage,
      executionTime,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('🔒 ブラウザクリーンアップ完了');
      } catch (closeError) {
        console.warn('⚠️ ブラウザクローズ時エラー:', closeError);
      }
    }
  }
}

/**
 * CrowdWorks案件スクレイピング実行
 */
async function scrapeCrowdWorksJobs(page: Page, maxJobs: number = 10): Promise<ScrapingResult> {
  const startTime = Date.now();

  try {
    console.log('🔍 CrowdWorks案件スクレイピング開始...');

    // CrowdWorks公開案件ページにアクセス
    console.log('📄 CrowdWorks案件ページにアクセス中...');
    await page.goto('https://crowdworks.jp/public/jobs', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    console.log('✅ CrowdWorksページ読み込み完了');

    // ページタイトル確認
    const pageTitle = await page.title();
    console.log(`📋 ページタイトル: "${pageTitle}"`);

    // 案件一覧の要素が読み込まれるまで待機
    console.log('⏳ 案件一覧読み込み待機中...');
    await page.waitForSelector('.search_result', { timeout: 10000 });

    // 案件要素を取得
    console.log('📝 案件データ抽出中...');
    const jobs = await page.evaluate((maxJobsLimit) => {
      const jobElements = (globalThis as any).document.querySelectorAll('.search_result .project_row');
      const extractedJobs: any[] = [];

      console.log(`🔢 発見した案件数: ${jobElements.length}`);

      for (let i = 0; i < Math.min(jobElements.length, maxJobsLimit); i++) {
        const jobElement = jobElements[i] as any; // ブラウザ環境のHTMLElement

        try {
          // 案件タイトル
          const titleElement = jobElement.querySelector('.project_title a');
          const title = titleElement?.textContent?.trim() || 'タイトル不明';
          const url = titleElement ? new URL(titleElement.getAttribute('href') || '', 'https://crowdworks.jp').href : '';

          // 案件ID（URLから抽出）
          const idMatch = url.match(/\/public\/jobs\/(\d+)/);
          const id = idMatch ? idMatch[1] : `unknown_${i}`;

          // 予算情報
          const budgetElement = jobElement.querySelector('.project_budget');
          const budgetText = budgetElement?.textContent?.trim() || '';

          let budget = {
            type: 'unknown' as 'fixed' | 'hourly' | 'unknown',
            amount: 0,
            currency: 'JPY'
          };

          // 予算テキストをパース（例：「10,000円 〜 50,000円」「時給1,000円」）
          if (budgetText.includes('時給')) {
            budget.type = 'hourly';
            const hourlyMatch = budgetText.match(/[\d,]+/);
            budget.amount = hourlyMatch ? parseInt(hourlyMatch[0].replace(/,/g, '')) : 0;
          } else if (budgetText.includes('円')) {
            budget.type = 'fixed';
            const fixedMatch = budgetText.match(/([\d,]+)円/);
            budget.amount = fixedMatch ? parseInt(fixedMatch[1].replace(/,/g, '')) : 0;
          }

          // カテゴリ
          const categoryElement = jobElement.querySelector('.project_category');
          const category = categoryElement?.textContent?.trim() || '未分類';

          // タグ（スキル）
          const tagElements = jobElement.querySelectorAll('.project_skills .skill_tag');
          const tags: string[] = [];
          tagElements.forEach((tag: any) => {
            const tagText = tag.textContent?.trim();
            if (tagText) tags.push(tagText);
          });

          // クライアント情報
          const clientElement = jobElement.querySelector('.client_info');
          const clientName = clientElement?.querySelector('.client_name')?.textContent?.trim() || '匿名';

          // 評価情報
          const ratingElement = clientElement?.querySelector('.client_rating');
          const ratingText = ratingElement?.textContent?.trim() || '';
          const ratingMatch = ratingText.match(/([\d.]+)/);
          const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

          // レビュー数
          const reviewElement = clientElement?.querySelector('.review_count');
          const reviewText = reviewElement?.textContent?.trim() || '';
          const reviewMatch = reviewText.match(/(\d+)/);
          const reviewCount = reviewMatch ? parseInt(reviewMatch[1]) : 0;

          // 投稿日時
          const dateElement = jobElement.querySelector('.posted_date');
          const postedAt = dateElement?.textContent?.trim() || '';

          // 応募者数
          const applicantElement = jobElement.querySelector('.applicant_count');
          const applicantText = applicantElement?.textContent?.trim() || '';
          const applicantMatch = applicantText.match(/(\d+)/);
          const applicants = applicantMatch ? parseInt(applicantMatch[1]) : 0;

          // 概要（最初の100文字）
          const descElement = jobElement.querySelector('.project_description');
          const description = descElement?.textContent?.trim().slice(0, 100) || '';

          const jobData = {
            id,
            title,
            description: description + (description.length >= 100 ? '...' : ''),
            url,
            budget,
            category,
            tags,
            client: {
              name: clientName,
              rating,
              reviewCount
            },
            postedAt,
            applicants
          };

          extractedJobs.push(jobData);
          console.log(`✅ 案件 ${i + 1}: ${title}`);

        } catch (error) {
          console.error(`❌ 案件 ${i + 1} 抽出エラー:`, error);
        }
      }

      return extractedJobs;
    }, maxJobs);

    const executionTime = Date.now() - startTime;

    console.log(`🎉 CrowdWorksスクレイピング完了:`);
    console.log(`   📊 取得案件数: ${jobs.length}`);
    console.log(`   ⏱️ 実行時間: ${executionTime}ms`);

    // サンプル案件情報をログ出力
    if (jobs.length > 0) {
      console.log(`📝 サンプル案件情報:`);
      const sample = jobs[0];
      console.log(`   🏷️ タイトル: ${sample.title}`);
      console.log(`   💰 予算: ${sample.budget.type} ${sample.budget.amount}円`);
      console.log(`   🏢 クライアント: ${sample.client.name} (評価: ${sample.client.rating}/5)`);
      console.log(`   🏷️ カテゴリ: ${sample.category}`);
      console.log(`   🔗 URL: ${sample.url}`);
    }

    return {
      success: true,
      jobsFound: jobs.length,
      jobs,
      executionTime
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ CrowdWorksスクレイピングエラー:', errorMessage);

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
 * CrowdWorks案件取得テスト（Playwright統合版）
 */
async function testCrowdWorksScraping(): Promise<{
  success: boolean;
  scrapingResult?: ScrapingResult;
  error?: string;
  executionTime: number;
}> {
  const startTime = Date.now();
  let browser: Browser | null = null;

  try {
    console.log('🚀 CrowdWorks案件取得テスト開始...');

    // Chromium起動
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--disable-software-rasterizer',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
      ],
      executablePath: process.env['PLAYWRIGHT_BROWSERS_PATH']
        ? `${process.env['PLAYWRIGHT_BROWSERS_PATH']}/chromium`
        : '/usr/bin/chromium',
    });

    console.log('✅ Chromium起動成功');

    // ブラウザコンテキスト作成
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      // 日本語環境設定
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
    });

    const page = await context.newPage();

    // CrowdWorks案件スクレイピング実行
    const scrapingResult = await scrapeCrowdWorksJobs(page, 5); // テスト用に5件取得

    await context.close();

    const executionTime = Date.now() - startTime;
    console.log(`✅ CrowdWorks案件取得テスト完了 (${executionTime}ms)`);

    return {
      success: scrapingResult.success,
      scrapingResult,
      executionTime,
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ CrowdWorks案件取得テスト失敗:', errorMessage);

    return {
      success: false,
      error: errorMessage,
      executionTime,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('🔒 ブラウザクリーンアップ完了');
      } catch (closeError) {
        console.warn('⚠️ ブラウザクローズ時エラー:', closeError);
      }
    }
  }
}

/**
 * CrowdWorksログインテスト実行
 */
async function testCrowdWorksLogin(): Promise<{
  success: boolean;
  loginResult?: LoginResult;
  error?: string;
  executionTime: number;
}> {
  const startTime = Date.now();
  let browser: Browser | null = null;

  try {
    console.log('🚀 CrowdWorksログインテスト開始...');

    // 認証情報を取得
    const credentials = await getCrowdWorksCredentials();

    // Chromium起動
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--disable-software-rasterizer',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
      ],
      executablePath: process.env['PLAYWRIGHT_BROWSERS_PATH']
        ? `${process.env['PLAYWRIGHT_BROWSERS_PATH']}/chromium`
        : '/usr/bin/chromium',
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    // CrowdWorksログイン実行
    const loginResult = await loginToCrowdWorks(page, credentials);

    await context.close();

    const executionTime = Date.now() - startTime;
    console.log(`✅ CrowdWorksログインテスト完了 (${executionTime}ms)`);

    return {
      success: true,
      loginResult,
      executionTime,
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ CrowdWorksログインテスト失敗:', errorMessage);

    return {
      success: false,
      error: errorMessage,
      executionTime,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('🔒 ブラウザクリーンアップ完了');
      } catch (closeError) {
        console.warn('⚠️ ブラウザクローズ時エラー:', closeError);
      }
    }
  }
}

/**
 * Lambda メインハンドラー
 */
export const lambdaHandler = async (
  event: ScheduledExecutionEvent,
  _context: Context
): Promise<ScheduledExecutionResponse> => {
  const startTime = Date.now();

  try {
    console.log('🌟 === CrowdWorks Search Lambda Handler 開始 ===');
    console.log('📅 実行時間:', new Date().toISOString());
    console.log('🔧 実行環境:', process.env['NODE_ENV'] || 'development');
    console.log('📋 イベント:', JSON.stringify(event, null, 2));

    // Phase 1: Playwright基本動作確認
    console.log('\n🔍 === Phase 1: Playwright基本動作確認 ===');
    const playwrightTest = await testPlaywrightBasic();

    if (!playwrightTest.success) {
      throw new Error(`Playwright基本テスト失敗: ${playwrightTest.error}`);
    }

    // Phase 2: CrowdWorksログインテスト
    console.log('\n🔐 === Phase 2: CrowdWorksログインテスト ===');
    const loginTest = await testCrowdWorksLogin();

    if (!loginTest.success || !loginTest.loginResult?.isLoggedIn) {
      console.error('⚠️ CrowdWorksログインテスト失敗:', loginTest.error);
      // ログイン失敗時もとりあえず続行（後続処理でエラーハンドリング）
    }

    // Phase 3: CrowdWorks案件スクレイピングテスト
    console.log('\n📊 === Phase 3: CrowdWorks案件スクレイピングテスト ===');
    const scrapingTest = await testCrowdWorksScraping();

    if (!scrapingTest.success) {
      console.error('⚠️ スクレイピングテスト失敗:', scrapingTest.error);
    }

    const executionTime = Date.now() - startTime;

    // 実行結果のまとめ
    const results = {
      phases: {
        playwright: playwrightTest,
        crowdworksLogin: loginTest,
        crowdworksScraping: scrapingTest
      },
      executionTime,
      timestamp: new Date().toISOString()
    };

    console.log('\n🎉 === Lambda Handler 実行完了 ===');
    console.log('📊 実行結果サマリー:');
    console.log(`  - Playwright: ${playwrightTest.success ? '✅' : '❌'}`);
    console.log(`  - ログイン: ${loginTest.loginResult?.isLoggedIn ? '✅' : '❌'}`);
    console.log(`  - スクレイピング: ${scrapingTest.success ? '✅' : '❌'}`);
    console.log(`⏱️ 総実行時間: ${executionTime}ms`);

    return {
      statusCode: 200,
      body: JSON.stringify(results, null, 2),
      executionTime,
      timestamp: new Date().toISOString(),
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error('💥 === Lambda Handler エラー ===');
    console.error('❌ エラー内容:', errorMessage);
    console.error('📊 Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    console.error(`⏱️ エラー発生時間: ${executionTime}ms`);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: errorMessage,
        executionTime,
        timestamp: new Date().toISOString(),
      }, null, 2),
      executionTime,
      timestamp: new Date().toISOString(),
    };
  }
};

// API Gateway用ハンドラー（互換性維持）
export const handler = lambdaHandler;
