"use client";

import { Card } from "@tremor/react";

interface Post {
  mediaIgId: string;
  mediaType: string | null;
  mediaProductType?: string | null;
  caption: string | null;
  permalink: string | null;
  likeCount: number | null;
  commentsCount: number | null;
  reach: number | null;
  saved: number | null;
  shares: number | null;
  postedAt: Date | null;
}

export default function PostGrid({ posts }: { posts: Post[] }) {
  if (posts.length === 0) {
    return <p className="text-tremor-content text-sm">No posts collected yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {posts.map((post) => (
        <Card key={post.mediaIgId} className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-tremor-content bg-tremor-background-subtle px-2 py-0.5 rounded">
              {post.mediaProductType ?? post.mediaType ?? "POST"}
            </span>
            {post.postedAt && (
              <span className="text-xs text-tremor-content">
                {new Date(post.postedAt).toLocaleDateString()}
              </span>
            )}
          </div>
          {post.caption && (
            <p className="text-sm text-tremor-content-emphasis line-clamp-2 mb-3">
              {post.caption}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-tremor-content">Likes</span>
              <p className="font-medium text-tremor-content-strong">
                {post.likeCount?.toLocaleString() ?? "—"}
              </p>
            </div>
            <div>
              <span className="text-tremor-content">Comments</span>
              <p className="font-medium text-tremor-content-strong">
                {post.commentsCount?.toLocaleString() ?? "—"}
              </p>
            </div>
            {post.reach != null && (
              <div>
                <span className="text-tremor-content">Reach</span>
                <p className="font-medium text-tremor-content-strong">
                  {post.reach.toLocaleString()}
                </p>
              </div>
            )}
            {post.saved != null && (
              <div>
                <span className="text-tremor-content">Saves</span>
                <p className="font-medium text-tremor-content-strong">
                  {post.saved.toLocaleString()}
                </p>
              </div>
            )}
            {post.shares != null && (
              <div>
                <span className="text-tremor-content">Shares</span>
                <p className="font-medium text-tremor-content-strong">
                  {post.shares.toLocaleString()}
                </p>
              </div>
            )}
          </div>
          {post.permalink && (
            <a
              href={post.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-tremor-brand mt-3 inline-block hover:underline"
            >
              View on Instagram
            </a>
          )}
        </Card>
      ))}
    </div>
  );
}
