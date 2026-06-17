import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export interface FeatureFlag {
  key: string;
  is_enabled: boolean;
  description: string | null;
}

interface FeatureFlagsContextType {
  flags: Record<string, boolean>;
  allFlags: FeatureFlag[];
  loading: boolean;
  toggleFlag: (key: string, isEnabled: boolean) => Promise<void>;
}

const FeatureFlagsContext = createContext<FeatureFlagsContextType | undefined>(undefined);

export const FeatureFlagsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [allFlags, setAllFlags] = useState<FeatureFlag[]>([]);
  const [flagsMap, setFlagsMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // Fetch all flags from Supabase database
  const fetchFlags = async () => {
    try {
      const { data, error } = await supabase
        .from('feature_flags')
        .select('key, is_enabled, description')
        .order('key', { ascending: true });

      if (error) throw error;

      if (data) {
        setAllFlags(data);
        const mapping: Record<string, boolean> = {};
        data.forEach((flag) => {
          mapping[flag.key] = flag.is_enabled;
        });
        setFlagsMap(mapping);
      }
    } catch (err) {
      console.error('Error loading feature flags:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlags();

    // Subscribe to real-time changes on the feature_flags table
    const channel = supabase
      .channel('realtime-feature-flags')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'feature_flags',
        },
        (payload) => {
          console.log('Feature flag database change received:', payload);
          // Refetch to ensure state is in sync
          fetchFlags();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Admin action: update flag in database
  const toggleFlag = async (key: string, isEnabled: boolean) => {
    // Optimistic UI update
    setFlagsMap((prev) => ({ ...prev, [key]: isEnabled }));
    setAllFlags((prev) =>
      prev.map((f) => (f.key === key ? { ...f, is_enabled: isEnabled } : f))
    );

    try {
      const { error } = await supabase
        .from('feature_flags')
        .update({ 
          is_enabled: isEnabled,
          updated_at: new Date().toISOString()
        })
        .eq('key', key);

      if (error) throw error;
    } catch (err) {
      console.error(`Failed to toggle flag ${key}:`, err);
      // Revert on failure
      fetchFlags();
      throw err;
    }
  };

  return (
    <FeatureFlagsContext.Provider value={{ flags: flagsMap, allFlags, loading, toggleFlag }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
};

export const useFeatureFlags = () => {
  const context = useContext(FeatureFlagsContext);
  if (context === undefined) {
    throw new Error('useFeatureFlags must be used within a FeatureFlagsProvider');
  }
  return context;
};
