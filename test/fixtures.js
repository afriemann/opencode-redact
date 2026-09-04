// Verified secret fixtures for the @secretlint/secretlint-rule-preset-recommend@13.0.5
// rule set, derived empirically by probing the real installed rule bundle (not
// invented from documentation) — see scratch-probe.mjs history in the change's
// implementation notes. Each fixture is confirmed to trigger exactly the named
// rule/messageId when scanned through the real linter with the recommend preset
// (filter-comments disabled) and, for the GCP fixture, ext: ".json".
//
// AWS access-key-id and account-id checks are NOT included: both are gated
// behind `enableIDScanRule`, which defaults to false and is never set by this
// plugin, so those checks never fire under our configuration (see design.md D2
// correction and Risks section).

const AWS_SECRET_40 = "ZQ7mK4pXvB2nJ8wR5tL9cF3hD6yG1sA0uEZQ7mK4";
const CF_40 = "ZQ7mK4pXvB2nJ8wR5tL9cF3hD6yG1sA0uEZQ7mK4";
const HVS_100 =
  "ZQ7mK4pXvB2nJ8wR5tL9cF3hD6yG1sA0uE-_ZQ7mK4pXvB2nJ8wR5tL9cF3hD6yG1sA0uE-_ZQ7mK4pXvB2nJ8wR5tL9cF3hD6yG";
const PEM_BODY_110 =
  "MIABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr";
const SENDGRID_A = "ZQ7mK4pXvB2nJ8wR5tL9cF";
const SENDGRID_B = "ZQ7mK4pXvB2nJ8wR5tL9cF3hD6yG1sA0uEZQ7mK4pXv";
const HF_34 = "abcdefghijklmnopqrstuvwxyzABCDEFGH";
const NOTION_35 = "ZQ7mK4pXvB2nJ8wR5tL9cF3hD6yG1sA0uEZ";
const DOCKER_27 = "ZQ7mK4pXvB2nJ8wR5tL9cF3hD6y";

const ONEPASSWORD_B64 =
  "eyJlbWFpbCI6InRlc3RAMXBhc3N3b3Jkc2VydmljZWFjY291bnRzLmxjbCIsIm11ayI6eyJhbGciOiJBMjU2R0NNIiwiZXh0Ijp0cnVlLCJrIjoiTThWUGZJYzhWRWZUaGNNWExhS0NLRjhzTWg1Sk1ac1BBdHU5MmZRTmJvIiwia2V5X29wcyI6WyJlbmNyeXB0IiwiZGVjcnlwdCJdLCJrdHkiOiJvY3QiLCJraWQiOiJtcCJ9LCJzZWNyZXRLZXkiOiJBMy1DNFpKTU4tUFFUWlRMLUhHTDg0LUc2NE03LUtWWlJOLTRaVlA2Iiwic3JwWCI6Ijg3MGQ2N2E5ZTYyNjYyNWQ5ZTM2ODUwNzgwNGM5YzMyZTY2MWM1N2U3ZTU1ODc3ODI5MWJmMjlkNWEyNzlhZTEiLCJzaWduSW5BZGRyZXNzIjoiZ290aGFtLmV4YW1wbGUuY29tOjQwMDAifQ==";

export const GCP_JSON_FIXTURE = JSON.stringify({
  type: "service_account",
  project_id: "x",
  private_key_id: "abc",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n",
  client_email: "a@b.iam.gserviceaccount.com",
});

/**
 * One entry per detection rule reachable through this plugin's configuration.
 * `ext` is the virtual file extension required for the fixture to trigger
 * (only the GCP rule branches on this; every other rule ignores it).
 */
