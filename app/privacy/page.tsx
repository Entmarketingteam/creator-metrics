import React from "react";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black text-white p-8 font-sans">
      <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
      <p className="mb-4">Last Updated: May 13, 2026</p>
      <section className="space-y-4">
        <p>
          Creator Metrics ("we", "us", or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our application.
        </p>
        <h2 className="text-xl font-semibold">1. Information Collection</h2>
        <p>
          We use Meta/Instagram APIs to collect analytics data (reach, impressions, engagement) for the accounts you explicitly connect.
        </p>
        <h2 className="text-xl font-semibold">2. Data Deletion</h2>
        <p>
          Users can request the deletion of their data at any time by contacting us at ethan@entagency.co or by disconnecting their account in the dashboard.
        </p>
      </section>
    </div>
  );
}
