"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function startOAuth() {
  const state = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set("ig_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 300,
  });

  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  url.searchParams.set("client_id", process.env.META_APP_ID!);
  url.searchParams.set(
    "redirect_uri",
    `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/instagram/callback`
  );
  url.searchParams.set(
    "scope",
    "pages_show_list,instagram_basic,instagram_manage_insights,pages_read_engagement"
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  redirect(url.toString());
}
