import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { LancersJob, LancersJobDetail } from '../src/services/LancersService';
import * as dotenv from 'dotenv';

// 環境変数を読み込み
dotenv.config();

/**
 * ランサーズ案件スクレイピングメイン処理
 */
async function main(): Promise<void> {
    console.log('🚀 ランサーズ案件のスクレイピングを開始します...');
    console.log('⚠️ 注意: 公開案件のみを対象とします');

    const browser = await chromium.launch({
        headless: false,
        slowMo: 1000,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

        // User-Agentを設定
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        });

        // const lancersService = new LancersService(page);

        // 取得するカテゴリとそれぞれの最大件数（10件ずつに変更）
        const categories = [
            { name: 'system', url: 'https://www.lancers.jp/work/search/system' },
            { name: 'web', url: 'https://www.lancers.jp/work/search/web' },
            { name: 'app', url: 'https://www.lancers.jp/work/search/app' },
            { name: 'design', url: 'https://www.lancers.jp/work/search/design' },
            { name: 'writing', url: 'https://www.lancers.jp/work/search/writing' },
            { name: 'translation', url: 'https://www.lancers.jp/work/search/translation' }
        ];

        const itemsPerCategory = 5; // 各カテゴリから5件取得（合計30件）
        const detailsLimit = 5; // 詳細取得も5件に制限

        const allJobs: LancersJob[] = [];
        const allDetails: LancersJobDetail[] = [];
        const startTime = Date.now();

        console.log('🔍 各カテゴリから案件を取得します...');

        for (const category of categories) {
            console.log(`\n📁 カテゴリ「${category.name}」の処理を開始（最大${itemsPerCategory}件）`);

            try {
                // カテゴリURLマッピング（新着順パラメータ付き）
                const categoryUrls: { [key: string]: string } = {
                    'system': 'https://www.lancers.jp/work/search/system?open=1&show_description=1&sort=started&work_rank%5B%5D=0&work_rank%5B%5D=2&work_rank%5B%5D=3',
                    'web': 'https://www.lancers.jp/work/search/web?open=1&show_description=1&sort=started&work_rank%5B%5D=0&work_rank%5B%5D=2&work_rank%5B%5D=3',
                    'app': 'https://www.lancers.jp/work/search/system/smartphoneapp?open=1&show_description=1&sort=started&work_rank%5B%5D=0&work_rank%5B%5D=2&work_rank%5B%5D=3',
                    'design': 'https://www.lancers.jp/work/search/design?open=1&show_description=1&sort=started&work_rank%5B%5D=0&work_rank%5B%5D=2&work_rank%5B%5D=3',
                    'writing': 'https://www.lancers.jp/work/search/writing?open=1&show_description=1&sort=started&work_rank%5B%5D=0&work_rank%5B%5D=2&work_rank%5B%5D=3',
                    'translation': 'https://www.lancers.jp/work/search/writing/translation?open=1&show_description=1&sort=started&work_rank%5B%5D=0&work_rank%5B%5D=2&work_rank%5B%5D=3'
                };

                const categoryUrl = categoryUrls[category.name];
                if (!categoryUrl) {
                    console.log(`❌ カテゴリ「${category.name}」のURLが見つかりません`);
                    continue;
                }

                console.log(`🌐 アクセス: ${categoryUrl}`);
                await page.goto(categoryUrl, { waitUntil: 'networkidle', timeout: 30000 });
                await page.waitForTimeout(3000);

                // 新着順が既に選択されているか確認
                const sortSelect = await page.$('select[name="sort"], combobox[aria-label="並び順"]');
                if (sortSelect) {
                    const selectedValue = await sortSelect.evaluate(el => (el as HTMLSelectElement).value);
                    console.log(`📊 現在のソート: ${selectedValue}`);

                    if (selectedValue !== 'started') {
                        await page.selectOption('select[name="sort"]', 'started');
                        console.log('✅ 新着順に変更しました');
                        await page.waitForTimeout(2000);
                    } else {
                        console.log('✅ 既に新着順でソートされています');
                    }
                }

                // 案件一覧を取得
                const jobs = await getJobsFromPage(page, itemsPerCategory, category.name);
                console.log(`📊 ${category.name}カテゴリ: ${jobs.length}件の案件を取得`);

                allJobs.push(...jobs);

                // 詳細情報を取得（最大10件まで）
                const detailsToFetch = jobs.slice(0, detailsLimit);
                for (const job of detailsToFetch) {
                    try {
                        console.log(`🔍 詳細取得: ${job.title}`);
                        const detail = await getJobDetail(page, job.url);
                        if (detail) {
                            allDetails.push(detail);
                        }
                        await page.waitForTimeout(1000); // レート制限
                    } catch (detailError) {
                        console.log(`⚠️ 詳細取得エラー: ${job.title}`);
                    }
                }

            } catch (categoryError) {
                console.error(`❌ カテゴリ「${category.name}」でエラー:`, categoryError);
            }
        }

        // ファイル出力
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const jobsFilename = `output/lancers-jobs-${timestamp}.json`;
        const detailsFilename = `output/lancers-details-${timestamp}.json`;

        writeFileSync(jobsFilename, JSON.stringify(allJobs, null, 2), 'utf8');
        writeFileSync(detailsFilename, JSON.stringify(allDetails, null, 2), 'utf8');

        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log('\n🎉 スクレイピング完了！');
        console.log(`📊 合計取得件数: ${allJobs.length}件`);
        console.log(`📝 詳細取得件数: ${allDetails.length}件`);
        console.log(`⏱️ 実行時間: ${elapsedTime}秒`);
        console.log(`💾 保存先: ${jobsFilename}`);
        console.log(`💾 詳細保存先: ${detailsFilename}`);

    } catch (error) {
        console.error('❌ スクレイピング中にエラーが発生:', error);
    } finally {
        await browser.close();
    }
}

