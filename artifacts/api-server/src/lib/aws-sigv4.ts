import crypto from "node:crypto";

/**
 * AWS Signature V4 for the JSON (`x-amz-json-1.1`) services we call (Secrets Manager, KMS).
 * No SDK — just the signing the API requires. Shared by the AWS vault store and the KMS
 * unwrap path so the signing lives in exactly one place.
 */
export interface AwsCreds { accessKeyId: string; secretAccessKey: string; sessionToken?: string | undefined }

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}
function sha256hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}
function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), "aws4_request");
}

/** Build the signed headers for a POST to an AWS JSON API endpoint at `host`. */
export function awsSignedHeaders(opts: {
  host: string; region: string; service: string; target: string; body: string; creds: AwsCreds; contentType?: string;
}): Record<string, string> {
  const { host, region, service, target, body, creds } = opts;
  const contentType = opts.contentType ?? "application/x-amz-json-1.1";
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`;
  const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256hex(body)].join("\n");
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(creds.secretAccessKey, dateStamp, region, service), stringToSign).toString("hex");
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "X-Amz-Date": amzDate,
    "X-Amz-Target": target,
    Authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (creds.sessionToken) headers["X-Amz-Security-Token"] = creds.sessionToken;
  return headers;
}

/** Read AWS credentials + region from the environment. */
export function awsCredsFromEnv(): { region: string; creds: AwsCreds } {
  return {
    region: process.env["AWS_REGION"]?.trim() || "us-east-1",
    creds: {
      accessKeyId: process.env["AWS_ACCESS_KEY_ID"]?.trim() || "",
      secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"]?.trim() || "",
      sessionToken: process.env["AWS_SESSION_TOKEN"]?.trim() || undefined,
    },
  };
}
