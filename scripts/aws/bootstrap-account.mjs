#!/usr/bin/env node

/**
 * Builds the `kgwari-web` account from nothing, in dependency order, carrying
 * outputs between stacks so nothing is copied by hand.
 *
 * Adapted from kgwari-backend-app `scripts/aws/bootstrap-environment.mjs`. The
 * portfolio account has fewer stacks and one environment, but the ordering
 * constraint is identical and is the reason both scripts exist: DNS must exist
 * before any certificate can validate, and the delegation must be live before
 * validation is attempted — ACM against an undelegated zone does not fail, it
 * sits at "pending" for hours, and the deploy that follows looks hung rather
 * than misconfigured.
 *
 *   1. verify we are in the account cdk.json names
 *   2. deploy the account foundation — OIDC provider, permissions boundary
 *   3. bootstrap eu-west-1 and us-east-1 if they are not already
 *   4. deploy the CI role — now that the bootstrap roles it names exist
 *   5. deploy the dns stack, read its nameservers from the stack outputs
 *   6. write the NS delegation into the apex zone in the management account
 *   7. wait until the delegation actually resolves
 *   8. deploy the certificate, then the site
 *
 * Step 6 needs a role in the management account — see kgwari-backend-app
 * `infra/aws/route53-delegation-role.yaml`, which must trust this account and
 * permit this zone's record name. Without `delegationRoleArn` the script prints
 * the nameservers and waits for you to add them by hand, then carries on; the
 * automation is a convenience, not a dependency.
 *
 * Usage:
 *   npm run account:build
 *   npm run account:build:dry-run
 */

import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveNs } from "node:dns/promises";

import { DEFAULT_APP_ENVIRONMENT } from "../../dist/infra/cdk/lib/config/app-environment.js";
import { getEnvironmentConfiguration } from "../../dist/infra/cdk/lib/config/environment-configuration.js";

const APEX_ZONE_NAME = process.env.APEX_ZONE_NAME ?? "kgwari.com";
const DNS_TIMEOUT_MS = Number(process.env.DNS_TIMEOUT_MS ?? 10 * 60 * 1000);
const BOUNDARY_NAME = process.env.BOUNDARY_NAME ?? "kgwari-cdk-boundary";

const dryRun = process.argv.slice(2).includes("--dry-run");

const appEnvironment = DEFAULT_APP_ENVIRONMENT;
const configuration = getEnvironmentConfiguration(appEnvironment);
const prefix = configuration.stackNamePrefix;
const region = configuration.infrastructure.defaultRegion;
const context = JSON.parse(readFileSync("cdk.json", "utf8")).context;

const expectedAccount = trimmed(context[`${appEnvironment}AccountId`]);
const zoneName = trimmed(context[`${appEnvironment}PortfolioHostedZoneName`]);
const DELEGATION_ROLE_ARN =
  process.env.DELEGATION_ROLE_ARN ?? trimmed(context.delegationRoleArn);

/**
 * Regions needing a CDKToolkit stack. `us-east-1` is not optional — it holds
 * the CloudFront certificate, and its absence surfaces only at the last stack.
 */
const BOOTSTRAP_REGIONS = [region, "us-east-1"];

main().catch((error) => fail(error.message));

