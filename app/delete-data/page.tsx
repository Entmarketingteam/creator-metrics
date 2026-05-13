import React from "react";

export default function DeletionPage() {
  return (
    <div className="min-h-screen bg-black text-white p-8 font-sans">
      <h1 className="text-3xl font-bold mb-6">Data Deletion Instructions</h1>
      <section className="space-y-4 text-gray-300">
        <p>
          To delete your account and all associated Instagram analytics data from Creator Metrics, please follow these steps:
        </p>
        <ol className="list-decimal list-inside space-y-2 ml-4">
          <li>Log in to your Creator Metrics dashboard.</li>
          <li>Navigate to Settings.</li>
          <li>Click on "Disconnect Instagram Account".</li>
          <li>Confirm that you wish to delete all stored historical data.</li>
        </ol>
        <p className="mt-6">
          Alternatively, you can email <strong>ethan@entagency.co</strong> with the subject line "Data Deletion Request" and include your Instagram username. We will process your request within 48 hours.
        </p>
      </section>
    </div>
  );
}
