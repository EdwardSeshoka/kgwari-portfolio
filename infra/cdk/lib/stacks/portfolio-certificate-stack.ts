import { Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";
import type { AppEnvironment } from "../config/app-environment.js";

export type PortfolioCertificateStackProps = StackProps & {
  appEnvironment: AppEnvironment;
  /** The CloudFront alias, e.g. `portfolio.kgwari.com`. */
  portfolioDomainName: string;
  /** The zone answering the validation record, created by PortfolioDnsStack. */
  portfolioHostedZoneName: string;
  portfolioHostedZoneId: string;
};

/**
 * The CloudFront certificate, in us-east-1 because CloudFront takes them from
 * nowhere else — while the site itself lives in eu-west-1 with everything.
 *
 * It replaces a `PORTFOLIO_CERTIFICATE_ARN` pasted into a GitHub variable. That
 * string could not express the constraint it was carrying: a certificate is
 * bound to a region *and* an account, and both changed in the region move, so
 * the old value would have failed only at deploy — the same way the backend's
 * did during the first region attempt.
 *
 * **The zone arrives as an id, not as a lookup.** It is created by
 * `PortfolioDnsStack` in this same account, in the home region; `hostedZoneId`
 * crosses into us-east-1 as a token through `crossRegionReferences`. Route 53
 * is global, so a zone created in one region is writable from a stack in
 * another. What this buys over `fromLookup` is that a zone which does not exist
 * cannot resolve to a dummy value and let synth pass.
 *
 * **Validation cannot succeed before the delegation does.** ACM against an
 * undelegated zone does not error — it sits at "pending" for hours. Deploy this
 * stack only after `scripts/aws/bootstrap-account.mjs` has written the NS record
 * into the apex and confirmed it resolves.
 */
export class PortfolioCertificateStack extends Stack {
  public readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: PortfolioCertificateStackProps) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "PortfolioHostedZone", {
      hostedZoneId: props.portfolioHostedZoneId,
      zoneName: props.portfolioHostedZoneName
    });

    this.certificate = new acm.Certificate(this, "PortfolioCertificate", {
      domainName: props.portfolioDomainName,
      validation: acm.CertificateValidation.fromDns(hostedZone)
    });
  }
}
