import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface CrowdWorksSearcherStackProps extends cdk.StackProps {
  readonly stage?: string;
  readonly useContainerImage?: boolean; // Container Image使用フラグ
}

export class CrowdWorksSearcherStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: CrowdWorksSearcherStackProps) {
    super(scope, id, props);

    const stage = props?.stage || this.node.tryGetContext('stage') || 'dev';
    const isProd = stage === 'production';
    const useContainerImage = props?.useContainerImage ?? true; // デフォルトでContainer使用

    // リソース名のプレフィックス
    const resourcePrefix = `crowdworks-searcher-${stage}`;

    // S3バケット（データ保存用）
    const dataBucket = new s3.Bucket(this, 'CrowdWorksDataBucket', {
      bucketName: `${resourcePrefix}-data-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: isProd, // 本番環境のみバージョニング有効
      lifecycleRules: [
        {
          id: 'DeleteOldData',
          enabled: true,
          expiration: isProd ? cdk.Duration.days(30) : cdk.Duration.days(7),
          // 本番環境では古いバージョンも管理
          ...(isProd && {
            noncurrentVersionExpiration: cdk.Duration.days(7),
          }),
        },
      ],
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd, // 本番環境では手動削除が必要
    });

    // CloudWatch Logs グループ
    const logGroup = new logs.LogGroup(this, 'LambdaLogGroup', {
      logGroupName: `/aws/lambda/${resourcePrefix}-main`,
      retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Lambda実行ロール（Container Image用権限追加）
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      roleName: `${resourcePrefix}-lambda-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket', 's3:DeleteObject'],
              resources: [dataBucket.bucketArn, `${dataBucket.bucketArn}/*`],
            }),
          ],
        }),
        LogsAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
              resources: [logGroup.logGroupArn],
            }),
          ],
        }),
        // Parameter Store (シークレット管理用)
        ParameterStoreAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['ssm:GetParameter', 'ssm:GetParameters'],
              resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/crowdworks-search/*`],
            }),
          ],
        }),
      },
    });

    // Lambda関数（Container Image対応）
    const mainFunction = useContainerImage
      ? new lambda.DockerImageFunction(this, 'CrowdWorksMainFunction', {
        functionName: `${resourcePrefix}-main`,
        code: lambda.DockerImageCode.fromImageAsset('./', {
          // Lambda Container用のDockerfileを指定
          file: 'Dockerfile.lambda',
          // ビルド引数でステージを渡す
          buildArgs: {
            STAGE: stage,
            NODE_ENV: isProd ? 'production' : 'development',
          },
        }),
        timeout: cdk.Duration.minutes(15), // Playwright用に15分
        memorySize: isProd ? 3008 : 2048,  // Playwright用メモリ
        role: lambdaRole,
        logGroup: logGroup,
        architecture: lambda.Architecture.X86_64, // Playwrightはx86_64のみサポート
        environment: {
          NODE_ENV: stage,
          STAGE: stage,
          DATA_BUCKET_NAME: dataBucket.bucketName,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
          // Playwright環境変数
          PLAYWRIGHT_BROWSERS_PATH: '/usr/bin',
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
          LOG_LEVEL: isProd ? 'info' : 'debug',
        },
        // 本番環境では予約済み同時実行数を設定
        ...(isProd && {
          reservedConcurrentExecutions: 5,
        }),
      })
      : new lambda.Function(this, 'CrowdWorksMainFunction', {
        functionName: `${resourcePrefix}-main`,
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'lambda/handler.lambdaHandler',
        code: lambda.Code.fromAsset('./dist'),
        timeout: cdk.Duration.minutes(isProd ? 15 : 10),
        memorySize: isProd ? 1536 : 1024,
        role: lambdaRole,
        logGroup: logGroup,
        environment: {
          NODE_ENV: stage,
          STAGE: stage,
          DATA_BUCKET_NAME: dataBucket.bucketName,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        },
        // 本番環境では予約済み同時実行数を設定
        ...(isProd && {
          reservedConcurrentExecutions: 5,
        }),
      });

    // EventBridge（スケジューラー）
    const scheduleRule = new events.Rule(this, 'ScheduleRule', {
      ruleName: `${resourcePrefix}-schedule`,
      // 本番環境では15分間隔、その他は30分間隔
      schedule: events.Schedule.rate(isProd ? cdk.Duration.minutes(15) : cdk.Duration.minutes(30)),
      description: `CrowdWorks案件検索の定期実行 (${stage}環境)`,
      enabled: stage !== 'test', // テスト環境では無効
    });

    scheduleRule.addTarget(new targets.LambdaFunction(mainFunction));

    // タグ付け
    cdk.Tags.of(this).add('Project', 'CrowdWorksSearcher');
    cdk.Tags.of(this).add('Stage', stage);
    cdk.Tags.of(this).add('Environment', isProd ? 'production' : 'development');

    // 出力
    new cdk.CfnOutput(this, 'DataBucketName', {
      value: dataBucket.bucketName,
      description: 'S3データバケット名',
      exportName: `${resourcePrefix}-data-bucket-name`,
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: mainFunction.functionName,
      description: 'Lambda関数名',
      exportName: `${resourcePrefix}-lambda-function-name`,
    });

    new cdk.CfnOutput(this, 'LambdaFunctionArn', {
      value: mainFunction.functionArn,
      description: 'Lambda関数ARN',
      exportName: `${resourcePrefix}-lambda-function-arn`,
    });

    new cdk.CfnOutput(this, 'Stage', {
      value: stage,
      description: 'デプロイメントステージ',
      exportName: `${resourcePrefix}-stage`,
    });

    // 出力（Container Image情報追加）
    new cdk.CfnOutput(this, 'DeploymentMethod', {
      value: useContainerImage ? 'Container Image' : 'ZIP Package',
      description: 'Lambda関数のデプロイ方式',
      exportName: `${resourcePrefix}-deployment-method`,
    });
  }
}
