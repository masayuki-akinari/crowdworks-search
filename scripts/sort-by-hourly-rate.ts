require('dotenv').config();

import { readFileSync, writeFileSync } from 'fs';

// 型定義
interface AnalysisResult {
    jobId: string;
    title: string;
    工数_見積もり: string;
    想定時給: string;
    gpt_summary: string;
    category?: string; // カテゴリ情報を追加
}

interface SortedResult extends AnalysisResult {
    hourly_rate_numeric: number; // 数値化した時給
}

// 時給文字列を数値に変換する関数
function parseHourlyRate(hourlyRateString: string): number {
    if (!hourlyRateString || hourlyRateString.trim() === '' || hourlyRateString === '0円') {
        return 0;
    }

    // 「3000円」「1,500円」「2500円」などから数値を抽出
    const match = hourlyRateString.match(/([0-9,]+)/);
    if (match && match[1]) {
        const numericString = match[1].replace(/,/g, ''); // カンマを除去
        return parseInt(numericString, 10);
    }

    return 0;
}

// ソート種別
type SortOrder = 'high' | 'low';

// メイン処理
function sortAnalysisResults(order: SortOrder = 'high'): void {
    console.log(`🔄 想定時給による${order === 'high' ? '高額順' : '低額順'}ソートを開始...`);

    const results: SortedResult[] = [];

    // ECカテゴリのデータ読み込み
    try {
        const ecData: AnalysisResult[] = JSON.parse(readFileSync('analyzed-ec.json', 'utf8'));
        ecData.forEach(item => {
            results.push({
                ...item,
                category: 'EC',
                hourly_rate_numeric: parseHourlyRate(item.想定時給)
            });
        });
        console.log(`✅ ECカテゴリ: ${ecData.length}件読み込み`);
    } catch (e) {
        console.log(`⚠️ ECカテゴリファイルが見つかりません: analyzed-ec.json`);
    }

    // Web製品カテゴリのデータ読み込み
    try {
        const webData: AnalysisResult[] = JSON.parse(readFileSync('analyzed-web_products.json', 'utf8'));
        webData.forEach(item => {
            results.push({
                ...item,
                category: 'Web製品',
                hourly_rate_numeric: parseHourlyRate(item.想定時給)
            });
        });
        console.log(`✅ Web製品カテゴリ: ${webData.length}件読み込み`);
    } catch (e) {
        console.log(`⚠️ Web製品カテゴリファイルが見つかりません: analyzed-web_products.json`);
    }

    if (results.length === 0) {
        console.error('❌ データが読み込めませんでした');
        return;
    }

    // ソート実行
    const sortedResults = results.sort((a, b) => {
        if (order === 'high') {
            return b.hourly_rate_numeric - a.hourly_rate_numeric; // 高額順
        } else {
            return a.hourly_rate_numeric - b.hourly_rate_numeric; // 低額順
        }
    });

    console.log(`🔍 ソート完了: ${sortedResults.length}件`);

    // 統計情報を先に表示
    const validResults = sortedResults.filter(r => r.hourly_rate_numeric > 0);
    if (validResults.length > 0) {
        const maxRate = Math.max(...validResults.map(r => r.hourly_rate_numeric));
        const minRate = Math.min(...validResults.map(r => r.hourly_rate_numeric));
        const avgRate = Math.round(validResults.reduce((sum, r) => sum + r.hourly_rate_numeric, 0) / validResults.length);

        console.log(`\n📈 統計情報:`);
        console.log(`最高時給: ${maxRate.toLocaleString()}円`);
        console.log(`最低時給: ${minRate.toLocaleString()}円`);
        console.log(`平均時給: ${avgRate.toLocaleString()}円`);
        console.log(`有効案件: ${validResults.length}件 / 全${sortedResults.length}件`);
    }

    // 結果表示（上位20件）
    console.log(`\n📊 ${order === 'high' ? '高時給' : '低時給'}ランキング TOP20:\n`);

    // 表示用データを準備（0円案件を除外）
    const displayResults = order === 'low'
        ? sortedResults.filter(r => r.hourly_rate_numeric > 0)
        : sortedResults;

    console.log(`📋 表示対象: ${displayResults.length}件`);

    displayResults.slice(0, 20).forEach((item, index) => {
        const rank = index + 1;
        const hourlyRate = item.hourly_rate_numeric.toLocaleString() + '円';
        const category = item.category || 'N/A';
        const workHours = item.工数_見積もり || 'N/A';
        const summary = (item.gpt_summary || '').substring(0, 50) + '...';

        console.log(`${rank}位: ${hourlyRate} (${category}) - 工数: ${workHours}`);
        console.log(`   概要: ${summary}\n`);
    });

    // ファイルに保存
    const outputFileName = `sorted-by-hourly-rate-${order}.json`;
    writeFileSync(outputFileName, JSON.stringify(sortedResults, null, 2), 'utf8');
    console.log(`\n💾 結果を保存: ${outputFileName} (${sortedResults.length}件)`);
}

// コマンドライン引数取得
const [, , sortOrder] = process.argv;
const order: SortOrder = (sortOrder === 'low') ? 'low' : 'high';

// 実行
sortAnalysisResults(order); 