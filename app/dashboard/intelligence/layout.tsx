import { IntelligenceTabs } from "@/components/IntelligenceTabs";
import { Suspense } from "react";

export default function IntelligenceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Content Intelligence</h1>
        <p className="text-gray-500 text-sm">AI-powered insights for your content.</p>
      </div>
      <Suspense>
        <IntelligenceTabs />
      </Suspense>
      {children}
    </div>
  );
}