async function main() {
  step(`Building ${prefix} — account ${expectedAccount ?? "?"}, region ${region}`);

  if (!expectedAccount) {
    fail(
      `cdk.json has no ${appEnvironment}AccountId. Fill it in with the kgwari-web account id before deploying — the resolver has no ambient fallback, on purpose.`
    );
  }

  if (!zoneName) {
    fail(`cdk.json has no ${appEnvironment}PortfolioHostedZoneName. There is no zone to create.`);
  }

  // 1. The wrong-account guard. Cheap, and the failure it prevents is not.
  const actualAccount = aws(["sts", "get-caller-identity", "--query", "Account", "--output", "text"]);
  if (actualAccount !== expectedAccount) {
    fail(
      `Logged into account ${actualAccount}, but cdk.json names ${expectedAccount}. Switch profile before continuing.`
    );
  }
  ok(`account ${actualAccount} confirmed`);

  // 2. The account foundation. Idempotent CloudFormation. The boundary must
  // precede bootstrap, because `--custom-permissions-boundary` names a policy
  // that has to already exist.
  step("Deploying the account foundation");
  cfnDeploy("kgwari-github-oidc-provider", "infra/aws/github-oidc-provider.yaml");
  cfnDeploy("kgwari-cdk-permissions-boundary", "infra/aws/cdk-permissions-boundary.yaml", {
    namedIam: true
  });
  ok("OIDC provider and permissions boundary in place");

  // 3. Bootstrap, if it is missing. Idempotent — an already-bootstrapped region
  // is a no-op, so this costs a describe-stacks on every run and saves the
  // "has not been bootstrapped" failure on the first one.
  for (const bootstrapRegion of new Set(BOOTSTRAP_REGIONS)) {
    if (isBootstrapped(bootstrapRegion)) {
      ok(`${bootstrapRegion} already bootstrapped`);
      continue;
    }

    step(`Bootstrapping ${bootstrapRegion}`);
    run("npx", [
      "cdk",
      "bootstrap",
      `aws://${expectedAccount}/${bootstrapRegion}`,
      "--template",
      "infra/aws/cdk-bootstrap-template.yaml",
      "--custom-permissions-boundary",
      BOUNDARY_NAME
    ]);

    // Deleting CDKToolkit breaks every deploy in the account/region pair, and
    // nothing warns you first.
    aws(
      [
        "cloudformation",
        "update-termination-protection",
        "--stack-name",
        "CDKToolkit",
        "--enable-termination-protection"
      ],
      undefined,
      bootstrapRegion
    );
    ok(`${bootstrapRegion} bootstrapped and protected`);
  }

  // 4. The CI deploy role. After bootstrap, because its policy names the
  // `cdk-*` roles it is allowed to assume — and a role granting access to ARNs
  // that do not exist yet is a policy nobody can verify by reading.
  step("Deploying the CI deploy role");
  cfnDeploy("kgwari-github-actions-portfolio-role", "infra/aws/github-actions-role.yaml", {
    namedIam: true,
    parameters: [`GitHubEnvironment=${appEnvironment}`, `StackNamePrefix=${prefix}`]
  });
  const deployRoleArn = roleArnFrom("kgwari-github-actions-portfolio-role");
  ok(`deploy role ${deployRoleArn}`);

  // 5. DNS first, capturing outputs rather than reading them off the console.
  step("Deploying dns");
  const outputsFile = join(mkdtempSync(join(tmpdir(), "kgwari-")), "dns-outputs.json");
  cdkDeploy(`${prefix}/dns`, ["--outputs-file", outputsFile]);

  if (dryRun) {
    ok("dry run — stopping before delegation");
    return;
  }

  const nameservers = readNameservers(outputsFile);

  // 6 & 7. Delegate, then prove it before trusting it.
  if (DELEGATION_ROLE_ARN) {
    step(`Delegating ${zoneName} in ${APEX_ZONE_NAME}`);
    delegate(nameservers);
  } else {
    step(`Delegation needed for ${zoneName}`);
    console.log(`\n  Add an NS record for ${zoneName} in the ${APEX_ZONE_NAME} zone`);
    console.log(`  (management account), with these values:\n`);
    for (const ns of nameservers) console.log(`    ${ns}`);
    console.log(`\n  Add delegationRoleArn to cdk.json to have this done for you next time.\n`);
  }

  await waitForDelegation(nameservers);

  // 8. The certificate, then the site. In this order because the distribution
  // cannot be created without the certificate it aliases.
  for (const leaf of ["portfolio-certificate", "portfolio"]) {
    step(`Deploying ${leaf}`);
    cdkDeploy(`${prefix}/${leaf}`);
  }

  ok(`${prefix} is up at https://${trimTrailingDot(zoneName)}`);
  console.log(`\n  Set AWS_ROLE_TO_ASSUME on the '${appEnvironment}' GitHub environment:`);
  console.log(`    ${deployRoleArn}\n`);
}

/** One zone, so one Nameservers output — anything else means the stack changed shape. */
function readNameservers(outputsFile) {
  const outputs = JSON.parse(readFileSync(outputsFile, "utf8"))[`${prefix}-dns`] ?? {};
  const entry = Object.entries(outputs).find(([key]) => key.endsWith("Nameservers"));

  if (!entry) fail("The dns stack published no nameserver output. Nothing to delegate.");

  const nameservers = entry[1]
    .split(",")
    .map((ns) => trimTrailingDot(ns.trim()))
    .filter(Boolean);

  if (nameservers.length === 0) fail("The dns stack's nameserver output was empty.");
  return nameservers;
}

