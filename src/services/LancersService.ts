import { Page } from 'playwright';

export interface LancersJob {
    title: string;
    url: string;
    category: string;
    budget: string;
    description: string;
    applicantCount: string;
    clientName: string;
    contractCount: string;
    postedDate: string;
}

export interface LancersJobDetail extends LancersJob {
    detailedDescription: string;
    paymentType: string;
    deliveryDate: string;
    applicationDeadline: string;
    client: {
        name: string;
        overallRating: string;
        orderHistory: string;
        completionRate: string;
    };
}

export interface LancersScrapingResult {
    jobs: LancersJob[];
    jobDetails: LancersJobDetail[];
}

/**
 * ランサーズ案件取得サービス
 */
export class LancersService {
    private page: Page;
    private _isLoggedIn: boolean = false;

    constructor(page: Page) {
        this.page = page;
    }

    get isLoggedIn(): boolean {
        return this._isLoggedIn;
    }

    /**
     * ランサーズにログイン
     */
    async login(email: string, password: string): Promise<boolean> {
        try {
            console.log('🔐 ランサーズにログイン中...');
            
            // ログインページに移動
            await this.page.goto('https://www.lancers.jp/user/login', { 
                waitUntil: 'networkidle', 
                timeout: 30000 
            });

            // メールアドレス入力
            const emailSelector = 'input[name="login_name"], input[type="email"], #loginUserName';
            await this.page.waitForSelector(emailSelector, { timeout: 10000 });
            await this.page.fill(emailSelector, email);

            // パスワード入力
            const passwordSelector = 'input[name="password"], input[type="password"], #loginPassword';
            await this.page.fill(passwordSelector, password);

            // ログインボタンをクリック
            const loginButtonSelector = 'button[type="submit"], input[type="submit"], .login-button';
            await this.page.click(loginButtonSelector);

            // ログイン完了を待機
            await this.page.waitForURL(url => !url.toString().includes('/user/login'), { timeout: 15000 });
            
            this._isLoggedIn = true;
            console.log('✅ ランサーズログイン成功');
            return true;

        } catch (error) {
            console.error('❌ ランサーズログインエラー:', error);
            this._isLoggedIn = false;
            return false;
        }
    }

