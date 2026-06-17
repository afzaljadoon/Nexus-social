import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiBell, FiHeart, FiMessageSquare, FiAlertCircle, FiCheck, FiClock, FiTrash2, FiUserPlus, FiUserMinus } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';

interface ProfileType {
  full_name: string | null;
  avatar_url: string | null;
}

interface PostType {
  title: string;
}

interface NotificationType {
  id: number;
  created_at: string;
  type: 'like' | 'comment' | 'follow' | 'unfollow';
  is_read: boolean;
  post_id: number | null;
  sender_id: string;
  sender: ProfileType | null;
  posts: PostType | null;
}

export default function Notifications() {
  const { user } = useAuth();
  
  const [notifications, setNotifications] = useState<NotificationType[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // Fetch Notifications
  const fetchNotifications = async () => {
    if (!user) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select(`
          id,
          created_at,
          type,
          is_read,
          post_id,
          sender_id,
          sender:profiles!sender_id(full_name, avatar_url),
          posts(title)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        setErrorMsg(error.message);
      } else {
        setNotifications((data as any) || []);
      }
    } catch (err) {
      setErrorMsg('Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, [user]);

  // Real-time Subscription to automatically add new incoming notifications
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`user-notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${user.id}`,
        },
        async (payload) => {
          const newRow = payload.new as any;

          // Fetch sender profiles and post title to hydrate the realtime row
          try {
            const { data: senderData } = await supabase
              .from('profiles')
              .select('full_name, avatar_url')
              .eq('id', newRow.sender_id)
              .single();

            let postData = null;
            if (newRow.post_id) {
              const { data } = await supabase
                .from('posts')
                .select('title')
                .eq('id', newRow.post_id)
                .single();
              postData = data;
            }

            const hydratedNotif: NotificationType = {
              id: newRow.id,
              created_at: newRow.created_at,
              type: newRow.type,
              is_read: newRow.is_read,
              post_id: newRow.post_id,
              sender_id: newRow.sender_id,
              sender: senderData,
              posts: postData,
            };

            setNotifications((prev) => [hydratedNotif, ...prev]);
          } catch (err) {
            console.error('Error hydrating realtime notification:', err);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Mark all notifications as read
  const handleMarkAllAsRead = async () => {
    if (!user || notifications.length === 0) return;

    // Optimistic UI update
    const originalNotifs = [...notifications];
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));

    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('recipient_id', user.id)
        .eq('is_read', false);

      if (error) throw error;
    } catch (err) {
      console.error('Error marking notifications as read:', err);
      setNotifications(originalNotifs); // Rollback
    }
  };

  // Mark single notification as read
  const handleMarkAsRead = async (notifId: number) => {
    setNotifications(prev =>
      prev.map(n => (n.id === notifId ? { ...n, is_read: true } : n))
    );

    try {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notifId);
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  // Delete notification
  const handleDeleteNotification = async (notifId: number) => {
    setNotifications(prev => prev.filter(n => n.id !== notifId));
    try {
      await supabase
        .from('notifications')
        .delete()
        .eq('id', notifId);
    } catch (err) {
      console.error('Error deleting notification:', err);
    }
  };

  const formatTimestamp = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="glass-panel page-header-panel">
          <h2>Notifications</h2>
          <p className="subtitle">Syncing notification feed...</p>
        </div>
        <div className="feed-placeholder-grid">
          {[1, 2].map((num) => (
            <div key={num} className="glass-panel placeholder-card skeleton" style={{ height: '80px' }} />
          ))}
        </div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="page-container">
        <div className="glass-panel placeholder-card error-alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <FiAlertCircle size={40} />
          <h3>Error Loading Notifications</h3>
          <p>{errorMsg}</p>
          <button className="btn btn-secondary" onClick={fetchNotifications}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const hasUnread = notifications.some(n => !n.is_read);

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-container"
    >
      <div className="glass-panel page-header-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2>Notification Center</h2>
          <p className="subtitle">Activity feed related to your posts</p>
        </div>
        {hasUnread && (
          <button onClick={handleMarkAllAsRead} className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '8px 16px' }}>
            <FiCheck />
            <span>Mark all as read</span>
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="glass-panel placeholder-card" style={{ padding: '60px 20px' }}>
          <FiBell size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
          <h3>No notifications yet</h3>
          <p style={{ color: 'var(--text-muted)' }}>We will notify you here when users interact with your posts.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <AnimatePresence initial={false}>
            {notifications.map((notif) => {
              const senderName = notif.sender?.full_name || 'Someone';
              const avatarLetter = senderName.charAt(0).toUpperCase();
              const postTitle = notif.posts?.title || 'your post';

              return (
                <motion.div
                  key={notif.id}
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                  className={`glass-panel ${!notif.is_read ? 'unread-notification' : ''}`}
                  style={{
                    padding: '16px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    textAlign: 'left',
                    position: 'relative',
                    background: !notif.is_read ? 'rgba(124, 58, 237, 0.04)' : 'var(--surface)',
                    borderLeft: !notif.is_read ? '4px solid var(--color-primary)' : '1px solid var(--surface-border)'
                  }}
                >
                  {/* Sender Avatar */}
                  <div className="user-avatar-glow" style={{ flexShrink: 0 }}>
                    {notif.sender?.avatar_url ? (
                      <img
                        src={notif.sender.avatar_url}
                        alt={senderName}
                        style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div className="avatar-circle" style={{ width: '36px', height: '36px', fontSize: '0.9rem' }}>
                        {avatarLetter}
                      </div>
                    )}
                  </div>

                  {/* Notification Content */}
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: '1.4' }}>
                      <strong style={{ fontWeight: 600 }}>{senderName}</strong>{' '}
                      {notif.type === 'like' ? (
                        <>
                          liked your post{' '}
                          <strong style={{ color: 'var(--color-secondary)' }}>"{postTitle}"</strong>
                        </>
                      ) : notif.type === 'comment' ? (
                        <>
                          commented on your post{' '}
                          <strong style={{ color: 'var(--color-secondary)' }}>"{postTitle}"</strong>
                        </>
                      ) : notif.type === 'unfollow' ? (
                        <>
                          unfollowed you
                        </>
                      ) : (
                        <>
                          started following you
                        </>
                      )}
                    </p>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      <FiClock size={11} />
                      {formatTimestamp(notif.created_at)}
                    </span>
                  </div>

                  {/* Icon type Badge */}
                  <div style={{ color: notif.type === 'like' ? 'var(--danger)' : notif.type === 'comment' ? 'var(--color-secondary)' : notif.type === 'unfollow' ? 'var(--text-muted)' : 'var(--color-primary)', display: 'flex', alignItems: 'center' }}>
                    {notif.type === 'like' ? (
                      <FiHeart size={16} style={{ fill: 'var(--danger)' }} />
                    ) : notif.type === 'comment' ? (
                      <FiMessageSquare size={16} />
                    ) : notif.type === 'unfollow' ? (
                      <FiUserMinus size={16} />
                    ) : (
                      <FiUserPlus size={16} />
                    )}
                  </div>

                  {/* Action triggers */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {!notif.is_read && (
                      <button
                        onClick={() => handleMarkAsRead(notif.id)}
                        className="btn btn-secondary"
                        style={{ padding: '6px', borderRadius: '6px', fontSize: '0.8rem' }}
                        title="Mark as read"
                      >
                        <FiCheck />
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteNotification(notif.id)}
                      className="btn btn-secondary"
                      style={{ padding: '6px', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--danger)' }}
                      title="Delete notification"
                    >
                      <FiTrash2 />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