/** UPSERT so a re-run is a no-op rather than a DuplicateRecord error. */
function delegate(nameservers) {
  const credentials = assumeDelegationRole();
  const apexZoneId = findApexZoneId(credentials);

  const change = {
    Comment: `Delegating ${zoneName}`,
    Changes: [
      {
        Action: "UPSERT",
        ResourceRecordSet: {
          Name: zoneName,
          Type: "NS",
          TTL: 300,
          ResourceRecords: nameservers.map((ns) => ({ Value: ns }))
        }
      }
    ]
  };

  const changeId = aws(
    [
      "route53",
      "change-resource-record-sets",
      "--hosted-zone-id",
      apexZoneId,
      "--change-batch",
      JSON.stringify(change),
      "--query",
      "ChangeInfo.Id",
      "--output",
      "text"
    ],
    credentials
  );

  ok(`delegation submitted (${changeId})`);
}

function assumeDelegationRole() {
  const raw = aws([
    "sts",
    "assume-role",
    "--role-arn",
    DELEGATION_ROLE_ARN,
    "--role-session-name",
    "kgwari-delegate-portfolio",
    "--query",
    "Credentials",
    "--output",
    "json"
  ]);

  const credentials = JSON.parse(raw);
  return {
    AWS_ACCESS_KEY_ID: credentials.AccessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
    AWS_SESSION_TOKEN: credentials.SessionToken
  };
}

function findApexZoneId(credentials) {
  const id = aws(
    [
      "route53",
      "list-hosted-zones-by-name",
      "--dns-name",
      APEX_ZONE_NAME,
      "--max-items",
      "1",
      "--query",
      "HostedZones[0].Id",
      "--output",
      "text"
    ],
    credentials
  );

  if (!id || id === "None") fail(`No hosted zone named ${APEX_ZONE_NAME} in the management account.`);
  return id.replace("/hostedzone/", "");
}

/**
 * Poll public DNS until the delegation is visible.
 *
 * This is the step the whole script exists for. ACM validation against a zone
 * whose parent has not been told about it does not error — it waits, and so
 * does your deploy. Better to block here, where the reason is on screen.
 */
async function waitForDelegation(expected) {
  step(`Waiting for ${zoneName} to resolve`);
  const deadline = Date.now() + DNS_TIMEOUT_MS;
  const wanted = new Set(expected.map((ns) => ns.toLowerCase()));

  while (Date.now() < deadline) {
    try {
      const found = (await resolveNs(zoneName)).map((ns) => trimTrailingDot(ns.toLowerCase()));
      if (found.some((ns) => wanted.has(ns))) {
        ok(`${zoneName} is delegated`);
        return;
      }
    } catch {
      // NXDOMAIN while the parent has not published yet — expected, keep going.
    }
    await sleep(15_000);
  }

  fail(
    `${zoneName} did not resolve within ${Math.round(DNS_TIMEOUT_MS / 60000)} minutes. Certificate validation would stall — fix the delegation before re-running.`
  );
}

function cdkDeploy(selector, extra = []) {
  run("npx", [
    "cdk",
    "deploy",
    selector,
    "--exclusively",
    "--require-approval",
    "never",
    "--app",
    "node dist/infra/cdk/bin/app.js",
    ...extra
  ]);
}

function roleArnFrom(stackName) {
  return aws([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stackName,
    "--query",
    "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue",
    "--output",
    "text"
  ]);
}

/** `aws cloudformation deploy`, which is a no-op when nothing changed. */
function cfnDeploy(stackName, templateFile, { namedIam = false, parameters = [] } = {}) {
  run("aws", [
    "cloudformation",
    "deploy",
    "--region",
    region,
    "--stack-name",
    stackName,
    "--template-file",
    templateFile,
    "--no-fail-on-empty-changeset",
    ...(namedIam ? ["--capabilities", "CAPABILITY_NAMED_IAM"] : []),
    ...(parameters.length > 0 ? ["--parameter-overrides", ...parameters] : [])
  ]);
}

function isBootstrapped(bootstrapRegion) {
  try {
    const status = aws(
      [
        "cloudformation",
        "describe-stacks",
        "--stack-name",
        "CDKToolkit",
        "--query",
        "Stacks[0].StackStatus",
        "--output",
        "text"
      ],
      undefined,
      bootstrapRegion
    );
    return status.endsWith("_COMPLETE");
  } catch {
    return false;
  }
}

function aws(argv, credentials, overrideRegion) {
  return execFileSync("aws", [...argv, "--region", overrideRegion ?? region], {
    encoding: "utf8",
    env: { ...process.env, ...credentials }
  }).trim();
}

function run(command, argv) {
  execFileSync(command, argv, {
    stdio: "inherit",
    env: { ...process.env, DEPLOY_ENVIRONMENT: appEnvironment }
  });
}

function trimmed(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function trimTrailingDot(value) {
  return value.endsWith(".") ? value.slice(0, -1) : value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function step(message) {
  console.log(`\n▸ ${message}`);
}

function ok(message) {
  console.log(`  ✔ ${message}`);
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}
