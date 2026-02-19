"use client";

import Link from "next/link";
import Image from "next/image";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";

interface CreatorCardProps {
  id: string;
  username: string;
  displayName: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
  isOwned: boolean | null;
  biography: string | null;
}

export default function CreatorCard({
  id,
  username,
  displayName,
  profilePictureUrl,
  followersCount,
  followsCount,
  mediaCount,
  isOwned,
  biography,
}: CreatorCardProps) {
  return (
    <Link href={`/dashboard/creators/${id}`}>
      <div className="group rounded-2xl border border-gray-800 bg-gray-900/50 p-5 hover:border-gray-600 hover:bg-gray-900 transition-all cursor-pointer">
        {/* Profile Header — Instagram style */}
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 ring-2 ring-gray-700 group-hover:ring-blue-500/50 transition-all">
            {profilePictureUrl ? (
              <AvatarImage src={profilePictureUrl} alt={username} />
            ) : null}
            <AvatarFallback className="text-lg font-bold">
              {(displayName ?? username).charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-white truncate">
                {displayName ?? username}
              </p>
              {isOwned && <Badge variant="success">Owned</Badge>}
            </div>
            <p className="text-sm text-gray-400">@{username}</p>
          </div>
        </div>

        {/* Stats Row — Instagram style */}
        <div className="flex justify-between mt-4 pt-4 border-t border-gray-800">
          <div className="text-center flex-1">
            <p className="text-lg font-bold text-white">{formatNumber(mediaCount)}</p>
            <p className="text-xs text-gray-400">Posts</p>
          </div>
          <div className="text-center flex-1 border-x border-gray-800">
            <p className="text-lg font-bold text-white">{formatNumber(followersCount)}</p>
            <p className="text-xs text-gray-400">Followers</p>
          </div>
          <div className="text-center flex-1">
            <p className="text-lg font-bold text-white">{formatNumber(followsCount)}</p>
            <p className="text-xs text-gray-400">Following</p>
          </div>
        </div>

        {/* Bio snippet */}
        {biography && (
          <p className="text-xs text-gray-400 mt-3 line-clamp-2">{biography}</p>
        )}
      </div>
    </Link>
  );
}
