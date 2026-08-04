import {
  DEFAULT_APP_ENVIRONMENT,
  parseAppEnvironmentList,
  toScopedContextKey,
  toScopedEnvironmentVariableName,
  type AppEnvironment
} from "./app-environment.js";
import {
  getEnvironmentConfiguration,
  type EnvironmentConfiguration
} from "./environment-configuration.js";

export { DEFAULT_APP_ENVIRONMENT };

/**
 * Two values, and neither is an identifier. The hosted zone id and the
 * certificate ARN used to be resolved here too; both are now *created* — by
 * `PortfolioDnsStack` and `PortfolioCertificateStack` — so there is nothing to
 * paste and nothing that can be pasted pointing at the wrong account or region.
 */
export type DeploymentPortfolioConfiguration = Readonly<{
  domainName?: string;
  hostedZoneName?: string;
}>;

export type DeploymentEnvironmentConfiguration = EnvironmentConfiguration &
  Readonly<{
    account: string;
    region: string;
    portfolio: DeploymentPortfolioConfiguration;
  }>;

export type DeploymentEnvironmentResolverInput = Readonly<{
  environment?: Readonly<Record<string, string | undefined>>;
  readContext?: (key: string) => string | undefined;
  fallbackTargets?: readonly AppEnvironment[];
}>;

export function resolveDeploymentTargetEnvironments(
  input: DeploymentEnvironmentResolverInput = {}
): AppEnvironment[] {
  const environment = input.environment ?? process.env;
  const readContext = input.readContext ?? (() => undefined);
  const requestedTargets = firstDefined(
    environment.DEPLOY_ENVIRONMENTS,
    environment.DEPLOY_ENVIRONMENT,
    readContext("deployEnvironments"),
    readContext("deployEnvironment")
  );

  const resolvedTargets = parseAppEnvironmentList(requestedTargets);

  if (resolvedTargets.length > 0) return resolvedTargets;
  if (input.fallbackTargets?.length) return [...input.fallbackTargets];

  return [DEFAULT_APP_ENVIRONMENT];
}

export function resolveDeploymentEnvironmentConfiguration(
  appEnvironment: AppEnvironment,
  input: DeploymentEnvironmentResolverInput = {}
): DeploymentEnvironmentConfiguration {
  const environment = input.environment ?? process.env;
  const readContext = input.readContext ?? (() => undefined);
  const environmentConfiguration = getEnvironmentConfiguration(appEnvironment);
  const deploymentTargets = input.fallbackTargets
    ? resolveDeploymentTargetEnvironments({
        environment,
        readContext,
        fallbackTargets: input.fallbackTargets
      })
    : resolveDeploymentTargetEnvironments({ environment, readContext });
  const allowSharedEnvironmentVariables =
    deploymentTargets.length === 1 && deploymentTargets[0] === appEnvironment;

  const account =
    firstDefined(
      readScopedEnvironmentValue(
        appEnvironment,
        "ACCOUNT_ID",
        "AccountId",
        environment,
        readContext
      ),
      allowSharedEnvironmentVariables ? environment.ACCOUNT_ID : undefined,
      environment.CDK_DEFAULT_ACCOUNT
    ) ?? "";

  const region =
    firstDefined(
      readScopedEnvironmentValue(appEnvironment, "REGION", "Region", environment, readContext),
      allowSharedEnvironmentVariables ? environment.AWS_REGION : undefined,
      allowSharedEnvironmentVariables ? environment.REGION : undefined,
      environment.CDK_DEFAULT_REGION,
      readContext("defaultRegion"),
      environmentConfiguration.infrastructure.defaultRegion
    ) ?? environmentConfiguration.infrastructure.defaultRegion;

  const domainName = firstDefined(
    readScopedEnvironmentValue(
      appEnvironment,
      "PORTFOLIO_DOMAIN_NAME",
      "PortfolioDomainName",
      environment,
      readContext
    ),
    allowSharedEnvironmentVariables ? environment.PORTFOLIO_DOMAIN_NAME : undefined
  );

  const hostedZoneName = firstDefined(
    readScopedEnvironmentValue(
      appEnvironment,
      "PORTFOLIO_HOSTED_ZONE_NAME",
      "PortfolioHostedZoneName",
      environment,
      readContext
    ),
    allowSharedEnvironmentVariables ? environment.PORTFOLIO_HOSTED_ZONE_NAME : undefined
  );

  return {
    ...environmentConfiguration,
    account,
    region,
    portfolio: {
      ...(domainName ? { domainName } : {}),
      ...(hostedZoneName ? { hostedZoneName } : {})
    }
  };
}

function readScopedEnvironmentValue(
  appEnvironment: AppEnvironment,
  envKeySuffix: string,
  contextKeySuffix: string,
  environment: Readonly<Record<string, string | undefined>>,
  readContext: (key: string) => string | undefined
): string | undefined {
  return firstDefined(
    environment[toScopedEnvironmentVariableName(appEnvironment, envKeySuffix)],
    readContext(toScopedContextKey(appEnvironment, contextKeySuffix))
  );
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (!value) continue;

    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }

  return undefined;
}
