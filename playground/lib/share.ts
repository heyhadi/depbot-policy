// A shared link stores the policy in the URL hash, so it never reaches a server.
const hashKey = "policy";

export function shareUrl(href: string, source: string): string {
  const url = new URL(href);
  url.hash = `${hashKey}=${encode(source)}`;
  return url.toString();
}

/** Returns the policy stored in a URL hash, or undefined if there is none or it's corrupt. */
export function readSharedPolicy(hash: string): string | undefined {
  const encoded = new URLSearchParams(hash.replace(/^#/, "")).get(hashKey);
  if (!encoded) return undefined;
  try {
    return decode(encoded);
  } catch {
    return undefined;
  }
}

// base64url over UTF-8, so non-ASCII text (e.g. a block reason in Japanese) survives.
function encode(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(encoded: string): string {
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
