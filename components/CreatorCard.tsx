"use client";

import { Card } from "@tremor/react";
import Link from "next/link";

interface CreatorCardProps {
  id: string;
  username: string;
  displayName: string | null;
  followersCount: number | null;
  mediaCount: number | null;
  isOwned: boolean | null;
}

export default function CreatorCard({
  id,
  username,
  displayName,
  followersCount,
  mediaCount,
  isOwned,
}: CreatorCardProps) {
  return (
    <Link href={`/dashboard/creators/${id}`}>
      <Card className="p-4 hover:bg-tremor-background-subtle transition-colors cursor-pointer">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-tremor-content-strong">
              {displayName ?? username}
            </p>
            <p className="text-sm text-tremor-content">@{username}</p>
          </div>
          {isOwned && (
            <span className="text-xs bg-tremor-brand/20 text-tremor-brand px-2 py-0.5 rounded-full">
              Owned
            </span>
          )}
        </div>
        <div className="flex gap-6 mt-3 text-sm">
          <div>
            <span className="text-tremor-content">Followers</span>
            <p className="font-medium text-tremor-content-strong">
              {followersCount?.toLocaleString() ?? "—"}
            </p>
          </div>
          <div>
            <span className="text-tremor-content">Posts</span>
            <p className="font-medium text-tremor-content-strong">
              {mediaCount?.toLocaleString() ?? "—"}
            </p>
          </div>
        </div>
      </Card>
    </Link>
  );
}
