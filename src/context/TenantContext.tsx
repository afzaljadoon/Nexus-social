import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export interface Workspace {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
}

interface TenantContextProps {
  organizations: Organization[];
  workspaces: Workspace[];
  activeOrg: Organization | null;
  activeWorkspace: Workspace | null;
  memberRole: 'owner' | 'admin' | 'member' | null;
  loading: boolean;
  changeOrg: (orgId: string) => Promise<void>;
  changeWorkspace: (workspaceId: string) => void;
  refreshTenants: () => Promise<void>;
}

const TenantContext = createContext<TenantContextProps | undefined>(undefined);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeOrg, setActiveOrg] = useState<Organization | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [memberRole, setMemberRole] = useState<'owner' | 'admin' | 'member' | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTenants = async () => {
    if (!user) {
      setOrganizations([]);
      setWorkspaces([]);
      setActiveOrg(null);
      setActiveWorkspace(null);
      setMemberRole(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // 1. Fetch user's organizations via memberships join
      const { data: membershipsData, error: membershipsError } = await supabase
        .from('memberships')
        .select(`
          role,
          organizations:organization_id(id, name, slug)
        `)
        .eq('user_id', user.id);

      if (membershipsError) throw membershipsError;

      const userOrgs: Organization[] = (membershipsData || [])
        .map((m: any) => m.organizations)
        .filter(Boolean);

      setOrganizations(userOrgs);

      if (userOrgs.length > 0) {
        // Retrieve last active org from localStorage, fallback to first org
        const storedOrgId = localStorage.getItem(`nexus_active_org_${user.id}`);
        const initialOrg = userOrgs.find((o) => o.id === storedOrgId) || userOrgs[0];
        
        // Find role in this initial org
        const initialMembership = (membershipsData || []).find(
          (m: any) => m.organizations?.id === initialOrg.id
        );
        setMemberRole(initialMembership?.role || 'member');
        setActiveOrg(initialOrg);

        // 2. Fetch workspaces inside this active organization
        const { data: workspacesData, error: workspacesError } = await supabase
          .from('workspaces')
          .select('id, organization_id, name, slug')
          .eq('organization_id', initialOrg.id);

        if (workspacesError) throw workspacesError;

        const orgWorkspaces: Workspace[] = workspacesData || [];
        setWorkspaces(orgWorkspaces);

        if (orgWorkspaces.length > 0) {
          const storedWorkspaceId = localStorage.getItem(`nexus_active_workspace_${user.id}_${initialOrg.id}`);
          const initialWorkspace = orgWorkspaces.find((w) => w.id === storedWorkspaceId) || orgWorkspaces[0];
          setActiveWorkspace(initialWorkspace);
        } else {
          setActiveWorkspace(null);
        }
      } else {
        setActiveOrg(null);
        setWorkspaces([]);
        setActiveWorkspace(null);
        setMemberRole(null);
      }

    } catch (err) {
      console.error('Error fetching tenant details:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, [user]);

  const changeOrg = async (orgId: string) => {
    const targetOrg = organizations.find((o) => o.id === orgId);
    if (!targetOrg || !user) return;

    setLoading(true);
    try {
      localStorage.setItem(`nexus_active_org_${user.id}`, orgId);
      setActiveOrg(targetOrg);

      // Fetch role in target org
      const { data: membershipData } = await supabase
        .from('memberships')
        .select('role')
        .eq('user_id', user.id)
        .eq('organization_id', orgId)
        .single();
      setMemberRole(membershipData?.role || 'member');

      // Fetch workspaces inside target organization
      const { data: workspacesData } = await supabase
        .from('workspaces')
        .select('id, organization_id, name, slug')
        .eq('organization_id', orgId);

      const orgWorkspaces: Workspace[] = workspacesData || [];
      setWorkspaces(orgWorkspaces);

      if (orgWorkspaces.length > 0) {
        const storedWorkspaceId = localStorage.getItem(`nexus_active_workspace_${user.id}_${orgId}`);
        const targetWorkspace = orgWorkspaces.find((w) => w.id === storedWorkspaceId) || orgWorkspaces[0];
        setActiveWorkspace(targetWorkspace);
      } else {
        setActiveWorkspace(null);
      }

    } catch (err) {
      console.error('Error switching organization:', err);
    } finally {
      setLoading(false);
    }
  };

  const changeWorkspace = (workspaceId: string) => {
    const targetWorkspace = workspaces.find((w) => w.id === workspaceId);
    if (!targetWorkspace || !user || !activeOrg) return;

    localStorage.setItem(`nexus_active_workspace_${user.id}_${activeOrg.id}`, workspaceId);
    setActiveWorkspace(targetWorkspace);
  };

  return (
    <TenantContext.Provider
      value={{
        organizations,
        workspaces,
        activeOrg,
        activeWorkspace,
        memberRole,
        loading,
        changeOrg,
        changeWorkspace,
        refreshTenants: fetchTenants,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};
