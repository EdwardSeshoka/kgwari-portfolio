import { Stage, type StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import type { AppEnvironment } from "./config/app-environment.js";
import { getEnvironmentConfiguration } from "./config/environment-configuration.js";
import type { DeploymentPortfolioConfiguration } from "./config/environment-resolver.js";
import { PortfolioCertificateStack } from "./stacks/portfolio-certificate-stack.js";
import { PortfolioDnsStack } from "./stacks/portfolio-dns-stack.js";
import { PortfolioStack } from "./stacks/portfolio-stack.js";

export type PortfolioStageProps = StageProps & {
  appEnvironment: AppEnvironment;
  portfolio: DeploymentPortfolioConfiguration;
};

/**
 * Three stacks, in one order: dns, certificate, portfolio.
 *
 * The order is not cosmetic. The zone must exist before its nameservers can be
 * delegated, and the delegation must be live before the certificate is
 * attempted — ACM against an undelegated zone does not fail, it sits at
 * "pending" for hours, and the deploy that follows looks hung rather than
 * misconfigured. `scripts/aws/bootstrap-account.mjs` deploys them with the
 * delegation in between, which is why it exists.
 */
export class PortfolioStage extends Stage {
  constructor(scope: Construct, id: string, props: PortfolioStageProps) {
    super(scope, id, props);

    const environmentConfiguration = getEnvironmentConfiguration(props.appEnvironment);
    const { domainName, hostedZoneName } = props.portfolio;

    const dns =
      hostedZoneName !== undefined
        ? new PortfolioDnsStack(this, "dns", {
            appEnvironment: props.appEnvironment,
            stackName: `${environmentConfiguration.stackNamePrefix}-dns`,
            portfolioHostedZoneName: hostedZoneName
          })
        : undefined;

    /**
     * CloudFront accepts certificates from us-east-1 only, so this one stack
     * sits in Virginia while the site sits in Ireland. `crossRegionReferences`
     * is what carries the zone id out and the certificate ARN back.
     */
    const certificate =
      domainName && dns
        ? new PortfolioCertificateStack(this, "portfolio-certificate", {
            appEnvironment: props.appEnvironment,
            stackName: `${environmentConfiguration.stackNamePrefix}-portfolio-certificate`,
            ...(this.account ? { env: { account: this.account, region: "us-east-1" } } : {}),
            crossRegionReferences: true,
            portfolioDomainName: domainName,
            portfolioHostedZoneName: dns.hostedZone.zoneName,
            portfolioHostedZoneId: dns.hostedZone.hostedZoneId
          }).certificate
        : undefined;

    new PortfolioStack(this, "portfolio", {
      appEnvironment: props.appEnvironment,
      stackName: `${environmentConfiguration.stackNamePrefix}-portfolio`,
      crossRegionReferences: true,
      ...(domainName ? { portfolioDomainName: domainName } : {}),
      ...(dns
        ? {
            portfolioHostedZoneName: dns.hostedZone.zoneName,
            portfolioHostedZoneId: dns.hostedZone.hostedZoneId
          }
        : {}),
      ...(certificate ? { portfolioCertificate: certificate } : {})
    });
  }
}
