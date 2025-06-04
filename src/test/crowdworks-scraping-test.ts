/**
 * CrowdWorksスクレイピング動作確認テスト
 * ローカル環境でPlaywrightとCrowdWorksアクセスをテスト
 */

import { chromium } from 'playwright';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

// AWS SSM Client
const ssmClient = new SSMClient({ region: process.env['AWS_REGION'] || 'ap-northeast-1' });

interface CrowdWorksCredentials {
    email: string;
    password: string;
}

/**
 * 認証情報取得（ローカル開発用）
 */
async function getCrowdWorksCredentials(): Promise<CrowdWorksCredentials> {
    try {
        console.log('🔐 CrowdWorks認証情報を取得中...');

        // 環境変数から取得を試行
        const envEmail = process.env['CROWDWORKS_EMAIL'];
        const envPassword = process.env['CROWDWORKS_PASSWORD'];

        if (envEmail && envPassword) {
            console.log('✅ 環境変数から認証情報取得完了');
            return { email: envEmail, password: envPassword };
        }

        console.log('⚠️ 環境変数が設定されていません。Parameter Storeから取得します...');

        // Parameter Storeから取得
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
            throw new Error('Parameter Storeにパラメータが見つかりません');
        }

        console.log('✅ Parameter Storeから認証情報取得完了');
        return { email, password };

    } catch (error) {
        console.error('❌ 認証情報取得エラー:', error);
        throw error;
    }
}

/**
 * CrowdWorksログインテスト
 */
async function testCrowdWorksLogin() {
    console.log('🚀 CrowdWorksログインテスト開始...');

    const browser = await chromium.launch({
        headless: false, // ローカルテスト用に表示
        slowMo: 1000     // 動作を見やすくするためスロー実行
    });

    try {
        const page = await browser.newPage();

        // 認証情報取得
        const credentials = await getCrowdWorksCredentials();

        // CrowdWorksログインページにアクセス
        console.log('📄 CrowdWorksログインページアクセス中...');
        await page.goto('https://crowdworks.jp/login', {
            waitUntil: 'networkidle',
            timeout: 30000
        });

        console.log('✅ ログインページ読み込み完了');
        console.log(`📋 タイトル: ${await page.title()}`);

        // ログインフォーム要素の待機
        console.log('⏳ ログインフォーム要素を待機中...');
        await page.waitForSelector('input[type="email"], input[name="email"], #login_form input[type="text"]', {
            timeout: 10000
        });

        // メールアドレス入力
        console.log('📧 メールアドレス入力中...');
        const emailSelector = 'input[type="email"], input[name="email"], #login_form input[type="text"]';
        await page.fill(emailSelector, credentials.email);

        // パスワード入力
        console.log('🔑 パスワード入力中...');
        const passwordSelector = 'input[type="password"], input[name="password"]';
        await page.fill(passwordSelector, credentials.password);

        // スクリーンショット（ログイン前）
        await page.screenshot({ path: 'login-before.png', fullPage: true });
        console.log('📸 ログイン前スクリーンショット保存: login-before.png');

        // ログインボタンクリック
        console.log('🖱️ ログインボタンクリック中...');
        const loginButtonSelector = 'input[type="submit"], button[type="submit"], .login-button, #login_button';
        await page.click(loginButtonSelector);

        // ログイン処理完了を待機
        console.log('⏳ ログイン処理完了待機中...');
        try {
            await page.waitForNavigation({
                waitUntil: 'networkidle',
                timeout: 15000
            });
        } catch (navigationError) {
            console.log('ℹ️ ナビゲーション待機タイムアウト');
        }

        // スクリーンショット（ログイン後）
        await page.screenshot({ path: 'login-after.png', fullPage: true });
        console.log('📸 ログイン後スクリーンショット保存: login-after.png');

        // ログイン状態確認
        console.log('🔍 ログイン状態確認中...');
        const currentUrl = page.url();
        console.log(`📋 現在のURL: ${currentUrl}`);

        const isLoggedIn = await page.evaluate(() => {
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

        if (loginSuccess) {
            console.log('✅ ログイン成功！');
        } else {
            console.log('❌ ログイン失敗');
            console.log('詳細:', {
                hasUserMenu: isLoggedIn.hasUserMenu,
                hasError: isLoggedIn.hasError,
                currentUrl,
                currentPath: isLoggedIn.currentPath
            });
        }

        // 一定時間待機（ログイン状態を確認）
        console.log('⏸️ 5秒間待機（ログイン状態確認）...');
        await page.waitForTimeout(5000);

    } catch (error) {
        console.error('❌ テスト実行エラー:', error);
    } finally {
        await browser.close();
        console.log('🔒 ブラウザクローズ完了');
    }
}

// テスト実行
if (require.main === module) {
    testCrowdWorksLogin()
        .then(() => {
            console.log('🎉 CrowdWorksログインテスト完了');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 テスト失敗:', error);
            process.exit(1);
        });
} 