/**
 * ページから案件一覧を取得
 */
async function getJobsFromPage(page: any, maxJobs: number, category: string): Promise<LancersJob[]> {
    const jobs: LancersJob[] = [];
    let pageNum = 1;

    while (jobs.length < maxJobs) {
        console.log(`📄 ページ ${pageNum} を処理中...`);

        // 案件一覧要素を取得（更新されたセレクター）
        const jobElements = await page.$$('article[data-testid="job-card"], .job-item, div[data-job-id]');

        if (jobElements.length === 0) {
            // フォールバックセレクター
            const fallbackElements = await page.$$('div:has(> a[href*="/work/detail/"])');
            console.log(`🔍 フォールバック: ${fallbackElements.length}件の要素を発見`);

            if (fallbackElements.length === 0) {
                console.log('❌ 案件要素が見つかりません');
                break;
            }
        }

        const currentPageJobs = jobElements.length > 0 ? jobElements : await page.$$('div:has(> a[href*="/work/detail/"])');

        for (let i = 0; i < currentPageJobs.length && jobs.length < maxJobs; i++) {
            try {
                const job = await extractJobFromElement(currentPageJobs[i], category);
                if (job) {
                    jobs.push(job);
                }
            } catch (jobError) {
                console.log(`⚠️ 案件抽出エラー: ${jobError}`);
            }
        }

        // 次ページがあるかチェック
        const nextButton = await page.$('a:has-text("次へ"), a[aria-label="次のページ"]');
        if (!nextButton || jobs.length >= maxJobs) {
            break;
        }

        await nextButton.click();
        await page.waitForTimeout(3000);
        pageNum++;
    }

    return jobs;
}

/**
 * 案件要素から情報を抽出
 */
async function extractJobFromElement(element: any, category: string): Promise<LancersJob | null> {
    try {
        // タイトルとURL（更新されたセレクター）
        const titleLink = await element.$('a[href*="/work/detail/"]');
        if (!titleLink) return null;

        const title = await titleLink.textContent();
        const url = await titleLink.getAttribute('href');

        if (!title || !url) return null;

        const fullUrl = url.startsWith('http') ? url : `https://www.lancers.jp${url}`;
        const jobId = url.match(/\/work\/detail\/(\d+)/)?.[1] || '';

        // 価格情報
        // const priceElement = await element.$('span:has-text("円"), .price, .budget');
        // const budgetText = priceElement ? await priceElement.textContent() : '';

        // カテゴリ情報
        // const categoryElement = await element.$('a[href*="/work/search/"], .category');
        // const subcategory = categoryElement ? await categoryElement.textContent() : '';

        // 説明文
        const descriptionElement = await element.$('.description, .job-summary, p');
        const description = descriptionElement ? await descriptionElement.textContent() : '';

        // 投稿日
        const dateElement = await element.$('.date, .posted-date, time');
        const postedDate = dateElement ? await dateElement.textContent() : '';

        // NEW フラグ
        // const newElement = await element.$(':has-text("NEW"), .new-badge');
        // const isNew = !!newElement;

        // クライアント情報
        const clientElement = await element.$('a[href*="/client/"], .client-name');
        const client = clientElement ? await clientElement.textContent() : '';

        const job: LancersJob = {
            id: jobId,
            title: title.trim(),
            description: description?.trim() || '',
            url: fullUrl,
            budget: {
                type: 'unknown' as const,
                amount: 0,
                currency: 'JPY'
            },
            category: category,
            tags: [],
            client: {
                name: client?.trim() || '',
                rating: 0,
                reviewCount: 0
            },
            postedAt: postedDate?.trim() || '',
            applicants: 0,
            scrapedAt: new Date().toISOString()
        };

        return job;

    } catch (error) {
        console.log(`⚠️ 案件抽出エラー:`, error);
        return null;
    }
}

