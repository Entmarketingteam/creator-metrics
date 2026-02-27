const LTK_SERVICE_BASE_URL = process.env.LTK_SERVICE_BASE_URL;

export interface LtkOverview {
  posts_count: number;
  avg_posts_per_week: number;
  top_retailer: string;
  total_products: number;
  posts_per_day: { date: string; count: number }[];
  top_retailers: { name: string; count: number }[];
  recent_posts: {
    id: string;
    share_url: string;
    hero_image: string;
    caption: string;
    date_published: string;
    product_count: number;
  }[];
  date_range: { start: string; end: string };
}

export async function fetchLtkOverview(slug: string): Promise<LtkOverview | null> {
  if (!slug) return null;
  if (!LTK_SERVICE_BASE_URL) return null;

  const baseUrl = LTK_SERVICE_BASE_URL.replace(/\/+$/, "");
  const url = `${baseUrl}/api/ltk/${encodeURIComponent(slug)}/data`;

  const res = await fetch(url, { next: { revalidate: 60 } });

  if (!res.ok) {
    return null;
  }

  return (await res.json()) as LtkOverview;
}

