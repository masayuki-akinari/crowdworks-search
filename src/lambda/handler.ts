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
      waitUntil: 'networkidle', // より確実な読み込み待機
      timeout: 60000 // タイムアウトを60秒に延長
    });

    console.log('✅ ログインページ読み込み完了');

    // ページタイトル確認
    const title = await page.title();
    console.log(`📋 ページタイトル: ${title}`);

    // ページの状態確認
    console.log('🔍 ページ状態確認中...');
    const pageInfo = await page.evaluate(() => ({
      url: (globalThis as any).window.location.href,
      title: (globalThis as any).document.title,
      readyState: (globalThis as any).document.readyState
    }));
    console.log(`📊 ページ状態: ${JSON.stringify(pageInfo)}`);

    // メールアドレス入力欄を待機（より確実な待機）
    console.log('⏳ メールアドレス入力欄を待機中...');
    await page.waitForFunction(
      () => (globalThis as any).document.querySelector('input[type="email"], [role="textbox"], textbox') !== null,
      { timeout: 30000 }
    );

    // メールアドレス入力（MCPテストで確認した正しい方式）
    console.log('📧 メールアドレス入力中...');
    try {
      // MCPテストで確認済み：この方式が正しく動作する
      await page.getByRole('textbox', { name: 'メールアドレス' }).fill(credentials.email);
      console.log('✅ メールアドレス入力完了');
    } catch (error) {
      // フォールバック：より具体的なセレクター
      console.log('⚠️ フォールバック中...');
      await page.fill('input[type="email"], [placeholder*="メール"]', credentials.email);
      console.log('✅ メールアドレス入力完了（フォールバック）');
    }

    // 少し待機
    await page.waitForTimeout(1000);

    // パスワード入力（MCPテストで確認した正しい方式）
    console.log('🔑 パスワード入力中...');
    try {
      // MCPテストで確認済み：この方式が正しく動作する
      await page.getByRole('textbox', { name: 'パスワード' }).fill(credentials.password);
      console.log('✅ パスワード入力完了');
    } catch (error) {
      // フォールバック：より具体的なセレクター
      console.log('⚠️ フォールバック中...');
      await page.fill('input[type="password"], [placeholder*="パスワード"]', credentials.password);
      console.log('✅ パスワード入力完了（フォールバック）');
    }

    // 少し待機
    await page.waitForTimeout(1000);

    // ログインボタンをクリック（MCPテストで確認した正しい方式）
    console.log('🖱️ ログインボタンクリック中...');
    try {
      // MCPテストで確認済み：button "ログイン"
      await page.getByRole('button', { name: 'ログイン' }).click();
      console.log('✅ ログインボタンクリック完了');
    } catch (error) {
      // フォールバック：より一般的なセレクター
      console.log('⚠️ フォールバック中...');
      await page.click('button:has-text("ログイン"), input[value="ログイン"]');
      console.log('✅ ログインボタンクリック完了（フォールバック）');
    }

    // ログイン処理完了を待機（より長めの待機）
    console.log('⏳ ログイン処理完了待機中...');
    await page.waitForTimeout(5000); // 5秒待機してレスポンスを確認

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
export async function testPlaywrightBasic(): Promise<{
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
      console.log('🔍 DOM解析開始...');

      // 直接案件リンクから抽出（デバッグで成功した方式）
      const doc = (globalThis as any).document;
      const jobLinks = doc.querySelectorAll('a[href*="/public/jobs/"]');
      console.log(`🔗 案件リンク数: ${jobLinks.length}`);

      if (jobLinks.length === 0) {
        console.log('❌ 案件リンクが見つかりません');
        return [];
      }

      // 案件詳細ページのリンクのみを対象にする（一覧ページや他のリンクを除外）
      const validJobLinks: any[] = [];
      for (let i = 0; i < jobLinks.length; i++) {
        const link = jobLinks[i];
        const href = link.getAttribute('href') || '';

        // 案件詳細ページのパターンをチェック
        if (href.match(/\/public\/jobs\/\d+$/) && !href.includes('category') && !href.includes('group')) {
          validJobLinks.push(link);
        }
      }

      console.log(`✅ 有効な案件リンク数: ${validJobLinks.length}`);

      // 最初の数件のみを安全に抽出
      const safeLimit = Math.min(validJobLinks.length, params.maxJobsLimit);
      const jobs: any[] = [];

      for (let i = 0; i < safeLimit; i++) {
        try {
          const link = validJobLinks[i];
          const href = link.getAttribute('href') || '';
          const title = link.textContent?.trim() || '';
          const url = href.startsWith('http') ? href : `https://crowdworks.jp${href}`;

          // 案件IDをURLから抽出
          const jobIdMatch = url.match(/\/public\/jobs\/(\d+)/);
          const jobId = jobIdMatch ? (jobIdMatch[1] ?? `unknown_${i}`) : `unknown_${i}`;

          if (title && url && jobId !== `unknown_${i}`) {
            // 重複チェック
            if (params.scrapedIds.includes(jobId)) {
              console.log(`⏭️ スキップ: 重複案件 ${jobId}`);
              continue;
            }

            // 親要素から追加情報を取得
            let parentElement = link.parentElement;
            let detailText = '';
            let budget = '';

            // 最大5階層まで親要素を辿る
            for (let depth = 0; depth < 5 && parentElement; depth++) {
              const parentText = parentElement.textContent || '';
              if (parentText.includes('円') && !budget) {
                // 予算情報を抽出
                const budgetMatch = parentText.match(/(\d{1,3}(?:,\d{3})*)\s*円/);
                if (budgetMatch) {
                  budget = budgetMatch[0];
                }
              }

              if (parentText.length > detailText.length && parentText.length < 1000) {
                detailText = parentText;
              }

              parentElement = parentElement.parentElement;
            }

            // 予算タイプの判定
            let budgetType: 'fixed' | 'hourly' | 'unknown' = 'unknown';
            let budgetAmount = 0;

            if (detailText.includes('固定報酬制')) {
              budgetType = 'fixed';
            } else if (detailText.includes('時間単価制')) {
              budgetType = 'hourly';
            }

            if (budget) {
              const amountStr = budget.replace(/[^0-9]/g, '');
              budgetAmount = parseInt(amountStr) || 0;
            }

            // タグ/スキルの取得
            const tags: string[] = [];
            if (detailText) {
              const skillMatches = detailText.match(/([a-zA-Z]+|[ァ-ヶー]+[\w]*)/g);
              if (skillMatches) {
                skillMatches.forEach(skill => {
                  if (skill.length > 2 && skill.length < 20) {
                    tags.push(skill);
                  }
                });
              }
            }

            // 投稿日時の取得
            let postedAt = new Date().toISOString().split('T')[0];
            const dateMatch = detailText.match(/(\d{4}年\d{2}月\d{2}日|\d{2}月\d{2}日)/);
            if (dateMatch) {
              postedAt = dateMatch[0];
            }

            // 応募者数と期限の取得
            let applicants = 0;
            let deadline = '';

            const contractMatch = detailText.match(/契約数[^\d]*(\d+)/);
            if (contractMatch) {
              applicants = parseInt(contractMatch[1] ?? '0') || 0;
            }

            const deadlineMatch = detailText.match(/あと(\d+)日|(\d+月\d+日)/);
            if (deadlineMatch) {
              deadline = deadlineMatch[0] ?? '';
            }

            jobs.push({
              id: jobId,
              title: title,
              description: detailText.substring(0, 500),
              url: url,
              budget: {
                type: budgetType,
                amount: budgetAmount,
                currency: 'JPY'
              },
              category: params.categoryName,
              tags: tags.slice(0, 10),
              client: {
                name: '匿名',
                rating: 0,
                reviewCount: 0
              },
              postedAt: postedAt,
              deadline: deadline,
              applicants: applicants,
              scrapedAt: new Date().toISOString()
            });
            console.log(`✅ 案件抽出成功: ${title} (${jobId}) - ${budget}`);
          }
        } catch (itemError) {
          console.log(`❌ 案件 ${i} の処理中にエラー:`, itemError);
          continue;
        }
      }

      console.log(`📊 合計 ${jobs.length} 件の案件を抽出しました`);
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

    // 新着順ソートを設定 - URLパラメータで直接指定
    console.log('🔄 新着順ソート設定中...');
    try {
      const currentUrl = page.url();
      const newUrl = currentUrl.includes('?')
        ? `${currentUrl}&order=new`
        : `${currentUrl}?order=new`;

      await page.goto(newUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log(`✅ 新着順URL直接アクセス: ${newUrl}`);
    } catch (sortError) {
      console.log('⚠️ 新着順ソート設定失敗、デフォルト順序で続行');
    }

    // 案件一覧の要素が読み込まれるまで待機
    console.log('⏳ 案件一覧読み込み待機中...');
    try {
      // 実際のDOM構造に基づいた待機
      await page.waitForSelector('main list listitem', { timeout: 10000 });
      console.log('✅ 案件一覧要素の読み込み確認');
    } catch (error) {
      console.log('⚠️ 標準的な案件一覧要素待機失敗、他のセレクターを試行');
      // フォールバック：一般的なリスト要素を待機
      try {
        await page.waitForSelector('ul li, ol li', { timeout: 5000 });
        console.log('✅ 代替案件一覧要素の読み込み確認');
      } catch (fallbackError) {
        console.log('⚠️ 案件一覧要素が見つかりません、DOM構造を直接解析します');
      }
    }

    // 案件要素を取得
    console.log('📝 案件データ抽出中...');
    const jobs: CrowdWorksJob[] = await page.evaluate((params: { maxJobsLimit: number; categoryName: string; scrapedIds: string[] }) => {
      console.log('🔍 DOM解析開始...');

      // 直接案件リンクから抽出（デバッグで成功した方式）
      const doc = (globalThis as any).document;
      const jobLinks = doc.querySelectorAll('a[href*="/public/jobs/"]');
      console.log(`🔗 案件リンク数: ${jobLinks.length}`);

      if (jobLinks.length === 0) {
        console.log('❌ 案件リンクが見つかりません');
        return [];
      }

      // 案件詳細ページのリンクのみを対象にする（一覧ページや他のリンクを除外）
      const validJobLinks: any[] = [];
      for (let i = 0; i < jobLinks.length; i++) {
        const link = jobLinks[i];
        const href = link.getAttribute('href') || '';

        // 案件詳細ページのパターンをチェック
        if (href.match(/\/public\/jobs\/\d+$/) && !href.includes('category') && !href.includes('group')) {
          validJobLinks.push(link);
        }
      }

      console.log(`✅ 有効な案件リンク数: ${validJobLinks.length}`);

      // 最初の数件のみを安全に抽出
      const safeLimit = Math.min(validJobLinks.length, params.maxJobsLimit);
      const jobs: any[] = [];

      for (let i = 0; i < safeLimit; i++) {
        try {
          const link = validJobLinks[i];
          const href = link.getAttribute('href') || '';
          const title = link.textContent?.trim() || '';
          const url = href.startsWith('http') ? href : `https://crowdworks.jp${href}`;

          // 案件IDをURLから抽出
          const jobIdMatch = url.match(/\/public\/jobs\/(\d+)/);
          const jobId = jobIdMatch ? (jobIdMatch[1] ?? `unknown_${i}`) : `unknown_${i}`;

          if (title && url && jobId !== `unknown_${i}`) {
            // 重複チェック
            if (params.scrapedIds.includes(jobId)) {
              console.log(`⏭️ スキップ: 重複案件 ${jobId}`);
              continue;
            }

            // 親要素から追加情報を取得
            let parentElement = link.parentElement;
            let detailText = '';
            let budget = '';

            // 最大5階層まで親要素を辿る
            for (let depth = 0; depth < 5 && parentElement; depth++) {
              const parentText = parentElement.textContent || '';
              if (parentText.includes('円') && !budget) {
                // 予算情報を抽出
                const budgetMatch = parentText.match(/(\d{1,3}(?:,\d{3})*)\s*円/);
                if (budgetMatch) {
                  budget = budgetMatch[0];
                }
              }

              if (parentText.length > detailText.length && parentText.length < 1000) {
                detailText = parentText;
              }

              parentElement = parentElement.parentElement;
            }

            // 予算タイプの判定
            let budgetType: 'fixed' | 'hourly' | 'unknown' = 'unknown';
            let budgetAmount = 0;

            if (detailText.includes('固定報酬制')) {
              budgetType = 'fixed';
            } else if (detailText.includes('時間単価制')) {
              budgetType = 'hourly';
            }

            if (budget) {
              const amountStr = budget.replace(/[^0-9]/g, '');
              budgetAmount = parseInt(amountStr) || 0;
            }

            // タグ/スキルの取得
            const tags: string[] = [];
            if (detailText) {
              const skillMatches = detailText.match(/([a-zA-Z]+|[ァ-ヶー]+[\w]*)/g);
              if (skillMatches) {
                skillMatches.forEach(skill => {
                  if (skill.length > 2 && skill.length < 20) {
                    tags.push(skill);
                  }
                });
              }
            }

            // 投稿日時の取得
            let postedAt = new Date().toISOString().split('T')[0];
            const dateMatch = detailText.match(/(\d{4}年\d{2}月\d{2}日|\d{2}月\d{2}日)/);
            if (dateMatch) {
              postedAt = dateMatch[0];
            }

            // 応募者数と期限の取得
            let applicants = 0;
            let deadline = '';

            const contractMatch = detailText.match(/契約数[^\d]*(\d+)/);
            if (contractMatch) {
              applicants = parseInt(contractMatch[1] ?? '0') || 0;
            }

            const deadlineMatch = detailText.match(/あと(\d+)日|(\d+月\d+日)/);
            if (deadlineMatch) {
              deadline = deadlineMatch[0] ?? '';
            }

            jobs.push({
              id: jobId,
              title: title,
              description: detailText.substring(0, 500),
              url: url,
              budget: {
                type: budgetType,
                amount: budgetAmount,
                currency: 'JPY'
              },
              category: params.categoryName,
              tags: tags.slice(0, 10),
              client: {
                name: '匿名',
                rating: 0,
                reviewCount: 0
              },
              postedAt: postedAt,
              deadline: deadline,
              applicants: applicants,
              scrapedAt: new Date().toISOString()
            });
            console.log(`✅ 案件抽出成功: ${title} (${jobId}) - ${budget}`);
          }
        } catch (itemError) {
          console.log(`❌ 案件 ${i} の処理中にエラー:`, itemError);
          continue;
        }
      }

      console.log(`📊 合計 ${jobs.length} 件の案件を抽出しました`);
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

    console.log('✅ ブラウザ準備完了！カテゴリスクレイピング開始...');

    // 指定カテゴリをスクレイピング（ECとWeb制作）
    const categories = ['ec', 'web_products'];
    const results: { [category: string]: ScrapingResult } = {};

    for (const category of categories) {
      console.log(`\n📂 カテゴリ「${category}」処理開始...`);

      try {
        // 実装済みのカテゴリ別スクレイピング関数を使用
        const categoryResult = await scrapeCrowdWorksJobsByCategory(page, category, 20);
        results[category] = categoryResult;

        console.log(`📊 カテゴリ「${category}」完了: ${categoryResult.success ? '✅' : '❌'} (${categoryResult.jobsFound}件)`);

        if (categoryResult.success && categoryResult.jobs.length > 0) {
          const sampleJob = categoryResult.jobs[0]!; // 長さチェック済みなので安全
          console.log(`📝 サンプル案件: ${sampleJob.title}`);
        }

        // 次のカテゴリ処理前に少し待機
        await page.waitForTimeout(2000);

      } catch (categoryError) {
        console.error(`❌ カテゴリ「${category}」処理エラー:`, categoryError);
        results[category] = {
          success: false,
          jobsFound: 0,
          jobs: [],
          error: categoryError instanceof Error ? categoryError.message : String(categoryError),
          executionTime: 0
        };
      }
    }

    await context.close();

    const executionTime = Date.now() - startTime;

    // 結果サマリー
    const totalJobs = Object.values(results).reduce((sum, result) => sum + result.jobsFound, 0);
    const successCount = Object.values(results).filter(result => result.success).length;

    console.log(`\n🎉 カテゴリスクレイピングテスト完了:`);
    console.log(`   📊 処理カテゴリ数: ${categories.length}`);
    console.log(`   ✅ 成功カテゴリ数: ${successCount}`);
    console.log(`   📝 総取得案件数: ${totalJobs}件`);
    console.log(`   ⏱️ 総実行時間: ${executionTime}ms`);

    return {
      success: successCount > 0,
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

    // テキストベースでの情報抽出
    const pageText = doc.body?.textContent || '';

    // 支払い・予算情報を抽出
    let paymentType = '';
    let budget = '';

    const fixedPaymentMatch = pageText.match(/固定報酬制\s*([0-9,]+円\s*〜\s*[0-9,]+円|[0-9,]+円)/);
    if (fixedPaymentMatch) {
      paymentType = '固定報酬制';
      budget = fixedPaymentMatch[1];
    } else {
      const hourlyPaymentMatch = pageText.match(/時間単価制\s*([0-9,]+円\/時間\s*〜\s*[0-9,]+円\/時間|[0-9,]+円\/時間)/);
      if (hourlyPaymentMatch) {
        paymentType = '時間単価制';
        budget = hourlyPaymentMatch[1];
      }
    }

    // 日付情報を抽出
    let postDate = '';
    let applicationDeadline = '';
    let deliveryDate = '';

    const postDateMatch = pageText.match(/掲載日\s*(\d{4}年\d{2}月\d{2}日)/);
    if (postDateMatch) {
      postDate = postDateMatch[1];
    }

    const deadlineMatch = pageText.match(/応募期限\s*(\d{4}年\d{2}月\d{2}日)/);
    if (deadlineMatch) {
      applicationDeadline = deadlineMatch[1];
    }

    const deliveryMatch = pageText.match(/納品希望日\s*([^\s]+)/);
    if (deliveryMatch && deliveryMatch[1] !== '-') {
      deliveryDate = deliveryMatch[1];
    }

    // 応募状況情報を抽出
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

    // クライアント情報を抽出
    const clientLinkElement = doc.querySelector('a[href*="/public/employers/"]');
    let clientName = clientLinkElement?.textContent?.trim() || '匿名';

    // anke7562のようなクライアント名も抽出
    if (clientName === '匿名' || !clientName) {
      const clientNameMatch = pageText.match(/anke\d+|[a-zA-Z0-9_]+(?=\s*本人確認)/);
      if (clientNameMatch) {
        clientName = clientNameMatch[0];
      }
    }

    // 評価情報を抽出
    let overallRating = '';
    let orderHistory = '';
    let completionRate = '';

    const ratingMatch = pageText.match(/総合評価\s*"?(\d+\.\d+)"?|"(\d+\.\d+)"/);
    if (ratingMatch) overallRating = ratingMatch[1] || ratingMatch[2];

    const historyMatch = pageText.match(/募集実績\s*"?(\d+)"?\s*件|"(\d+)"\s*件/);
    if (historyMatch) orderHistory = (historyMatch[1] || historyMatch[2]) + '件';

    const completionMatch = pageText.match(/プロジェクト完了率\s*"?(\d+)"?\s*%|"(\d+)"\s*%/);
    if (completionMatch) completionRate = (completionMatch[1] || completionMatch[2]) + '%';

    // 本人確認状態
    let identityVerified = false;
    if (pageText.includes('本人確認済み') || !pageText.includes('本人確認未提出')) {
      identityVerified = true;
    }

    // 詳細説明を取得（最も長いテーブルセルから）
    let detailedDescription = '';
    const allCells = doc.querySelectorAll('td');
    let maxLength = 0;

    allCells.forEach((cell: any) => {
      const text = cell.textContent?.trim() || '';
      if (text.length > maxLength && text.length > 200 && text.includes('概要')) {
        detailedDescription = text;
        maxLength = text.length;
      }
    });

    // フォールバック：概要が見つからない場合は最も長いセルを取得
    if (!detailedDescription) {
      maxLength = 0;
      allCells.forEach((cell: any) => {
        const text = cell.textContent?.trim() || '';
        if (text.length > maxLength && text.length > 100) {
          detailedDescription = text;
          maxLength = text.length;
        }
      });
    }

    // 最近の応募者情報を取得
    const recentApplicants: Array<{
      name: string;
      applicationDate: string;
    }> = [];

    // テーブルから応募者情報を取得
    const tables = doc.querySelectorAll('table');
    for (let i = tables.length - 1; i >= 0; i--) {
      const table = tables[i];
      const rows = table.querySelectorAll('tbody tr');

      rows.forEach((row: any) => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const nameCell = cells[0];
          const dateCell = cells[1];

          const nameLink = nameCell.querySelector('a');
          const name = nameLink?.textContent?.trim() || nameCell.textContent?.trim() || '';
          const applicationDate = dateCell.textContent?.trim() || '';

          // 有効な応募者データかチェック
          if (name &&
            applicationDate &&
            applicationDate.includes('/') &&
            !name.includes('クラウドワーカー') &&
            name.length < 50) {
            recentApplicants.push({
              name,
              applicationDate
            });
          }
        }
      });

      // 応募者が見つかったらループを終了
      if (recentApplicants.length > 0) {
        break;
      }
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
    console.log(`🔍 カテゴリ「${params.category}」の案件と詳細スクレイピング開始...`);

    // Browserインスタンス作成
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // 案件一覧を取得
    const scrapingResult = await scrapeCrowdWorksJobsByCategory(page, params.category, params.maxJobs);

    if (!scrapingResult.success || scrapingResult.jobs.length === 0) {
      return {
        jobs: [],
        jobDetails: []
      };
    }

    const jobs = scrapingResult.jobs;
    const jobDetails: CrowdWorksJobDetail[] = [];

    // 詳細取得する案件数を決定
    const maxDetailsCount = params.maxDetails ?? 3;
    const detailTargets = jobs.slice(0, maxDetailsCount);

    console.log(`📋 ${jobs.length} 件の案件から ${detailTargets.length} 件の詳細を取得します`);

    // 各案件の詳細を取得
    for (let i = 0; i < detailTargets.length; i++) {
      const job = detailTargets[i]!; // slice結果なので必ず存在
      try {
        console.log(`📄 案件詳細取得中 (${i + 1}/${detailTargets.length}): ${job.title}`);
        const detail = await scrapeCrowdWorksJobDetail(page, job.url);
        jobDetails.push(detail);

        // リクエスト間隔を空ける
        if (i < detailTargets.length - 1) {
          await page.waitForTimeout(2000);
        }
      } catch (error) {
        console.log(`❌ 案件詳細取得エラー: ${job.title}`, error);
        continue;
      }
    }

    console.log(`🎉 カテゴリ「${params.category}」スクレイピング完了: ${jobs.length}件の案件, ${jobDetails.length}件の詳細`);

    return {
      jobs,
      jobDetails
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ カテゴリ詳細スクレイピングエラー:`, errorMessage);

    return {
      jobs: [],
      jobDetails: []
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Lambda関数のメインハンドラー
 * EventBridgeからのスケジュール実行を処理
 */
export const lambdaHandler = async (
  event: ScheduledExecutionEvent,
  _context: Context
): Promise<ScheduledExecutionResponse> => {
  const startTime = Date.now();

  try {
    console.log('🚀 CrowdWorksスクレイピング Lambda実行開始');
    console.log('📋 イベント:', JSON.stringify(event, null, 2));

    // メイン処理: カテゴリ別スクレイピング実行
    const result = await testCrowdWorksCategories();

    const executionTime = Date.now() - startTime;

    if (result.success) {
      const summary = Object.entries(result.results || {}).map(([category, categoryResult]) =>
        `${category}: ${categoryResult.jobsFound}件`
      ).join(', ');

      const response: ScheduledExecutionResponse = {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: `CrowdWorksカテゴリスクレイピング完了 - ${summary}`,
          executionTime,
          timestamp: new Date().toISOString(),
          results: result.results
        }),
        executionTime,
        timestamp: new Date().toISOString()
      };

      console.log('✅ Lambda実行完了');
      console.log(`📊 実行時間: ${executionTime}ms`);
      return response;
    } else {
      const response: ScheduledExecutionResponse = {
        statusCode: 500,
        body: JSON.stringify({
          success: false,
          error: result.error || 'スクレイピング処理に失敗しました',
          executionTime,
          timestamp: new Date().toISOString()
        }),
        executionTime,
        timestamp: new Date().toISOString()
      };

      console.error('❌ Lambda実行エラー:', result.error);
      return response;
    }

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    const response: ScheduledExecutionResponse = {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: errorMessage,
        executionTime,
        timestamp: new Date().toISOString()
      }),
      executionTime,
      timestamp: new Date().toISOString()
    };

    console.error('❌ Lambda実行中の予期しないエラー:', errorMessage);
    return response;
  }
};

// API Gateway用ハンドラー（互換性維持）
export const handler = lambdaHandler;

/**
 * ログインしてカテゴリから案件詳細を取得・保存する完全ワークフロー
 */
export async function loginAndScrapeCategories(params: {
  categories: string[];  // 'ec', 'web_products'など
  maxJobsPerCategory: number;
  maxDetailsPerCategory: number;
  saveToFile?: boolean;
}): Promise<{
  success: boolean;
  loginResult?: LoginResult;
  categoryResults?: { [category: string]: ScrapingResult };
  detailResults?: { [category: string]: CrowdWorksJobDetail[] };
  savedFiles?: string[] | undefined;
  error?: string;
  executionTime: number;
}> {
  const startTime = Date.now();
  let browser: Browser | null = null;

  try {
    console.log('🚀 CrowdWorks完全ワークフロー開始...');
    console.log(`📋 対象カテゴリ: ${params.categories.join(', ')}`);
    console.log(`📊 カテゴリ毎最大案件数: ${params.maxJobsPerCategory}`);
    console.log(`📄 カテゴリ毎最大詳細数: ${params.maxDetailsPerCategory}`);

    // 1. ブラウザ起動
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
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // 2. ログイン実行
    console.log('🔐 CrowdWorksログイン開始...');
    const credentials = await getCrowdWorksCredentials();
    const loginResult = await loginToCrowdWorks(page, credentials);

    if (!loginResult.success) {
      throw new Error(`ログイン失敗: ${loginResult.error}`);
    }

    console.log('✅ ログイン成功');

    // 3. 各カテゴリで案件取得
    const categoryResults: { [category: string]: ScrapingResult } = {};
    const detailResults: { [category: string]: CrowdWorksJobDetail[] } = {};
    const savedFiles: string[] = [];

    for (const category of params.categories) {
      console.log(`\n📂 カテゴリ「${category}」処理開始...`);

      try {
        // カテゴリの案件一覧を取得
        const categoryResult = await scrapeCrowdWorksJobsByCategory(
          page,
          category,
          params.maxJobsPerCategory
        );

        if (!categoryResult.success) {
          console.log(`❌ カテゴリ「${category}」案件取得失敗: ${categoryResult.error}`);
          continue;
        }

        categoryResults[category] = categoryResult;
        console.log(`✅ カテゴリ「${category}」: ${categoryResult.jobsFound}件の案件を取得`);

        // 詳細情報を取得する案件を選択
        const detailTargets = categoryResult.jobs.slice(0, params.maxDetailsPerCategory);
        const categoryDetails: CrowdWorksJobDetail[] = [];

        console.log(`📄 詳細取得対象: ${detailTargets.length}件`);

        // 各案件の詳細を取得
        for (let i = 0; i < detailTargets.length; i++) {
          const job = detailTargets[i]!;
          try {
            console.log(`📄 詳細取得中 (${i + 1}/${detailTargets.length}): ${job.title}`);
            const detail = await scrapeCrowdWorksJobDetail(page, job.url);
            categoryDetails.push(detail);

            // リクエスト間隔を空ける
            if (i < detailTargets.length - 1) {
              await page.waitForTimeout(2000);
            }
          } catch (error) {
            console.log(`❌ 案件詳細取得エラー: ${job.title}`, error);
            continue;
          }
        }

        detailResults[category] = categoryDetails;
        console.log(`✅ カテゴリ「${category}」詳細取得完了: ${categoryDetails.length}件`);

        // ファイル保存（オプション）
        if (params.saveToFile) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

          // 案件一覧保存
          const jobsFileName = `/tmp/crowdworks-${category}-jobs-${timestamp}.json`;
          const jobsData = {
            category,
            scrapedAt: new Date().toISOString(),
            totalJobs: categoryResult.jobsFound,
            jobs: categoryResult.jobs
          };

          try {
            await writeFileAsync(jobsFileName, JSON.stringify(jobsData, null, 2));
            savedFiles.push(jobsFileName);
            console.log(`💾 案件一覧保存: ${jobsFileName}`);
          } catch (saveError) {
            console.log(`❌ 案件一覧保存エラー: ${saveError}`);
          }

          // 詳細情報保存
          if (categoryDetails.length > 0) {
            const detailsFileName = `/tmp/crowdworks-${category}-details-${timestamp}.json`;
            const detailsData = {
              category,
              scrapedAt: new Date().toISOString(),
              totalDetails: categoryDetails.length,
              details: categoryDetails
            };

            try {
              await writeFileAsync(detailsFileName, JSON.stringify(detailsData, null, 2));
              savedFiles.push(detailsFileName);
              console.log(`💾 詳細情報保存: ${detailsFileName}`);
            } catch (saveError) {
              console.log(`❌ 詳細情報保存エラー: ${saveError}`);
            }
          }
        }

      } catch (categoryError) {
        console.log(`❌ カテゴリ「${category}」処理エラー:`, categoryError);
        continue;
      }
    }

    await context.close();

    const executionTime = Date.now() - startTime;
    console.log(`\n🎯 完全ワークフロー完了 (${executionTime}ms)`);
    console.log(`📊 処理結果サマリー:`);
    console.log(`  - 処理カテゴリ数: ${Object.keys(categoryResults).length}/${params.categories.length}`);
    console.log(`  - 総案件数: ${Object.values(categoryResults).reduce((sum, result) => sum + result.jobsFound, 0)}`);
    console.log(`  - 総詳細数: ${Object.values(detailResults).reduce((sum, details) => sum + details.length, 0)}`);
    console.log(`  - 保存ファイル数: ${savedFiles.length}`);

    return {
      success: true,
      loginResult,
      categoryResults,
      detailResults,
      savedFiles: savedFiles.length > 0 ? savedFiles : undefined,
      executionTime
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ 完全ワークフロー失敗:', errorMessage);

    return {
      success: false,
      error: errorMessage,
      executionTime
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('🔒 ブラウザクリーンアップ完了');
      } catch (closeError) {
        console.warn('⚠️ ブラウザクローズエラー:', closeError);
      }
    }
  }
}

// ファイル書き込み用のヘルパー関数
async function writeFileAsync(filePath: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fs = require('fs');
    fs.writeFile(filePath, data, (err: any) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * ログインなしでカテゴリから案件を取得するテスト（認証問題回避版）
 */
export async function testCategoryScrapingWithoutLogin(params: {
  categories: string[];
  maxJobsPerCategory: number;
  saveToFile?: boolean;
}): Promise<{
  success: boolean;
  categoryResults?: { [category: string]: ScrapingResult };
  savedFiles?: string[];
  error?: string;
  executionTime: number;
}> {
  const startTime = Date.now();
  let browser: Browser | null = null;

  try {
    console.log('🚀 ログインなしカテゴリスクレイピングテスト開始...');
    console.log(`📋 対象カテゴリ: ${params.categories.join(', ')}`);
    console.log(`📊 カテゴリ毎最大案件数: ${params.maxJobsPerCategory}`);

    // 1. ブラウザ起動
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--disable-software-rasterizer'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // 2. 各カテゴリで案件取得（ログインなし）
    const categoryResults: { [category: string]: ScrapingResult } = {};
    const savedFiles: string[] = [];

    for (const category of params.categories) {
      console.log(`\n📂 カテゴリ「${category}」処理開始...`);

      try {
        // カテゴリの案件一覧を取得（ログインなし）
        const categoryResult = await scrapeCrowdWorksJobsByCategory(
          page,
          category,
          params.maxJobsPerCategory
        );

        if (!categoryResult.success) {
          console.log(`❌ カテゴリ「${category}」案件取得失敗: ${categoryResult.error}`);
          continue;
        }

        categoryResults[category] = categoryResult;
        console.log(`✅ カテゴリ「${category}」: ${categoryResult.jobsFound}件の案件を取得`);

        // ファイル保存（オプション）
        if (params.saveToFile) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

          // 案件一覧保存
          const jobsFileName = `./crowdworks-${category}-jobs-${timestamp}.json`;
          const jobsData = {
            category,
            scrapedAt: new Date().toISOString(),
            totalJobs: categoryResult.jobsFound,
            jobs: categoryResult.jobs
          };

          try {
            await writeFileAsync(jobsFileName, JSON.stringify(jobsData, null, 2));
            savedFiles.push(jobsFileName);
            console.log(`💾 案件一覧保存: ${jobsFileName}`);
          } catch (saveError) {
            console.log(`❌ 案件一覧保存エラー: ${saveError}`);
          }
        }

      } catch (categoryError) {
        console.log(`❌ カテゴリ「${category}」処理エラー:`, categoryError);
        continue;
      }
    }

    await context.close();

    const executionTime = Date.now() - startTime;
    console.log(`\n🎯 ログインなしスクレイピング完了 (${executionTime}ms)`);
    console.log(`📊 処理結果サマリー:`);
    console.log(`  - 処理カテゴリ数: ${Object.keys(categoryResults).length}/${params.categories.length}`);
    console.log(`  - 総案件数: ${Object.values(categoryResults).reduce((sum, result) => sum + result.jobsFound, 0)}`);
    console.log(`  - 保存ファイル数: ${savedFiles.length}`);

    return {
      success: true,
      categoryResults,
      ...(savedFiles.length > 0 ? { savedFiles } : {}),
      executionTime
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ ログインなしスクレイピング失敗:', errorMessage);

    return {
      success: false,
      error: errorMessage,
      executionTime
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('🔒 ブラウザクリーンアップ完了');
      } catch (closeError) {
        console.warn('⚠️ ブラウザクローズエラー:', closeError);
      }
    }
  }
}

/**
 * ブラウザ終了の原因を調査するためのデバッグ版テスト
 */
export async function debugBrowserLifecycle(): Promise<{
  success: boolean;
  steps: string[];
  error?: string;
  executionTime: number;
}> {
  const startTime = Date.now();
  const steps: string[] = [];
  let browser: Browser | null = null;

  try {
    steps.push('🚀 デバッグテスト開始');
    console.log('🚀 ブラウザライフサイクルデバッグテスト開始...');

    // ブラウザ起動前の状態確認
    steps.push('📊 システム状態確認');
    console.log('📊 システム状態確認中...');

    // ブラウザ起動
    steps.push('🌐 ブラウザ起動開始');
    console.log('🌐 ブラウザ起動中...');

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer'
      ]
    });

    steps.push('✅ ブラウザ起動完了');
    console.log('✅ ブラウザ起動完了');

    // ブラウザ終了イベントをリッスン
    browser.on('disconnected', () => {
      steps.push('⚠️ ブラウザ予期しない切断検出');
      console.log('⚠️ ブラウザが予期せず切断されました');
    });

    // コンテキスト作成
    steps.push('📄 コンテキスト作成開始');
    console.log('📄 コンテキスト作成中...');

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    });

    steps.push('✅ コンテキスト作成完了');
    console.log('✅ コンテキスト作成完了');

    // ページ作成
    steps.push('📋 ページ作成開始');
    console.log('📋 ページ作成中...');

    const page = await context.newPage();

    steps.push('✅ ページ作成完了');
    console.log('✅ ページ作成完了');

    // ページ終了イベントをリッスン
    page.on('close', () => {
      steps.push('⚠️ ページ予期しない終了検出');
      console.log('⚠️ ページが予期せず終了されました');
    });

    // シンプルなページアクセステスト
    steps.push('🌍 Google アクセステスト開始');
    console.log('🌍 Google アクセステスト開始...');

    await page.goto('https://www.google.com', {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    steps.push('✅ Google アクセス完了');
    console.log('✅ Google アクセス完了');

    // タイトル取得
    steps.push('📋 タイトル取得開始');
    const title = await page.title();
    steps.push(`✅ タイトル取得完了: ${title}`);
    console.log(`✅ タイトル取得完了: ${title}`);

    // 待機テスト
    steps.push('⏳ 2秒待機テスト開始');
    console.log('⏳ 2秒待機テスト開始...');
    await page.waitForTimeout(2000);
    steps.push('✅ 2秒待機完了');
    console.log('✅ 2秒待機完了');

    // CrowdWorksページアクセステスト
    steps.push('🎯 CrowdWorksトップページアクセス開始');
    console.log('🎯 CrowdWorksトップページアクセス開始...');

    await page.goto('https://crowdworks.jp', {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });

    steps.push('✅ CrowdWorksトップページアクセス完了');
    console.log('✅ CrowdWorksトップページアクセス完了');

    const cwTitle = await page.title();
    steps.push(`📋 CrowdWorksタイトル: ${cwTitle}`);
    console.log(`📋 CrowdWorksタイトル: ${cwTitle}`);

    // クリーンアップ
    steps.push('🧹 コンテキスト終了開始');
    console.log('🧹 コンテキスト終了開始...');
    await context.close();
    steps.push('✅ コンテキスト終了完了');
    console.log('✅ コンテキスト終了完了');

    const executionTime = Date.now() - startTime;
    steps.push(`🎉 デバッグテスト完了 (${executionTime}ms)`);
    console.log(`🎉 デバッグテスト完了 (${executionTime}ms)`);

    return {
      success: true,
      steps,
      executionTime
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    steps.push(`❌ エラー発生: ${errorMessage}`);
    console.error('❌ デバッグテストでエラー:', errorMessage);

    return {
      success: false,
      steps,
      error: errorMessage,
      executionTime
    };
  } finally {
    if (browser) {
      try {
        steps.push('🔒 ブラウザ終了開始');
        console.log('🔒 ブラウザ終了開始...');
        await browser.close();
        steps.push('✅ ブラウザ終了完了');
        console.log('✅ ブラウザ終了完了');
      } catch (closeError) {
        steps.push(`⚠️ ブラウザ終了エラー: ${closeError}`);
        console.warn('⚠️ ブラウザ終了エラー:', closeError);
      }
    }
  }
}

/**
 * カテゴリ別CrowdWorks案件スクレイピング実行（デバッグ版）
 */
async function scrapeCrowdWorksJobsByCategoryDebug(
  page: Page,
  category: string,
  maxJobs: number = 20
): Promise<ScrapingResult> {
  const startTime = Date.now();

  try {
    console.log(`🔍 カテゴリ「${category}」の案件スクレイピング開始...`);

    // ページ状態の事前確認
    console.log('📊 ページ状態確認中...');
    const isConnected = page.isClosed();
    console.log(`📋 ページ状態: ${isConnected ? '閉じている' : '開いている'}`);

    if (isConnected) {
      throw new Error('ページが既に閉じられています');
    }

    // カテゴリページのURL構築
    const categoryUrl = `https://crowdworks.jp/public/jobs/group/${category}`;
    console.log(`📄 カテゴリページアクセス: ${categoryUrl}`);

    // ナビゲーション前のページ状態確認
    console.log('🌐 ナビゲーション前状態確認...');
    console.log(`📋 現在のURL: ${page.url()}`);

    await page.goto(categoryUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('✅ カテゴリページ読み込み完了');

    // ページタイトル確認
    const pageTitle = await page.title();
    console.log(`📋 ページタイトル: "${pageTitle}"`);

    // 新着順ソートを設定 - URLパラメータで直接指定
    console.log('🔄 新着順ソート設定中...');
    try {
      const currentUrl = page.url();
      const newUrl = currentUrl.includes('?')
        ? `${currentUrl}&order=new`
        : `${currentUrl}?order=new`;

      await page.goto(newUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log(`✅ 新着順URL直接アクセス: ${newUrl}`);
    } catch (sortError) {
      console.log('⚠️ 新着順ソート設定失敗、デフォルト順序で続行');
    }

    // DOM構造を確認
    console.log('🔍 DOM構造確認中...');
    const domInfo = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      return {
        listCount: doc.querySelectorAll('list').length,
        listitemCount: doc.querySelectorAll('listitem').length,
        ulCount: doc.querySelectorAll('ul').length,
        liCount: doc.querySelectorAll('li').length,
        jobLinksCount: doc.querySelectorAll('a[href*="/public/jobs/"]').length,
        hasMainElement: !!doc.querySelector('main')
      };
    });
    console.log('📊 DOM構造:', JSON.stringify(domInfo, null, 2));

    // 案件一覧の要素が読み込まれるまで待機
    console.log('⏳ 案件一覧読み込み待機中...');
    try {
      // 実際のDOM構造に基づいた待機
      await page.waitForSelector('main list listitem', { timeout: 10000 });
      console.log('✅ 案件一覧要素の読み込み確認');
    } catch (error) {
      console.log('⚠️ 標準的な案件一覧要素待機失敗、他のセレクターを試行');
      // フォールバック：一般的なリスト要素を待機
      try {
        await page.waitForSelector('ul li, ol li', { timeout: 5000 });
        console.log('✅ 代替案件一覧要素の読み込み確認');
      } catch (fallbackError) {
        console.log('⚠️ 案件一覧要素が見つかりません、DOM構造を直接解析します');
      }
    }

    // より安全なevaluate実行
    console.log('📝 案件データ抽出中...');

    // ページ状態の再確認
    console.log('📊 データ抽出前ページ状態確認...');
    const isStillConnected = page.isClosed();
    console.log(`📋 ページ状態: ${isStillConnected ? '閉じている' : '開いている'}`);

    if (isStillConnected) {
      throw new Error('データ抽出前にページが閉じられました');
    }

    const jobs: CrowdWorksJob[] = await page.evaluate((params: { maxJobsLimit: number; categoryName: string; scrapedIds: string[] }) => {
      console.log('🔍 DOM解析開始...');

      // 直接案件リンクから抽出（デバッグで成功した方式）
      const doc = (globalThis as any).document;
      const jobLinks = doc.querySelectorAll('a[href*="/public/jobs/"]');
      console.log(`🔗 案件リンク数: ${jobLinks.length}`);

      if (jobLinks.length === 0) {
        console.log('❌ 案件リンクが見つかりません');
        return [];
      }

      // 案件詳細ページのリンクのみを対象にする（一覧ページや他のリンクを除外）
      const validJobLinks: any[] = [];
      for (let i = 0; i < jobLinks.length; i++) {
        const link = jobLinks[i];
        const href = link.getAttribute('href') || '';

        // 案件詳細ページのパターンをチェック
        if (href.match(/\/public\/jobs\/\d+$/) && !href.includes('category') && !href.includes('group')) {
          validJobLinks.push(link);
        }
      }

      console.log(`✅ 有効な案件リンク数: ${validJobLinks.length}`);

      // 最初の数件のみを安全に抽出
      const safeLimit = Math.min(validJobLinks.length, params.maxJobsLimit);
      const jobs: any[] = [];

      for (let i = 0; i < safeLimit; i++) {
        try {
          const link = validJobLinks[i];
          const href = link.getAttribute('href') || '';
          const title = link.textContent?.trim() || '';
          const url = href.startsWith('http') ? href : `https://crowdworks.jp${href}`;

          // 案件IDをURLから抽出
          const jobIdMatch = url.match(/\/public\/jobs\/(\d+)/);
          const jobId = jobIdMatch ? (jobIdMatch[1] ?? `unknown_${i}`) : `unknown_${i}`;

          if (title && url && jobId !== `unknown_${i}`) {
            // 重複チェック
            if (params.scrapedIds.includes(jobId)) {
              console.log(`⏭️ スキップ: 重複案件 ${jobId}`);
              continue;
            }

            // 親要素から追加情報を取得
            let parentElement = link.parentElement;
            let detailText = '';
            let budget = '';

            // 最大5階層まで親要素を辿る
            for (let depth = 0; depth < 5 && parentElement; depth++) {
              const parentText = parentElement.textContent || '';
              if (parentText.includes('円') && !budget) {
                // 予算情報を抽出
                const budgetMatch = parentText.match(/(\d{1,3}(?:,\d{3})*)\s*円/);
                if (budgetMatch) {
                  budget = budgetMatch[0];
                }
              }

              if (parentText.length > detailText.length && parentText.length < 1000) {
                detailText = parentText;
              }

              parentElement = parentElement.parentElement;
            }

            // 予算タイプの判定
            let budgetType: 'fixed' | 'hourly' | 'unknown' = 'unknown';
            let budgetAmount = 0;

            if (detailText.includes('固定報酬制')) {
              budgetType = 'fixed';
            } else if (detailText.includes('時間単価制')) {
              budgetType = 'hourly';
            }

            if (budget) {
              const amountStr = budget.replace(/[^0-9]/g, '');
              budgetAmount = parseInt(amountStr) || 0;
            }

            // タグ/スキルの取得
            const tags: string[] = [];
            if (detailText) {
              const skillMatches = detailText.match(/([a-zA-Z]+|[ァ-ヶー]+[\w]*)/g);
              if (skillMatches) {
                skillMatches.forEach(skill => {
                  if (skill.length > 2 && skill.length < 20) {
                    tags.push(skill);
                  }
                });
              }
            }

            // 投稿日時の取得
            let postedAt = new Date().toISOString().split('T')[0];
            const dateMatch = detailText.match(/(\d{4}年\d{2}月\d{2}日|\d{2}月\d{2}日)/);
            if (dateMatch) {
              postedAt = dateMatch[0];
            }

            // 応募者数と期限の取得
            let applicants = 0;
            let deadline = '';

            const contractMatch = detailText.match(/契約数[^\d]*(\d+)/);
            if (contractMatch) {
              applicants = parseInt(contractMatch[1] ?? '0') || 0;
            }

            const deadlineMatch = detailText.match(/あと(\d+)日|(\d+月\d+日)/);
            if (deadlineMatch) {
              deadline = deadlineMatch[0] ?? '';
            }

            jobs.push({
              id: jobId,
              title: title,
              description: detailText.substring(0, 500),
              url: url,
              budget: {
                type: budgetType,
                amount: budgetAmount,
                currency: 'JPY'
              },
              category: params.categoryName,
              tags: tags.slice(0, 10),
              client: {
                name: '匿名',
                rating: 0,
                reviewCount: 0
              },
              postedAt: postedAt,
              deadline: deadline,
              applicants: applicants,
              scrapedAt: new Date().toISOString()
            });
            console.log(`✅ 案件抽出成功: ${title} (${jobId}) - ${budget}`);
          }
        } catch (itemError) {
          console.log(`❌ 案件 ${i} の処理中にエラー:`, itemError);
          continue;
        }
      }

      console.log(`📊 合計 ${jobs.length} 件の案件を抽出しました`);
      return jobs;
    }, { maxJobsLimit: maxJobs, categoryName: category, scrapedIds: [] });

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
 * カテゴリスクレイピングのデバッグ版テスト
 */
export async function debugCategoryScrapingTest(): Promise<{
  success: boolean;
  steps: string[];
  categoryResults?: { [category: string]: ScrapingResult };
  error?: string;
  executionTime: number;
}> {
  const startTime = Date.now();
  const steps: string[] = [];
  let browser: Browser | null = null;

  try {
    steps.push('🚀 カテゴリスクレイピングデバッグテスト開始');
    console.log('🚀 カテゴリスクレイピングデバッグテスト開始...');

    // ブラウザ起動
    steps.push('🌐 ブラウザ起動中');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer'
      ]
    });

    steps.push('✅ ブラウザ起動完了');

    // ブラウザイベントリスナー設定
    browser.on('disconnected', () => {
      steps.push('⚠️ ブラウザ予期しない切断検出');
      console.log('⚠️ ブラウザが予期せず切断されました');
    });

    // コンテキスト作成
    steps.push('📄 コンテキスト作成中');
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    });

    steps.push('✅ コンテキスト作成完了');

    // ページ作成
    steps.push('📋 ページ作成中');
    const page = await context.newPage();

    steps.push('✅ ページ作成完了');

    // ページイベントリスナー設定
    page.on('close', () => {
      steps.push('⚠️ ページ予期しない終了検出');
      console.log('⚠️ ページが予期せず終了されました');
    });

    page.on('crash', () => {
      steps.push('❌ ページクラッシュ検出');
      console.log('❌ ページがクラッシュしました');
    });

    // カテゴリテスト実行
    const categories = ['ec', 'web_products'];
    const categoryResults: { [category: string]: ScrapingResult } = {};

    for (const category of categories) {
      steps.push(`📂 カテゴリ「${category}」処理開始`);
      console.log(`\n📂 カテゴリ「${category}」処理開始...`);

      try {
        // ページ状態確認
        const isPageClosed = page.isClosed();
        if (isPageClosed) {
          steps.push(`❌ カテゴリ「${category}」: ページが閉じられています`);
          console.log(`❌ カテゴリ「${category}」: ページが既に閉じられています`);
          continue;
        }

        steps.push(`📊 カテゴリ「${category}」: デバッグ版スクレイピング実行中`);
        const categoryResult = await scrapeCrowdWorksJobsByCategoryDebug(page, category, 5);
        categoryResults[category] = categoryResult;

        if (categoryResult.success) {
          steps.push(`✅ カテゴリ「${category}」完了: ${categoryResult.jobsFound}件`);
          console.log(`✅ カテゴリ「${category}」完了: ${categoryResult.jobsFound}件`);
        } else {
          steps.push(`❌ カテゴリ「${category}」失敗: ${categoryResult.error}`);
          console.log(`❌ カテゴリ「${category}」失敗: ${categoryResult.error}`);
        }

        // カテゴリ間の待機
        steps.push(`⏳ カテゴリ間待機 (2秒)`);
        await page.waitForTimeout(2000);

      } catch (categoryError) {
        const errorMessage = categoryError instanceof Error ? categoryError.message : String(categoryError);
        steps.push(`❌ カテゴリ「${category}」エラー: ${errorMessage}`);
        console.error(`❌ カテゴリ「${category}」エラー:`, errorMessage);

        categoryResults[category] = {
          success: false,
          jobsFound: 0,
          jobs: [],
          error: errorMessage,
          executionTime: 0
        };
      }
    }

    // クリーンアップ
    steps.push('🧹 コンテキスト終了中');
    await context.close();
    steps.push('✅ コンテキスト終了完了');

    const executionTime = Date.now() - startTime;
    steps.push(`🎉 デバッグテスト完了 (${executionTime}ms)`);

    const successCount = Object.values(categoryResults).filter(result => result.success).length;
    console.log(`\n🎯 カテゴリスクレイピングデバッグテスト完了`);
    console.log(`📊 成功カテゴリ数: ${successCount}/${categories.length}`);

    return {
      success: successCount > 0,
      steps,
      categoryResults,
      executionTime
    };

  } catch (error) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    steps.push(`❌ テストエラー: ${errorMessage}`);
    console.error('❌ カテゴリスクレイピングデバッグテストエラー:', errorMessage);

    return {
      success: false,
      steps,
      error: errorMessage,
      executionTime
    };
  } finally {
    if (browser) {
      try {
        steps.push('🔒 ブラウザ終了中');
        await browser.close();
        steps.push('✅ ブラウザ終了完了');
      } catch (closeError) {
        steps.push(`⚠️ ブラウザ終了エラー: ${closeError}`);
        console.warn('⚠️ ブラウザ終了エラー:', closeError);
      }
    }
  }
}
