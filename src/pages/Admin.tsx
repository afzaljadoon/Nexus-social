import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiUsers, FiFileText, FiShield, FiAlertOctagon, FiTrash2, FiSlash, FiCheckCircle, FiAlertCircle, FiActivity } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import PermissionGuard from '../components/PermissionGuard';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { logAction } from '../lib/auditLogger';
import { cacheManager } from '../lib/cacheManager';

interface AdminUserType {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  role: 'user' | 'moderator' | 'admin';
  is_banned: boolean;
}

interface AdminPostType {
  id: number;
  title: string;
  created_at: string;
  user_id: string;
  deleted_at: string | null;
  published_at?: string | null;
  profiles: {
    full_name: string | null;
  } | null;
}

interface AuditLogType {
  id: number;
  created_at: string;
  action: string;
  target_id: string | null;
  user_id: string | null;
  user_email: string;
  metadata: Record<string, any>;
}

export default function Admin() {
  const { user, profile } = useAuth();
  const { allFlags, toggleFlag } = useFeatureFlags();
  const [activeTab, setActiveTab] = useState<'users' | 'posts' | 'stats' | 'flags' | 'logs' | 'reports'>('users');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  // Admin Data States
  const [users, setUsers] = useState<AdminUserType[]>([]);
  const [posts, setPosts] = useState<AdminPostType[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogType[]>([]);
  const [logsSearch, setLogsSearch] = useState('');
  const [systemStats, setSystemStats] = useState({
    totalUsers: 0,
    totalPosts: 0,
    bannedUsers: 0,
    moderatorsCount: 0
  });

  // Check role authorization
  const isAdminOrMod = profile?.role === 'admin' || profile?.role === 'moderator';
  const isAdmin = profile?.role === 'admin';

  const triggerBanner = (msg: string) => {
    setSuccessBanner(msg);
    setTimeout(() => setSuccessBanner(''), 4000);
  };

  const fetchAdminData = async () => {
    if (!user || !isAdminOrMod) return;
    setLoading(true);
    setErrorMsg('');
    try {
      // 1. Fetch Users List
      const { data: usersData, error: usersError } = await supabase
        .from('profiles')
        .select('id, full_name, username, avatar_url, role, is_banned')
        .order('full_name', { ascending: true });

      if (usersError) throw usersError;
      const formattedUsers = (usersData || []) as any[];
      setUsers(formattedUsers);

      // 2. Fetch Posts List
      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select('id, title, created_at, user_id, deleted_at, profiles(full_name)')
        .order('created_at', { ascending: false });

      if (postsError) throw postsError;
      setPosts((postsData || []) as any);

      // 3. Fetch Audit Logs
      const { data: logsData, error: logsError } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false });

      if (logsError) {
        console.error('Error fetching audit logs:', logsError);
      } else {
        setAuditLogs((logsData || []) as AuditLogType[]);
      }

      // 4. Fetch Reports List
      const { data: reportsData, error: reportsError } = await supabase
        .from('reports')
        .select(`
          id, created_at, reporter_id, content_type, content_id, reason, description, status, resolved_by, resolved_at,
          reporter:profiles!reports_reporter_id_fkey(full_name)
        `)
        .order('created_at', { ascending: false });

      let commentsMap: Record<number, string> = {};
      if (!reportsError && reportsData) {
        const reportedCommentIds = reportsData
          .filter((r: any) => r.content_type === 'comment')
          .map((r: any) => r.content_id);

        if (reportedCommentIds.length > 0) {
          const { data: commentsData } = await supabase
            .from('comments')
            .select('id, content')
            .in('id', reportedCommentIds);

          if (commentsData) {
            commentsData.forEach((c: any) => {
              commentsMap[c.id] = c.content;
            });
          }
        }
      }

      if (reportsError) {
        console.error('Error fetching reports:', reportsError);
      } else {
        const reportsWithContent = (reportsData || []).map((r: any) => {
          if (r.content_type === 'comment') {
            return { ...r, content_preview: commentsMap[r.content_id] || 'Comment content unavailable' };
          } else {
            const p = (postsData || []).find((post: any) => post.id === r.content_id);
            return { ...r, content_preview: p ? p.title : 'Post content unavailable' };
          }
        });
        setReports(reportsWithContent);
      }

      // 5. Compute System Statistics
      setSystemStats({
        totalUsers: formattedUsers.length,
        totalPosts: (postsData || []).length,
        bannedUsers: formattedUsers.filter(u => u.is_banned).length,
        moderatorsCount: formattedUsers.filter(u => u.role === 'moderator' || u.role === 'admin').length
      });

    } catch (err: any) {
      console.error('Error fetching admin details:', err);
      setErrorMsg(err.message || 'Failed to load administration dataset.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, [user, profile]);

  // Moderation Handler: Update User Role
  const handleUpdateRole = async (targetUserId: string, newRole: 'user' | 'moderator' | 'admin') => {
    if (!isAdmin) {
      alert("Unauthorized: Only administrators can assign roles.");
      return;
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', targetUserId);

      if (error) throw error;
      
      logAction('role.update', targetUserId, { old_role: users.find(u => u.id === targetUserId)?.role, new_role: newRole });
      setUsers(prev => prev.map(u => u.id === targetUserId ? { ...u, role: newRole } : u));
      triggerBanner('User role updated successfully.');
    } catch (err: any) {
      alert(err.message || 'Error updating user role.');
    }
  };

  // Moderation Handler: Toggle User Ban
  const handleToggleBan = async (targetUserId: string, currentBanStatus: boolean) => {
    if (!isAdmin) {
      alert("Unauthorized: Only administrators can ban/unban accounts.");
      return;
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_banned: !currentBanStatus })
        .eq('id', targetUserId);

      if (error) throw error;
      
      logAction('user.ban', targetUserId, { is_banned: !currentBanStatus });
      setUsers(prev => prev.map(u => u.id === targetUserId ? { ...u, is_banned: !currentBanStatus } : u));
      setSystemStats(prev => ({
        ...prev,
        bannedUsers: currentBanStatus ? prev.bannedUsers - 1 : prev.bannedUsers + 1
      }));
      triggerBanner(currentBanStatus ? 'User unbanned successfully.' : 'User account banned.');
    } catch (err: any) {
      alert(err.message || 'Error toggling ban state.');
    }
  };

  // Moderation Handler: Delete Post (Soft Delete)
  const handleDeletePostAdmin = async (postId: number) => {
    if (!window.confirm("Are you sure you want to moderate (soft delete) this post?")) return;

    try {
      const { error } = await supabase
        .from('posts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', postId);

      if (error) throw error;

      logAction('post.delete', String(postId), { mode: 'moderator', title: posts.find(p => p.id === postId)?.title });
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, deleted_at: new Date().toISOString() } : p));
      cacheManager.invalidateByTags(['posts', 'analytics']);
      triggerBanner('Post moderated and soft-deleted.');
    } catch (err: any) {
      alert(err.message || 'Error moderating post.');
    }
  };

  // Moderation Handler: Restore Post
  const handleRestorePostAdmin = async (postId: number) => {
    try {
      const { error } = await supabase
        .from('posts')
        .update({ deleted_at: null })
        .eq('id', postId);

      if (error) throw error;

      logAction('post.restore', String(postId), { mode: 'moderator', title: posts.find(p => p.id === postId)?.title });
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, deleted_at: null } : p));
      cacheManager.invalidateByTags(['posts', 'analytics']);
      triggerBanner('Post restored successfully.');
    } catch (err: any) {
      alert(err.message || 'Error restoring post.');
    }
  };
  // Moderation Handler: Dismiss Report
  const handleDismissReport = async (reportId: number) => {
    try {
      const { error } = await supabase
        .from('reports')
        .update({
          status: 'dismissed',
          resolved_by: user?.id,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', reportId);

      if (error) throw error;

      logAction('report.dismiss', String(reportId), { resolved_by: user?.id });
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, status: 'dismissed', resolved_by: user?.id, resolved_at: new Date().toISOString() } : r));
      triggerBanner('Report dismissed.');
    } catch (err: any) {
      alert(err.message || 'Error dismissing report.');
    }
  };

  // Moderation Handler: Resolve Report (Moderate & Soft Delete Content)
  const handleResolveReport = async (reportId: number, contentType: 'post' | 'comment', contentId: number) => {
    if (!window.confirm(`Are you sure you want to resolve this report and soft-delete the reported ${contentType}?`)) return;

    try {
      // 1. Soft-delete content
      if (contentType === 'post') {
        const { error: postError } = await supabase
          .from('posts')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', contentId);
        if (postError) throw postError;

        setPosts(prev => prev.map(p => p.id === contentId ? { ...p, deleted_at: new Date().toISOString() } : p));
      } else if (contentType === 'comment') {
        const { error: commentError } = await supabase
          .from('comments')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', contentId);
        if (commentError) throw commentError;
      }

      // 2. Update report status to resolved
      const { error: reportError } = await supabase
        .from('reports')
        .update({
          status: 'resolved',
          resolved_by: user?.id,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', reportId);

      if (reportError) throw reportError;

      logAction('report.resolve', String(reportId), { content_type: contentType, content_id: contentId });
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, status: 'resolved', resolved_by: user?.id, resolved_at: new Date().toISOString() } : r));
      cacheManager.invalidateByTags(['posts', 'analytics']);
      triggerBanner(`Content moderated and report resolved.`);
    } catch (err: any) {
      alert(err.message || 'Error resolving report.');
    }
  };

  // Moderation Handler: Ban Author of reported content
  const handleBanAuthorFromReport = async (reportId: number, contentType: 'post' | 'comment', contentId: number) => {
    if (!isAdmin) {
      alert("Unauthorized: Only administrators can ban accounts.");
      return;
    }
    if (!window.confirm("Are you sure you want to ban the author of this reported content?")) return;

    try {
      // 1. Fetch reported content author
      let contentAuthorId = null;
      if (contentType === 'post') {
        const { data: postData } = await supabase.from('posts').select('user_id').eq('id', contentId).single();
        contentAuthorId = postData?.user_id;
      } else {
        const { data: commentData } = await supabase.from('comments').select('user_id').eq('id', contentId).single();
        contentAuthorId = commentData?.user_id;
      }

      if (!contentAuthorId) {
        throw new Error('Content author not found.');
      }

      // 2. Ban user
      const { error: banError } = await supabase
        .from('profiles')
        .update({ is_banned: true })
        .eq('id', contentAuthorId);

      if (banError) throw banError;

      // 3. Update report status to resolved
      const { error: reportError } = await supabase
        .from('reports')
        .update({
          status: 'resolved',
          resolved_by: user?.id,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', reportId);

      if (reportError) throw reportError;

      logAction('user.ban', contentAuthorId, { is_banned: true, via_report: reportId });
      setUsers(prev => prev.map(u => u.id === contentAuthorId ? { ...u, is_banned: true } : u));
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, status: 'resolved', resolved_by: user?.id, resolved_at: new Date().toISOString() } : r));
      setSystemStats(prev => ({ ...prev, bannedUsers: prev.bannedUsers + 1 }));
      triggerBanner('Author banned and report resolved.');
    } catch (err: any) {
      alert(err.message || 'Error banning author.');
    }
  };
  if (!isAdminOrMod) {
    return (
      <div className="page-container">
        <div className="glass-panel placeholder-card error-alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <FiAlertOctagon size={48} />
          <h3>Access Denied</h3>
          <p>You do not have administrative credentials to view this panel.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="glass-panel page-header-panel skeleton" style={{ height: '80px', marginBottom: '24px' }}></div>
        <div className="glass-panel skeleton" style={{ height: '400px' }}></div>
      </div>
    );
  }

  const filteredLogs = auditLogs.filter(log => {
    const term = logsSearch.toLowerCase();
    return (
      log.action.toLowerCase().includes(term) ||
      (log.target_id && log.target_id.toLowerCase().includes(term)) ||
      log.user_email.toLowerCase().includes(term) ||
      JSON.stringify(log.metadata).toLowerCase().includes(term)
    );
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-container"
      style={{ position: 'relative' }}
    >
      {/* Toast banner */}
      <AnimatePresence>
        {successBanner && (
          <motion.div
            className="toast-notification success-toast"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <FiCheckCircle size={18} />
            <span>{successBanner}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="glass-panel page-header-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2>Administration Suite</h2>
          <p className="subtitle">Moderate posts, manage user access roles, and monitor system metrics</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)', fontSize: '0.9rem', fontWeight: 600, padding: '8px 16px', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: '12px' }}>
          <FiShield />
          <span>{profile?.role?.toUpperCase()} Control Panel</span>
        </div>
      </div>

      {/* Admin Tab Switcher */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
        <button
          onClick={() => setActiveTab('users')}
          className={`btn ${activeTab === 'users' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '8px 20px', borderRadius: '12px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <FiUsers />
          <span>Users</span>
        </button>
        <button
          onClick={() => setActiveTab('posts')}
          className={`btn ${activeTab === 'posts' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '8px 20px', borderRadius: '12px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <FiFileText />
          <span>Posts</span>
        </button>
        <button
          onClick={() => setActiveTab('stats')}
          className={`btn ${activeTab === 'stats' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '8px 20px', borderRadius: '12px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <FiAlertOctagon />
          <span>System Stats</span>
        </button>
        <button
          onClick={() => setActiveTab('flags')}
          className={`btn ${activeTab === 'flags' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '8px 20px', borderRadius: '12px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <FiShield />
          <span>Feature Flags</span>
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={`btn ${activeTab === 'reports' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '8px 20px', borderRadius: '12px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <FiAlertOctagon />
          <span>Reports Queue</span>
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`btn ${activeTab === 'logs' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '8px 20px', borderRadius: '12px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <FiActivity />
          <span>Audit Logs</span>
        </button>
      </div>

      {/* Tab Contents */}
      <div className="glass-panel" style={{ padding: '32px', textAlign: 'left' }}>
        {activeTab === 'users' && (
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '20px' }}>User Access Control</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--surface-border)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>User Profile</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Username</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Role</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 500 }}>Status</th>
                    <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 500 }}>Moderation Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const isMe = u.id === user?.id;
                    const letter = u.full_name?.charAt(0).toUpperCase() || 'U';
                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.02)' }}>
                        <td style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                          {u.avatar_url ? (
                            <img src={u.avatar_url} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <div className="avatar-circle" style={{ width: '32px', height: '32px', fontSize: '0.8rem' }}>{letter}</div>
                          )}
                          <div>
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'block' }}>{u.full_name}</span>
                            {isMe && <span style={{ fontSize: '0.65rem', color: 'var(--color-secondary)' }}>It's You</span>}
                          </div>
                        </td>
                        <td style={{ padding: '16px', color: 'var(--text-muted)' }}>@{u.username}</td>
                        <td style={{ padding: '16px' }}>
                          {isMe ? (
                            <span style={{ textTransform: 'capitalize', fontWeight: 500, color: u.role === 'admin' ? 'var(--danger)' : 'var(--text-primary)' }}>{u.role}</span>
                          ) : (
                            <PermissionGuard
                              allowedRoles={['admin']}
                              fallback={<span style={{ textTransform: 'capitalize', fontWeight: 500, color: 'var(--text-muted)' }}>{u.role}</span>}
                            >
                              <select
                                value={u.role}
                                onChange={(e) => handleUpdateRole(u.id, e.target.value as any)}
                                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--surface-border)', color: 'var(--text-primary)', borderRadius: '6px', padding: '4px 8px', outline: 'none' }}
                              >
                                <option value="user" style={{ background: '#050816' }}>User</option>
                                <option value="moderator" style={{ background: '#050816' }}>Moderator</option>
                                <option value="admin" style={{ background: '#050816' }}>Admin</option>
                              </select>
                            </PermissionGuard>
                          )}
                        </td>
                        <td style={{ padding: '16px', textAlign: 'center' }}>
                          <span style={{ padding: '4px 10px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 600, background: u.is_banned ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)', color: u.is_banned ? 'var(--danger)' : 'var(--success)' }}>
                            {u.is_banned ? 'Banned' : 'Active'}
                          </span>
                        </td>
                        <td style={{ padding: '16px', textAlign: 'center' }}>
                          {!isMe ? (
                            <PermissionGuard
                              allowedRoles={['admin']}
                              fallback={<span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Read-Only</span>}
                            >
                              <button
                                onClick={() => handleToggleBan(u.id, u.is_banned)}
                                className={`btn ${u.is_banned ? 'btn-primary' : 'btn-secondary'}`}
                                style={{ padding: '4px 12px', fontSize: '0.75rem', borderRadius: '8px', color: u.is_banned ? 'white' : 'var(--danger)', borderColor: u.is_banned ? '' : 'rgba(239, 68, 68, 0.2)' }}
                              >
                                <FiSlash style={{ marginRight: '4px' }} />
                                <span>{u.is_banned ? 'Unban User' : 'Ban User'}</span>
                              </button>
                            </PermissionGuard>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>None</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'posts' && (
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '20px' }}>Post Feed Moderation</h3>
            {posts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                <p>No posts exist in the system database.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--surface-border)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Post Title</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Author</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Publication Date</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 500 }}>Status</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 500 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {posts.map(p => (
                      <tr key={p.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.02)' }}>
                        <td style={{ padding: '16px', fontWeight: 500, color: 'var(--text-primary)' }}>{p.title}</td>
                        <td style={{ padding: '16px', color: 'var(--text-muted)' }}>{p.profiles?.full_name || 'Anonymous'}</td>
                        <td style={{ padding: '16px', color: 'var(--text-muted)' }}>{new Date(p.published_at || p.created_at).toLocaleDateString()}</td>
                        <td style={{ padding: '16px', textAlign: 'center' }}>
                          <span style={{ 
                            padding: '4px 10px', 
                            borderRadius: '99px', 
                            fontSize: '0.75rem', 
                            fontWeight: 600, 
                            background: p.deleted_at ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)', 
                            color: p.deleted_at ? 'var(--danger)' : 'var(--success)' 
                          }}>
                            {p.deleted_at ? 'Soft Deleted' : 'Active'}
                          </span>
                        </td>
                        <td style={{ padding: '16px', textAlign: 'center' }}>
                          {p.deleted_at ? (
                            <button
                              onClick={() => handleRestorePostAdmin(p.id)}
                              className="btn btn-secondary"
                              style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', color: 'var(--success)', borderColor: 'rgba(16, 185, 129, 0.2)' }}
                              title="Restore Post"
                            >
                              <FiCheckCircle />
                              <span style={{ marginLeft: '4px' }}>Restore</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleDeletePostAdmin(p.id)}
                              className="btn btn-secondary"
                              style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                              title="Delete Post"
                            >
                              <FiTrash2 />
                              <span style={{ marginLeft: '4px' }}>Delete</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'stats' && (
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '20px' }}>Global System Statistics</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
              <div style={{ padding: '20px', borderRadius: '12px', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--surface-border)' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Registered Users</span>
                <span style={{ display: 'block', fontSize: '2rem', fontWeight: 700, color: 'var(--color-secondary)', marginTop: '8px' }}>{systemStats.totalUsers}</span>
              </div>
              <div style={{ padding: '20px', borderRadius: '12px', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--surface-border)' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total System Posts</span>
                <span style={{ display: 'block', fontSize: '2rem', fontWeight: 700, color: 'var(--color-primary)', marginTop: '8px' }}>{systemStats.totalPosts}</span>
              </div>
              <div style={{ padding: '20px', borderRadius: '12px', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--surface-border)' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Banned Accounts</span>
                <span style={{ display: 'block', fontSize: '2rem', fontWeight: 700, color: 'var(--danger)', marginTop: '8px' }}>{systemStats.bannedUsers}</span>
              </div>
              <div style={{ padding: '20px', borderRadius: '12px', background: 'rgba(255,255,255,0.01)', border: '1px solid var(--surface-border)' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Moderators / Admins</span>
                <span style={{ display: 'block', fontSize: '2rem', fontWeight: 700, color: 'var(--color-accent)', marginTop: '8px' }}>{systemStats.moderatorsCount}</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'flags' && (
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '12px' }}>System Feature Flags</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '24px' }}>
              Enable or disable application modules dynamically in real-time. Changes apply instantly to all active user sessions without redeployment.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {allFlags.map((flag) => (
                <div
                  key={flag.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '20px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.01)',
                    border: '1px solid var(--surface-border)',
                  }}
                >
                  <div style={{ paddingRight: '16px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'block', fontSize: '1rem' }}>
                      {flag.key}
                    </span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block', lineHeight: '1.4' }}>
                      {flag.description || 'No description provided.'}
                    </span>
                  </div>

                  {/* Toggle Switch */}
                  <label className="switch-container" style={{ display: 'inline-flex', alignItems: 'center', cursor: isAdmin ? 'pointer' : 'not-allowed' }}>
                    <input
                      type="checkbox"
                      checked={flag.is_enabled}
                      disabled={!isAdmin}
                      onChange={async () => {
                        try {
                          await toggleFlag(flag.key, !flag.is_enabled);
                          logAction('flag.toggle', flag.key, { is_enabled: !flag.is_enabled });
                          triggerBanner(`Feature flag "${flag.key}" updated successfully.`);
                        } catch (err: any) {
                          alert(err.message || 'Error updating feature flag.');
                        }
                      }}
                      style={{ display: 'none' }}
                    />
                    <div
                      style={{
                        width: '46px',
                        height: '24px',
                        background: flag.is_enabled ? 'var(--color-secondary)' : 'rgba(255,255,255,0.1)',
                        borderRadius: '99px',
                        padding: '2px',
                        position: 'relative',
                        transition: 'background 0.2s',
                      }}
                    >
                      <div
                        style={{
                          width: '20px',
                          height: '20px',
                          background: '#fff',
                          borderRadius: '50%',
                          position: 'absolute',
                          left: flag.is_enabled ? '24px' : '2px',
                          transition: 'left 0.2s',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                        }}
                      />
                    </div>
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'reports' && (
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '20px' }}>Content Reports Queue</h3>
            {reports.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                <p>No content reports exist in the queue.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--surface-border)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Report Date</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Type</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Reported Content</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Reason</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 500 }}>Status</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 500 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((report) => (
                      <tr key={report.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.02)' }}>
                        <td style={{ padding: '16px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(report.created_at).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '16px', textTransform: 'capitalize' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            background: report.content_type === 'post' ? 'rgba(6, 182, 212, 0.1)' : 'rgba(168, 85, 247, 0.1)',
                            color: report.content_type === 'post' ? 'var(--color-secondary)' : '#a855f7'
                          }}>
                            {report.content_type}
                          </span>
                        </td>
                        <td style={{ padding: '16px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ fontWeight: 500, color: 'var(--text-primary)', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '240px' }}>
                              {report.content_preview}
                            </span>
                            {report.description && (
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                Note: "{report.description}"
                              </span>
                            )}
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Reporter: {report.reporter?.full_name || 'Anonymous'}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '16px', textTransform: 'capitalize', color: 'var(--danger)', fontWeight: 500 }}>
                          {report.reason.replace('_', ' ')}
                        </td>
                        <td style={{ padding: '16px', textAlign: 'center' }}>
                          <span style={{
                            padding: '4px 10px',
                            borderRadius: '99px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            background: report.status === 'pending' ? 'rgba(245, 158, 11, 0.1)' : report.status === 'resolved' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                            color: report.status === 'pending' ? '#f59e0b' : report.status === 'resolved' ? 'var(--success)' : 'var(--text-muted)'
                          }}>
                            {report.status}
                          </span>
                        </td>
                        <td style={{ padding: '16px', textAlign: 'center' }}>
                          {report.status === 'pending' ? (
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                              <button
                                onClick={() => handleResolveReport(report.id, report.content_type, report.content_id)}
                                className="btn btn-secondary"
                                style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', color: 'var(--success)', borderColor: 'rgba(16, 185, 129, 0.2)' }}
                              >
                                Moderate Content
                              </button>
                              <button
                                onClick={() => handleDismissReport(report.id)}
                                className="btn btn-secondary"
                                style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', color: 'var(--text-muted)', borderColor: 'var(--surface-border)' }}
                              >
                                Dismiss
                              </button>
                              {isAdmin && (
                                <button
                                  onClick={() => handleBanAuthorFromReport(report.id, report.content_type, report.content_id)}
                                  className="btn btn-secondary"
                                  style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '8px', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                                >
                                  Ban Author
                                </button>
                              )}
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Actioned</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '20px' }}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>System Audit Trail</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Track admin actions, role updates, account bans, post lifecycle events, and feature flag changes.
                </p>
              </div>
              <div>
                <input
                  type="text"
                  placeholder="Search logs (email, action, metadata...)"
                  value={logsSearch}
                  onChange={(e) => setLogsSearch(e.target.value)}
                  style={{
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid var(--surface-border)',
                    color: 'var(--text-primary)',
                    borderRadius: '8px',
                    padding: '8px 14px',
                    fontSize: '0.9rem',
                    outline: 'none',
                    width: '300px',
                  }}
                />
              </div>
            </div>

            {filteredLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                <p>No matching audit records found.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--surface-border)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Timestamp</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Action</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Actor (Email)</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Target Key/ID</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Metadata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.map(log => (
                      <tr key={log.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.02)' }}>
                        <td style={{ padding: '12px 16px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            background: log.action.startsWith('user.') || log.action.startsWith('role.') ? 'rgba(239, 68, 68, 0.1)' : 
                                        log.action.startsWith('flag.') ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                            color: log.action.startsWith('user.') || log.action.startsWith('role.') ? 'var(--danger)' : 
                                   log.action.startsWith('flag.') ? 'var(--success)' : 'var(--color-primary)'
                          }}>
                            {log.action}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--text-primary)' }}>
                          {log.user_email}
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                          {log.target_id || '-'}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <pre style={{
                            margin: 0,
                            padding: '8px',
                            background: 'rgba(0, 0, 0, 0.2)',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            maxHeight: '80px',
                            overflowY: 'auto',
                            color: 'var(--text-muted)',
                            fontFamily: 'monospace'
                          }}>
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
