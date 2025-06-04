#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CrowdWorksSearcherStack } from './src/infrastructure/crowdworks-searcher-stack';

const app = new cdk.App();

// 環境設定
const account = process.env['CDK_DEFAULT_ACCOUNT'];
const region = process.env['CDK_DEFAULT_REGION'] || process.env['AWS_REGION'] || 'ap-northeast-1';

const env: cdk.Environment = account ? { account, region } : { region };

// スタック作成
new CrowdWorksSearcherStack(app, 'CrowdWorksSearcherStack', {
    env,
    description: 'CrowdWorks Auto Job Searcher System',
}); 