import type { AppEnvironment } from "./app-environment.js";

/**
 * Ireland, following the platform out of Cape Town — see kgwari-docs
 * `platform/region-move-aws-preparation.md`. The portfolio moved after the
 * product rather than with it: renaming its stacks in the region it was about
 * to leave would have paid for the same migration twice.
 */
const DEFAULT_AWS_REGION = "eu-west-1";

export type EnvironmentConfiguration = Readonly<{
  appEnvironment: AppEnvironment;
  stackNamePrefix: string;
  infrastructure: Readonly<{
    allowDestructiveChanges: boolean;
    defaultRegion: string;
  }>;
}>;

export const ENVIRONMENT_CONFIGURATIONS: Record<AppEnvironment, EnvironmentConfiguration> = {
  dev: {
    appEnvironment: "dev",
    stackNamePrefix: "kgwari-dev",
    infrastructure: {
      allowDestructiveChanges: true,
      defaultRegion: DEFAULT_AWS_REGION
    }
  },
  beta: {
    appEnvironment: "beta",
    stackNamePrefix: "kgwari-beta",
    infrastructure: {
      allowDestructiveChanges: false,
      defaultRegion: DEFAULT_AWS_REGION
    }
  },
  production: {
    appEnvironment: "production",
    stackNamePrefix: "kgwari-production",
    infrastructure: {
      allowDestructiveChanges: false,
      defaultRegion: DEFAULT_AWS_REGION
    }
  }
};

export function getEnvironmentConfiguration(
  appEnvironment: AppEnvironment
): EnvironmentConfiguration {
  return ENVIRONMENT_CONFIGURATIONS[appEnvironment];
}
