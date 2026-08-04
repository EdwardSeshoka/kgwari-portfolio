import { CfnOutput, Fn, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as route53 from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";
import type { AppEnvironment } from "../config/app-environment.js";
import { getEnvironmentConfiguration } from "../config/environment-configuration.js";

export type PortfolioDnsStackProps = StackProps & {
  appEnvironment: AppEnvironment;
  /** The zone this account owns, e.g. `portfolio.kgwari.com`. */
  portfolioHostedZoneName: string;
};

/**
 * The portfolio's own hosted zone — created here rather than looked up.
 *
 * **Why it is created.** The zone used to be `dev.kgwari.com`, borrowed from
 * the backend's dns stack via `HostedZone.fromLookup`. Two problems, and only
 * one of them was the borrowing. A lookup needs credentials at synth, caches
 * into `cdk.context.json`, and fails in the worst available way: when it cannot
 * resolve a zone it can return a *dummy* value, so synth succeeds and the
 * deploy writes records into a zone that does not exist. A zone created here
 * cannot be the wrong zone.
 *
 * **What stays manual, and why it must.** Delegation. The four nameservers have
 * to be written into the `kgwari.com` apex as an NS record, and the apex lives
 * in the management account — so nothing in this account can write it. They are
 * published as a stack output for exactly that reason:
 * `scripts/aws/bootstrap-account.mjs` reads them, assumes the delegation role in
 * the management account, and waits for the delegation to resolve before any
 * certificate is attempted.
 *
 * **Retained on purpose.** Destroying a zone and recreating it produces four
 * *different* nameservers, silently invalidating the delegation and taking the
 * site's DNS with it. Certificate validation then stalls at "pending" rather
 * than failing, which is a bad hour.
 */
export class PortfolioDnsStack extends Stack {
  public readonly hostedZone: route53.PublicHostedZone;

  constructor(scope: Construct, id: string, props: PortfolioDnsStackProps) {
    super(scope, id, { ...props, terminationProtection: true });

    const environmentConfiguration = getEnvironmentConfiguration(props.appEnvironment);
    const constructId = toConstructId(props.portfolioHostedZoneName);

    this.hostedZone = new route53.PublicHostedZone(this, constructId, {
      zoneName: props.portfolioHostedZoneName,
      comment: `${environmentConfiguration.stackNamePrefix} — delegated from the apex in the management account`
    });

    this.hostedZone.applyRemovalPolicy(RemovalPolicy.RETAIN);

    // `Fn.join` because the nameserver list is a deploy-time token — rendering
    // it in TypeScript would print `${Token[…]}` rather than four hostnames.
    new CfnOutput(this, `${constructId}Nameservers`, {
      value: Fn.join(", ", this.hostedZone.hostedZoneNameServers ?? []),
      description: `NS records to add for ${props.portfolioHostedZoneName} in the kgwari.com zone (management account)`,
      exportName: `${environmentConfiguration.stackNamePrefix}-${constructId}-nameservers`
    });

    new CfnOutput(this, `${constructId}ZoneId`, {
      value: this.hostedZone.hostedZoneId,
      description: `Hosted zone id for ${props.portfolioHostedZoneName}`
    });
  }
}

/** `portfolio.kgwari.com` → `PortfolioKgwariCom`, so a zone rename cannot silently replace another. */
function toConstructId(zoneName: string): string {
  return zoneName
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}
