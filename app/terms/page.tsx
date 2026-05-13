import React from "react";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-black text-white p-8 font-sans">
      <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>
      <p className="mb-4 text-gray-400 text-sm">Effective Date: May 13, 2026</p>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">1. Acceptance of Terms</h2>
        <p>By connecting your Instagram account to Creator Metrics, you agree to these Terms of Service.</p>
        <h2 className="text-xl font-semibold">2. Use of Data</h2>
        <p>We provide analytics for your internal business use. You agree not to use this data for any unauthorized or illegal purposes.</p>
        <h2 className="text-xl font-semibold">3. Platform Policies</h2>
        <p>Your use is also subject to the Meta Platform Terms and Developer Policies.</p>
      </section>
    </div>
  );
}
