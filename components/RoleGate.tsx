import { auth } from "@clerk/nextjs/server";
import { resolveUserRole, type UserRole } from "@/lib/auth/roles";

interface RoleGateProps {
  allowed: UserRole[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Server component that conditionally renders based on user role.
 * Usage: <RoleGate allowed={["internal"]}><AdminPanel /></RoleGate>
 */
export default async function RoleGate({
  allowed,
  children,
  fallback = null,
}: RoleGateProps) {
  const { userId } = await auth();
  if (!userId) return <>{fallback}</>;

  const resolved = await resolveUserRole(userId);
  if (!allowed.includes(resolved.role)) return <>{fallback}</>;

  return <>{children}</>;
}
