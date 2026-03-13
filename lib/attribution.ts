export type AffiliatePlatform = "mavely" | "ltk" | "shopmy" | "amazon";

const PATTERNS: Array<{ platform: AffiliatePlatform; test: (url: string) => boolean }> = [
  {
    platform: "mavely",
    test: (url) => /go\.mvly\.co|mavely\.app\.link|go\.mavely\.com/.test(url),
  },
  {
    platform: "ltk",
    test: (url) => /liketk\.it|ltk\.com|rstyle\.me/.test(url),
  },
  {
    platform: "shopmy",
    test: (url) => /shopmy\.(us|co|com)|shop\.shopmy/.test(url),
  },
  {
    platform: "amazon",
    test: (url) => /amzn\.to|amazon\.com/.test(url),
  },
];

export function detectPlatform(url: string | null | undefined): AffiliatePlatform | null {
  if (!url) return null;
  for (const { platform, test } of PATTERNS) {
    if (test(url)) return platform;
  }
  return null;
}

/**
 * Detects ManyChat comment-trigger keywords in a caption.
 * Matches patterns like "comment SHOP", "comment "WORD"", "comment 222".
 * Returns the trigger keyword (uppercase), or null if none found.
 */
export function detectManyChat(caption: string | null | undefined): string | null {
  if (!caption) return null;
  const m = caption.match(/\bcomment\s+["']?([A-Z0-9][A-Z0-9 ]{1,30})["']?/);
  return m ? m[1].trim() : null;
}
