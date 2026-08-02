import { Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";
import type { AppEnvironment } from "../config/app-environment.js";

export type PortfolioCertificateStackProps = StackProps & {
  appEnvironment: AppEnvironment;
  /** The CloudFront alias, e.g. `portfolio.dev.kgwari.com`. */
  portfolioDomainName: string;
  /** The zone answering the validation record, e.g. `dev.kgwari.com`. */
  portfolioHostedZoneName: string;
};

/**
 * The CloudFront certificate, in us-east-1 because CloudFront takes them from
 * nowhere else — while the site itself lives in eu-west-1 with everything.
 *
 * It replaces a `PORTFOLIO_CERTIFICATE_ARN` pasted into a GitHub variable. That
 * string could not express the constraint it was carrying: a certificate is
 * bound to a region *and* an account, and both changed in this migration, so
 * the old value would have failed only at deploy — the same way the backend's
 * did during the first region attempt.
 *
 * **The zone is looked up rather than created.** `dev.kgwari.com` belongs to
 * the backend's dns stack, in this same account. Looking it up by name is the
 * loose coupling that suits a repository boundary: this stack does not own the
 * zone, must not delete it, and should not need a CloudFormation export from
 * another repository to find it.
 */
export class PortfolioCertificateStack extends Stack {
  public readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: PortfolioCertificateStackProps) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromLookup(this, "PortfolioHostedZone", {
      domainName: props.portfolioHostedZoneName
    });

    this.certificate = new acm.Certificate(this, "PortfolioCertificate", {
      domainName: props.portfolioDomainName,
      validation: acm.CertificateValidation.fromDns(hostedZone)
    });
  }
}
