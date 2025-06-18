import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  Aws,
  Size,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import {
  API_NAME_PREFIX,
  DYNAMO_VIDEO_TASK_TABLE,
  DYNAMO_VIDEO_TRANS_TABLE,
  DYNAMO_VIDEO_FRAME_TABLE,
  DYNAMO_VIDEO_ANALYSIS_TABLE,
  S3_BUCKET_EXTRACTION_PREFIX,
  VIDEO_SAMPLE_S3_PREFIX,
} from './extraction-constants';

export interface ExtractionServiceProps extends StackProps {
  /** Emails of initial users allowed to access the portal */
  userEmails: string;
}

export class ExtractionServiceStack extends Stack {
  public readonly apiUrl: string;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;

  constructor(scope: Construct, id: string, props: ExtractionServiceProps) {
    super(scope, id, props);
    const { userEmails } = props;

    /* S3 bucket for uploaded videos and artifacts */
    const extractionBucket = new s3.Bucket(this, 'ExtractionBucket', {
      bucketName: `${S3_BUCKET_EXTRACTION_PREFIX}-${Aws.ACCOUNT_ID}-${Aws.REGION}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.DELETE, s3.HttpMethods.HEAD],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
        },
      ],
    });

    /* DynamoDB tables mirroring Python stack */
    const taskTable = new dynamodb.Table(this, 'VideoTaskTable', {
      tableName: DYNAMO_VIDEO_TASK_TABLE,
      partitionKey: { name: 'Id', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    taskTable.addGlobalSecondaryIndex({
      indexName: 'RequestBy-index',
      partitionKey: { name: 'RequestBy', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const transTable = new dynamodb.Table(this, 'VideoTransTable', {
      tableName: DYNAMO_VIDEO_TRANS_TABLE,
      partitionKey: { name: 'task_id', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const frameTable = new dynamodb.Table(this, 'VideoFrameTable', {
      tableName: DYNAMO_VIDEO_FRAME_TABLE,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'task_id', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    frameTable.addGlobalSecondaryIndex({
      indexName: 'task_id-timestamp-index',
      partitionKey: { name: 'task_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const analysisTable = new dynamodb.Table(this, 'VideoAnalysisTable', {
      tableName: DYNAMO_VIDEO_ANALYSIS_TABLE,
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'task_id', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    analysisTable.addGlobalSecondaryIndex({
      indexName: 'task_id-analysis_type-index',
      partitionKey: { name: 'task_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'analysis_type', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    /* Cognito user pool for authentication */
    const userPool = new cognito.UserPool(this, 'WebUserPool', {
      userPoolName: 'video-analysis-user-pool',
      selfSignUpEnabled: false,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const userPoolClient = userPool.addClient('AppClient', {
      authFlows: { userPassword: true, userSrp: true },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    });
    this.userPoolId = userPool.userPoolId;
    this.userPoolClientId = userPoolClient.userPoolClientId;

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, 'WebAuth', {
      cognitoUserPools: [userPool],
      identitySource: apigw.IdentitySource.header('Authorization'),
    });

    /* SQS queue used by delete task process */
    const deadLetter = new sqs.Queue(this, 'DeleteTaskDlq', {
      queueName: `extr-srv-delete-task-dlq`,
      retentionPeriod: Duration.days(14),
    });
    const deleteQueue = new sqs.Queue(this, 'DeleteTaskQueue', {
      queueName: `extr-srv-delete-task`,
      visibilityTimeout: Duration.seconds(900),
      deadLetterQueue: { queue: deadLetter, maxReceiveCount: 5 },
    });

    /* Helper for creating Lambda-backed API endpoints */
    const createEndpoint = (
      id: string,
      resource: apigw.IResource,
      dir: string,
      role: iam.Role,
      env: { [key: string]: string },
    ) => {
      const fn = new lambda.Function(this, id, {
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: `${dir}.lambda_handler`,
        code: lambda.Code.fromAsset(`../source/extraction_service/lambda/${dir}`),
        timeout: Duration.seconds(900),
        memorySize: 128,
        ephemeralStorageSize: Size.mebibytes(512),
        role,
        environment: env,
      });

      resource.addMethod(
        'POST',
        new apigw.LambdaIntegration(fn, {
          proxy: false,
          integrationResponses: [
            {
              statusCode: '200',
              responseParameters: {
                'method.response.header.Access-Control-Allow-Origin': "'*'",
              },
            },
          ],
        }),
        {
          authorizer,
          authorizationType: apigw.AuthorizationType.COGNITO,
          methodResponses: [
            {
              statusCode: '200',
              responseParameters: {
                'method.response.header.Access-Control-Allow-Origin': true,
              },
            },
          ],
        },
      );
    };

    /* IAM roles for Lambdas */
    const basicLambdaRole = (name: string): iam.Role => {
      const role = new iam.Role(this, name, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      });
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ['logs:*'],
          resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:*`],
        }),
      );
      return role;
    };

    /* API Gateway */
    const api = new apigw.RestApi(this, 'ExtractionApi', {
      restApiName: API_NAME_PREFIX,
      deployOptions: {
        tracingEnabled: true,
        accessLogDestination: new apigw.LogGroupLogDestination(
          new logs.LogGroup(this, 'ApiAccessLogs'),
        ),
        accessLogFormat: apigw.AccessLogFormat.clf(),
        methodOptions: {
          '/*/*': { loggingLevel: apigw.MethodLoggingLevel.INFO },
        },
      },
    });

    this.apiUrl = api.url;

    const v1 = api.root.addResource('v1');
    const extraction = v1.addResource('extraction');
    const video = extraction.addResource('video');

    const createTaskRole = basicLambdaRole('CreateTaskRole');
    createTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:*'],
        resources: [
          taskTable.tableArn,
          `${taskTable.tableArn}/index/*`,
          frameTable.tableArn,
          `${frameTable.tableArn}/index/*`,
        ],
      }),
    );
    createTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:*'],
        resources: [extractionBucket.bucketArn, `${extractionBucket.bucketArn}/*`],
      }),
    );

    const createResource = video.addResource('create-task', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
      },
    });

    createEndpoint('CreateVideoTask', createResource, 'extr-srv-create-video-task', createTaskRole, {
      DYNAMO_VIDEO_TASK_TABLE: taskTable.tableName,
      DYNAMO_VIDEO_FRAME_TABLE: frameTable.tableName,
      S3_BUCKET: extractionBucket.bucketName,
      VIDEO_SAMPLE_S3_PREFIX,
    });

    const getTaskRole = basicLambdaRole('GetTaskRole');
    getTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:*'],
        resources: [
          taskTable.tableArn,
          `${taskTable.tableArn}/index/*`,
          transTable.tableArn,
          frameTable.tableArn,
          analysisTable.tableArn,
        ],
      }),
    );
    getTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:*'],
        resources: [extractionBucket.bucketArn, `${extractionBucket.bucketArn}/*`],
      }),
    );

    const getResource = video.addResource('get-task', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
      },
    });

    createEndpoint('GetVideoTask', getResource, 'extr-srv-get-video-task', getTaskRole, {
      DYNAMO_VIDEO_TASK_TABLE: taskTable.tableName,
      DYNAMO_VIDEO_TRANS_TABLE: transTable.tableName,
      DYNAMO_VIDEO_FRAME_TABLE: frameTable.tableName,
      DYNAMO_VIDEO_ANALYSIS_TABLE: analysisTable.tableName,
      S3_BUCKET: extractionBucket.bucketName,
    });
  }
}
