import React from 'react';
import { useAuth, hasRequiredRole } from '../hooks/useAuth';
import type { UserRole } from '../hooks/useAuth';

interface PermissionGuardProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
  fallback?: React.ReactNode;
}

/**
 * PermissionGuard Component:
 * Conditionally renders children UI components only if the logged-in user satisfies
 * at least one of the role scopes within allowedRoles (incorporating role hierarchy).
 * 
 * Example:
 * <PermissionGuard allowedRoles={['moderator']} fallback={<p>Locked</p>}>
 *   <button>Delete Post</button>
 * </PermissionGuard>
 * (This button will be visible to both Moderators and Admins, but hidden for regular Users).
 */
export const PermissionGuard: React.FC<PermissionGuardProps> = ({
  children,
  allowedRoles,
  fallback = null,
}) => {
  const { profile } = useAuth();

  const hasAccess = allowedRoles.some((role) =>
    hasRequiredRole(profile?.role, role)
  );

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

export default PermissionGuard;
