#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CrowdWorksSearcherStack } from './src/infrastructure/crowdworks-searcher-stack';

const app = new cdk.App();

// 環境設定
const account = process.env['CDK_DEFAULT_ACCOUNT'];
const region = process.env['CDK_DEFAULT_REGION'] || process.env['AWS_REGION'] || 'ap-northeast-1';
const stage = app.node.tryGetContext('stage') || process.env['STAGE'] || 'dev';

const env: cdk.Environment = account ? { account, region } : { region };

// ステージ別のスタック設定
const getStackConfig = (stage: string) => {
    const baseConfig = {
        env,
        description: `CrowdWorks Auto Job Searcher System - ${stage.toUpperCase()}`,
        stage,
    };

    switch (stage) {
        case 'production':
            return {
                ...baseConfig,
                terminationProtection: true, // 本番環境では削除保護を有効
            };
        case 'staging':
            return {
                ...baseConfig,
                terminationProtection: false,
            };
        default: // dev, test, etc.
            return {
                ...baseConfig,
                terminationProtection: false,
            };
    }
};

// スタック作成
const stackConfig = getStackConfig(stage);
new CrowdWorksSearcherStack(app, `CrowdWorksSearcherStack-${stage}`, stackConfig);

// タグを全リソースに適用
cdk.Tags.of(app).add('Application', 'CrowdWorksSearcher');
cdk.Tags.of(app).add('Stage', stage);
cdk.Tags.of(app).add('ManagedBy', 'CDK');

console.log(`🚀 Deploying CrowdWorks Searcher to ${stage.toUpperCase()} environment`);
console.log(`   Region: ${region}`);
console.log(`   Account: ${account || 'default'}`); 