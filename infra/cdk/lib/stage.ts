import { Stage, type StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import type { AppEnvironment } from "./config/app-environment.js";
import { getEnvironmentConfiguration } from "./config/environment-configuration.js";
import type { DeploymentPortfolioConfiguration } from "./config/environment-resolver.js";
import { PortfolioCertificateStack } from "./stacks/portfolio-certificate-stack.js";
import { PortfolioStack } from "./stacks/portfolio-stack.js";

export type PortfolioStageProps = StageProps & {
  appEnvironment: AppEnvironment;
  portfolio: DeploymentPortfolioConfiguration;
};

export class PortfolioStage extends Stage {
  constructor(scope: Construct, id: string, props: PortfolioStageProps) {
    super(scope, id, props);

    const environmentConfiguration = getEnvironmentConfiguration(props.appEnvironment);

    /**
     * CloudFront accepts certificates from us-east-1 only, so this one stack
     * sits in Virginia while the site sits in Ireland. `crossRegionReferences`
     * is what carries the ARN back across.
     */
    const certificate =
      props.portfolio.domainName && props.portfolio.hostedZoneName
        ? new PortfolioCertificateStack(this, "portfolio-certificate", {
            appEnvironment: props.appEnvironment,
            stackName: `${environmentConfiguration.stackNamePrefix}-portfolio-certificate`,
            ...(this.account ? { env: { account: this.account, region: "us-east-1" } } : {}),
            crossRegionReferences: true,
            portfolioDomainName: props.portfolio.domainName,
            portfolioHostedZoneName: props.portfolio.hostedZoneName
          }).certificate
        : undefined;

    new PortfolioStack(this, "portfolio", {
      appEnvironment: props.appEnvironment,
      stackName: `${environmentConfiguration.stackNamePrefix}-portfolio`,
      crossRegionReferences: true,
      ...(props.portfolio.domainName ? { portfolioDomainName: props.portfolio.domainName } : {}),
      ...(props.portfolio.hostedZoneName
        ? { portfolioHostedZoneName: props.portfolio.hostedZoneName }
        : {}),
      ...(certificate ? { portfolioCertificate: certificate } : {})
    });
  }
}
