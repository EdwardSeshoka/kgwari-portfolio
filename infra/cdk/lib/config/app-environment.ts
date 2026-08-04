/**
 * One target, not three.
 *
 * The portfolio is the public content property, not an environment of the
 * product — see kgwari-docs `platform/web-content-account.md`. It has one
 * account, one domain and one audience, so `dev` and `beta` were targets that
 * could be selected and never deployed. A selectable target with no account
 * behind it fails at deploy rather than at synth, which is the worst place to
 * find out.
 *
 * The shape is kept — an environment axis, resolved the same way — because the
 * content property may yet want a staging copy, and because the resolver reads
 * every context key through it.
 */
export const APP_ENVIRONMENTS = ["production"] as const;

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export const DEFAULT_APP_ENVIRONMENT: AppEnvironment = "production";

const APP_ENVIRONMENT_ALIASES: Record<string, AppEnvironment> = {
  production: "production",
  prod: "production"
};

export function parseAppEnvironment(value: unknown): AppEnvironment | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  return APP_ENVIRONMENT_ALIASES[normalized] ?? null;
}

export function parseAppEnvironmentList(value: unknown): AppEnvironment[] {
  if (typeof value !== "string") return [];

  const resolved = new Set<AppEnvironment>();

  for (const token of value.split(/[,\s]+/)) {
    const appEnvironment = parseAppEnvironment(token);
    if (appEnvironment) resolved.add(appEnvironment);
  }

  return [...resolved];
}

export function toScopedEnvironmentVariableName(
  appEnvironment: AppEnvironment,
  keySuffix: string
): string {
  return `${appEnvironment.toUpperCase()}_${keySuffix}`;
}

export function toScopedContextKey(appEnvironment: AppEnvironment, keySuffix: string): string {
  return `${appEnvironment}${keySuffix}`;
}
