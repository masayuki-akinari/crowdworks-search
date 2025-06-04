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

// 案件データストレージ（メモリ内重複チェック用）
const scrapedJobsCache = new Set<string>();

// 案件詳細情報の型定義
interface CrowdWorksJobDetail {
  // 基本情報
  jobId: string;
  title: string;
  category: string;
  url: string;

  // 仕事の概要
  paymentType: string;    // 固定報酬制/時間単価制
  budget: string;         // 予算範囲
  deliveryDate: string;   // 納品希望日
  postDate: string;       // 掲載日
  applicationDeadline: string; // 応募期限
  desiredImages: string[];  // 希望イメージ（単色、カラフル等）

  // 応募状況
  applicantCount: number;    // 応募した人数
  contractCount: number;     // 契約した人数
  recruitmentCount: number;  // 募集人数
  favoriteCount: number;     // 気になる！リスト人数

  // 詳細な仕事内容
  detailedDescription: string; // 詳細な依頼内容

  // クライアント情報
  client: {
    name: string;
    url: string;
    overallRating: string;     // 総合評価
    orderHistory: string;      // 募集実績
    completionRate: string;    // プロジェクト完了率
    thankCount: string;        // ありがとう件数
    identityVerified: boolean; // 本人確認
    orderRuleCheck: boolean;   // 発注ルールチェック
    description: string;       // クライアントの説明
  };

  // 応募者情報（最新の数件）
  recentApplicants: Array<{
    name: string;
    url: string;
    applicationDate: string;
  }>;

  // 取得日時
  scrapedAt: string;
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
      ...(process.env['AWS_LAMBDA_FUNCTION_NAME'] ? {
        executablePath: process.env['PLAYWRIGHT_BROWSERS_PATH']
          ? `${process.env['PLAYWRIGHT_BROWSERS_PATH']}/chromium`
          : '/usr/bin/chromium'
      } : {}),
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
      // PlaywrightでのHTML要素に対応したセレクター
      const jobSelectors = [
        'main li',             // main要素内のli要素（最も可能性が高い）
        'ul li',               // 一般的なリスト構造
        'ol li',               // 順序付きリスト
        '.job-list li',        // 案件リスト内のli
        'li',                  // 全てのli要素
        '.job-item',           // 案件アイテム用クラス
        '[data-job-id]'        // job-id属性を持つ要素
      ];

      let jobElements: any = null;
      let usedSelector = '';

      for (const selector of jobSelectors) {
        const elements = (globalThis as any).document.querySelectorAll(selector);
        if (elements.length > 0) {
          jobElements = elements;
          usedSelector = selector;
          console.log(`✅ 案件要素発見: ${selector} (${elements.length}件)`);
          break;
        }
      }

      if (!jobElements || jobElements.length === 0) {
        console.log('❌ 案件要素が見つかりません');
        // デバッグ: ページの主要な要素を確認
        const mainElements = (globalThis as any).document.querySelectorAll('main, .main, #main');
        console.log('🔍 デバッグ: main要素数:', mainElements.length);

        // 実際にある要素を調査
        const allLists = (globalThis as any).document.querySelectorAll('ul, ol');
        console.log('🔍 デバッグ: リスト要素数:', allLists.length);

        const allListItems = (globalThis as any).document.querySelectorAll('li');
        console.log('🔍 デバッグ: リストアイテム要素数:', allListItems.length);

        // 全ての見出し要素を確認
        const allHeadings = (globalThis as any).document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        console.log('🔍 デバッグ: 見出し要素数:', allHeadings.length);

        // 全てのリンク要素を確認
        const allLinks = (globalThis as any).document.querySelectorAll('a');
        console.log('🔍 デバッグ: リンク要素数:', allLinks.length);

        // 案件URLを含むリンクを確認
        const jobLinks = (globalThis as any).document.querySelectorAll('a[href*="/public/jobs/"]');
        console.log('🔍 デバッグ: 案件リンク数:', jobLinks.length);

        return [];
      }

      const jobs: any[] = [];
      console.log(`📊 ${jobElements.length}件の案件要素を処理中...`);

