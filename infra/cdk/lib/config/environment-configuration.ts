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
  /**
   * **The prefix names the property; the environment names the channel.** The
   * stacks are `kgwari-web-*` because they live in the `kgwari-web` account
   * alongside the blog and engineering writing that will follow — while the
   * environment stays `production`, matching the GitHub environment and the
   * other repositories. Calling them `kgwari-production-*` inside `kgwari-web`
   * would read as the product's production, which is a different account
   * entirely.
   *
   * `allowDestructiveChanges` is false: the bucket is `RETAIN`, and the site is
   * something people hold a link to.
   */
  production: {
    appEnvironment: "production",
    stackNamePrefix: "kgwari-web",
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
