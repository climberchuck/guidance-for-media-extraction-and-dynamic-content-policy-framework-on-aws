import {
  Stack,
  StackProps,
  RemovalPolicy,
  Duration,
  Aws,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import {
  S3_BUCKET_NAME_PREFIX,
  COGNITO_INVITATION_EMAIL_TEMPLATE,
  COGNITO_INVITATION_EMAIL_TITLE,
  APP_NAME,
  SSM_INSTRUCTION_URL,
} from './frontend-constants';

export interface FrontendStackProps extends StackProps {
  apiExtractionUrl: string;
  apiEvaluationUrl: string;
  userPoolId: string;
  userPoolClientId: string;
  userEmails: string;
  instanceHash: string;
  opensearchDomainArn: string;
  opensearchDomainEndpoint: string;
  bastionHostId: string;
}

export class FrontendStack extends Stack {
  public readonly websiteUrl: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const {
      apiExtractionUrl,
      apiEvaluationUrl,
      userPoolId,
      userPoolClientId,
      userEmails,
      instanceHash,
      opensearchDomainArn,
      opensearchDomainEndpoint,
      bastionHostId,
    } = props;

    const accountId = Aws.ACCOUNT_ID;
    const region = Aws.REGION;

    const webBucket = new s3.Bucket(this, 'FronendWebBucket', {
      bucketName: `${S3_BUCKET_NAME_PREFIX}-web-${accountId}-${region}${instanceHash}`,
      accessControl: s3.BucketAccessControl.PRIVATE,
      websiteIndexDocument: 'index.html',
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      serverAccessLogsPrefix: 'access-log/',
      enforceSSL: true,
    });

    new s3deploy.BucketDeployment(this, 'WebBucketDeploy', {
      sources: [s3deploy.Source.asset('../source/policy_eval_frontend/web/build')],
      destinationBucket: webBucket,
    });

    const cfOai = new cloudfront.OriginAccessIdentity(
      this,
      'CloudFrontOriginAccessIdentity',
    );

    webBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [webBucket.arnForObjects('*')],
        principals: [
          new iam.CanonicalUserPrincipal(
            cfOai.cloudFrontOriginAccessIdentityS3CanonicalUserId,
          ),
        ],
      }),
    );

    const logBucket = new s3.Bucket(this, 'WebLogBucket', {
      bucketName: `${S3_BUCKET_NAME_PREFIX}-log-${accountId}-${region}${instanceHash}`,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
    });

    const distribution = new cloudfront.CloudFrontWebDistribution(
      this,
      'WebDistribution',
      {
        originConfigs: [
          {
            s3OriginSource: {
              s3BucketSource: webBucket,
              originAccessIdentity: cfOai,
            },
            behaviors: [
              {
                isDefaultBehavior: true,
                viewerProtocolPolicy:
                  cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
              },
            ],
          },
        ],
        defaultRootObject: 'index.html',
        loggingConfig: {
          bucket: logBucket,
          includeCookies: false,
          prefix: 'access-log/',
        },
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      },
    );

    this.websiteUrl = distribution.distributionDomainName;

    const provisionRole = new iam.Role(this, 'FrontendLambdaProvisionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        'frontend-lambda-provision-poliy': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:UpdateUserPool'],
              resources: [
                `arn:aws:cognito-idp:${region}:${accountId}:userpool/${userPoolId}`,
              ],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:ListBucket',
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:HeadObject',
              ],
              resources: [webBucket.bucketArn, `${webBucket.bucketArn}/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['cloudfront:CreateInvalidation'],
              resources: [`arn:aws:cloudfront::${accountId}:distribution/*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['logs:CreateLogGroup'],
              resources: [`arn:aws:logs:${region}:${accountId}:*`],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
              resources: [
                `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/front-end-provision-custom-resource${instanceHash}:*`,
              ],
            }),
          ],
        }),
      },
    });

    const provisionFn = new lambda.Function(this, 'ProvisionUpdateWebUrls', {
      functionName: `front-end-provision-custom-resource${instanceHash}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'provision-custom-resource.on_event',
      code: lambda.Code.fromAsset(
        '../source/policy_eval_frontend/lambda/provision-web',
      ),
      timeout: Duration.seconds(120),
      role: provisionRole,
      memorySize: 512,
      environment: {
        APIGW_URL_PLACE_HOLDER_EXTR_SRV: '[[[APIGATEWAY_BASE_URL_EXTR_SRV]]]'.toString(),
        APIGW_URL_PLACE_HOLDER_EVAL_SRV: '[[[APIGATEWAY_BASE_URL_EVAL_SRV]]]'.toString(),
        COGNITO_USER_POOL_ID_PLACE_HOLDER: '[[[COGNITO_USER_POOL_ID]]]'.toString(),
        COGNITO_USER_IDENTITY_POOL_ID_PLACE_HOLDER: '[[[COGNITO_IDENTITY_POOL_ID]]]'.toString(),
        COGNITO_REGION_PLACE_HOLDER: '[[[COGNITO_REGION]]]'.toString(),
        COGNITO_USER_POOL_CLIENT_ID_PLACE_HOLDER: '[[[COGNITO_USER_POOL_CLIENT_ID]]]'.toString(),
        COGNITO_USER_POOL_ID: userPoolId,
        COGNITO_USER_POOL_CLIENT_ID: userPoolClientId,
        APIGW_URL_EXTR_SRV: `${apiExtractionUrl}v1`,
        APIGW_URL_EVAL_SRV: `${apiEvaluationUrl}v1`,
        COGNITO_REGION: region,
        COGNITO_USER_IDENTITY_POOL_ID: '',
        S3_WEB_BUCKET_NAME: webBucket.bucketName,
        S3_JS_PREFIX: 'static/js/',
        CLOUD_FRONT_DISTRIBUTION_ID: distribution.distributionId,
        COGNITO_USER_EMAILS: userEmails,
        COGNITO_INVITATION_EMAIL_TEMPLATE,
        COGNITO_INVITATION_EMAIL_TITLE,
        CLOUD_FRONT_URL: distribution.distributionDomainName,
        APP_NAME,
        OPENSEARCH_DOMAIN_ENDPOINT: opensearchDomainEndpoint,
        SSM_INSTRUCTION_URL,
        BASTION_HOST_ID: bastionHostId,
      },
    });

    const invokeRole = new iam.Role(this, 'FrontendLambdaProvisionInvokeRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        'frontend-lambda-provision-invoke-poliy': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['lambda:InvokeFunction', 'lambda:InvokeAsync'],
              resources: [provisionFn.functionArn],
            }),
          ],
        }),
      },
    });

    new cr.AwsCustomResource(this, `ProvisionWeb${instanceHash}`, {
      logRetention: logs.RetentionDays.ONE_WEEK,
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        physicalResourceId: cr.PhysicalResourceId.of('Trigger'),
        parameters: {
          FunctionName: provisionFn.functionName,
          InvocationType: 'RequestResponse',
          Payload: '{"RequestType": "Create"}',
        },
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
      role: invokeRole,
    });
  }
}
