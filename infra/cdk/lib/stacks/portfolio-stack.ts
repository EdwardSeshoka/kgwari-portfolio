import { Annotations, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import type { AppEnvironment } from "../config/app-environment.js";
import { getEnvironmentConfiguration } from "../config/environment-configuration.js";

export type PortfolioStackProps = StackProps & {
  appEnvironment: AppEnvironment;
  portfolioDomainName?: string;
  portfolioHostedZoneName?: string;
  portfolioHostedZoneId?: string;
  portfolioCertificateArn?: string;
};

export class PortfolioStack extends Stack {
  constructor(scope: Construct, id: string, props: PortfolioStackProps) {
    super(scope, id, props);

    const environmentConfiguration = getEnvironmentConfiguration(props.appEnvironment);
    const allowDestructiveChanges =
      environmentConfiguration.infrastructure.allowDestructiveChanges;

    const websiteBucket = new s3.Bucket(this, "WebsiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: allowDestructiveChanges ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: allowDestructiveChanges
    });

    const domainName = props.portfolioDomainName?.trim() || undefined;
    const hostedZoneName = props.portfolioHostedZoneName?.trim() || undefined;
    const hostedZoneId = props.portfolioHostedZoneId?.trim() || undefined;
    const certificateArn = props.portfolioCertificateArn?.trim() || undefined;

    let certificate: acm.ICertificate | undefined;
    if (domainName) {
      if (!certificateArn) {
        throw new Error(
          `Custom portfolio domain '${domainName}' requires a us-east-1 ACM certificate ARN. Set PORTFOLIO_CERTIFICATE_ARN.`
        );
      }

      certificate = acm.Certificate.fromCertificateArn(
        this,
        "PortfolioCertificate",
        certificateArn
      );
    }

    // The site is a set of pages at extensionless URLs (`/client`), each stored
    // as `client/index.html`. S3 has no notion of a directory index below the
    // root, so the mapping happens at the edge.
    const indexRewrite = new cloudfront.Function(this, "PortfolioIndexRewrite", {
      comment: "Map extensionless URLs onto the index.html inside their folder",
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // "/client/" -> "/client/index.html"
  if (uri.charAt(uri.length - 1) === '/') {
    request.uri = uri + 'index.html';
    return request;
  }

  // "/client" -> "/client/index.html". A dot after the last slash means the
  // request already names a file ("/assets/site.css"), so leave it alone.
  if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
    request.uri = uri + '/index.html';
  }

  return request;
}
`)
    });

    const distribution = new cloudfront.Distribution(this, "PortfolioDistribution", {
      comment: `${environmentConfiguration.stackNamePrefix}-portfolio`,
      defaultRootObject: "index.html",
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      ...(domainName && certificate
        ? {
            domainNames: [domainName],
            certificate
          }
        : {}),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations: [
          {
            function: indexRewrite,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST
          }
        ]
      },
      // A private bucket answers a missing key with 403, not 404, so both map to
      // the same page. This is a set of documents, not a single-page app: an
      // address that does not exist should say so rather than quietly serving
      // the overview with a 200 and looking like a working link.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 404,
          responsePagePath: "/404.html",
          ttl: Duration.minutes(5)
        },
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: "/404.html",
          ttl: Duration.minutes(5)
        }
      ]
    });

    const hostedZone = resolveHostedZone(this, hostedZoneName, hostedZoneId);

    if (domainName && hostedZone) {
      const recordName = toRecordName(domainName, hostedZone.zoneName);

      new route53.ARecord(this, "PortfolioAliasA", {
        zone: hostedZone,
        ...(recordName ? { recordName } : {}),
        target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution))
      });

      new route53.AaaaRecord(this, "PortfolioAliasAAAA", {
        zone: hostedZone,
        ...(recordName ? { recordName } : {}),
        target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution))
      });
    } else if (domainName) {
      Annotations.of(this).addWarning(
        `Custom portfolio domain '${domainName}' configured without a hosted zone. DNS alias records were not created.`
      );
    }

    const publicUrl = domainName
      ? `https://${domainName}`
      : `https://${distribution.distributionDomainName}`;

    new CfnOutput(this, "PortfolioBucketName", {
      value: websiteBucket.bucketName,
      description: "S3 bucket storing portfolio assets"
    });

    new CfnOutput(this, "PortfolioDistributionId", {
      value: distribution.distributionId,
      description: "CloudFront distribution id"
    });

    new CfnOutput(this, "PortfolioDistributionDomain", {
      value: distribution.distributionDomainName,
      description: "CloudFront distribution domain"
    });

    new CfnOutput(this, "PortfolioUrl", {
      value: publicUrl,
      description: "Public URL for the portfolio site"
    });
  }
}

function resolveHostedZone(
  scope: Construct,
  hostedZoneName?: string,
  hostedZoneId?: string
): route53.IHostedZone | undefined {
  if (!hostedZoneName) return undefined;

  if (hostedZoneId) {
    return route53.HostedZone.fromHostedZoneAttributes(scope, "PortfolioHostedZone", {
      hostedZoneId,
      zoneName: hostedZoneName
    });
  }

  return route53.HostedZone.fromLookup(scope, "PortfolioHostedZone", {
    domainName: hostedZoneName
  });
}

function toRecordName(domainName: string, zoneName: string): string | undefined {
  const normalizedDomain = stripTrailingDot(domainName);
  const normalizedZone = stripTrailingDot(zoneName);

  if (normalizedDomain === normalizedZone) return undefined;

  const suffix = `.${normalizedZone}`;
  if (!normalizedDomain.endsWith(suffix)) {
    throw new Error(
      `Portfolio domain '${normalizedDomain}' is not within hosted zone '${normalizedZone}'.`
    );
  }

  return normalizedDomain.slice(0, -suffix.length);
}

function stripTrailingDot(value: string): string {
  return value.endsWith(".") ? value.slice(0, -1) : value;
}
