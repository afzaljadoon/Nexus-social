import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, hasRequiredRole } from '../hooks/useAuth';
import type { UserRole } from '../hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

/**
 * ProtectedRoute Component:
 * Wraps any page that requires a user to be logged in and/or checks their access role.
 * 
 * Why it is needed:
 * Prevents anonymous guests from opening pages that contain user-specific data.
 * Redirects unauthorized users (e.g. non-admins trying to load admin panel) back to /feed.
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { user, profile, loading } = useAuth();

  if (loading) {
    // Show a modern glassmorphism skeleton / loader while checking session
    return (
      <div className="loading-container">
        <div className="spinner-large"></div>
        <p className="loading-text">Synchronizing Session...</p>
      </div>
    );
  }

  if (!user) {
    // Redirect to login if user is not signed in
    return <Navigate to="/login" replace />;
  }

  // Verify Role hierarchy permissions if allowedRoles list is defined
  if (allowedRoles && allowedRoles.length > 0) {
    const hasAccess = allowedRoles.some(role => hasRequiredRole(profile?.role, role));
    if (!hasAccess) {
      // Redirect unauthorized roles back to the main Feed
      return <Navigate to="/feed" replace />;
    }
  }

  // Render the protected page children if logged in and authorized
  return <>{children}</>;
};
