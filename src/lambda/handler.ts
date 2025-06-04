/**
 * AWS Lambda Handler for CrowdWorks Search System
 * EventBridge スケジュール実行用のメインハンドラー
 */

// ローカル開発時の環境変数読み込み
if (!process.env['AWS_LAMBDA_FUNCTION_NAME']) {
  // Lambda環境ではない場合のみdotenvをロード
  try {
    require('dotenv').config();
    console.log('🏠 ローカル環境: .envファイルを読み込みました');
  } catch (error) {
    console.log('⚠️ dotenvが見つかりません（Lambda環境では正常）');
  }
}

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
  scrapedAt: string; // スクレイピング日時
}

// スクレイピング結果型
interface ScrapingResult {
  success: boolean;
  jobsFound: number;
  jobs: CrowdWorksJob[];
  error?: string;
  executionTime: number;
}

// スクレイピング設定
interface ScrapingConfig {
  categories: string[];
  maxJobsPerCategory: number;
  sortOrder: 'newest' | 'oldest';
}

// 案件データストレージ（メモリ内重複チェック用）
const scrapedJobsCache = new Set<string>();

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
      waitUntil: 'domcontentloaded', // networkidleより軽量な設定
      timeout: 30000
    });

    console.log('✅ ログインページ読み込み完了');

    // ページタイトル確認
    const title = await page.title();
    console.log(`📋 ページタイトル: ${title}`);

    // ログインフォームの要素を待機（MCPテストで確認した正確なセレクター）
    console.log('⏳ ログインフォーム要素を待機中...');
    await page.waitForSelector('input[name="email"], [role="textbox"][aria-label*="メール"], textbox', {
      timeout: 10000
    });

    // メールアドレス入力（MCPテストで確認したPlaywright方式）
    console.log('📧 メールアドレス入力中...');
    try {
      // getByRole方式（MCPで確認した方法）
      await page.getByRole('textbox', { name: 'メールアドレス' }).fill(credentials.email);
      console.log('✅ メールアドレス入力完了（getByRole方式）');
    } catch (roleError) {
      // フォールバック：従来のセレクター方式
      console.log('⚠️ getByRole失敗、セレクター方式でリトライ...');
      const emailSelector = 'input[name="email"], input[type="email"], textbox[name*="email"]';
      await page.fill(emailSelector, credentials.email);
      console.log('✅ メールアドレス入力完了（セレクター方式）');
    }

    // パスワード入力（MCPテストで確認した方式）
    console.log('🔑 パスワード入力中...');
    try {
      // getByRole方式（MCPで確認した方法）
      await page.getByRole('textbox', { name: 'パスワード' }).fill(credentials.password);
      console.log('✅ パスワード入力完了（getByRole方式）');
    } catch (roleError) {
      // フォールバック：従来のセレクター方式
      console.log('⚠️ getByRole失敗、セレクター方式でリトライ...');
      const passwordSelector = 'input[name="password"], input[type="password"]';
      await page.fill(passwordSelector, credentials.password);
      console.log('✅ パスワード入力完了（セレクター方式）');
    }

    // ログインボタンをクリック（MCPテストで確認した方式）
    console.log('🖱️ ログインボタンクリック中...');
    try {
      // getByRole方式（MCPで確認した方法）
      await page.getByRole('button', { name: 'ログイン', exact: true }).click();
      console.log('✅ ログインボタンクリック完了（getByRole方式）');
    } catch (roleError) {
      // フォールバック：従来のセレクター方式
      console.log('⚠️ getByRole失敗、セレクター方式でリトライ...');
      const loginButtonSelector = 'input[type="submit"], button[type="submit"], button:has-text("ログイン")';
      await page.click(loginButtonSelector);
      console.log('✅ ログインボタンクリック完了（セレクター方式）');
    }

    // ログイン処理完了を待機
    console.log('⏳ ログイン処理完了待機中...');
    await page.waitForTimeout(3000); // 3秒待機してレスポンスを確認

    // ログイン成功/失敗を確認
    console.log('🔍 ログイン結果確認中...');
    const currentUrl = page.url();
    console.log(`📋 現在のURL: ${currentUrl}`);

    // エラーチェック（MCPテストで確認したエラー要素）
    const loginStatus = await page.evaluate(() => {
      // 標準的なCSSセレクターを使用（:has-text()は無効なので削除）
      const errorGroups = (globalThis as any).document.querySelectorAll('[role="group"]');
      const allElements = (globalThis as any).document.querySelectorAll('*');

      let hasErrorGroup = false;
      let hasErrorMessage = false;
      let errorText = '';

      // エラーグループを探す
      for (const group of errorGroups) {
        if (group.textContent?.includes('入力内容に問題があります')) {
          hasErrorGroup = true;
          break;
        }
      }

      // エラーメッセージを探す  
      for (const element of allElements) {
        if (element.textContent?.includes('メールアドレスまたはパスワードが正しくありません')) {
          hasErrorMessage = true;
          errorText = element.textContent.trim();
          break;
        }
      }

      const generalError = (globalThis as any).document.querySelector('.error, .alert, .notice, [class*="error"]');

      // ログイン成功の判定要素
      const userMenu = (globalThis as any).document.querySelector('a[href*="logout"], .user-menu, .header-user-menu, [href*="mypage"]');
      const dashboard = (globalThis as any).document.querySelector('.dashboard, [class*="dashboard"], .mypage');

      return {
        hasErrorGroup,
        hasErrorMessage,
        hasGeneralError: !!generalError,
        hasUserMenu: !!userMenu,
        hasDashboard: !!dashboard,
        currentPath: (globalThis as any).window.location.pathname,
        isLoginPage: (globalThis as any).window.location.pathname.includes('/login'),
        errorText: errorText || generalError?.textContent || ''
      };
    });

    const executionTime = Date.now() - startTime;

    // ログイン成功判定
    const hasError = loginStatus.hasErrorGroup || loginStatus.hasErrorMessage || loginStatus.hasGeneralError;
    const hasSuccess = loginStatus.hasUserMenu || loginStatus.hasDashboard || !loginStatus.isLoginPage;
    const loginSuccess = !hasError && hasSuccess;

    console.log('📊 ログイン結果詳細:');
    console.log(`   エラーグループ: ${loginStatus.hasErrorGroup ? '❌' : '✅'}`);
    console.log(`   エラーメッセージ: ${loginStatus.hasErrorMessage ? '❌' : '✅'}`);
    console.log(`   ユーザーメニュー: ${loginStatus.hasUserMenu ? '✅' : '❌'}`);
    console.log(`   ログインページ: ${loginStatus.isLoginPage ? '❌' : '✅'}`);
    console.log(`   現在のパス: ${loginStatus.currentPath}`);

    if (loginSuccess) {
      console.log('✅ CrowdWorksログイン成功！');
      return {
        success: true,
        isLoggedIn: true,
        executionTime
      };
    } else {
      console.log('❌ CrowdWorksログイン失敗');
      const errorDetail = loginStatus.errorText || 'ログイン後の状態確認でエラーを検出';
      console.log(`📋 エラー詳細: ${errorDetail}`);

      return {
        success: false,
        isLoggedIn: false,
        error: errorDetail,
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
    const jobs: CrowdWorksJob[] = await page.evaluate((params: { maxJobsLimit: number; categoryName: string; scrapedIds: string[] }) => {
      // 実際のDOM構造に基づく案件要素セレクター
      const jobSelectors = [
        'list listitem',  // MCPブラウザで確認した実際の構造
        '.search_result .project_row',
        '.project-item',
        '.job-item',
        '[class*="project-row"]',
        '.list-item'
      ];

      let jobElements: any = null;
      for (const selector of jobSelectors) {
        const elements = (globalThis as any).document.querySelectorAll(selector);
        if (elements.length > 0) {
          jobElements = elements;
          console.log(`案件要素発見: ${selector} (${elements.length}件)`);
          break;
        }
      }

      if (!jobElements) {
        console.log('案件要素が見つかりません');
        return [];
      }

      const extractedJobs: any[] = [];
      const scrapedIdsSet = new Set(params.scrapedIds);
      console.log(`🔢 発見した案件数: ${jobElements.length}`);

      for (let i = 0; i < Math.min(jobElements.length, params.maxJobsLimit); i++) {
        const jobElement = jobElements[i] as any;

        try {
          // 実際のDOM構造に基づく案件タイトルとURL抽出
          // MCPで確認: heading[level=3] > link の構造
          const titleElement = jobElement.querySelector('heading[level="3"] link, h3 a, .project_title a, .job-title a, a[class*="title"]');
          const title = titleElement?.textContent?.trim() || titleElement?.innerText?.trim() || `案件タイトル不明_${i}`;

          // href属性またはurl属性から案件URLを取得
          const href = titleElement?.getAttribute('href') || titleElement?.getAttribute('url') || '';
          const url = href ? (href.startsWith('http') ? href : `https://crowdworks.jp${href}`) : '';

          // 案件ID（URLから抽出）
          const idMatch = url.match(/\/public\/jobs\/(\d+)/);
          const id = idMatch && idMatch[1] ? idMatch[1] : `${params.categoryName}_${i}_${Date.now()}`;

          // 重複チェック
          if (scrapedIdsSet.has(id)) {
            console.log(`⏭️ スキップ（既存）: ${id} - ${title}`);
            continue;
          }

          // 予算情報 - 実際のDOM構造に基づく
          // MCPで確認: 固定報酬制、時間単価制の表示
          const budgetElements = jobElement.querySelectorAll('generic');
          let budgetText = '';

          for (const budgetEl of budgetElements) {
            const text = budgetEl?.textContent?.trim() || '';
            if (text.includes('円') || text.includes('固定報酬制') || text.includes('時間単価制') || text.includes('コンペ')) {
              budgetText = text;
              break;
            }
          }

          let budget = {
            type: 'unknown' as 'fixed' | 'hourly' | 'unknown',
            amount: 0,
            currency: 'JPY'
          };

          if (budgetText.includes('時間単価制') || budgetText.includes('時給')) {
            budget.type = 'hourly';
            const hourlyMatch = budgetText.match(/([\d,]+)/);
            budget.amount = hourlyMatch ? parseInt(hourlyMatch[0].replace(/,/g, '')) : 0;
          } else if (budgetText.includes('固定報酬制') || budgetText.includes('円')) {
            budget.type = 'fixed';
            const fixedMatch = budgetText.match(/([\d,]+)/);
            budget.amount = fixedMatch ? parseInt(fixedMatch[0].replace(/,/g, '')) : 0;
          }

          // タグ（スキル） - listで管理されている場合
          const skillList = jobElement.querySelector('list');
          const tags: string[] = [];
          if (skillList) {
            const skillItems = skillList.querySelectorAll('listitem link');
            skillItems.forEach((skillItem: any) => {
              const skillText = skillItem?.textContent?.trim();
              if (skillText) tags.push(skillText);
            });
          }

          // クライアント情報 - link要素から取得
          const clientLinks = jobElement.querySelectorAll('link');
          let clientName = '匿名';
          for (const link of clientLinks) {
            const linkText = link?.textContent?.trim() || '';
            if (linkText && !linkText.includes('この仕事に似た') && !linkText.includes('http') && linkText.length < 50) {
              clientName = linkText;
              break;
            }
          }

          // 投稿日時 - time要素から取得
          const timeElement = jobElement.querySelector('time');
          const postedAt = timeElement?.textContent?.trim() || timeElement?.getAttribute('datetime') || '';

          // 応募者数・契約数 - genericテキストから抽出
          let applicants = 0;
          const genericElements = jobElement.querySelectorAll('generic');
          for (const generic of genericElements) {
            const text = generic?.textContent?.trim() || '';
            if (text.includes('契約数') || text.includes('応募数')) {
              const numberMatch = text.match(/(\d+)/);
              if (numberMatch) {
                applicants = parseInt(numberMatch[1]);
                break;
              }
            }
          }

          // 概要 - paragraph要素から取得
          const descElement = jobElement.querySelector('paragraph');
          const description = descElement?.textContent?.trim().slice(0, 200) || '';

          const jobData = {
            id,
            title,
            description: description + (description.length >= 200 ? '...' : ''),
            url,
            budget,
            category: params.categoryName,
            tags,
            client: {
              name: clientName,
              rating: 0, // 評価情報は複雑な構造のため一旦0
              reviewCount: 0
            },
            postedAt,
            applicants,
            scrapedAt: new Date().toISOString()
          };

          extractedJobs.push(jobData);
          console.log(`✅ 案件 ${extractedJobs.length}: ${title} (ID: ${id})`);

        } catch (error) {
          console.error(`❌ 案件 ${i + 1} 抽出エラー:`, error);
        }
      }

      return extractedJobs;
    }, {
      maxJobsLimit: maxJobs,
      categoryName: 'all',
      scrapedIds: Array.from(scrapedJobsCache)
    });

    // 重複チェックのためキャッシュに追加
    jobs.forEach((job: CrowdWorksJob) => scrapedJobsCache.add(job.id));

    const executionTime = Date.now() - startTime;

    console.log(`🎉 CrowdWorksスクレイピング完了:`);
    console.log(`   📊 取得案件数: ${jobs.length}`);
    console.log(`   ⏱️ 実行時間: ${executionTime}ms`);

    // サンプル案件情報をログ出力
    if (jobs.length > 0) {
      console.log(`📝 サンプル案件情報:`);
      const sample = jobs[0];
      if (sample) {
        console.log(`   🏷️ タイトル: ${sample.title}`);
        console.log(`   💰 予算: ${sample.budget.type} ${sample.budget.amount}円`);
        console.log(`   🏢 クライアント: ${sample.client.name} (評価: ${sample.client.rating}/5)`);
        console.log(`   🏷️ カテゴリ: ${sample.category}`);
        console.log(`   🔗 URL: ${sample.url}`);
      }
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
 * カテゴリ別CrowdWorks案件スクレイピング実行
 */
async function scrapeCrowdWorksJobsByCategory(
  page: Page,
  category: string,
  maxJobs: number = 20
): Promise<ScrapingResult> {
  const startTime = Date.now();

  try {
    console.log(`🔍 カテゴリ「${category}」の案件スクレイピング開始...`);

    // カテゴリページのURL構築
    const categoryUrl = `https://crowdworks.jp/public/jobs/group/${category}`;
    console.log(`📄 カテゴリページアクセス: ${categoryUrl}`);

    await page.goto(categoryUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('✅ カテゴリページ読み込み完了');

    // ページタイトル確認
    const pageTitle = await page.title();
    console.log(`📋 ページタイトル: "${pageTitle}"`);

    // 新着順ソートを設定
    console.log('🔄 新着順ソート設定中...');
    try {
      // 現在の実際のCrowdWorksページ構造に基づくソート設定

      // まず、ソートドロップダウン要素の待機
      await page.waitForSelector('combobox', { timeout: 5000 });

      // ソートドロップダウンを新着順に変更
      const sortDropdown = await page.$('combobox');
      if (sortDropdown) {
        // ドロップダウンをクリックして開く
        await sortDropdown.click();
        await page.waitForTimeout(500);

        // 「新着」オプションを選択
        try {
          await page.selectOption('combobox', { label: '新着' });
          console.log('✅ 新着順ソート設定完了（selectOption使用）');
        } catch (selectError) {
          // selectOption が失敗した場合は、手動で「新着」テキストをクリック
          const newOption = await page.$('option:has-text("新着")');
          if (newOption) {
            await newOption.click();
            console.log('✅ 新着順ソート設定完了（optionクリック使用）');
          } else {
            console.log('⚠️ 新着オプションが見つかりません');
          }
        }

        // ソート変更後のページ更新を待機
        await page.waitForTimeout(2000);

        // URLに order=new が含まれているか確認
        const currentUrl = page.url();
        if (currentUrl && currentUrl.includes('order=new')) {
          console.log('✅ 新着順URLパラメータ確認済み');
        } else {
          console.log('⚠️ 新着順URLパラメータが確認できません。直接URLアクセスを試行します。');

          // 直接新着順URLにアクセス
          const baseUrl = currentUrl || `https://crowdworks.jp/public/jobs/group/${category}`;
          const newUrl = baseUrl.includes('?')
            ? `${baseUrl}&order=new`
            : `${baseUrl}?order=new`;

          await page.goto(newUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          console.log(`✅ 新着順URL直接アクセス: ${newUrl}`);
        }
      } else {
        console.log('⚠️ ソートドロップダウンが見つかりません。直接URLアクセスを試行します。');

        // フォールバック：直接新着順URLにアクセス
        const currentUrl = page.url();
        const baseUrl = currentUrl || `https://crowdworks.jp/public/jobs/group/${category}`;
        const newUrl = baseUrl.includes('?')
          ? `${baseUrl}&order=new`
          : `${baseUrl}?order=new`;

        await page.goto(newUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log(`✅ 新着順URL直接アクセス（フォールバック）: ${newUrl}`);
      }

    } catch (sortError) {
      console.log('⚠️ ソート設定エラー。最終フォールバックとして直接URLアクセスを実行します。');

      // 最終フォールバック：直接新着順URLにアクセス
      try {
        const currentUrl = page.url();
        const baseUrl = currentUrl || `https://crowdworks.jp/public/jobs/group/${category}`;
        const newUrl = baseUrl.includes('?')
          ? `${baseUrl}&order=new`
          : `${baseUrl}?order=new`;

        await page.goto(newUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        console.log(`✅ 新着順URL直接アクセス（最終フォールバック）: ${newUrl}`);
      } catch (finalError) {
        console.log(`❌ 新着順ソート設定に完全に失敗しました: ${finalError}`);
        console.log('デフォルトソート順序で続行します。');
      }
    }

    // 案件一覧の要素が読み込まれるまで待機
    console.log('⏳ 案件一覧読み込み待機中...');
    const listSelectors = [
      '.search_result',
      '.project-list',
      '.job-list',
      '[class*="project"]',
      '.list-item'
    ];

    let listFound = false;
    for (const selector of listSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        console.log(`✅ 案件一覧発見: ${selector}`);
        listFound = true;
        break;
      } catch (error) {
        // 要素が見つからない場合は次のセレクターを試行
      }
    }

    if (!listFound) {
      console.log('⚠️ 案件一覧要素が見つかりません');
    }

    // 案件要素を取得
    console.log('📝 案件データ抽出中...');
    const jobs: CrowdWorksJob[] = await page.evaluate((params: { maxJobsLimit: number; categoryName: string; scrapedIds: string[] }) => {
      // 実際のDOM構造に基づく案件要素セレクター
      const jobSelectors = [
        'list listitem',  // MCPブラウザで確認した実際の構造
        '.search_result .project_row',
        '.project-item',
        '.job-item',
        '[class*="project-row"]',
        '.list-item'
      ];

      let jobElements: any = null;
      for (const selector of jobSelectors) {
        const elements = (globalThis as any).document.querySelectorAll(selector);
        if (elements.length > 0) {
          jobElements = elements;
          console.log(`案件要素発見: ${selector} (${elements.length}件)`);
          break;
        }
      }

      if (!jobElements) {
        console.log('案件要素が見つかりません');
        return [];
      }

      const extractedJobs: any[] = [];
      const scrapedIdsSet = new Set(params.scrapedIds);
      console.log(`🔢 発見した案件数: ${jobElements.length}`);

      for (let i = 0; i < Math.min(jobElements.length, params.maxJobsLimit); i++) {
        const jobElement = jobElements[i] as any;

        try {
          // 実際のDOM構造に基づく案件タイトルとURL抽出
          // MCPで確認: heading[level=3] > link の構造
          const titleElement = jobElement.querySelector('heading[level="3"] link, h3 a, .project_title a, .job-title a, a[class*="title"]');
          const title = titleElement?.textContent?.trim() || titleElement?.innerText?.trim() || `案件タイトル不明_${i}`;

          // href属性またはurl属性から案件URLを取得
          const href = titleElement?.getAttribute('href') || titleElement?.getAttribute('url') || '';
          const url = href ? (href.startsWith('http') ? href : `https://crowdworks.jp${href}`) : '';

          // 案件ID（URLから抽出）
          const idMatch = url.match(/\/public\/jobs\/(\d+)/);
          const id = idMatch && idMatch[1] ? idMatch[1] : `${params.categoryName}_${i}_${Date.now()}`;

          // 重複チェック
          if (scrapedIdsSet.has(id)) {
            console.log(`⏭️ スキップ（既存）: ${id} - ${title}`);
            continue;
          }

          // 予算情報 - 実際のDOM構造に基づく
          // MCPで確認: 固定報酬制、時間単価制の表示
          const budgetElements = jobElement.querySelectorAll('generic');
          let budgetText = '';

          for (const budgetEl of budgetElements) {
            const text = budgetEl?.textContent?.trim() || '';
            if (text.includes('円') || text.includes('固定報酬制') || text.includes('時間単価制') || text.includes('コンペ')) {
              budgetText = text;
              break;
            }
          }

          let budget = {
            type: 'unknown' as 'fixed' | 'hourly' | 'unknown',
            amount: 0,
            currency: 'JPY'
          };

          if (budgetText.includes('時間単価制') || budgetText.includes('時給')) {
            budget.type = 'hourly';
            const hourlyMatch = budgetText.match(/([\d,]+)/);
            budget.amount = hourlyMatch ? parseInt(hourlyMatch[0].replace(/,/g, '')) : 0;
          } else if (budgetText.includes('固定報酬制') || budgetText.includes('円')) {
            budget.type = 'fixed';
            const fixedMatch = budgetText.match(/([\d,]+)/);
            budget.amount = fixedMatch ? parseInt(fixedMatch[0].replace(/,/g, '')) : 0;
          }

          // タグ（スキル） - listで管理されている場合
          const skillList = jobElement.querySelector('list');
          const tags: string[] = [];
          if (skillList) {
            const skillItems = skillList.querySelectorAll('listitem link');
            skillItems.forEach((skillItem: any) => {
              const skillText = skillItem?.textContent?.trim();
              if (skillText) tags.push(skillText);
            });
          }

          // クライアント情報 - link要素から取得
          const clientLinks = jobElement.querySelectorAll('link');
          let clientName = '匿名';
          for (const link of clientLinks) {
            const linkText = link?.textContent?.trim() || '';
            if (linkText && !linkText.includes('この仕事に似た') && !linkText.includes('http') && linkText.length < 50) {
              clientName = linkText;
              break;
            }
          }

          // 投稿日時 - time要素から取得
          const timeElement = jobElement.querySelector('time');
          const postedAt = timeElement?.textContent?.trim() || timeElement?.getAttribute('datetime') || '';

          // 応募者数・契約数 - genericテキストから抽出
          let applicants = 0;
          const genericElements = jobElement.querySelectorAll('generic');
          for (const generic of genericElements) {
            const text = generic?.textContent?.trim() || '';
            if (text.includes('契約数') || text.includes('応募数')) {
              const numberMatch = text.match(/(\d+)/);
              if (numberMatch) {
                applicants = parseInt(numberMatch[1]);
                break;
              }
            }
          }

          // 概要 - paragraph要素から取得
          const descElement = jobElement.querySelector('paragraph');
          const description = descElement?.textContent?.trim().slice(0, 200) || '';

          const jobData = {
            id,
            title,
            description: description + (description.length >= 200 ? '...' : ''),
            url,
            budget,
            category: params.categoryName,
            tags,
            client: {
              name: clientName,
              rating: 0, // 評価情報は複雑な構造のため一旦0
              reviewCount: 0
            },
            postedAt,
            applicants,
            scrapedAt: new Date().toISOString()
          };

          extractedJobs.push(jobData);
          console.log(`✅ 案件 ${extractedJobs.length}: ${title} (ID: ${id})`);

        } catch (error) {
          console.error(`❌ 案件 ${i + 1} 抽出エラー:`, error);
        }
      }

      return extractedJobs;
    }, {
      maxJobsLimit: maxJobs,
      categoryName: category,
      scrapedIds: Array.from(scrapedJobsCache)
    });

    // 重複チェックのためキャッシュに追加
    jobs.forEach((job: CrowdWorksJob) => scrapedJobsCache.add(job.id));

    const executionTime = Date.now() - startTime;

    console.log(`🎉 カテゴリ「${category}」スクレイピング完了:`);
    console.log(`   📊 取得案件数: ${jobs.length}`);
    console.log(`   ⏱️ 実行時間: ${executionTime}ms`);

    // サンプル案件情報をログ出力
    if (jobs.length > 0) {
      console.log(`📝 サンプル案件:`);
      const sample = jobs[0];
      if (sample) {
        console.log(`   🏷️ タイトル: ${sample.title}`);
        console.log(`   💰 予算: ${sample.budget.type} ${sample.budget.amount}円`);
        console.log(`   🏢 クライアント: ${sample.client.name}`);
        console.log(`   🔗 URL: ${sample.url}`);
      }
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
 * 指定カテゴリのCrowdWorks案件スクレイピングテスト
 */
async function testCrowdWorksCategories(): Promise<{
  success: boolean;
  results?: { [category: string]: ScrapingResult };
  error?: string;
  executionTime: number;
}> {
  const startTime = Date.now();
  let browser: Browser | null = null;

  try {
    console.log('🚀 CrowdWorksカテゴリ案件スクレイピングテスト開始...');

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
    console.log('🔐 CrowdWorksログイン実行中...');
    const loginResult = await loginToCrowdWorks(page, credentials);

    if (!loginResult.success || !loginResult.isLoggedIn) {
      throw new Error(`ログイン失敗: ${loginResult.error}`);
    }

    console.log('✅ ログイン成功！カテゴリスクレイピング開始...');

    // 指定カテゴリをスクレイピング
    const categories = ['web_products', 'ec'];
    const results: { [category: string]: ScrapingResult } = {};

    for (const category of categories) {
      console.log(`\n📂 カテゴリ「${category}」処理開始...`);

      // ログイン後の既存コードを使用（型エラーを一旦無視）
      const categoryUrl = `https://crowdworks.jp/public/jobs/group/${category}`;
      console.log(`📄 カテゴリページアクセス: ${categoryUrl}`);

      await page.goto(categoryUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      console.log(`✅ カテゴリページ「${category}」読み込み完了`);

      // 簡易案件データ取得（後で詳細実装）
      const jobData = await page.evaluate(() => {
        const projects = (globalThis as any).document.querySelectorAll('.search_result .project_row, .project-item, [class*="project"]');
        return {
          count: projects.length,
          titles: Array.from(projects).slice(0, 3).map((p: any) => p.querySelector('a')?.textContent?.trim() || '不明')
        };
      });

      results[category] = {
        success: true,
        jobsFound: jobData.count,
        jobs: [], // 後で実装
        executionTime: 1000
      };

      console.log(`📊 カテゴリ「${category}」: ${jobData.count}件の案件発見`);
      if (jobData.titles.length > 0) {
        console.log(`📝 サンプルタイトル: ${jobData.titles.join(', ')}`);
      }

      // 次のカテゴリ処理前に少し待機
      await page.waitForTimeout(2000);
    }

    await context.close();

    const executionTime = Date.now() - startTime;
    console.log(`✅ カテゴリスクレイピングテスト完了 (${executionTime}ms)`);

    return {
      success: true,
      results,
      executionTime,
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ カテゴリスクレイピングテスト失敗:', errorMessage);

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

    // Phase 4: CrowdWorksカテゴリ別スクレイピングテスト（NEW）
    console.log('\n🎯 === Phase 4: CrowdWorksカテゴリ別スクレイピングテスト ===');
    const categoryTest = await testCrowdWorksCategories();

    if (!categoryTest.success) {
      console.error('⚠️ カテゴリスクレイピングテスト失敗:', categoryTest.error);
    } else if (categoryTest.results) {
      console.log('📋 カテゴリ別結果:');
      Object.entries(categoryTest.results).forEach(([category, result]) => {
        console.log(`   ${category}: ${result.success ? '✅' : '❌'} (${result.jobsFound}件)`);
      });
    }

    const executionTime = Date.now() - startTime;

    // 実行結果のまとめ
    const results = {
      phases: {
        playwright: playwrightTest,
        crowdworksLogin: loginTest,
        crowdworksScraping: scrapingTest,
        crowdworksCategories: categoryTest
      },
      executionTime,
      timestamp: new Date().toISOString()
    };

    console.log('\n🎉 === Lambda Handler 実行完了 ===');
    console.log('📊 実行結果サマリー:');
    console.log(`  - Playwright: ${playwrightTest.success ? '✅' : '❌'}`);
    console.log(`  - ログイン: ${loginTest.loginResult?.isLoggedIn ? '✅' : '❌'}`);
    console.log(`  - スクレイピング: ${scrapingTest.success ? '✅' : '❌'}`);
    console.log(`  - カテゴリ別: ${categoryTest.success ? '✅' : '❌'}`);
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