export const RULE_FIXTURES = [
  { rule: "aws", messageId: "AWSSecretAccessKey", ext: ".txt", content: `aws_secret_access_key=${AWS_SECRET_40}` },
  { rule: "gcp", messageId: "PrivateKeyJSON", ext: ".json", content: GCP_JSON_FIXTURE },
  {
    rule: "privatekey",
    messageId: "PrivateKey",
    ext: ".txt",
    content: `-----BEGIN RSA PRIVATE KEY-----\n${PEM_BODY_110}\n-----END RSA PRIVATE KEY-----`,
  },
  {
    rule: "npm",
    messageId: "NPM_ACCESS_TOKEN",
    ext: ".txt",
    content: "//registry.npmjs.org/:_authToken=npm_1234567890abcdefghijklmnopqrstuvwxyz",
  },
  { rule: "basicauth", messageId: "BasicAuth", ext: ".txt", content: "https://alice:s3cr3tPass1@example.com" },
  {
    rule: "database-connection-string",
    messageId: "PostgreSQLConnection",
    ext: ".txt",
    content: "postgres://dbadmin:Xk9mPq2vLw@localhost:5432/mydb",
  },
  {
    rule: "slack",
    messageId: "SLACK_TOKEN",
    ext: ".txt",
    content: "xoxb-1234567890-1234567890123-abcdefghijklmnopqrstuvwx",
  },
  { rule: "sendgrid", messageId: "SENDGRID_KEY", ext: ".txt", content: `SG.${SENDGRID_A}.${SENDGRID_B}` },
  {
    rule: "shopify",
    messageId: "SHOPIFY_KEY",
    ext: ".txt",
    content: "shpat_1234567890abcdef1234567890abcdef",
  },
  { rule: "stripe", messageId: "STRIPE_SECRET_KEY_LIVE", ext: ".txt", content: "sk_live_1234567890abcdefghijklmn" },
  { rule: "github", messageId: "GITHUB_TOKEN", ext: ".txt", content: "ghp_1234567890abcdefghijklmnopqrstuvwxyz" },
  { rule: "gitlab", messageId: "GITLAB_PERSONAL_ACCESS_TOKEN", ext: ".txt", content: "glpat-1234567890abcdefghij" },
  {
    rule: "grafana",
    messageId: "GRAFANA_CLOUD_API_TOKEN",
    ext: ".txt",
    content: "glc_1234567890abcdefghijklmnopqrstuvwxyzABCDEFGH1234567890abcdefghijklmnopqrstuvwxyz",
  },
  {
    rule: "openai",
    messageId: "OPENAI_TOKEN",
    ext: ".txt",
    content: `sk-${"A".repeat(20)}T3BlbkFJ${"B".repeat(20)}`,
  },
  {
    rule: "anthropic",
    messageId: "ANTHROPIC_API_KEY",
    ext: ".txt",
    content: `sk-ant-api03-${"A".repeat(91)}AA`,
  },
  {
    rule: "groq",
    messageId: "GROQ_API_KEY",
    ext: ".txt",
    content: "gsk_1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP",
  },
  { rule: "huggingface", messageId: "HUGGINGFACE_USER_ACCESS_TOKEN", ext: ".txt", content: `hf_${HF_34}` },
  {
    rule: "linear",
    messageId: "LINEAR_API_TOKEN",
    ext: ".txt",
    content: "lin_api_1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP",
  },
  { rule: "notion", messageId: "NOTION_INTEGRATION_TOKEN", ext: ".txt", content: `ntn_12345678901${NOTION_35}` },
  { rule: "1password", messageId: "OPS_TOKEN", ext: ".txt", content: `ops_${ONEPASSWORD_B64}` },
  {
    rule: "hashicorp-vault",
    messageId: "HASHICORP_VAULT_SERVICE_TOKEN",
    ext: ".txt",
    content: `hvs.${HVS_100}`,
  },
  { rule: "vercel", messageId: "VERCEL_PERSONAL_ACCESS_TOKEN", ext: ".txt", content: `vcp_${CF_40}` },
  {
    rule: "databricks",
    messageId: "DATABRICKS_PERSONAL_ACCESS_TOKEN",
    ext: ".txt",
    content: "dapi1234567890abcdef1234567890abcdef",
  },
  { rule: "docker", messageId: "DOCKER_PERSONAL_ACCESS_TOKEN", ext: ".txt", content: `dckr_pat_${DOCKER_27}` },
  {
    rule: "figma",
    messageId: "FIGMA_PERSONAL_ACCESS_TOKEN",
    ext: ".txt",
    content: "figd_1234567890abcdefghijklmnopqrstuvwxyzABCD1234",
  },
  {
    rule: "cloudflare",
    messageId: "CLOUDFLARE_GLOBAL_API_KEY",
    ext: ".txt",
    content: `cfk_${CF_40}12345678`,
  },
  {
    rule: "tailscale",
    messageId: "TAILSCALE_AUTH_KEY",
    ext: ".txt",
    content: "tskey-auth-abcdefgh12345678-abcdefghijklmnop1234567890ABCDEF",
  },
];
