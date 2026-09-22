const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = "https://token.actions.githubusercontent.com/.well-known/jwks";
const AUDIENCE = "edy-prime-link-captacao-help";
const REPOSITORY = "edicarlosnunes/edy-prime-imoveis";
const WORKFLOW_REF =
  "edicarlosnunes/edy-prime-imoveis/.github/workflows/link-captacao-help.yml@refs/heads/main";

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function parseJsonPart<T>(value: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
  } catch {
    return null;
  }
}

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface GithubClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  repository?: string;
  ref?: string;
  workflow_ref?: string;
  event_name?: string;
}

function audienceMatches(aud: string | string[] | undefined) {
  return typeof aud === "string" ? aud === AUDIENCE : Array.isArray(aud) && aud.includes(AUDIENCE);
}

export async function verifyGithubActionsOidc(token: string | null | undefined) {
  const raw = String(token ?? "").trim();
  const parts = raw.split(".");
  if (parts.length !== 3) return false;

  const header = parseJsonPart<JwtHeader>(parts[0]!);
  const claims = parseJsonPart<GithubClaims>(parts[1]!);
  if (!header || !claims || header.alg !== "RS256" || !header.kid) return false;

  const now = Math.floor(Date.now() / 1000);
  if (
    claims.iss !== ISSUER ||
    !audienceMatches(claims.aud) ||
    claims.repository !== REPOSITORY ||
    claims.ref !== "refs/heads/main" ||
    claims.workflow_ref !== WORKFLOW_REF ||
    !["schedule", "workflow_dispatch"].includes(claims.event_name ?? "") ||
    typeof claims.exp !== "number" ||
    claims.exp < now - 30 ||
    (typeof claims.nbf === "number" && claims.nbf > now + 30)
  ) {
    return false;
  }

  const response = await fetch(JWKS_URL, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) return false;
  const jwks = (await response.json().catch(() => null)) as
    | { keys?: Array<JsonWebKey & { kid?: string; alg?: string }> }
    | null;
  const jwk = jwks?.keys?.find((key) => key.kid === header.kid && (!key.alg || key.alg === "RS256"));
  if (!jwk) return false;

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      decodeBase64Url(parts[2]!),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return false;
  }
}
