import { App } from "aws-cdk-lib";
import {
  DEFAULT_APP_ENVIRONMENT,
  resolveDeploymentEnvironmentConfiguration,
  resolveDeploymentTargetEnvironments
} from "../lib/config/environment-resolver.js";
import { PortfolioStage } from "../lib/stage.js";

const app = new App();

const deploymentTargets = resolveDeploymentTargetEnvironments({
  environment: process.env,
  readContext,
  fallbackTargets: [DEFAULT_APP_ENVIRONMENT]
});

for (const appEnvironment of deploymentTargets) {
  const deploymentConfiguration = resolveDeploymentEnvironmentConfiguration(appEnvironment, {
    environment: process.env,
    readContext,
    fallbackTargets: deploymentTargets
  });

  if (!deploymentConfiguration.account) {
    throw new Error(
      `Account not configured for environment ${appEnvironment}. Fill in '${appEnvironment}AccountId' in cdk.json, which is where it belongs — or, for a one-off synth, pass -c ${appEnvironment}AccountId=… or set ${appEnvironment.toUpperCase()}_ACCOUNT_ID.`
    );
  }

  new PortfolioStage(app, deploymentConfiguration.stackNamePrefix, {
    env: {
      account: deploymentConfiguration.account,
      region: deploymentConfiguration.region
    },
    appEnvironment,
    portfolio: deploymentConfiguration.portfolio
  });
}

function readContext(key: string): string | undefined {
  const value = app.node.tryGetContext(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
