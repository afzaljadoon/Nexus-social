import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FiHome, FiUser, FiMessageSquare, FiLogOut, FiMenu, FiX, FiActivity, FiBookmark, FiBell, FiBarChart2, FiShield, FiClock, FiAward, FiBriefcase, FiSend } from 'react-icons/fi';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabaseClient';
import { useTenant } from '../context/TenantContext';

/**
 * DashboardLayout Component:
 * Provides a responsive layout frame for authenticated users.
 * Contains:
 * - A responsive Sidebar (collapsible on mobile).
 * - A top Navbar showing the user's avatar, active email, and status.
 * - An <Outlet /> which renders whichever sub-page is active (Feed, Profile, Chat).
 */
export default function DashboardLayout() {
  const { user, profile, signOut } = useAuth();
  const { organizations, workspaces, activeOrg, activeWorkspace, changeOrg, changeWorkspace } = useTenant();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const [wsMenuOpen, setWsMenuOpen] = useState(false);

  // Fetch unread count & listen to realtime updates
  useEffect(() => {
    if (!user) return;

    const fetchUnreadCount = async () => {
      try {
        const { count, error } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('recipient_id', user.id)
          .eq('is_read', false);

        if (!error && count !== null) {
          setUnreadCount(count);
        }
      } catch (err) {
        console.error('Error fetching unread notifications count:', err);
      }
    };

    fetchUnreadCount();

    const channel = supabase
      .channel('unread-notifications-badge')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${user.id}`,
        },
        () => {
          fetchUnreadCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  // Get user details (fallback to profile, then metadata, then email)
  const userEmail = user?.email || 'user@nexus.social';
  const userName = profile?.full_name || user?.user_metadata?.full_name || userEmail.split('@')[0];
  const avatarLetter = userName.charAt(0).toUpperCase();

  const navLinks = [
    { path: '/feed', name: 'Feed', icon: <FiHome /> },
    { path: '/chat', name: 'Chat', icon: <FiMessageSquare /> },
    { path: '/activity', name: 'Activity Feed', icon: <FiClock /> },
    {
      path: '/notifications',
      name: 'Notifications',
      icon: <FiBell />,
      badge: unreadCount > 0 ? unreadCount : undefined,
    },
    { path: '/bookmarks', name: 'Bookmarks', icon: <FiBookmark /> },
    { path: '/leaderboard', name: 'Leaderboard', icon: <FiAward /> },
    { path: '/analytics', name: 'Analytics', icon: <FiBarChart2 /> },
    { path: '/organization', name: 'Manage Org', icon: <FiBriefcase /> },
    { path: '/collaboration', name: 'Collaboration', icon: <FiSend /> },
    ...(profile?.role === 'admin' || profile?.role === 'moderator' ? [
      { path: '/admin', name: 'Admin Panel', icon: <FiShield /> }
    ] : []),
    { path: '/profile', name: 'Profile', icon: <FiUser /> },
  ];

  return (
    <div className="dashboard-container">
      {/* 1. Mobile Top Navbar */}
      <header className="mobile-navbar glass-panel">
        <div className="navbar-logo">
          <FiActivity className="logo-icon" />
          <span>Nexus Social</span>
        </div>
        <button 
          className="menu-toggle-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <FiX size={24} /> : <FiMenu size={24} />}
        </button>
      </header>

      {/* 2. Responsive Sidebar (Desktop & Mobile Drawer) */}
      <aside className={`dashboard-sidebar glass-panel ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <FiActivity className="logo-icon" />
          <h1>Nexus Social</h1>
        </div>

        {/* Organization Selector */}
        {activeOrg && (
          <div style={{ padding: '0 20px', marginBottom: '16px', zIndex: 110 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' }}>
              <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Active Tenant</label>
              
              {/* Custom Organization Dropdown */}
              <div style={{ position: 'relative', width: '100%' }}>
                <button
                  type="button"
                  onClick={() => {
                    setOrgMenuOpen(!orgMenuOpen);
                    setWsMenuOpen(false);
                  }}
                  style={{
                    width: '100%',
                    height: '38px',
                    paddingLeft: '36px',
                    paddingRight: '30px',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid var(--surface-border)',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    outline: 'none',
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
                  <FiBriefcase style={{ position: 'absolute', left: '12px', color: 'var(--color-secondary)' }} size={16} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeOrg.name}
                  </span>
                  <span style={{
                    borderLeft: '4px solid transparent',
                    borderRight: '4px solid transparent',
                    borderTop: '5px solid var(--text-muted)',
                    marginLeft: '8px',
                    transition: 'transform 0.2s',
                    transform: orgMenuOpen ? 'rotate(180deg)' : 'none',
                  }} />
                </button>

                <AnimatePresence>
                  {orgMenuOpen && (
                    <>
                      <div 
                        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }} 
                        onClick={() => setOrgMenuOpen(false)} 
                      />
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.15 }}
                        style={{
                          position: 'absolute',
                          top: '44px',
                          left: 0,
                          right: 0,
                          background: 'rgba(9, 13, 34, 0.95)',
                          backdropFilter: 'blur(16px)',
                          border: '1px solid rgba(6, 182, 212, 0.25)',
                          borderRadius: '8px',
                          boxShadow: '0 10px 25px rgba(0,0,0,0.5), 0 0 15px rgba(6, 182, 212, 0.1)',
                          zIndex: 1001,
                          maxHeight: '200px',
                          overflowY: 'auto',
                          padding: '6px',
                        }}
                      >
                        {organizations.map((org) => (
                          <button
                            key={org.id}
                            type="button"
                            onClick={() => {
                              changeOrg(org.id);
                              setOrgMenuOpen(false);
                            }}
                            style={{
                              width: '100%',
                              padding: '8px 12px',
                              borderRadius: '6px',
                              background: org.id === activeOrg.id ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                              border: 'none',
                              color: org.id === activeOrg.id ? 'var(--color-secondary)' : 'var(--text-primary)',
                              fontSize: '0.8rem',
                              fontWeight: org.id === activeOrg.id ? 600 : 500,
                              textAlign: 'left',
                              cursor: 'pointer',
                              display: 'block',
                              transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => {
                              if (org.id !== activeOrg.id) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                            }}
                            onMouseLeave={(e) => {
                              if (org.id !== activeOrg.id) e.currentTarget.style.background = 'transparent';
                            }}
                          >
                            {org.name}
                          </button>
                        ))}
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>

              {/* Workspace Selector */}
              {workspaces.length > 0 && activeWorkspace && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px', position: 'relative', width: '100%' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setWsMenuOpen(!wsMenuOpen);
                      setOrgMenuOpen(false);
                    }}
                    style={{
                      width: '100%',
                      height: '30px',
                      paddingLeft: '12px',
                      paddingRight: '24px',
                      borderRadius: '6px',
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid var(--surface-border)',
                      color: 'var(--text-muted)',
                      fontSize: '0.75rem',
                      outline: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      position: 'relative',
                      textAlign: 'left',
                      transition: 'border-color 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'}
                    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--surface-border)'}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      #{activeWorkspace.name}
                    </span>
                    <span style={{
                      borderLeft: '3.5px solid transparent',
                      borderRight: '3.5px solid transparent',
                      borderTop: '4.5px solid var(--text-muted)',
                      marginLeft: '6px',
                      transition: 'transform 0.2s',
                      transform: wsMenuOpen ? 'rotate(180deg)' : 'none',
                    }} />
                  </button>

                  <AnimatePresence>
                    {wsMenuOpen && (
                      <>
                        <div 
                          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }} 
                          onClick={() => setWsMenuOpen(false)} 
                        />
                        <motion.div
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.12 }}
                          style={{
                            position: 'absolute',
                            top: '34px',
                            left: 0,
                            right: 0,
                            background: 'rgba(9, 13, 34, 0.95)',
                            backdropFilter: 'blur(16px)',
                            border: '1px solid rgba(6, 182, 212, 0.25)',
                            borderRadius: '6px',
                            boxShadow: '0 8px 20px rgba(0,0,0,0.5), 0 0 10px rgba(6, 182, 212, 0.08)',
                            zIndex: 1001,
                            maxHeight: '150px',
                            overflowY: 'auto',
                            padding: '4px',
                          }}
                        >
                          {workspaces.map((w) => (
                            <button
                              key={w.id}
                              type="button"
                              onClick={() => {
                                changeWorkspace(w.id);
                                setWsMenuOpen(false);
                              }}
                              style={{
                                width: '100%',
                                padding: '6px 10px',
                                borderRadius: '4px',
                                background: w.id === activeWorkspace.id ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                                border: 'none',
                                color: w.id === activeWorkspace.id ? 'var(--color-secondary)' : 'var(--text-muted)',
                                fontSize: '0.72rem',
                                fontWeight: w.id === activeWorkspace.id ? 600 : 500,
                                textAlign: 'left',
                                cursor: 'pointer',
                                display: 'block',
                                transition: 'all 0.2s',
                              }}
                              onMouseEnter={(e) => {
                                if (w.id !== activeWorkspace.id) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                              }}
                              onMouseLeave={(e) => {
                                if (w.id !== activeWorkspace.id) e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              #{w.name}
                            </button>
                          ))}
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>
        )}

        {/* User Card inside Sidebar */}
        <div className="sidebar-user-card">
          <div className="user-avatar-glow">
            {profile?.avatar_url ? (
              <img 
                src={profile.avatar_url} 
                alt={userName} 
                style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover', display: 'block' }} 
              />
            ) : (
              <div className="avatar-circle">{avatarLetter}</div>
            )}
          </div>
          <div className="user-meta-info">
            <span className="user-display-name">{userName}</span>
            <span className="user-email-text">{userEmail}</span>
          </div>
        </div>

        {/* Navigation Menu Links */}
        <nav className="sidebar-nav">
          {navLinks.map((link) => (
            <NavLink
              key={link.path}
              to={link.path}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) => 
                `nav-item ${isActive ? 'nav-active' : ''}`
              }
            >
              <span className="nav-icon" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                {link.icon}
                {link.badge !== undefined && (
                  <span 
                    style={{ 
                      position: 'absolute', 
                      top: '-6px', 
                      right: '-6px', 
                      background: 'var(--danger)', 
                      color: '#fff', 
                      borderRadius: '50%', 
                      width: '16px', 
                      height: '16px', 
                      fontSize: '0.65rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      fontWeight: 'bold',
                      boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)'
                    }}
                  >
                    {link.badge}
                  </span>
                )}
              </span>
              <span className="nav-text">{link.name}</span>
            </NavLink>
          ))}
        </nav>

        {/* Sign Out Button */}
        <div className="sidebar-footer">
          <button onClick={handleLogout} className="btn btn-secondary logout-btn">
            <FiLogOut />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Overlay background for mobile drawer */}
      {mobileMenuOpen && (
        <div 
          className="sidebar-overlay" 
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* 3. Main Workspace Area where pages render */}
      <main className="dashboard-content">
        <div className="content-wrapper">
          {/* Outlet is a React Router component that acts as a placeholder 
              for whichever child page (/feed, /profile, /chat) is currently loaded */}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
