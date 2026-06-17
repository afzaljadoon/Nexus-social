import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiBookmark, FiAlertCircle, FiClock, FiHeart, FiMessageSquare } from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import CommentsSection from '../components/CommentsSection';

interface ProfileType {
  full_name: string | null;
  avatar_url: string | null;
}

interface LikeType {
  user_id: string;
}

interface PostType {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string | null;
  user_id: string;
  profiles: ProfileType | null;
  likes: LikeType[];
}

interface BookmarkType {
  id: number;
  created_at: string;
  posts: PostType | null;
}

export default function Bookmarks() {
  const { user } = useAuth();
  
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [expandedComments, setExpandedComments] = useState<Record<number, boolean>>({});

  // Fetch bookmarks
  const fetchBookmarks = async () => {
    if (!user) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const { data, error } = await supabase
        .from('bookmarks')
        .select('id, created_at, posts(*, profiles(full_name, avatar_url), likes(user_id))')
        .order('created_at', { ascending: false });

      if (error) {
        setErrorMsg(error.message);
      } else {
        const formattedBookmarks = (data as any[] || []).map(item => ({
          id: item.id,
          created_at: item.created_at,
          posts: Array.isArray(item.posts) ? item.posts[0] || null : (item.posts || null)
        })) as BookmarkType[];
        setBookmarks(formattedBookmarks);
      }
    } catch (err) {
      setErrorMsg('Failed to load bookmarks.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookmarks();
  }, [user]);

  // Remove Bookmark
  const handleRemoveBookmark = async (bookmarkId: number) => {
    // Optimistic UI Update: immediately remove from local state
    const originalBookmarks = [...bookmarks];
    setBookmarks(prev => prev.filter(b => b.id !== bookmarkId));

    try {
      const { error } = await supabase
        .from('bookmarks')
        .delete()
        .eq('id', bookmarkId);

      if (error) throw error;
    } catch (err: any) {
      console.error('Error removing bookmark:', err);
      setBookmarks(originalBookmarks); // Rollback
      alert('Failed to remove bookmark.');
    }
  };


  const toggleComments = (postId: number) => {
    setExpandedComments(prev => ({
      ...prev,
      [postId]: !prev[postId],
    }));
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
          <h2>Saved Bookmarks</h2>
          <p className="subtitle">Loading your saved publications...</p>
        </div>
        <div className="feed-placeholder-grid">
          {[1, 2].map((num) => (
            <div key={num} className="glass-panel placeholder-card skeleton" style={{ height: '180px' }} />
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
          <h3>Error Loading Bookmarks</h3>
          <p>{errorMsg}</p>
          <button className="btn btn-secondary" onClick={fetchBookmarks}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-container"
    >
      <div className="glass-panel page-header-panel">
        <h2>Saved Bookmarks</h2>
        <p className="subtitle">Publications you have bookmarked for later reading</p>
      </div>

      {bookmarks.length === 0 ? (
        <div className="glass-panel placeholder-card" style={{ padding: '60px 20px' }}>
          <FiBookmark size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
          <h3>No bookmarks saved</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>Go to the feed and bookmark posts to save them here.</p>
          <Link to="/feed" className="btn btn-primary">
            Explore Feed
          </Link>
        </div>
      ) : (
        <div className="feed-placeholder-grid">
          <AnimatePresence initial={false}>
            {bookmarks.map((bookmark) => {
              const post = bookmark.posts;
              if (!post) return null; // Handle orphaned or deleted posts

              const authorName = post.profiles?.full_name || 'Anonymous User';
              const firstLetter = authorName.charAt(0).toUpperCase();
              const likedByMe = user ? (post.likes?.some(l => l.user_id === user.id) ?? false) : false;

              return (
                <motion.article
                  key={bookmark.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="glass-panel feed-card"
                  style={{ padding: '24px', textAlign: 'left', position: 'relative' }}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div className="feed-card-author" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {post.profiles?.avatar_url ? (
                        <img
                          src={post.profiles.avatar_url}
                          alt={authorName}
                          style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div className="avatar-circle" style={{ width: '36px', height: '36px', fontSize: '0.9rem' }}>
                          {firstLetter}
                        </div>
                      )}
                      <div>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 600 }}>{authorName}</h4>
                        <span className="subtitle" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', marginTop: '2px' }}>
                          <FiClock size={12} />
                          {formatTimestamp(post.updated_at || post.created_at)}
                        </span>
                      </div>
                    </div>

                    {/* Bookmark Action */}
                    <button
                      onClick={() => handleRemoveBookmark(bookmark.id)}
                      className="btn btn-secondary"
                      style={{ padding: '8px', borderRadius: '8px', fontSize: '0.9rem', color: 'var(--color-secondary)' }}
                      title="Remove Bookmark"
                    >
                      <FiBookmark style={{ fill: 'var(--color-secondary)' }} />
                    </button>
                  </div>

                  {/* Body */}
                  <div className="feed-card-body">
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>
                      {post.title}
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                      {post.content}
                    </p>
                  </div>

                  {/* Footer Stats Bar */}
                  <div style={{ display: 'flex', gap: '12px', marginTop: '16px', borderTop: '1px solid var(--surface-border)', paddingTop: '12px' }}>
                    {/* Likes Display */}
                    <div
                      className="btn btn-secondary"
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.85rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        cursor: 'default',
                        borderColor: likedByMe ? 'rgba(239, 68, 68, 0.4)' : 'var(--surface-border)',
                        color: likedByMe ? 'var(--danger)' : 'inherit',
                      }}
                    >
                      <FiHeart style={{ fill: likedByMe ? 'var(--danger)' : 'transparent' }} />
                      <span>{post.likes?.length || 0}</span>
                    </div>

                    {/* Comments Toggle */}
                    <button
                      onClick={() => toggleComments(post.id)}
                      className="btn btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      <FiMessageSquare />
                      <span>{expandedComments[post.id] ? 'Hide Comments' : 'Comments'}</span>
                    </button>
                  </div>

                  {/* Expanded Comments */}
                  <AnimatePresence>
                    {expandedComments[post.id] && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        style={{ overflow: 'hidden' }}
                      >
                        <CommentsSection postId={post.id} postAuthorId={post.user_id} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