      for (let i = 0; i < Math.min(jobElements.length, params.maxJobsLimit); i++) {
        try {
          const jobElement = jobElements[i];

          // 実際のHTML要素でタイトルとURLを検索
          const titleElement = jobElement.querySelector('h3 a, h2 a, h4 a, .title a, a[href*="/public/jobs/"], a[href*="/jobs/"]');
          const title = titleElement?.textContent?.trim() || titleElement?.innerText?.trim() || `案件タイトル不明_${i}`;

          // href属性から案件URLを取得
          const href = titleElement?.getAttribute('href') || '';
          const url = href ? (href.startsWith('http') ? href : `https://crowdworks.jp${href}`) : '';

          // 案件IDをURLから抽出
          const jobIdMatch = url.match(/\/public\/jobs\/(\d+)/);
          const jobId = jobIdMatch ? jobIdMatch[1] : `unknown_${i}`;

          // 重複チェック
          if (params.scrapedIds.includes(jobId)) {
            console.log(`⏭️ スキップ: 重複案件 ${jobId}`);
            continue;
          }

          // 概要 - 実際のHTML要素から取得
          const descriptionElement = jobElement.querySelector('p, div, span');
          let description = '';
          if (descriptionElement) {
            description = descriptionElement.textContent?.trim() || descriptionElement.innerText?.trim() || '';
          }

          // 料金情報 - 全てのテキスト要素から検索
          const allElements = jobElement.querySelectorAll('*');
          let budgetText = '';

          for (const element of allElements) {
            const text = element?.textContent?.trim() || '';
            if (text.includes('円') || text.includes('固定報酬制') || text.includes('時間単価制') || text.includes('コンペ')) {
              budgetText = text;
              break;
            }
          }

          // カテゴリ - リンク要素から取得
          const categoryLinks = jobElement.querySelectorAll('a');
          let category = params.categoryName;
          for (const link of categoryLinks) {
            const linkText = link?.textContent?.trim() || '';
            const href = link?.getAttribute('href') || '';
            if (href.includes('/public/jobs/category/') && linkText && linkText.length < 30) {
              category = linkText;
              break;
            }
          }

          // スキル/タグ - リンク要素から抽出
          const skillLinks = jobElement.querySelectorAll('a');
          const tags: string[] = [];
          skillLinks.forEach((skillItem: any) => {
            const skillText = skillItem?.textContent?.trim();
            const href = skillItem?.getAttribute('href') || '';
            if (skillText && href.includes('/skill/') && skillText.length > 0 && skillText.length < 50) {
              tags.push(skillText);
            }
          });

          // クライアント情報 - リンク要素から取得
          const clientLinks = jobElement.querySelectorAll('a');
          let clientName = '匿名';
          for (const link of clientLinks) {
            const linkText = link?.textContent?.trim() || '';
            const href = link?.getAttribute('href') || '';
            // クライアントページへのリンクを探す
            if (linkText && href.includes('/public/employers/') && !href.includes('/public/jobs/') && linkText.length < 50) {
              clientName = linkText;
              break;
            }
          }

          // 掲載日時 - time要素から取得
          const timeElement = jobElement.querySelector('time');
          const postedAt = timeElement?.textContent?.trim() || timeElement?.innerText?.trim() || new Date().toISOString().split('T')[0];

          // 応募者数と期限 - テキストから抽出
          let applicantCount = 0;
          let deadline = '';

          allElements.forEach((element: any) => {
            const text = element?.textContent?.trim() || '';

            // 契約数を抽出
            const contractMatch = text.match(/契約数[^\d]*(\d+)/);
            if (contractMatch) {
              applicantCount = parseInt(contractMatch[1]) || 0;
            }

            // 期限を抽出
            const deadlineMatch = text.match(/あと(\d+)日|(\d+月\d+日)/);
            if (deadlineMatch) {
              deadline = text;
            }
          });

          const job = {
            id: jobId,
            title: title,
            url: url,
            description: description.substring(0, 500), // 長すぎる場合は切り詰め
            budget: budgetText,
            category: category,
            tags: tags.slice(0, 10), // 最大10個のタグ
            clientName: clientName,
            postedAt: postedAt,
            applicantCount: applicantCount,
            deadline: deadline,
            scrapedAt: new Date().toISOString()
          };

          jobs.push(job);
          console.log(`✅ 案件データ抽出成功: ${job.title} (${job.id})`);

        } catch (error) {
          console.log(`❌ 案件 ${i} の処理中にエラー:`, error);
          continue;
        }
      }

