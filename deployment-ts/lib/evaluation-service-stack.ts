import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  Size,
  Aws,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as eventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import {
  API_NAME_PREFIX,
  BEDROCK_DEFAULT_MODEL_ID,
  BEDROCK_ANTHROPIC_CLAUDE_SONNET_V3,
  BEDROCK_ANTHROPIC_CLAUDE_SONNET_V3_MODEL_VERSION,
  DYNAMO_EVAL_TASK_TABLE,
} from './evaluation-constants';

export interface EvaluationServiceProps extends StackProps {
  userPoolId: string;
  /** Unique string appended to named resources */
  instanceHash: string;
  /** Region for invoking Bedrock models */
  bedrockRegion: string;
}

export class EvaluationServiceStack extends Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: EvaluationServiceProps) {
    super(scope, id, props);
    const { userPoolId, instanceHash, bedrockRegion } = props;

    /* DynamoDB table for evaluation tasks */
    const taskTable = new dynamodb.Table(this, 'EvalTaskTable', {
      tableName: DYNAMO_EVAL_TASK_TABLE,
      partitionKey: { name: 'Id', type: dynamodb.AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });

    taskTable.addGlobalSecondaryIndex({
      indexName: 'VideoTaskId-index',
      partitionKey: { name: 'VideoTaskId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    /* SQS queue for async task processing */
    const dlQueue = new sqs.Queue(this, 'EvalSrvDeadLetterQueue', {
      queueName: `eval-srv-task-dead-letter-queue${instanceHash}`,
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(14),
    });

    const taskQueue = new sqs.Queue(this, 'EvalSrvTaskQueue', {
      queueName: `eval-srv-task-queue${instanceHash}`,
      deliveryDelay: Duration.seconds(30),
      visibilityTimeout: Duration.seconds(900),
      deadLetterQueue: {
        queue: dlQueue,
        maxReceiveCount: 1000,
      },
    });

    /* Lambda processing tasks from SQS */
    const processorRole = new iam.Role(this, 'TaskProcessorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    processorRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:*'],
        resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:*`],
      }),
    );
    processorRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sqs:*'],
        resources: [taskQueue.queueArn],
      }),
    );
    processorRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/amazon.titan*',
          'arn:aws:bedrock:*::foundation-model/anthropic.*',
        ],
      }),
    );
    processorRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:*'],
        resources: [
          `arn:aws:dynamodb:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${DYNAMO_EVAL_TASK_TABLE}`,
          `arn:aws:dynamodb:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${DYNAMO_EVAL_TASK_TABLE}/index/*`,
        ],
      }),
    );

    const taskProcessor = new lambda.Function(this, 'TaskProcessorLambda', {
      functionName: `eval-srv-create-task-processor${instanceHash}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'eval-srv-create-task-processor.lambda_handler',
      code: lambda.Code.fromAsset(
        '../source/evaluation_service/lambda/eval-srv-create-task-processor',
      ),
      timeout: Duration.seconds(900),
      memorySize: 128,
      ephemeralStorageSize: Size.mebibytes(512),
      role: processorRole,
      environment: {
        DYNAMO_EVAL_TASK_TABLE,
        SQS_URL: taskQueue.queueUrl,
        BEDROCK_REGION: bedrockRegion,
        BEDROCK_ANTHROPIC_CLAUDE_SONNET_V3,
      },
    });

    taskProcessor.addEventSource(
      new eventSources.SqsEventSource(taskQueue, { batchSize: 1 }),
    );

    /* API Gateway and Lambda integrations */
    const userPool = cognito.UserPool.fromUserPoolId(this, 'WebUserPool', userPoolId);

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(
      this,
      `EvalSrvAuth${instanceHash}`,
      {
        cognitoUserPools: [userPool],
        identitySource: apigw.IdentitySource.header('Authorization'),
      },
    );

    const api = new apigw.RestApi(this, `EvalApi${instanceHash}`, {
      restApiName: `${API_NAME_PREFIX}${instanceHash}`,
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
    const ev = v1.addResource('evaluation');

    const createEndpoint = (
      id: string,
      path: string,
      dir: string,
      role: iam.Role,
      env: { [key: string]: string },
    ) => {
      const fn = new lambda.Function(this, id, {
        functionName: `${dir}${instanceHash}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: `${dir}.lambda_handler`,
        code: lambda.Code.fromAsset(`../source/evaluation_service/lambda/${dir}`),
        memorySize: 128,
        timeout: Duration.seconds(30),
        ephemeralStorageSize: Size.mebibytes(512),
        role,
        environment: env,
      });

      const resource = ev.addResource(path, {
        defaultCorsPreflightOptions: {
          allowMethods: ['POST', 'OPTIONS'],
          allowOrigins: apigw.Cors.ALL_ORIGINS,
        },
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

    /* Invoke LLM endpoint */
    const invokeRole = new iam.Role(this, 'InvokeLlmRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    invokeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:*'],
        resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:*`],
      }),
    );
    invokeRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/amazon.titan*',
          'arn:aws:bedrock:*::foundation-model/anthropic.*',
        ],
      }),
    );

    createEndpoint('InvokeLlm', 'invoke-llm', 'eval-srv-llms-invoke', invokeRole, {
      BEDROCK_DEFAULT_MODEL_ID,
      BEDROCK_REGION: bedrockRegion,
      BEDROCK_ANTHROPIC_CLAUDE_SONNET_V3,
      BEDROCK_ANTHROPIC_CLAUDE_SONNET_V3_MODEL_VERSION,
    });

    /* Create task endpoint */
    const createTaskRole = new iam.Role(this, 'CreateTaskRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    createTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:*'],
        resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:*`],
      }),
    );
    createTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sqs:*'],
        resources: [taskQueue.queueArn],
      }),
    );
    createTaskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:*'],
        resources: [
          `arn:aws:dynamodb:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${DYNAMO_EVAL_TASK_TABLE}`,
          `arn:aws:dynamodb:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${DYNAMO_EVAL_TASK_TABLE}/index/*`,
        ],
      }),
    );

    createEndpoint('CreateTask', 'create-task', 'eval-srv-create-task', createTaskRole, {
      DYNAMO_EVAL_TASK_TABLE,
      SQS_URL: taskQueue.queueUrl,
    });

    /* Delete task endpoint */
    const deleteRole = new iam.Role(this, 'DeleteTaskRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    deleteRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:*'],
        resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:*`],
      }),
    );
    deleteRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:*'],
        resources: [
          `arn:aws:dynamodb:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${DYNAMO_EVAL_TASK_TABLE}`,
          `arn:aws:dynamodb:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${DYNAMO_EVAL_TASK_TABLE}/index/*`,
        ],
      }),
    );

    createEndpoint('DeleteTask', 'delete-task', 'eval-srv-delete-task', deleteRole, {
      DYNAMO_EVAL_TASK_TABLE,
    });

    /* Get tasks endpoint */
    const getTasksRole = new iam.Role(this, 'GetTasksRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    getTasksRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:*'],
        resources: [`arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:*`],
      }),
    );
    getTasksRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:*'],
        resources: [
          `arn:aws:dynamodb:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${DYNAMO_EVAL_TASK_TABLE}`,
          `arn:aws:dynamodb:${Aws.REGION}:${Aws.ACCOUNT_ID}:table/${DYNAMO_EVAL_TASK_TABLE}/index/*`,
        ],
      }),
    );

    createEndpoint('GetTasks', 'get-tasks', 'eval-srv-get-tasks', getTasksRole, {
      DYNAMO_EVAL_TASK_TABLE,
    });
  }
}
