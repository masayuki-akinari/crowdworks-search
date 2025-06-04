import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class CrowdWorksSearcherStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // S3バケット（データ保存用）
        const dataBucket = new s3.Bucket(this, 'CrowdWorksDataBucket', {
            bucketName: `crowdworks-searcher-data-${this.account}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            lifecycleRules: [
                {
                    id: 'DeleteOldData',
                    enabled: true,
                    expiration: cdk.Duration.days(7),
                }
            ],
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // Lambda実行ロール
        const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ],
            inlinePolicies: {
                S3Access: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                's3:GetObject',
                                's3:PutObject',
                                's3:ListBucket'
                            ],
                            resources: [
                                dataBucket.bucketArn,
                                `${dataBucket.bucketArn}/*`
                            ]
                        })
                    ]
                })
            }
        });

        // Lambda関数（基本版）
        const mainFunction = new lambda.Function(this, 'CrowdWorksMainFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'lambda/handler.lambdaHandler',
            code: lambda.Code.fromAsset('./dist'),
            timeout: cdk.Duration.minutes(10),
            memorySize: 1024,
            role: lambdaRole,
            environment: {
                DATA_BUCKET_NAME: dataBucket.bucketName,
            },
        });

        // EventBridge（スケジューラー）
        const scheduleRule = new events.Rule(this, 'ScheduleRule', {
            schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
            description: 'CrowdWorks案件検索の定期実行（15分間隔）',
        });

        scheduleRule.addTarget(new targets.LambdaFunction(mainFunction));

        // 出力
        new cdk.CfnOutput(this, 'DataBucketName', {
            value: dataBucket.bucketName,
            description: 'S3データバケット名',
        });

        new cdk.CfnOutput(this, 'LambdaFunctionName', {
            value: mainFunction.functionName,
            description: 'Lambda関数名',
        });
    }
} 