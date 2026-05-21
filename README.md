# Morara Portfolio

Static portfolio and architecture one-pager for Morara.

The dev deployment is intended to be served from:

```text
https://portfolio.dev.morara.wine
```

That subdomain follows the current Morara convention used by `app.dev.morara.wine`.

## What This Repo Owns

- `site/index.html`: the static HTML artifact that is uploaded to S3.
- `infra/cdk`: S3, CloudFront, optional Route 53 alias records, and outputs used by the deploy workflow.
- `.github/workflows`: pull request validation and main-branch deployment.

The S3 bucket is private. CloudFront reads it through Origin Access Control.

## Local Setup

```sh
npm install
npm run build
```

The build compiles CDK TypeScript and copies `site/` into `dist/site/`.

## Updating The Portfolio HTML

Replace:

```text
site/index.html
```

with the exported one-pager HTML.

If the export includes extra assets, place them under `site/assets/` or another folder inside `site/`. The deploy workflow syncs the full `dist/site` folder.

## Deployment

The `Main Release and Portfolio Deploy` workflow runs on pushes to `main`.

It does the following:

1. Installs dependencies.
2. Runs lint, typecheck, tests, and build.
3. Deploys the CDK stack for the target environment.
4. Resolves the S3 bucket and CloudFront distribution from stack outputs unless explicitly configured.
5. Syncs `dist/site` to S3.
6. Invalidates CloudFront.
7. Creates a git tag from `package.json` version.

## GitHub Environment Variables

For the `dev` GitHub environment, configure:

```text
ACCOUNT_ID=072468084892
AWS_REGION=af-south-1
PORTFOLIO_DOMAIN_NAME=portfolio.dev.morara.wine
PORTFOLIO_HOSTED_ZONE_NAME=dev.morara.wine
PORTFOLIO_HOSTED_ZONE_ID=<optional if CDK lookup is allowed>
PORTFOLIO_CERTIFICATE_ARN=<us-east-1 ACM certificate ARN for portfolio.dev.morara.wine>
```

Optional overrides:

```text
PORTFOLIO_STACK_NAME=morara-dev-portfolio
S3_BUCKET=<bucket name>
CLOUDFRONT_DISTRIBUTION_ID=<distribution id>
```

Prefer stack outputs over manual `S3_BUCKET` and `CLOUDFRONT_DISTRIBUTION_ID` unless you need a temporary override.

## GitHub Secrets

Use the same credential pattern as the other Morara repos:

```text
AWS_ROLE_TO_ASSUME=<preferred OIDC role ARN>
```

or the fallback:

```text
AWS_ACCESS_KEY_ID=<access key>
AWS_SECRET_ACCESS_KEY=<secret key>
```

OIDC is preferred.

### Creating The GitHub Actions Role

Create the deploy role once in the dev account (`072468084892`). This role is trusted only by the `EdwardSeshoka/morara-portfolio` GitHub repo and the `dev` GitHub environment.

If the dev account does not already have the GitHub OIDC provider, run:

```sh
aws cloudformation deploy \
  --region af-south-1 \
  --stack-name morara-dev-portfolio-github-actions-role \
  --template-file infra/aws/github-actions-role.dev.yaml \
  --capabilities CAPABILITY_NAMED_IAM
```

If the GitHub OIDC provider already exists, reuse it instead:

```sh
aws cloudformation deploy \
  --region af-south-1 \
  --stack-name morara-dev-portfolio-github-actions-role \
  --template-file infra/aws/github-actions-role.dev.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides ExistingGitHubOidcProviderArn=arn:aws:iam::072468084892:oidc-provider/token.actions.githubusercontent.com
```

After the stack completes, copy the `GitHubActionsRoleArn` output into the GitHub `dev` environment secret:

```text
AWS_ROLE_TO_ASSUME=arn:aws:iam::072468084892:role/github-actions-morara-portfolio-dev
```

The role currently uses `AdministratorAccess` because the portfolio CDK deployment creates and updates CloudFront, S3, Route 53, ACM bindings, IAM-backed CDK assets, and CloudFormation resources. Once the deploy path is stable, this can be narrowed to a least-privilege managed policy.

## DNS And Certificate Notes

CloudFront requires the ACM certificate to be in `us-east-1`.

If `PORTFOLIO_HOSTED_ZONE_NAME` points at the delegated dev hosted zone (`dev.morara.wine`) and the workflow role has Route 53 permissions, CDK creates:

```text
portfolio.dev.morara.wine A     -> CloudFront
portfolio.dev.morara.wine AAAA  -> CloudFront
```

The parent `morara.wine` hosted zone should only delegate `dev.morara.wine` to the dev account. It should not contain individual app records for `portfolio.dev.morara.wine`.

## Useful Commands

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run cdk:deploy:dev
```
