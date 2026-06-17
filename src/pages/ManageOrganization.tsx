import React, { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { motion, AnimatePresence } from 'framer-motion';
import { FiPlus, FiBriefcase, FiUsers, FiAward, FiSettings, FiCheckCircle, FiAlertCircle, FiLoader, FiUserPlus, FiArrowRight } from 'react-icons/fi';
import SharedNotes from '../components/SharedNotes';
import FileManager from '../components/FileManager';

interface Member {
  id: string;
  role: 'owner' | 'admin' | 'member';
  user_id: string;
  profiles: {
    full_name: string | null;
    username: string | null;
    avatar_url: string | null;
  } | null;
}

export default function ManageOrganization() {
  const { user } = useAuth();
  const { activeOrg, workspaces, memberRole, refreshTenants, changeOrg } = useTenant();

  // Loading & Alerts
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Organization Form
  const [newOrgName, setNewOrgName] = useState('');

  // Workspace Form
  const [newWorkspaceName, setNewWorkspaceName] = useState('');

  // Members list & Invite state
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  // Fetch organization members
  const fetchMembers = async () => {
    if (!activeOrg) return;
    try {
      const { data, error } = await supabase
        .from('memberships')
        .select(`
          id,
          role,
          user_id,
          profiles:user_id(full_name, username, avatar_url)
        `)
        .eq('organization_id', activeOrg.id);

      if (error) throw error;
      setMembers(data as any[] || []);
    } catch (err) {
      console.error('Error fetching org members:', err);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [activeOrg]);

  // Handle Create Organization
  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newOrgName.trim()) return;

    setLoading(true);
    setErrorMsg('');

    try {
      const slug = newOrgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const { data, error } = await supabase
        .from('organizations')
        .insert([{ name: newOrgName.trim(), slug }])
        .select('id')
        .single();

      if (error) throw error;

      setNewOrgName('');
      triggerSuccess(`Organization "${newOrgName}" created successfully!`);
      await refreshTenants();
      if (data) {
        await changeOrg(data.id);
      }
    } catch (err: any) {
      console.error('Error creating organization:', err);
      setErrorMsg(err.message || 'Failed to create organization. Slug might be taken.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Create Workspace
  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg || !newWorkspaceName.trim()) return;

    setLoading(true);
    setErrorMsg('');

    try {
      const slug = newWorkspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const { error } = await supabase
        .from('workspaces')
        .insert([{ organization_id: activeOrg.id, name: newWorkspaceName.trim(), slug }]);

      if (error) throw error;

      setNewWorkspaceName('');
      triggerSuccess(`Workspace "${newWorkspaceName}" created successfully!`);
      await refreshTenants();
    } catch (err: any) {
      console.error('Error creating workspace:', err);
      setErrorMsg(err.message || 'Failed to create workspace.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Invite Member (by username)
  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg || !inviteUsername.trim()) return;

    setLoading(true);
    setErrorMsg('');

    try {
      // 1. Search for profile by username
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('username', inviteUsername.trim())
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profileData) {
        throw new Error(`Username "${inviteUsername}" not found.`);
      }

      // 2. Insert invitation row
      const { error: inviteError } = await supabase
        .from('invitations')
        .insert([
          {
            organization_id: activeOrg.id,
            invited_by: user.id,
            username: inviteUsername.trim(),
            role: inviteRole,
            status: 'pending'
          },
        ]);

      if (inviteError) {
        if (inviteError.code === '23505') {
          throw new Error('An invitation has already been sent to this user.');
        }
        throw inviteError;
      }

      setInviteUsername('');
      triggerSuccess(`Invitation successfully sent to @${inviteUsername.trim()}!`);
    } catch (err: any) {
      console.error('Invitation error:', err);
      setErrorMsg(err.message || 'Failed to invite user.');
    } finally {
      setLoading(false);
    }
  };

  // Permission Checks
  const isOwnerOrAdmin = memberRole === 'owner' || memberRole === 'admin';

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-container"
      style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}
    >
      {/* Floating Success Banner */}
      <AnimatePresence>
        {successMsg && (
          <motion.div 
            className="toast-notification success-toast"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <FiCheckCircle size={18} />
            <span>{successMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header Panel */}
      <div className="glass-panel page-header-panel" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2>Organization Console</h2>
          <p className="subtitle">
            Manage multi-tenant organizations, workspaces, and team memberships
          </p>
        </div>
        {activeOrg && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'rgba(6, 182, 212, 0.05)', border: '1px solid rgba(6, 182, 212, 0.15)', borderRadius: '12px' }}>
            <FiBriefcase color="var(--color-secondary)" />
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Active: {activeOrg.name} ({memberRole?.toUpperCase()})</span>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="error-alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: '10px', marginBottom: '24px', textAlign: 'left' }}>
          <FiAlertCircle size={18} />
          <span>{errorMsg}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', flexWrap: 'wrap' }}>
        {/* LEFT COLUMN: ORGANIZATIONS & WORKSPACES */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Create Organization */}
          <div className="glass-panel" style={{ padding: '28px', textAlign: 'left' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FiPlus />
              <span>Create New Organization</span>
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
              Start a new tenant group. This isolates all feed posts and workspaces from other organizations.
            </p>

            <form onSubmit={handleCreateOrg} style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                placeholder="e.g. Acme Corporation"
                className="input-field"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
                disabled={loading}
                required
                style={{ flex: 1, height: '40px', borderRadius: '8px' }}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !newOrgName.trim()}
                style={{ padding: '0 16px', height: '40px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                {loading ? <FiLoader className="spin" /> : <FiArrowRight />}
              </button>
            </form>
          </div>

          {/* Manage Workspaces */}
          {activeOrg && (
            <div className="glass-panel" style={{ padding: '28px', textAlign: 'left' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FiBriefcase />
                <span>Workspaces ({workspaces.length})</span>
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                Active workspaces inside <strong>{activeOrg.name}</strong>.
              </p>

              {/* Workspaces List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
                {workspaces.map((w) => (
                  <div
                    key={w.id}
                    style={{
                      padding: '10px 14px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid var(--surface-border)',
                      borderRadius: '8px',
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{w.name}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>/{w.slug}</span>
                  </div>
                ))}
              </div>

              {/* Create Workspace Form */}
              {isOwnerOrAdmin ? (
                <form onSubmit={handleCreateWorkspace} style={{ display: 'flex', gap: '8px', borderTop: '1px dashed var(--surface-border)', paddingTop: '16px' }}>
                  <input
                    type="text"
                    placeholder="New Workspace (e.g. Marketing)"
                    className="input-field"
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    disabled={loading}
                    required
                    style={{ flex: 1, height: '38px', borderRadius: '8px', fontSize: '0.85rem' }}
                  />
                  <button
                    type="submit"
                    className="btn btn-secondary"
                    disabled={loading || !newWorkspaceName.trim()}
                    style={{ padding: '0 16px', height: '38px', borderRadius: '8px', fontSize: '0.85rem' }}
                  >
                    Add
                  </button>
                </form>
              ) : (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
                  * Only Owners or Admins can manage workspaces.
                </p>
              )}
            </div>
          )}

        </div>

        {/* RIGHT COLUMN: MEMBERS & INVITATIONS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {activeOrg ? (
            <>
              {/* Invite Member */}
              {isOwnerOrAdmin && (
                <div className="glass-panel" style={{ padding: '28px', textAlign: 'left', position: 'relative', zIndex: 10 }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FiUserPlus />
                    <span>Invite Team Member</span>
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                    Add another community member to this organization by searching their username.
                  </p>

                  <form onSubmit={handleInviteMember} style={{ display: 'flex', gap: '8px', flexWrap: 'nowrap', alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder="Enter username (exact)"
                      className="input-field"
                      value={inviteUsername}
                      onChange={(e) => setInviteUsername(e.target.value)}
                      disabled={loading}
                      required
                      style={{ flex: 1, minWidth: '140px', height: '38px', borderRadius: '8px', fontSize: '0.85rem' }}
                    />
                    {/* Custom Role Dropdown */}
                    <div style={{ position: 'relative' }}>
                      <button
                        type="button"
                        onClick={() => setRoleMenuOpen(!roleMenuOpen)}
                        disabled={loading}
                        style={{
                          width: '115px',
                          height: '38px',
                          borderRadius: '8px',
                          fontSize: '0.85rem',
                          background: 'rgba(0, 0, 0, 0.3)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--surface-border)',
                          padding: '0px 22px 0px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          position: 'relative',
                          textAlign: 'left',
                          transition: 'border-color 0.2s',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.4)'}
                        onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--surface-border)'}
                      >
                        <span style={{ textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {inviteRole}
                        </span>
                        <span style={{
                          borderLeft: '4px solid transparent',
                          borderRight: '4px solid transparent',
                          borderTop: '5px solid var(--text-muted)',
                          marginLeft: '6px',
                          transition: 'transform 0.2s',
                          transform: roleMenuOpen ? 'rotate(180deg)' : 'none',
                        }} />
                      </button>

                      <AnimatePresence>
                        {roleMenuOpen && (
                          <>
                            <div 
                              style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }} 
                              onClick={() => setRoleMenuOpen(false)} 
                            />
                            <motion.div
                              initial={{ opacity: 0, y: -6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -6 }}
                              transition={{ duration: 0.12 }}
                              style={{
                                position: 'absolute',
                                top: '44px',
                                right: 0,
                                width: '115px',
                                background: 'rgba(9, 13, 34, 0.95)',
                                backdropFilter: 'blur(16px)',
                                border: '1px solid rgba(6, 182, 212, 0.25)',
                                borderRadius: '8px',
                                boxShadow: '0 8px 20px rgba(0,0,0,0.5), 0 0 10px rgba(6, 182, 212, 0.08)',
                                zIndex: 1001,
                                padding: '4px',
                              }}
                            >
                              {['member', 'admin'].map((role) => (
                                <button
                                  key={role}
                                  type="button"
                                  onClick={() => {
                                    setInviteRole(role as any);
                                    setRoleMenuOpen(false);
                                  }}
                                  style={{
                                    width: '100%',
                                    padding: '6px 10px',
                                    borderRadius: '6px',
                                    background: role === inviteRole ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                                    border: 'none',
                                    color: role === inviteRole ? 'var(--color-secondary)' : 'var(--text-primary)',
                                    fontSize: '0.8rem',
                                    fontWeight: role === inviteRole ? 600 : 500,
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    display: 'block',
                                    textTransform: 'capitalize',
                                    transition: 'all 0.2s',
                                  }}
                                  onMouseEnter={(e) => {
                                    if (role !== inviteRole) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                                  }}
                                  onMouseLeave={(e) => {
                                    if (role !== inviteRole) e.currentTarget.style.background = 'transparent';
                                  }}
                                >
                                  {role}
                                </button>
                              ))}
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={loading || !inviteUsername.trim()}
                      style={{ padding: '0 16px', height: '38px', borderRadius: '8px', fontSize: '0.85rem' }}
                    >
                      Invite
                    </button>
                  </form>
                </div>
              )}

              {/* Members List */}
              <div className="glass-panel" style={{ padding: '28px', textAlign: 'left', flex: 1 }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FiUsers />
                  <span>Team Members ({members.length})</span>
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {members.map((m) => {
                    const displayName = m.profiles?.full_name || 'Anonymous';
                    const username = m.profiles?.username || 'unknown';
                    const firstLetter = displayName.charAt(0).toUpperCase();

                    return (
                      <div
                        key={m.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          background: 'rgba(255, 255, 255, 0.02)',
                          border: '1px solid var(--surface-border)',
                          borderRadius: '12px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          {m.profiles?.avatar_url ? (
                            <img
                              src={m.profiles.avatar_url}
                              alt={displayName}
                              style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }}
                            />
                          ) : (
                            <div className="avatar-circle" style={{ width: '32px', height: '32px', fontSize: '0.8rem' }}>
                              {firstLetter}
                            </div>
                          )}
                          <div>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', color: 'var(--text-primary)' }}>{displayName}</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>@{username}</span>
                          </div>
                        </div>

                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            padding: '3px 8px',
                            borderRadius: '20px',
                            background: m.role === 'owner' ? 'rgba(245, 158, 11, 0.1)' : m.role === 'admin' ? 'rgba(6, 182, 212, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                            color: m.role === 'owner' ? '#f59e0b' : m.role === 'admin' ? 'var(--color-secondary)' : 'var(--text-muted)',
                            textTransform: 'uppercase'
                          }}
                        >
                          {m.role === 'owner' && <FiAward size={10} />}
                          {m.role === 'admin' && <FiSettings size={10} />}
                          <span>{m.role}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="glass-panel placeholder-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', justifyContent: 'center', height: '100%' }}>
              <FiBriefcase size={36} color="var(--text-muted)" />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
                Select or create an organization to view team members.
              </p>
            </div>
          )}

        </div>
      </div>

      {/* Shared Collaborative Notes & File Storage Boards */}
      {activeOrg && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px', marginTop: '24px' }}>
          <div style={{ marginTop: '-24px' }}>
            <SharedNotes />
          </div>
          <div style={{ marginTop: '-24px' }}>
            <FileManager />
          </div>
        </div>
      )}
    </motion.div>
  );
}