    /**
     * 案件リストを取得
     */
    async scrapeJobs(category: string, maxJobs: number): Promise<LancersJob[]> {
        try {
            console.log(`🔍 ランサーズ「${category}」カテゴリで案件取得中...`);
            
            // カテゴリURLの構築
            const categoryUrls: { [key: string]: string } = {
                'system': 'https://www.lancers.jp/work/search/system?open=1',
                'web': 'https://www.lancers.jp/work/search/web?open=1', 
                'app': 'https://www.lancers.jp/work/search/system/mobile?open=1',
                'design': 'https://www.lancers.jp/work/search/design?open=1'
            };
            
            const url = categoryUrls[category] || categoryUrls['system'];
            if (!url) {
                throw new Error(`未対応のカテゴリ: ${category}`);
            }
            
            await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            
            // 案件リストを取得
            const jobs = await this.page.evaluate(({ maxJobs, category }) => {
                const jobs: any[] = [];
                
                // 案件詳細リンクを持つ要素を取得
                const jobLinks = document.querySelectorAll('a[href*="/work/detail/"]');
                console.log(`案件リンク数: ${jobLinks.length}`);
                
                let count = 0;
                jobLinks.forEach((link: Element, index: number) => {
                    if (count >= maxJobs) return;
                    
                    try {
                        const href = link.getAttribute('href');
                        if (!href || !href.includes('/work/detail/')) return;
                        
                        // タイトルを取得
                        let title = link.textContent?.trim() || '';
                        
                        // NEW, 初回, 2回目などのラベルを除去
                        title = title.replace(/^(NEW|初回|\d+回目)\s*/, '').trim();

                        if (!title || title.length < 5) return;

                        // 完全なURLを構築
                        const fullUrl = href.startsWith('http') ? href : `https://www.lancers.jp${href}`;

                        // 親要素から価格情報を取得
                        let budget = '';
                        let parentElement = link.parentElement;
                        while (parentElement && !budget) {
                            const text = parentElement.textContent || '';
                            const priceMatch = text.match(/([\d,]+)\s*円/);
                            if (priceMatch) {
                                budget = priceMatch[0];
                                break;
                            }
                            parentElement = parentElement.parentElement;
                            if (!parentElement || parentElement === document.body) break;
                        }
                        
                        // 説明文を取得
                    let description = '';
                        parentElement = link.parentElement;
                        while (parentElement && !description) {
                            const textNodes = Array.from(parentElement.childNodes)
                                .filter(node => node.nodeType === Node.TEXT_NODE)
                                .map(node => node.textContent?.trim())
                                .filter(text => text && text.length > 30);
                            
                            if (textNodes.length > 0 && textNodes[0]) {
                                const firstText = textNodes[0];
                                description = firstText.length > 200 
                                    ? firstText.substring(0, 200) + '...' 
                                    : firstText;
                                break;
                            }
                            parentElement = parentElement.parentElement;
                            if (!parentElement || parentElement === document.body) break;
                        }
                        
                        const job = {
                            title: title,
                            url: fullUrl,
                            category: category,
                            budget: budget,
                            description: description,
                            applicantCount: '0',
                            clientName: '',
                            contractCount: '0',
                            postedDate: ''
                        };
                        
                        console.log(`案件${count + 1}: ${title}`);
                        jobs.push(job);
                        count++;

                } catch (error) {
                        console.log(`案件解析エラー (${index}):`, error);
                }
            });

                console.log(`最終的に取得された案件数: ${jobs.length}`);
                return jobs;
                
            }, { maxJobs, category });
            
            console.log(`✅ ランサーズから${jobs.length}件の案件を取得しました`);
            return jobs;
            
        } catch (error) {
            console.error('案件取得エラー:', error);
            throw error;
        }
    }

    /**
     * 案件詳細を取得
     */
    async scrapeJobDetail(url: string): Promise<LancersJobDetail | null> {
        try {
            console.log(`📋 詳細取得中: ${url}`);

            await this.page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

            const detail = await this.page.evaluate(() => {
                const getTextContent = (selector: string): string => {
                    const element = document.querySelector(selector);
                    return element?.textContent?.trim() || '';
                };

                // タイトル取得
                const title = getTextContent('h1') || document.title;

                // 詳細説明取得
                const detailedDescription = getTextContent('.work-detail-description, .description, .content') ||
                                          document.body.textContent?.substring(0, 1000) || '';

                return {
                    title: title,
                    url: window.location.href,
                    category: '',
                    budget: '',
                    description: '',
                    applicantCount: '0',
                    clientName: '',
                    contractCount: '0',
                    postedDate: '',
                    detailedDescription: detailedDescription,
                    paymentType: '',
                    deliveryDate: '',
                    applicationDeadline: '',
                    client: {
                        name: '',
                        overallRating: '',
                        orderHistory: '',
                        completionRate: ''
                    }
                };
            });

            return detail;

        } catch (error) {
            console.error(`詳細取得エラー: ${url}`, error);
            return null;
        }
    }

      /**
   * 予算額を数値で抽出
   */
  // private extractBudgetAmount(budget: string): number {
  //   if (!budget) return 0;
  //   
  //   // 「～」や「-」で区切られた範囲の場合は上限値を取得
  //   const rangeMatch = budget.match(/([0-9,]+)\s*円\s*[~～-]\s*([0-9,]+)\s*円/);
  //   if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
  //     const min = parseInt(rangeMatch[1].replace(/,/g, '')) || 0;
  //     const max = parseInt(rangeMatch[2].replace(/,/g, '')) || 0;
  //     return Math.max(min, max); // 上限値を返す
  //   }
  //   
  //   // 単一の金額
  //   const singleMatch = budget.match(/([0-9,]+)\s*円/);
  //   if (singleMatch && singleMatch[1]) {
  //     return parseInt(singleMatch[1].replace(/,/g, '')) || 0;
  //   }
  //   
  //   return 0;
  // }
} 