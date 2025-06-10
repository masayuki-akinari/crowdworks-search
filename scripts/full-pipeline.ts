#!/usr/bin/env npx ts-node

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface PipelineConfig {
  minHourlyRate: number;
  crowdWorksCategories: string[];
  lancersCategories: string[];
  scrapeCount: number;
}

class FullPipeline {
  private config: PipelineConfig;
  private outputDir: string;

  constructor(config: PipelineConfig) {
    this.config = config;
    this.outputDir = 'output';
  }

  /**
   * コマンドを実行してPromiseで結果を返す
   */
  private executeCommand(command: string, args: string[] = []): Promise<number> {
    return new Promise((resolve, reject) => {
      console.log(`🚀 実行中: ${command} ${args.join(' ')}`);
      
      const childProcess = spawn(command, args, {
        stdio: 'inherit',
        shell: true,
        cwd: process.cwd()
      });

      childProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ 完了: ${command}`);
          resolve(code);
        } else {
          console.error(`❌ エラー: ${command} (exit code: ${code})`);
          reject(new Error(`Command failed: ${command}`));
        }
      });

      childProcess.on('error', (error) => {
        console.error(`❌ プロセスエラー: ${error.message}`);
        reject(error);
      });
    });
  }

  /**
   * 1. CrowdWorksスクレイピング実行
   */
  private async scrapeCrowdWorks(): Promise<void> {
    console.log('\n📊 === STEP 1: CrowdWorksスクレイピング ===');
    
    for (const category of this.config.crowdWorksCategories) {
      try {
        await this.executeCommand('npm', ['run', 'handler', `scrape-${category}`, this.config.scrapeCount.toString()]);
        console.log(`✅ CrowdWorks ${category}カテゴリ完了`);
      } catch (error) {
        console.warn(`⚠️ CrowdWorks ${category}スキップ: ${error}`);
      }
    }
  }

  /**
   * 2. Lancersスクレイピング実行
   */
  private async scrapeLancers(): Promise<void> {
    console.log('\n🎯 === STEP 2: Lancersスクレイピング ===');
    
    for (const category of this.config.lancersCategories) {
      try {
        await this.executeCommand('npm', ['run', 'handler', `lancers-${category}`, this.config.scrapeCount.toString()]);
        console.log(`✅ Lancers ${category}カテゴリ完了`);
      } catch (error) {
        console.warn(`⚠️ Lancers ${category}スキップ: ${error}`);
      }
    }
  }

  /**
   * 3. 統合分析レポート生成
   */
  private async generateAnalysisReport(): Promise<void> {
    console.log('\n📈 === STEP 3: 統合分析レポート生成 ===');
    
    try {
      await this.executeCommand('npx', ['ts-node', 'scripts/create-unified-report.ts', this.config.minHourlyRate.toString()]);
      console.log('✅ 統合分析レポート生成完了');
    } catch (error) {
      console.error('❌ 分析レポート生成失敗:', error);
      throw error;
    }
  }

  /**
   * 4. 結果サマリー表示
   */
  private displaySummary(): void {
    console.log('\n🎉 === パイプライン実行完了！ ===');
    
    // outputディレクトリの最新ファイルを確認
    if (fs.existsSync(this.outputDir)) {
      const files = fs.readdirSync(this.outputDir)
        .filter(file => file.endsWith('.json') || file.endsWith('.md'))
        .map(file => ({
          name: file,
          path: path.join(this.outputDir, file),
          stats: fs.statSync(path.join(this.outputDir, file))
        }))
        .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime())
        .slice(0, 5);

      console.log('\n📁 生成されたファイル（最新5件）:');
      files.forEach((file, index) => {
        const sizeKB = Math.round(file.stats.size / 1024);
        const timestamp = file.stats.mtime.toLocaleString('ja-JP');
        console.log(`  ${index + 1}. ${file.name} (${sizeKB}KB) - ${timestamp}`);
      });

      // 最新のレポートファイルを特定
      const latestReport = files.find(f => f.name.includes('unified-high-paying-jobs') && f.name.endsWith('.md'));
      if (latestReport) {
        console.log(`\n🎯 最新分析レポート: ${latestReport.name}`);
        console.log(`   パス: ${latestReport.path}`);
      }
    }

    console.log(`\n💰 設定情報:`);
    console.log(`   最低時給: ${this.config.minHourlyRate.toLocaleString()}円`);
    console.log(`   CrowdWorksカテゴリ: ${this.config.crowdWorksCategories.join(', ')}`);
    console.log(`   Lancersカテゴリ: ${this.config.lancersCategories.join(', ')}`);
    console.log(`   スクレイピング件数: ${this.config.scrapeCount}件/カテゴリ`);
  }

  /**
   * フルパイプライン実行
   */
  async execute(): Promise<void> {
    const startTime = Date.now();
    
    console.log('🚀 === フル自動化パイプライン開始 ===');
    console.log(`開始時刻: ${new Date().toLocaleString('ja-JP')}`);
    
    try {
      // STEP 1: CrowdWorksスクレイピング
      await this.scrapeCrowdWorks();
      
      // STEP 2: Lancersスクレイピング  
      await this.scrapeLancers();
      
      // STEP 3: 統合分析
      await this.generateAnalysisReport();
      
      // STEP 4: 結果表示
      this.displaySummary();
      
      const executionTime = Math.round((Date.now() - startTime) / 1000);
      console.log(`\n🎉 パイプライン実行完了！ (実行時間: ${executionTime}秒)`);
      
    } catch (error) {
      console.error('\n❌ パイプライン実行中にエラーが発生しました:', error);
      process.exit(1);
    }
  }
}

// メイン実行
async function main() {
  // コマンドライン引数の解析
  const args = process.argv.slice(2);
  const minHourlyRate = args[0] ? parseInt(args[0]) : 3000;
  const scrapeCount = args[1] ? parseInt(args[1]) : 10;

  const config: PipelineConfig = {
    minHourlyRate,
    scrapeCount,
    crowdWorksCategories: ['ec', 'web', 'app', 'dev'], // CrowdWorksカテゴリ
    lancersCategories: ['system', 'web', 'app', 'design'] // Lancersカテゴリ
  };

  console.log('⚙️ パイプライン設定:');
  console.log(`   最低時給: ${config.minHourlyRate.toLocaleString()}円`);
  console.log(`   スクレイピング件数: ${config.scrapeCount}件/カテゴリ`);
  console.log(`   CrowdWorksカテゴリ: ${config.crowdWorksCategories.join(', ')}`);
  console.log(`   Lancersカテゴリ: ${config.lancersCategories.join(', ')}`);

  const pipeline = new FullPipeline(config);
  await pipeline.execute();
}

if (require.main === module) {
  main().catch(console.error);
}

export { FullPipeline }; 