/**
 * 案件詳細情報を取得（修正されたスクレイピングロジック使用）
 */
async function getJobDetail(page: any, jobUrl: string): Promise<LancersJobDetail | null> {
    try {
        await page.goto(jobUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(2000);

        const jobId = jobUrl.match(/\/work\/detail\/(\d+)/)?.[1] || '';

        // ページが削除されているかチェック
        const errorCheck = await page.evaluate(() => {
            const banner = document.querySelector('banner h1[level="1"]');
            if (banner) {
                const text = banner.textContent || '';
                if (text.includes('閲覧制限') || text.includes('削除')) {
                    return { error: true, message: text };
                }
            }
            return { error: false };
        });

        if (errorCheck.error) {
            console.log(`⚠️ ページアクセスエラー: ${jobId}`);
            return null;
        }

        // 修正されたスクレイピングロジックを使用して詳細情報を抽出
        const detailInfo = await page.evaluate(() => {
            // タイトルの取得（テストで成功した手法を使用）
            const title = (() => {
                const h1 = document.querySelector('h1');
                if (!h1) return '';

                // "【急募】オンライン子供向けプログラミングレッスン講師を募集！の仕事 [IT・通信・インターネット]"
                // から "【急募】オンライン子供向けプログラミングレッスン講師を募集！" を抽出
                const fullText = h1.textContent || '';
                const match = fullText.match(/^(.+?)の仕事/);
                return match ? match[1]!.trim() : fullText.replace(/\s*\[.*?\]\s*$/, '').trim();
            })();

            // 予算の取得（定義リストからの抽出）
            const budget = (() => {
                const terms = Array.from(document.querySelectorAll('dt'));
                for (const term of terms) {
                    if (term.textContent?.includes('提示した予算') || term.textContent?.includes('予算')) {
                        const dd = term.nextElementSibling;
                        if (dd && dd.tagName === 'DD') {
                            return dd.textContent?.trim() || '';
                        }
                    }
                }
                return '';
            })();

            // 詳細説明の取得（定義リストからの抽出）
            const detailedDescription = (() => {
                const terms = Array.from(document.querySelectorAll('dt'));
                for (const term of terms) {
                    if (term.textContent?.includes('依頼概要')) {
                        const dd = term.nextElementSibling;
                        if (dd && dd.tagName === 'DD') {
                            const text = dd.textContent?.trim() || '';
                            // 最初の500文字に制限（詳細版なので少し長めに）
                            return text.length > 500 ? text.substring(0, 500) + '...' : text;
                        }
                    }
                }
                return '';
            })();

            return { title, budget, detailedDescription };
        });

        // 詳細情報を構築
        const detail: LancersJobDetail = {
            jobId: jobId,
            title: detailInfo.title,
            category: '',
            url: jobUrl,
            paymentType: '',
            budget: detailInfo.budget,
            deliveryDate: '',
            postDate: '',
            applicationDeadline: '',
            applicantCount: 0,
            contractCount: 0,
            recruitmentCount: 0,
            favoriteCount: 0,
            detailedDescription: detailInfo.detailedDescription,
            client: {
                name: '',
                url: '',
                overallRating: '',
                orderHistory: '',
                completionRate: '',
                identityVerified: false,
                description: ''
            },
            recentApplicants: [],
            scrapedAt: new Date().toISOString()
        };

        return detail;

    } catch (error) {
        console.log(`⚠️ 詳細取得エラー:`, error);
        return null;
    }
}

// スクリプト実行
if (require.main === module) {
    main().catch(error => {
        console.error('💥 スクリプト実行エラー:', error);
        process.exit(1);
    });
}

export default main; 