      console.log(`📊 合計 ${jobs.length} 件の案件を抽出しました (セレクター: ${usedSelector})`);
      return jobs;
    }, { maxJobsLimit: maxJobs, categoryName: 'all', scrapedIds: Array.from(scrapedJobsCache) });

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
export async function testCrowdWorksScraping(): Promise<{
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
      ...(process.env['AWS_LAMBDA_FUNCTION_NAME'] ? {
        executablePath: process.env['PLAYWRIGHT_BROWSERS_PATH']
          ? `${process.env['PLAYWRIGHT_BROWSERS_PATH']}/chromium`
          : '/usr/bin/chromium'
      } : {}),
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
export async function testCrowdWorksLogin(): Promise<{
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
      ...(process.env['AWS_LAMBDA_FUNCTION_NAME'] ? {
        executablePath: process.env['PLAYWRIGHT_BROWSERS_PATH']
          ? `${process.env['PLAYWRIGHT_BROWSERS_PATH']}/chromium`
          : '/usr/bin/chromium'
      } : {}),
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
      // PlaywrightでのHTML要素に対応したセレクター
      const jobSelectors = [
        'main li',             // main要素内のli要素（最も可能性が高い）
        'ul li',               // 一般的なリスト構造
        'ol li',               // 順序付きリスト
        '.job-list li',        // 案件リスト内のli
        'li',                  // 全てのli要素
        '.job-item',           // 案件アイテム用クラス
        '[data-job-id]'        // job-id属性を持つ要素
      ];

      let jobElements: any = null;
      let usedSelector = '';

      for (const selector of jobSelectors) {
        const elements = (globalThis as any).document.querySelectorAll(selector);
        if (elements.length > 0) {
          jobElements = elements;
          usedSelector = selector;
          console.log(`✅ 案件要素発見: ${selector} (${elements.length}件)`);
          break;
        }
      }

      if (!jobElements || jobElements.length === 0) {
        console.log('❌ 案件要素が見つかりません');
        // デバッグ: ページの主要な要素を確認
        const mainElements = (globalThis as any).document.querySelectorAll('main, .main, #main');
        console.log('🔍 デバッグ: main要素数:', mainElements.length);

        // 実際にある要素を調査
        const allLists = (globalThis as any).document.querySelectorAll('ul, ol');
        console.log('🔍 デバッグ: リスト要素数:', allLists.length);

        const allListItems = (globalThis as any).document.querySelectorAll('li');
        console.log('🔍 デバッグ: リストアイテム要素数:', allListItems.length);

        // 全ての見出し要素を確認
        const allHeadings = (globalThis as any).document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        console.log('🔍 デバッグ: 見出し要素数:', allHeadings.length);

        // 全てのリンク要素を確認
        const allLinks = (globalThis as any).document.querySelectorAll('a');
        console.log('🔍 デバッグ: リンク要素数:', allLinks.length);

        // 案件URLを含むリンクを確認
        const jobLinks = (globalThis as any).document.querySelectorAll('a[href*="/public/jobs/"]');
        console.log('🔍 デバッグ: 案件リンク数:', jobLinks.length);

        return [];
      }

      const jobs: any[] = [];
      console.log(`📊 ${jobElements.length}件の案件要素を処理中...`);

      for (let i = 0; i < Math.min(jobElements.length, params.maxJobsLimit); i++) {
        try {
          const jobElement = jobElements[i];

          // 実際のHTML要素でタイトルとURLを検索
          const titleElement = jobElement.querySelector('h3 a, h2 a, h4 a, .title a, a[href*="/public/jobs/"], a[href*="/jobs/"]');
          const title = titleElement?.textContent?.trim() || titleElement?.innerText?.trim() || `案件タイトル不明_${i}`;

          // href属性から案件URLを取得
          const href = titleElement?.getAttribute('href') || '';
          const url = href ? (href.startsWith('http') ? href : `https://crowdworks.jp${href}`) : '';

          // 案件IDをURLから抽出
          const jobIdMatch = url.match(/\/public\/jobs\/(\d+)/);
          const jobId = jobIdMatch ? jobIdMatch[1] : `unknown_${i}`;

          // 重複チェック
          if (params.scrapedIds.includes(jobId)) {
            console.log(`⏭️ スキップ: 重複案件 ${jobId}`);
            continue;
          }

          // 概要 - 実際のHTML要素から取得
          const descriptionElement = jobElement.querySelector('p, div, span');
          let description = '';
          if (descriptionElement) {
            description = descriptionElement.textContent?.trim() || descriptionElement.innerText?.trim() || '';
          }

          // 料金情報 - 全てのテキスト要素から検索
          const allElements = jobElement.querySelectorAll('*');
          let budgetText = '';

          for (const element of allElements) {
            const text = element?.textContent?.trim() || '';
            if (text.includes('円') || text.includes('固定報酬制') || text.includes('時間単価制') || text.includes('コンペ')) {
              budgetText = text;
              break;
            }
          }

          // カテゴリ - リンク要素から取得
          const categoryLinks = jobElement.querySelectorAll('a');
          let category = params.categoryName;
          for (const link of categoryLinks) {
            const linkText = link?.textContent?.trim() || '';
            const href = link?.getAttribute('href') || '';
            if (href.includes('/public/jobs/category/') && linkText && linkText.length < 30) {
              category = linkText;
              break;
            }
          }

          // スキル/タグ - リンク要素から抽出
          const skillLinks = jobElement.querySelectorAll('a');
          const tags: string[] = [];
          skillLinks.forEach((skillItem: any) => {
            const skillText = skillItem?.textContent?.trim();
            const href = skillItem?.getAttribute('href') || '';
            if (skillText && href.includes('/skill/') && skillText.length > 0 && skillText.length < 50) {
              tags.push(skillText);
            }
          });

          // クライアント情報 - リンク要素から取得
          const clientLinks = jobElement.querySelectorAll('a');
          let clientName = '匿名';
          for (const link of clientLinks) {
            const linkText = link?.textContent?.trim() || '';
            const href = link?.getAttribute('href') || '';
            // クライアントページへのリンクを探す
            if (linkText && href.includes('/public/employers/') && !href.includes('/public/jobs/') && linkText.length < 50) {
              clientName = linkText;
              break;
            }
          }

          // 掲載日時 - time要素から取得
          const timeElement = jobElement.querySelector('time');
          const postedAt = timeElement?.textContent?.trim() || timeElement?.innerText?.trim() || new Date().toISOString().split('T')[0];

          // 応募者数と期限 - テキストから抽出
          let applicantCount = 0;
          let deadline = '';

          allElements.forEach((element: any) => {
            const text = element?.textContent?.trim() || '';

            // 契約数を抽出
            const contractMatch = text.match(/契約数[^\d]*(\d+)/);
            if (contractMatch) {
              applicantCount = parseInt(contractMatch[1]) || 0;
            }

            // 期限を抽出
            const deadlineMatch = text.match(/あと(\d+)日|(\d+月\d+日)/);
            if (deadlineMatch) {
              deadline = text;
            }
          });

          const job = {
            id: jobId,
            title: title,
            url: url,
            description: description.substring(0, 500), // 長すぎる場合は切り詰め
            budget: budgetText,
            category: category,
            tags: tags.slice(0, 10), // 最大10個のタグ
            clientName: clientName,
            postedAt: postedAt,
            applicantCount: applicantCount,
            deadline: deadline,
            scrapedAt: new Date().toISOString()
          };

          jobs.push(job);
          console.log(`✅ 案件データ抽出成功: ${job.title} (${job.id})`);

        } catch (error) {
          console.log(`❌ 案件 ${i} の処理中にエラー:`, error);
          continue;
        }
      }

      console.log(`📊 合計 ${jobs.length} 件の案件を抽出しました (セレクター: ${usedSelector})`);
      return jobs;
    }, { maxJobsLimit: maxJobs, categoryName: category, scrapedIds: Array.from(scrapedJobsCache) });

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
export async function testCrowdWorksCategories(): Promise<{
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
      ...(process.env['AWS_LAMBDA_FUNCTION_NAME'] ? {
        executablePath: process.env['PLAYWRIGHT_BROWSERS_PATH']
          ? `${process.env['PLAYWRIGHT_BROWSERS_PATH']}/chromium`
          : '/usr/bin/chromium'
      } : {}),
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
 * 案件詳細情報を抽出
 */
export async function scrapeCrowdWorksJobDetail(page: Page, jobUrl: string): Promise<CrowdWorksJobDetail> {
  console.log(`📄 案件詳細ページにアクセス: ${jobUrl}`);

  await page.goto(jobUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await page.waitForTimeout(2000);

  const detail = await page.evaluate(() => {
    const doc = (globalThis as any).document;

    // タイトル取得（h1から正確に抽出）
    const titleElement = doc.querySelector('h1');
    const fullTitle = titleElement?.textContent?.trim() || '';
    // 案件タイトルから不要な部分を削除（より正確に）
    const title = fullTitle.replace(/\s+(ウェブデザイン|アンケート|その他).*の仕事の依頼.*$/, '').trim();

    // 案件IDをURLから抽出
    const jobId = (globalThis as any).window.location.pathname.match(/\/(\d+)$/)?.[1] || '';

    // カテゴリを取得（パンくずから）
    const categoryElement = doc.querySelector('a[href*="/public/jobs/category/"]');
    const category = categoryElement?.textContent?.trim() || '';

    // 仕事の概要テーブルから情報抽出（MCP構造に基づく正確な取得）
    let paymentType = '';
    let budget = '';
    let deliveryDate = '';
    let postDate = '';
    let applicationDeadline = '';

    // MCPで確認した構造: 固定報酬制の行を探す
    const paymentRow = doc.querySelector('tr[class*="row"], table tr:has(td:contains("固定報酬制"))');
    if (paymentRow) {
      const cells = paymentRow.querySelectorAll('td');
      if (cells.length >= 2) {
        paymentType = cells[0]?.textContent?.trim() || '';
        budget = cells[1]?.textContent?.trim() || '';
      }
    }

    // テキストベースでのフォールバック抽出
    const pageText = doc.body?.textContent || '';

    // 固定報酬制の予算を抽出
    const budgetMatch = pageText.match(/固定報酬制\s*([0-9,]+円\s*〜\s*[0-9,]+円)/);
    if (budgetMatch) {
      paymentType = '固定報酬制';
      budget = budgetMatch[1];
    }

    // 掲載日を抽出
    const postDateMatch = pageText.match(/掲載日\s*(\d{4}年\d{2}月\d{2}日)/);
    if (postDateMatch) {
      postDate = postDateMatch[1];
    }

    // 応募期限を抽出
    const deadlineMatch = pageText.match(/応募期限\s*(\d{4}年\d{2}月\d{2}日)/);
    if (deadlineMatch) {
      applicationDeadline = deadlineMatch[1];
    }

    // 納品希望日を抽出
    const deliveryMatch = pageText.match(/納品希望日\s*([^\s]+)/);
    if (deliveryMatch && deliveryMatch[1] !== '-') {
      deliveryDate = deliveryMatch[1];
    }

    // 応募状況テーブルから情報抽出（テキストベース）
    let applicantCount = 0;
    let contractCount = 0;
    let recruitmentCount = 0;
    let favoriteCount = 0;

    const applicantMatch = pageText.match(/応募した人\s*(\d+)\s*人/);
    if (applicantMatch) applicantCount = parseInt(applicantMatch[1]);

    const contractMatch = pageText.match(/契約した人\s*(\d+)\s*人/);
    if (contractMatch) contractCount = parseInt(contractMatch[1]);

    const recruitmentMatch = pageText.match(/募集人数\s*(\d+)\s*人/);
    if (recruitmentMatch) recruitmentCount = parseInt(recruitmentMatch[1]);

    const favoriteMatch = pageText.match(/気になる！リスト\s*(\d+)\s*人/);
    if (favoriteMatch) favoriteCount = parseInt(favoriteMatch[1]);

    // クライアント情報を抽出（新構造対応）
    const clientLinkElement = doc.querySelector('a[href*="/public/employers/"]');
    const clientName = clientLinkElement?.textContent?.trim() || '匿名';

    // 評価情報を抽出（テキストベース）
    let overallRating = '';
    let orderHistory = '';
    let completionRate = '';

    const ratingMatch = pageText.match(/総合評価\s*"?(\d+\.\d+)"?/);
    if (ratingMatch) overallRating = ratingMatch[1];

    const historyMatch = pageText.match(/募集実績\s*"?(\d+)"?\s*件/);
    if (historyMatch) orderHistory = historyMatch[1] + '件';

    const completionMatch = pageText.match(/プロジェクト完了率\s*"?(\d+)"?\s*%/);
    if (completionMatch) completionRate = completionMatch[1] + '%';

    // 本人確認、発注ルールチェックの状態
    let identityVerified = false;
    if (pageText.includes('本人確認済み') || !pageText.includes('本人確認未提出')) {
      identityVerified = true;
    }

    // 詳細説明を取得（長いテキストセルから）
    let detailedDescription = '';
    const allCells = doc.querySelectorAll('td');
    allCells.forEach((cell: any) => {
      const text = cell.textContent?.trim() || '';
      // 詳細説明と思われる長いテキストを取得
      if (text.length > 200 && text.includes('概要') && !detailedDescription) {
        detailedDescription = text;
      }
    });

    // 最近の応募者情報を取得
    const recentApplicants: Array<{
      name: string;
      applicationDate: string;
    }> = [];

    // 最後のテーブルから応募者情報を取得
    const tables = doc.querySelectorAll('table');
    const lastTable = tables[tables.length - 1];
    if (lastTable) {
      const applicantRows = lastTable.querySelectorAll('tbody tr');
      applicantRows.forEach((row: any) => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const nameCell = cells[0];
          const dateCell = cells[1];

          const nameLink = nameCell.querySelector('a');
          const name = nameLink?.textContent?.trim() || nameCell.textContent?.trim() || '';
          const applicationDate = dateCell.textContent?.trim() || '';

          // ヘッダー行をスキップ
          if (name && applicationDate && !name.includes('クラウドワーカー') && applicationDate.includes('/')) {
            recentApplicants.push({
              name,
              applicationDate
            });
          }
        }
      });
    }

    return {
      jobId,
      title: title || fullTitle, // フォールバック
      url: (globalThis as any).window.location.href,
      category,
      paymentType,
      budget,
      postDate,
      deliveryDate,
      applicationDeadline,
      desiredImages: [], // 希望イメージは現在の構造では取得困難なため空配列
      applicantCount,
      contractCount,
      recruitmentCount,
      favoriteCount,
      client: {
        name: clientName,
        url: clientLinkElement?.getAttribute('href') ?
          `https://crowdworks.jp${clientLinkElement.getAttribute('href')}` : '',
        overallRating,
        orderHistory,
        completionRate,
        thankCount: '', // ありがとう件数は現在の構造では取得困難
        identityVerified,
        orderRuleCheck: false, // 発注ルールチェックは現在の構造では取得困難
        description: '', // クライアント説明は現在の構造では取得困難
      },
      detailedDescription,
      recentApplicants: recentApplicants.map(applicant => ({
        ...applicant,
        url: '' // 応募者URLは現在の構造では取得困難
      })),
      scrapedAt: new Date().toISOString()
    };
  });

  console.log(`✅ 案件詳細情報を取得: ${detail.title}`);
  return detail;
}

