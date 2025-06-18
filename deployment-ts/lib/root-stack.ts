import { Stack, StackProps, Duration, CfnOutput, CfnParameter, Aws } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ExtractionServiceStack } from './extraction-service-stack';
import { EvaluationServiceStack } from './evaluation-service-stack';
import { FrontendStack } from './frontend-stack';

export class RootStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const inputUserEmails = new CfnParameter(this, 'inputUserEmails', {
      type: 'String',
      description: 'Comma separated emails for portal access',
    });

    // Placeholder: instantiate sub stacks with minimal parameters
    const extraction = new ExtractionServiceStack(this, 'ExtractionServiceStack', {
      userEmails: inputUserEmails.valueAsString,
    });

    const evaluation = new EvaluationServiceStack(this, 'EvaluationServiceStack', {
      userPoolId: extraction.userPoolId,
      instanceHash: '',
      bedrockRegion: Aws.REGION,
    });

    const frontend = new FrontendStack(this, 'FrontStack', {
      apiExtractionUrl: extraction.apiUrl,
      apiEvaluationUrl: evaluation.apiUrl,
      userPoolId: extraction.userPoolId,
      userPoolClientId: extraction.userPoolClientId,
      userEmails: inputUserEmails.valueAsString,
      instanceHash: '',
      opensearchDomainArn: '',
      opensearchDomainEndpoint: '',
      bastionHostId: '',
    });

    new CfnOutput(this, 'WebsiteURL', { value: frontend.websiteUrl });
    new CfnOutput(this, 'ExtractionApiUrl', { value: extraction.apiUrl });
    new CfnOutput(this, 'EvaluationApiUrl', { value: evaluation.apiUrl });
  }
}
