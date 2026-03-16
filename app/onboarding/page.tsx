import { startOAuth } from "./actions";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; pages?: string; names?: string }>;
}) {
  const { error, pages, names } = await searchParams;
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="max-w-md w-full text-center space-y-6 px-6">
        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mx-auto">
          <span className="text-white font-bold text-2xl">CM</span>
        </div>
        <h1 className="text-2xl font-bold text-white">Connect your Instagram</h1>
        <p className="text-gray-400">
          Link your account to see your analytics dashboard.
        </p>

        {error === "already_claimed" && (
          <p className="text-red-400 text-sm bg-red-950 rounded-lg px-4 py-3">
            This Instagram account is already connected to another login.
          </p>
        )}
        {error === "no_ig_account" && (
          <div className="text-red-400 text-sm bg-red-950 rounded-lg px-4 py-3 text-left space-y-1">
            {pages === "0" ? (
              <p>No Facebook Pages found on this account. You may be logged into the wrong Facebook account, or your Instagram isn&apos;t linked to a Facebook Page yet.</p>
            ) : (
              <p>Found {pages} Facebook Page{Number(pages) !== 1 ? "s" : ""} ({names ? decodeURIComponent(names) : "unknown"}) but none are linked to an Instagram Business or Creator account.</p>
            )}
          </div>
        )}
        {error === "true" && (
          <p className="text-red-400 text-sm bg-red-950 rounded-lg px-4 py-3">
            Connection failed. Please try again.
          </p>
        )}

        <form action={startOAuth}>
          <button
            type="submit"
            className="w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold py-3 px-6 rounded-xl hover:opacity-90 transition-opacity"
          >
            Connect Instagram
          </button>
        </form>
      </div>
    </div>
  );
}