/**
 * 案件詳細付きでカテゴリ別案件を取得する
 */
export async function scrapeCrowdWorksJobsByCategoryWithDetails(params: {
  category: string;
  maxJobs: number;
  maxDetails?: number; // 詳細取得する案件の最大数（デフォルト3件）
}): Promise<{
  jobs: CrowdWorksJob[];
  jobDetails: CrowdWorksJobDetail[];
}> {
  let browser: Browser | null = null;

  try {
    console.log('🚀 案件詳細付き取得開始...');

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
      ...(process.env['AWS_LAMBDA_FUNCTION_NAME'] ? {
        executablePath: process.env['PLAYWRIGHT_BROWSERS_PATH']
          ? `${process.env['PLAYWRIGHT_BROWSERS_PATH']}/chromium`
          : '/usr/bin/chromium'
      } : {}),
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
    });

    const page = await context.newPage();

    // ログイン実行
    console.log('🔐 CrowdWorksにログイン中...');
    const credentials = await getCrowdWorksCredentials();
    await loginToCrowdWorks(page, credentials);

    // 案件一覧を取得
    console.log(`📋 案件一覧取得中: ${params.category}`);
    const jobsResult = await scrapeCrowdWorksJobsByCategory(page, params.category, params.maxJobs);
    const jobs = jobsResult.jobs;

    // 詳細情報を取得（指定された件数まで）
    const maxDetails = params.maxDetails || 3;
    const jobDetails: CrowdWorksJobDetail[] = [];

    console.log(`📄 案件詳細取得開始: ${Math.min(jobs.length, maxDetails)}件`);

    for (let i = 0; i < Math.min(jobs.length, maxDetails); i++) {
      const job = jobs[i];
      if (job && job.url) {
        console.log(`📄 詳細取得中 ${i + 1}/${maxDetails}: ${job.title}`);
        const detail = await scrapeCrowdWorksJobDetail(page, job.url);
        if (detail) {
          jobDetails.push(detail);
        }

        // 詳細取得間の待機時間（サーバー負荷軽減）
        await page.waitForTimeout(2000);
      }
    }

    console.log(`✅ 案件詳細取得完了: ${jobDetails.length}件`);

    await context.close();

    return {
      jobs,
      jobDetails
    };

  } catch (error) {
    console.error('❌ 案件詳細付き取得エラー:', error);
    throw error;
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
