import React from 'react';
import { useFeatureFlags } from '../hooks/useFeatureFlags';

interface FeatureGuardProps {
  children: React.ReactNode;
  flag: string;
  fallback?: React.ReactNode;
}

/**
 * FeatureGuard Component:
 * Conditionally renders children nodes if the specified feature flag key
 * is enabled (`is_enabled: true`) in the database.
 * 
 * Example:
 * <FeatureGuard flag="ai-comments">
 *   <button>AI Reply Helper</button>
 * </FeatureGuard>
 */
export const FeatureGuard: React.FC<FeatureGuardProps> = ({
  children,
  flag,
  fallback = null,
}) => {
  const { flags, loading } = useFeatureFlags();

  if (loading) {
    return null;
  }

  const isEnabled = flags[flag] === true;

  if (!isEnabled) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

export default FeatureGuard;
