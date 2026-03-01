const API_BASE = "https://graph.facebook.com/v21.0";

export interface IGProfile {
  id: string;
  name?: string;
  username: string;
  profile_picture_url?: string;
  biography?: string;
  followers_count: number;
  follows_count: number;
  media_count: number;
}

export interface IGMedia {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  like_count?: number;
  comments_count?: number;
  permalink?: string;
  timestamp?: string;
}

interface IGMediaInsight {
  reach?: number;
  saved?: number;
  shares?: number;
  total_interactions?: number;
  ig_reels_avg_watch_time?: number;
  ig_reels_video_view_total_time?: number;
  views?: number;
}

interface IGAccountInsights {
  reach?: number;
  accounts_engaged?: number;
  total_interactions?: number;
  follows_and_unfollows?: number;
}

async function igFetch<T>(path: string, token: string): Promise<T> {
  const url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${token}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`IG API ${res.status}: ${err}`);
  }
  return res.json();
}

export async function fetchOwnedProfile(
  igUserId: string,
  token: string
): Promise<IGProfile> {
  return igFetch<IGProfile>(
    `/${igUserId}?fields=id,name,username,profile_picture_url,biography,followers_count,follows_count,media_count`,
    token
  );
}

export async function fetchOwnedMedia(
  igUserId: string,
  token: string,
  limit = 25
): Promise<IGMedia[]> {
  const res = await igFetch<{ data: IGMedia[] }>(
    `/${igUserId}/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,like_count,comments_count,permalink,timestamp&limit=${limit}`,
    token
  );
  return res.data;
}

export async function fetchOwnedMediaInsights(
  mediaId: string,
  token: string,
  mediaProductType?: string
): Promise<IGMediaInsight> {
  try {
    const isReel = mediaProductType === "REELS";
    const metrics = isReel
      ? "reach,saved,shares,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time,views"
      : "reach,saved,shares,total_interactions";

    const res = await igFetch<{ data: { name: string; values: { value: number }[] }[] }>(
      `/${mediaId}/insights?metric=${metrics}`,
      token
    );
    const out: Record<string, number> = {};
    for (const m of res.data) {
      out[m.name] = m.values[0]?.value ?? 0;
    }
    return out as unknown as IGMediaInsight;
  } catch {
    return {};
  }
}

export async function fetchOwnedAccountInsights(
  igUserId: string,
  token: string
): Promise<IGAccountInsights> {
  try {
    const res = await igFetch<{ data: { name: string; total_value?: { value: number } }[] }>(
      `/${igUserId}/insights?metric=reach,accounts_engaged,total_interactions,follows_and_unfollows&period=day&metric_type=total_value`,
      token
    );
    const out: Record<string, number> = {};
    for (const m of res.data) {
      out[m.name] = m.total_value?.value ?? 0;
    }
    return out as unknown as IGAccountInsights;
  } catch {
    return {};
  }
}

interface BusinessDiscoveryResult {
  business_discovery: {
    username: string;
    name: string;
    profile_picture_url?: string;
    biography?: string;
    followers_count: number;
    media_count: number;
    media?: {
      data: IGMedia[];
    };
  };
}

export async function fetchPublicProfile(
  ourIgId: string,
  targetUsername: string,
  token: string
): Promise<{
  profile: IGProfile;
  media: IGMedia[];
}> {
  const res = await igFetch<BusinessDiscoveryResult>(
    `/${ourIgId}?fields=business_discovery.fields(username,name,profile_picture_url,biography,followers_count,media_count,media.limit(25){id,caption,media_type,media_url,thumbnail_url,like_count,comments_count,permalink,timestamp}).username(${targetUsername})`,
    token
  );
  const bd = res.business_discovery;
  return {
    profile: {
      id: "",
      username: bd.username,
      name: bd.name,
      profile_picture_url: bd.profile_picture_url,
      biography: bd.biography,
      followers_count: bd.followers_count,
      follows_count: 0,
      media_count: bd.media_count,
    },
    media: bd.media?.data ?? [],
  };
}

export async function exchangeToken(
  appId: string,
  appSecret: string,
  currentToken: string
): Promise<string> {
  const res = await igFetch<{ access_token: string; token_type: string; expires_in: number }>(
    `/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${currentToken}`,
    currentToken
  );
  return res.access_token;
}
