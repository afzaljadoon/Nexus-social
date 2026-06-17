import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../context/TenantContext';
import { motion, AnimatePresence } from 'framer-motion';
import { FiMail, FiCheck, FiX, FiSend, FiLoader, FiAlertCircle, FiCheckCircle } from 'react-icons/fi';

interface ReceivedInvite {
  id: string;
  role: 'admin' | 'member';
  created_at: string;
  invited_by_profile: {
    full_name: string | null;
    username: string | null;
  } | null;
  organizations: {
    name: string;
  } | null;
}

interface SentInvite {
  id: string;
  username: string;
  role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
}

export default function CollaborationPortal() {
  const { profile } = useAuth();
  const { activeOrg, memberRole, refreshTenants } = useTenant();

  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [receivedInvites, setReceivedInvites] = useState<ReceivedInvite[]>([]);
  const [sentInvites, setSentInvites] = useState<SentInvite[]>([]);

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  // Fetch Received Invitations
  const fetchReceivedInvites = async () => {
    if (!profile?.username) return;
    try {
      const { data, error } = await supabase
        .from('invitations')
        .select(`
          id,
          role,
          created_at,
          invited_by_profile:invited_by(full_name, username),
          organizations:organization_id(name)
        `)
        .eq('username', profile.username)
        .eq('status', 'pending');

      if (error) throw error;
      setReceivedInvites(data as any[] || []);
    } catch (err) {
      console.error('Error fetching received invites:', err);
    }
  };

  // Fetch Sent Invitations for Active Organization
  const fetchSentInvites = async () => {
    if (!activeOrg) return;
    try {
      const { data, error } = await supabase
        .from('invitations')
        .select('id, username, role, status, created_at')
        .eq('organization_id', activeOrg.id);

      if (error) throw error;
      setSentInvites(data || []);
    } catch (err) {
      console.error('Error fetching sent invites:', err);
    }
  };

  useEffect(() => {
    fetchReceivedInvites();
  }, [profile]);

  useEffect(() => {
    fetchSentInvites();
  }, [activeOrg]);

  // Handle Accept Received Invite
  const handleAcceptInvite = async (inviteId: string, orgName: string) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const { error } = await supabase.rpc('accept_invitation', { invite_id: inviteId });
      if (error) throw error;

      triggerSuccess(`Successfully joined "${orgName}"!`);
      await fetchReceivedInvites();
      await refreshTenants();
    } catch (err: any) {
      console.error('Error accepting invitation:', err);
      setErrorMsg(err.message || 'Failed to accept invitation.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Decline Received Invite
  const handleDeclineInvite = async (inviteId: string) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const { error } = await supabase
        .from('invitations')
        .update({ status: 'declined' })
        .eq('id', inviteId);

      if (error) throw error;

      triggerSuccess('Invitation declined.');
      await fetchReceivedInvites();
    } catch (err: any) {
      console.error('Error declining invitation:', err);
      setErrorMsg(err.message || 'Failed to decline invitation.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Cancel Sent Invite (Admins/Owners only)
  const handleCancelInvite = async (inviteId: string) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const { error } = await supabase
        .from('invitations')
        .delete()
        .eq('id', inviteId);

      if (error) throw error;

      triggerSuccess('Invitation cancelled.');
      await fetchSentInvites();
    } catch (err: any) {
      console.error('Error cancelling invitation:', err);
      setErrorMsg(err.message || 'Failed to cancel invitation.');
    } finally {
      setLoading(false);
    }
  };

  const isOwnerOrAdmin = memberRole === 'owner' || memberRole === 'admin';

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-container"
      style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}
    >
      {/* Toast Notification */}
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

      {/* Header */}
      <div className="glass-panel page-header-panel" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Collaboration Portal</h2>
          <p className="subtitle">Accept organization invitations and manage outgoing team invites</p>
        </div>
      </div>

      {errorMsg && (
        <div className="error-alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: '10px', marginBottom: '24px' }}>
          <FiAlertCircle size={18} />
          <span>{errorMsg}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', flexWrap: 'wrap' }}>
        
        {/* LEFT COLUMN: RECEIVED INVITATIONS */}
        <div className="glass-panel" style={{ padding: '28px', textAlign: 'left', minHeight: '300px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiMail />
            <span>Incoming Invitations ({receivedInvites.length})</span>
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
            Organizations that invited you to join their workspaces.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {receivedInvites.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No pending invitations.
              </div>
            ) : (
              receivedInvites.map((invite) => {
                const orgName = invite.organizations?.name || 'Unknown Organization';
                const inviterName = invite.invited_by_profile?.full_name || invite.invited_by_profile?.username || 'Someone';

                return (
                  <div
                    key={invite.id}
                    style={{
                      padding: '14px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid var(--surface-border)',
                      borderRadius: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px'
                    }}
                  >
                    <div>
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, display: 'block', color: 'var(--text-primary)' }}>
                        {orgName}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                        Invited by {inviterName} as <strong style={{ color: 'var(--color-secondary)' }}>{invite.role}</strong>
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => handleAcceptInvite(invite.id, orgName)}
                        disabled={loading}
                        className="btn btn-primary"
                        style={{ padding: '6px 12px', height: '32px', borderRadius: '6px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        {loading ? <FiLoader className="spin" /> : <FiCheck />}
                        <span>Accept</span>
                      </button>
                      <button
                        onClick={() => handleDeclineInvite(invite.id)}
                        disabled={loading}
                        className="btn btn-secondary"
                        style={{ padding: '6px 12px', height: '32px', borderRadius: '6px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                      >
                        <FiX />
                        <span>Decline</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: SENT INVITATIONS */}
        <div className="glass-panel" style={{ padding: '28px', textAlign: 'left', minHeight: '300px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiSend />
            <span>Sent Invitations ({sentInvites.length})</span>
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
            Outgoing invitations managed by {activeOrg ? <strong>{activeOrg.name}</strong> : 'your organization'}.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {!activeOrg ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Select an organization to view sent invitations.
              </div>
            ) : sentInvites.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No sent invitations.
              </div>
            ) : (
              sentInvites.map((invite) => (
                <div
                  key={invite.id}
                  style={{
                    padding: '14px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--surface-border)',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}
                >
                  <div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', color: 'var(--text-primary)' }}>
                      @{invite.username}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                      Role: {invite.role.toUpperCase()} • Sent: {new Date(invite.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: '20px',
                        background: invite.status === 'pending' ? 'rgba(245, 158, 11, 0.1)' : invite.status === 'accepted' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        color: invite.status === 'pending' ? '#f59e0b' : invite.status === 'accepted' ? '#22c55e' : '#ef4444',
                        textTransform: 'uppercase'
                      }}
                    >
                      {invite.status}
                    </span>

                    {isOwnerOrAdmin && invite.status === 'pending' && (
                      <button
                        onClick={() => handleCancelInvite(invite.id)}
                        disabled={loading}
                        title="Cancel Invitation"
                        style={{
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          color: '#ef4444',
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                      >
                        <FiX size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </motion.div>
  );
}
