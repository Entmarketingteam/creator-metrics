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
