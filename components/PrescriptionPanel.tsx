const PRIORITY_COLORS = ["bg-red-500", "bg-yellow-500", "bg-green-500"];

export function PrescriptionPanel({
  prescriptions,
  issues,
}: {
  prescriptions: string[];
  issues: string[];
}) {
  if (!prescriptions.length) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
        <span>💊</span> Caption Prescriptions
      </h3>
      <ul className="space-y-3">
        {prescriptions.map((p, i) => (
          <li key={i} className="flex items-start gap-3 text-sm text-gray-300">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${
                PRIORITY_COLORS[i % PRIORITY_COLORS.length]
              }`}
            />
            {p}
          </li>
        ))}
      </ul>
      {issues.length > 0 && (
        <p className="mt-4 text-xs text-gray-600">
          Top weak dimensions: {issues.map((d) => d.replace(/_/g, " ")).join(" · ")}
        </p>
      )}
    </div>
  );
}
