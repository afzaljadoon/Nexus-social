import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FiPlus, FiMessageSquare, FiAlertCircle, FiClock, FiEdit2, FiTrash2, FiSave, FiX, FiCheckCircle, FiHeart, FiBookmark, FiSearch, FiRefreshCw, FiAlertOctagon, FiZap, FiUsers, FiTrendingUp, FiInfo } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import CommentsSection from '../components/CommentsSection';
import ReportModal from '../components/ReportModal';
import { useTenant } from '../context/TenantContext';
import { logAction } from '../lib/auditLogger';
import { cacheManager } from '../lib/cacheManager';

interface LikeType {
  user_id: string;
}

interface BookmarkType {
  user_id: string;
}

interface PostType {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  published_at?: string | null;
  user_id: string;
  profiles: {
    full_name: string | null;
    avatar_url: string | null;
    last_seen: string | null;
  } | null;
  likes: LikeType[];
  bookmarks: BookmarkType[];
  tags?: string[];
  relevance?: number;
  // Recommendation signals (only populated in 'foryou' feed)
  reasons?: string[];
}

/**
 * Feed Page Component:
 * Fetches all posts and manages full Edit and Delete CRUD flows with custom modals.
 */
export default function Feed() {
  const { user, onlineUsers } = useAuth();
  const { activeOrg } = useTenant();

  const formatLastSeen = (lastSeenStr: string | null) => {
    if (!lastSeenStr) return 'Offline';
    const lastSeenDate = new Date(lastSeenStr);
    const diffMs = new Date().getTime() - lastSeenDate.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Active just now';
    if (diffMins < 60) return `Active ${diffMins}m ago`;
    if (diffHours < 24) return `Active ${diffHours}h ago`;
    return `Active ${diffDays}d ago`;
  };

  // 1. React States
  const [posts, setPosts] = useState<PostType[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [successBanner, setSuccessBanner] = useState('');

  // Pagination & Infinite Scroll States
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const observerRef = useRef<HTMLDivElement | null>(null);

  // Follow State
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [feedType, setFeedType] = useState<'global' | 'following' | 'foryou'>('global');
  const [showTrash, setShowTrash] = useState(false);

  // Search & Tag Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const handleTagClick = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleRemoveTag = (tag: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tag));
  };

  // Search Debouncer Effect
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(handler);
  }, [searchQuery]);

  // 2. Edit Modal States
  const [editingPost, setEditingPost] = useState<PostType | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  
  // 3. Report Modal States
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportContentId, setReportContentId] = useState<number | null>(null);
  const [reportContentType, setReportContentType] = useState<'post' | 'comment'>('post');

  const openReportModal = (id: number, type: 'post' | 'comment') => {
    setReportContentId(id);
    setReportContentType(type);
    setIsReportOpen(true);
  };
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  // 3. Delete Modal States
  const [deletingPostId, setDeletingPostId] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // 4. Comments Toggle State
  const [expandedComments, setExpandedComments] = useState<Record<number, boolean>>({});

  const toggleComments = (postId: number) => {
    setExpandedComments((prev) => ({
      ...prev,
      [postId]: !prev[postId],
    }));
  };

  // 5. Like Toggle Handler with Optimistic UI Update
  const handleLikeToggle = async (postId: number, postAuthorId: string, alreadyLiked: boolean) => {
    if (!user) return;

    // Capture current state for potential rollback
    const originalPosts = [...posts];

    // Optimistically update React State
    setPosts((prevPosts) =>
      prevPosts.map((post) => {
        if (post.id === postId) {
          const updatedLikes = alreadyLiked
            ? (post.likes || []).filter((l) => l.user_id !== user.id)
            : [...(post.likes || []), { user_id: user.id }];
          return { ...post, likes: updatedLikes };
        }
        return post;
      })
    );

    try {
      if (alreadyLiked) {
        // Remove like from DB
        const { error } = await supabase
          .from('likes')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', user.id);

        if (error) throw error;
      } else {
        // Add like to DB
        const { error } = await supabase
          .from('likes')
          .insert([{ post_id: postId, user_id: user.id }]);

        if (error) throw error;

        // Trigger Notification (only if user is not liking their own post)
        if (postAuthorId !== user.id) {
          await supabase
            .from('notifications')
            .insert([{
              recipient_id: postAuthorId,
              sender_id: user.id,
              type: 'like',
              post_id: postId
            }]);
        }
      }
      cacheManager.invalidateByTags(['posts', 'analytics', 'recommendations']);
    } catch (err: any) {
      console.error('Error toggling like:', err);
      // Rollback to original state if query failed
      setPosts(originalPosts);
      triggerSuccessBanner('Could not update like status.');
    }
  };

  // 5.5. Bookmark Toggle Handler with Optimistic UI Update
  const handleBookmarkToggle = async (postId: number, alreadyBookmarked: boolean) => {
    if (!user) return;

    const originalPosts = [...posts];

    // Optimistically update React State
    setPosts((prevPosts) =>
      prevPosts.map((post) => {
        if (post.id === postId) {
          const updatedBookmarks = alreadyBookmarked
            ? (post.bookmarks || []).filter((b) => b.user_id !== user.id)
            : [...(post.bookmarks || []), { user_id: user.id }];
          return { ...post, bookmarks: updatedBookmarks };
        }
        return post;
      })
    );

    try {
      if (alreadyBookmarked) {
        // Delete bookmark from DB
        const { error } = await supabase
          .from('bookmarks')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', user.id);

        if (error) throw error;
      } else {
        // Insert bookmark to DB
        const { error } = await supabase
          .from('bookmarks')
          .insert([{ post_id: postId, user_id: user.id }]);

        if (error) throw error;
      }
      cacheManager.invalidateByTags(['posts', 'recommendations']);
    } catch (err: any) {
      console.error('Error toggling bookmark:', err);
      setPosts(originalPosts);
      triggerSuccessBanner('Could not update bookmark status.');
    }
  };

  const POSTS_PER_PAGE = 5;

  // 5.8. Follow Toggle Handler with Optimistic UI Update
  const handleFollowToggle = async (targetUserId: string, isFollowing: boolean) => {
    if (!user) return;

    // Capture current state for potential rollback
    const originalFollowingIds = [...followingIds];

    // Optimistically update React State
    if (isFollowing) {
      setFollowingIds((prev) => prev.filter((id) => id !== targetUserId));
    } else {
      setFollowingIds((prev) => [...prev, targetUserId]);
    }

    try {
      if (isFollowing) {
        // Unfollow: delete row
        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', user.id)
          .eq('following_id', targetUserId);

        if (error) throw error;

        // Trigger Unfollow Notification
        await supabase
          .from('notifications')
          .insert([{
            recipient_id: targetUserId,
            sender_id: user.id,
            type: 'unfollow',
            post_id: null
          }]);
      } else {
        // Follow: insert row
        const { error } = await supabase
          .from('follows')
          .insert([{ follower_id: user.id, following_id: targetUserId }]);

        if (error) throw error;

        // Trigger Follow Notification
        await supabase
          .from('notifications')
          .insert([{
            recipient_id: targetUserId,
            sender_id: user.id,
            type: 'follow',
            post_id: null
          }]);
      }
      cacheManager.invalidateByTags(['posts', 'recommendations']);
    } catch (err: any) {
      console.error('Error toggling follow:', err);
      setFollowingIds(originalFollowingIds); // Rollback
      triggerSuccessBanner('Could not update follow status.');
    }
  };

  // ---------------------------------------------------------------
  // Fetch standard posts (Global / Following / Trash)
  // ---------------------------------------------------------------
  const getFeedPosts = async (currentPage = 0, isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      else setLoadingMore(true);

      const from = currentPage * POSTS_PER_PAGE;
      const to = from + POSTS_PER_PAGE - 1;

      // Query active follow list first if logged in
      let currentFollowing: string[] = [];
      if (user) {
        const { data: followsData } = await supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', user.id);
        currentFollowing = followsData?.map((f) => f.following_id) || [];
        setFollowingIds(currentFollowing);
      }

      // Short-circuit: Following feed with no follows
      if (!showTrash && feedType === 'following' && currentFollowing.length === 0) {
        setPosts([]);
        setHasMore(false);
        return;
      }

      const orgId = activeOrg?.id || null;
      const tagsString = selectedTags.length > 0 ? selectedTags.join(',') : '';
      const cacheKey = `feed:${orgId}:${feedType}:${showTrash}:${debouncedSearchQuery.trim()}:${tagsString}:${from}:${to}`;
      const cachedPosts = cacheManager.get<any[]>(cacheKey);

      if (cachedPosts) {
        setPosts((prev) => (isInitial ? cachedPosts : [...prev, ...cachedPosts]));
        setHasMore(cachedPosts.length === POSTS_PER_PAGE);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      const { data, error } = await supabase.rpc('search_posts_advanced', {
        p_query: debouncedSearchQuery.trim() || '',
        p_tags: selectedTags.length > 0 ? selectedTags : null,
        p_org_id: orgId,
        p_show_trash: showTrash,
        p_feed_type: feedType,
        p_user_id: user?.id || null,
        p_following_ids: feedType === 'following' ? currentFollowing : null,
        p_limit: POSTS_PER_PAGE,
        p_offset: from
      });

      if (error) {
        setErrorMsg(error.message);
      } else {
        const newPosts = data || [];
        cacheManager.set(cacheKey, newPosts, 120000, ['posts', 'feed']);
        setPosts((prev) => (isInitial ? newPosts : [...prev, ...newPosts]));
        setHasMore(newPosts.length === POSTS_PER_PAGE);
      }
    } catch (err) {
      setErrorMsg('Failed to connect to the server.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // ---------------------------------------------------------------
  // Fetch personalised recommendations (For You tab)
  // Uses the get_recommended_posts RPC which scores posts via:
  //   follow affinity, tag interest, popularity, quality, recency decay
  // ---------------------------------------------------------------
  const getRecommendedPosts = async (currentPage = 0, isInitial = false) => {
    if (!user) return;
    try {
      if (isInitial) setLoading(true);
      else setLoadingMore(true);

      const from = currentPage * POSTS_PER_PAGE;
      const orgId = activeOrg?.id || null;
      const cacheKey = `recommendations:${user.id}:${orgId}:${from}`;
      const cached = cacheManager.get<any[]>(cacheKey);

      if (cached) {
        setPosts((prev) => (isInitial ? cached : [...prev, ...cached]));
        setHasMore(cached.length === POSTS_PER_PAGE);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      const { data, error } = await supabase.rpc('get_recommended_posts', {
        p_user_id: user.id,
        p_org_id: orgId,
        p_limit: POSTS_PER_PAGE,
        p_offset: from
      });

      if (error) {
        setErrorMsg(error.message);
      } else {
        // The RPC returns `post_user_id` instead of `user_id` to avoid Postgres
        // column-ambiguity errors. Remap it here so card rendering stays unchanged.
        const newPosts = (data || []).map((row: any) => ({
          ...row,
          user_id: row.post_user_id ?? row.user_id,
        }));
        // 5-minute TTL for recommendations — behavioural signals change slowly
        cacheManager.set(cacheKey, newPosts, 300000, ['posts', 'recommendations']);
        setPosts((prev) => (isInitial ? newPosts : [...prev, ...newPosts]));
        setHasMore(newPosts.length === POSTS_PER_PAGE);
      }
    } catch (err) {
      setErrorMsg('Failed to load recommendations.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Dispatch to the correct fetch function based on active tab
  const loadPosts = (currentPage = 0, isInitial = false) => {
    if (feedType === 'foryou') {
      getRecommendedPosts(currentPage, isInitial);
    } else {
      getFeedPosts(currentPage, isInitial);
    }
  };

  // Trigger initial fetch when search query, feed type, tags, or active org changes
  useEffect(() => {
    setPage(0);
    setPosts([]);
    loadPosts(0, true);
  }, [debouncedSearchQuery, feedType, showTrash, activeOrg?.id, selectedTags]);

  // Infinite Scroll IntersectionObserver Setup
  useEffect(() => {
    if (loading || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore) {
          setPage((prev) => {
            const nextPage = prev + 1;
            loadPosts(nextPage, false);
            return nextPage;
          });
        }
      },
      { threshold: 0.1 }
    );

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => observer.disconnect();
  }, [loading, hasMore, loadingMore, feedType, debouncedSearchQuery, selectedTags]);

  // 6. Real-time Likes Subscription
  useEffect(() => {
    const channel = supabase
      .channel('public-likes-feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'likes' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newLike = payload.new as { post_id: number; user_id: string };
            setPosts((prevPosts) =>
              prevPosts.map((post) => {
                if (post.id === newLike.post_id) {
                  const alreadyExists = post.likes?.some((l) => l.user_id === newLike.user_id);
                  if (alreadyExists) return post;
                  return { ...post, likes: [...(post.likes || []), { user_id: newLike.user_id }] };
                }
                return post;
              })
            );
          } else if (payload.eventType === 'DELETE') {
            const oldLike = payload.old as { post_id: number; user_id: string };
            setPosts((prevPosts) =>
              prevPosts.map((post) => {
                if (post.id === oldLike.post_id) {
                  return { ...post, likes: (post.likes || []).filter((l) => l.user_id !== oldLike.user_id) };
                }
                return post;
              })
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 4. Success Banner utility
  const triggerSuccessBanner = (msg: string) => {
    setSuccessBanner(msg);
    setTimeout(() => {
      setSuccessBanner('');
    }, 4000);
  };

  // 5. Edit Modals Handlers
  const openEditModal = (post: PostType) => {
    setEditingPost(post);
    setEditTitle(post.title);
    setEditContent(post.content);
    setEditError('');
  };

  const closeEditModal = () => {
    setEditingPost(null);
    setEditTitle('');
    setEditContent('');
    setEditError('');
  };

  const handleUpdatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPost) return;
    if (!editTitle.trim() || !editContent.trim()) {
      setEditError('Title and content cannot be blank.');
      return;
    }

    setEditLoading(true);
    setEditError('');

    const now = new Date().toISOString();

    try {
      const { error } = await supabase
        .from('posts')
        .update({
          title: editTitle.trim(),
          content: editContent.trim(),
          updated_at: now // Updates the edit timestamp column
        })
        .eq('id', editingPost.id);

      if (error) {
        setEditError(error.message);
      } else {
        setPosts(posts.map(p => p.id === editingPost.id
          ? { ...p, title: editTitle.trim(), content: editContent.trim(), updated_at: now }
          : p
        ));
        closeEditModal();
        cacheManager.invalidateByTags(['posts', 'analytics']);
        triggerSuccessBanner('Post updated successfully!');
      }
    } catch (err) {
      setEditError('Could not save updates. Please try again.');
    } finally {
      setEditLoading(false);
    }
  };

  // 6. Custom Delete Modal Handlers
  const openDeleteModal = (postId: number) => {
    setDeletingPostId(postId);
  };

  const closeDeleteModal = () => {
    setDeletingPostId(null);
  };

  const handleDeletePost = async () => {
    if (!deletingPostId) return;
    setDeleteLoading(true);

    try {
      const { error } = await supabase
        .from('posts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', deletingPostId);

      if (error) {
        alert(error.message);
      } else {
        logAction('post.delete', String(deletingPostId), { title: posts.find(p => p.id === deletingPostId)?.title });
        setPosts(posts.filter(p => p.id !== deletingPostId));
        closeDeleteModal();
        cacheManager.invalidateByTags(['posts', 'analytics']);
        triggerSuccessBanner('Post soft-deleted successfully.');
      }
    } catch (err) {
      alert('Error deleting post.');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleRestorePost = async (postId: number) => {
    try {
      const { error } = await supabase
        .from('posts')
        .update({ deleted_at: null })
        .eq('id', postId);

      if (error) {
        alert(error.message);
      } else {
        logAction('post.restore', String(postId), { title: posts.find(p => p.id === postId)?.title });
        setPosts(posts.filter(p => p.id !== postId));
        cacheManager.invalidateByTags(['posts', 'analytics']);
        triggerSuccessBanner('Post restored successfully.');
      }
    } catch (err) {
      alert('Error restoring post.');
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
        <div className="glass-panel page-header-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>News Feed</h2>
            <p className="subtitle">Loading latest feed updates...</p>
          </div>
        </div>
        <div className="feed-placeholder-grid">
          {[1, 2, 3].map((num) => (
            <div key={num} className="glass-panel placeholder-card skeleton" style={{ height: '180px' }}></div>
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
          <h3>Database Fetch Error</h3>
          <p>{errorMsg}</p>
          <button className="btn btn-secondary" onClick={() => window.location.reload()}>
            Retry Connection
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
      style={{ position: 'relative' }}
    >
      {/* Dynamic Success Toast Notification */}
      <AnimatePresence>
        {successBanner && (
          <motion.div
            className="toast-notification success-toast"
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ duration: 0.3 }}
          >
            <FiCheckCircle size={18} />
            <span>{successBanner}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feed Page Header */}
      <div className="glass-panel page-header-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2>News Feed</h2>
          <p className="subtitle">See what's happening in Nexus Social right now</p>
        </div>
        <Link to="/create-post" className="btn btn-primary">
          <FiPlus />
          <span>New Post</span>
        </Link>
      </div>

      {/* Feed Type Switcher Tabs */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
        {/* Global Feed tab */}
        <button
          id="feed-tab-global"
          onClick={() => { setShowTrash(false); setFeedType('global'); }}
          className={`btn ${(!showTrash && feedType === 'global') ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '8px 20px', borderRadius: '12px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <FiTrendingUp size={14} />
          Global Feed
        </button>

        {/* Following tab */}
        <button
          id="feed-tab-following"
          onClick={() => { setShowTrash(false); setFeedType('following'); }}
          className={`btn ${(!showTrash && feedType === 'following') ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '8px 20px', borderRadius: '12px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <FiUsers size={14} />
          Following
        </button>

        {/* For You tab — personalised recommendations */}
        {user && (
          <button
            id="feed-tab-foryou"
            onClick={() => { setShowTrash(false); setFeedType('foryou'); }}
            className={`btn ${(!showTrash && feedType === 'foryou') ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              padding: '8px 20px',
              borderRadius: '12px',
              fontSize: '0.9rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              ...((!showTrash && feedType === 'foryou') ? {} : {
                color: 'var(--color-secondary)',
                borderColor: 'rgba(6, 182, 212, 0.25)',
                background: 'rgba(6, 182, 212, 0.04)',
              })
            }}
          >
            <FiZap size={14} />
            For You
          </button>
        )}

        {/* Trash Bin tab */}
        {user && (
          <button
            id="feed-tab-trash"
            onClick={() => setShowTrash(true)}
            className={`btn ${showTrash ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              padding: '8px 20px',
              borderRadius: '12px',
              fontSize: '0.9rem',
              color: showTrash ? '#fff' : 'var(--danger)',
              borderColor: showTrash ? '' : 'rgba(239, 68, 68, 0.2)'
            }}
          >
            Trash Bin
          </button>
        )}
      </div>

      {/* For You: personalisation context banner */}
      {!showTrash && feedType === 'foryou' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 16px',
          background: 'rgba(6, 182, 212, 0.05)',
          border: '1px solid rgba(6, 182, 212, 0.15)',
          borderRadius: '10px',
          marginBottom: '4px',
          fontSize: '0.82rem',
          color: 'var(--text-muted)',
        }}>
          <FiZap size={14} style={{ color: 'var(--color-secondary)', flexShrink: 0 }} />
          <span>
            Posts ranked by your <strong style={{ color: 'var(--text-primary)' }}>follow network</strong>,{' '}
            <strong style={{ color: 'var(--text-primary)' }}>liked topics</strong>, and{' '}
            <strong style={{ color: 'var(--text-primary)' }}>community activity</strong> — like and follow more to improve your feed.
          </span>
        </div>
      )}

      {/* Search Bar Input */}
      <div className="glass-panel" style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div className="input-with-icon" style={{ width: '100%' }}>
          <FiSearch className="field-icon" style={{ left: '16px' }} />
          <input
            type="text"
            className="input-field"
            style={{ width: '100%', paddingLeft: '46px' }}
            placeholder="Search posts by title or content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="password-toggle-btn"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="Clear search"
            >
              <FiX />
            </button>
          )}
        </div>
      </div>

      {/* Tag Filters bar */}
      {selectedTags.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '12px 20px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--surface-border)', borderRadius: '12px', marginTop: '16px' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Active Tag Filters:</span>
          {selectedTags.map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: '0.8rem',
                color: '#fff',
                background: 'var(--color-secondary)',
                padding: '4px 10px',
                borderRadius: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 500
              }}
            >
              #{tag}
              <FiX
                size={12}
                style={{ cursor: 'pointer' }}
                onClick={() => handleRemoveTag(tag)}
              />
            </span>
          ))}
          <button
            onClick={() => setSelectedTags([])}
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0
            }}
          >
            Clear all
          </button>
        </div>
      )}

      {/* Empty State */}
      {posts.length === 0 ? (
        debouncedSearchQuery.trim() ? (
          <div className="glass-panel placeholder-card" style={{ padding: '60px 20px' }}>
            <FiSearch size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
            <h3>No results found</h3>
            <p style={{ color: 'var(--text-muted)' }}>We couldn't find any posts matching "{debouncedSearchQuery}". Try adjusting your keywords.</p>
          </div>
        ) : feedType === 'following' ? (
          <div className="glass-panel placeholder-card" style={{ padding: '60px 20px' }}>
            <FiMessageSquare size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
            <h3>Your Following Feed is Empty</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>Follow users in the Global Feed to see their latest updates here.</p>
            <button onClick={() => setFeedType('global')} className="btn btn-primary">
              Explore Global Feed
            </button>
          </div>
        ) : feedType === 'foryou' ? (
          <div className="glass-panel placeholder-card" style={{ padding: '60px 20px' }}>
            <FiZap size={48} style={{ color: 'var(--color-secondary)', marginBottom: '16px' }} />
            <h3>Your Feed is Still Learning</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '8px' }}>
              We don't have enough signals yet to personalise your feed.
            </p>
            <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '0.9rem' }}>
              Like posts, bookmark content, and follow people you find interesting — the more you engage, the smarter your "For You" feed becomes.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setFeedType('global')} className="btn btn-primary">
                <FiTrendingUp size={14} />
                <span>Explore Global Feed</span>
              </button>
              <button onClick={() => setFeedType('following')} className="btn btn-secondary">
                <FiUsers size={14} />
                <span>Find People to Follow</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="glass-panel placeholder-card" style={{ padding: '60px 20px' }}>
            <FiMessageSquare size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
            <h3>No posts yet</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>Be the first one to write a post on Nexus Social!</p>
            <Link to="/create-post" className="btn btn-primary">
              Create First Post
            </Link>
          </div>
        )
      ) : (
        /* Posts Grid */
        <div className="feed-placeholder-grid">
          {posts.map((post) => {
            const authorName = post.profiles?.full_name || 'Anonymous User';
            const firstLetter = authorName.charAt(0).toUpperCase();
            const isAuthor = user && user.id === post.user_id;
            const likedByMe = user ? (post.likes?.some((l) => l.user_id === user.id) ?? false) : false;
            const bookmarkedByMe = user ? (post.bookmarks?.some((b) => b.user_id === user.id) ?? false) : false;

            return (
              <motion.article
                key={post.id}
                className="glass-panel feed-card"
                whileHover={{ y: -4 }}
                transition={{ duration: 0.2 }}
                style={{ padding: '24px', textAlign: 'left', position: 'relative' }}
              >
                {/* Header: Author + Actions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div className="feed-card-author" style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                    <Link to={`/profile/${post.user_id}`} style={{ position: 'relative', display: 'block' }}>
                      {post.profiles?.avatar_url ? (
                        <img
                          src={post.profiles.avatar_url}
                          alt={authorName}
                          style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover', display: 'block' }}
                        />
                      ) : (
                        <div className="avatar-circle" style={{ width: '36px', height: '36px', fontSize: '0.9rem' }}>
                          {firstLetter}
                        </div>
                      )}
                      {onlineUsers[post.user_id] && !isAuthor && (
                        <span
                          style={{
                            position: 'absolute',
                            bottom: '0',
                            right: '0',
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            backgroundColor: 'var(--success)',
                            border: '2px solid var(--bg-primary)',
                            display: 'block',
                          }}
                          title="Online"
                        />
                      )}
                    </Link>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <Link to={`/profile/${post.user_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <h4 style={{ fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer' }} className="author-name-hover">{authorName}</h4>
                        </Link>
                        {!isAuthor && (
                          <span style={{ fontSize: '0.7rem', color: onlineUsers[post.user_id] ? 'var(--success)' : 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px', background: 'rgba(255, 255, 255, 0.03)', padding: '2px 6px', borderRadius: '4px' }}>
                            <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: onlineUsers[post.user_id] ? 'var(--success)' : 'rgba(255, 255, 255, 0.3)' }} />
                            {onlineUsers[post.user_id] ? 'Online' : formatLastSeen(post.profiles?.last_seen)}
                          </span>
                        )}
                        {user && user.id !== post.user_id && (
                          <button
                            onClick={() => handleFollowToggle(post.user_id, followingIds.includes(post.user_id))}
                            style={{
                              background: followingIds.includes(post.user_id) ? 'rgba(255, 255, 255, 0.02)' : 'rgba(6, 182, 212, 0.08)',
                              border: '1px solid',
                              borderColor: followingIds.includes(post.user_id) ? 'var(--surface-border)' : 'var(--color-secondary)',
                              color: followingIds.includes(post.user_id) ? 'var(--text-muted)' : 'var(--color-secondary)',
                              padding: '2px 8px',
                              fontSize: '0.7rem',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              height: '20px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'var(--transition-smooth)',
                              fontWeight: 500,
                            }}
                            title={followingIds.includes(post.user_id) ? 'Unfollow user' : 'Follow user'}
                          >
                            {followingIds.includes(post.user_id) ? 'Unfollow' : 'Follow'}
                          </button>
                        )}
                      </div>
                      <span className="subtitle" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', marginTop: '2px', flexWrap: 'wrap' }}>
                        <FiClock size={12} />
                        {/* Display edited time if edited, otherwise display publication time */}
                        {formatTimestamp(post.updated_at || post.published_at || post.created_at)}
                        {post.updated_at && (
                          <span style={{ color: 'var(--color-secondary)', fontWeight: 500 }}>(Edited)</span>
                        )}
                        {/* Search match indicator (only shown when actively searching) */}
                        {post.relevance !== undefined && post.relevance > 0 && debouncedSearchQuery.trim() && (
                          <span style={{ color: 'var(--color-accent)', fontWeight: 600, background: 'rgba(245, 158, 11, 0.08)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', marginLeft: '6px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <FiSearch size={10} />
                            Best match
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Edit/Delete Actions (Only visible to Author) or Report button */}
                  {isAuthor ? (
                    <div style={{ display: 'flex', gap: '8px', marginLeft: '12px' }}>
                      {post.deleted_at ? (
                        <button
                          onClick={() => handleRestorePost(post.id)}
                          className="btn btn-secondary"
                          style={{ 
                            padding: '4px 12px', 
                            borderRadius: '8px', 
                            fontSize: '0.8rem', 
                            color: 'var(--success)', 
                            borderColor: 'rgba(16, 185, 129, 0.2)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                          aria-label="Restore post"
                        >
                          <FiRefreshCw />
                          <span>Restore</span>
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => openEditModal(post)}
                            className="btn btn-secondary"
                            style={{ padding: '8px', borderRadius: '8px', fontSize: '0.9rem' }}
                            aria-label="Edit post"
                          >
                            <FiEdit2 />
                          </button>
                          <button
                            onClick={() => openDeleteModal(post.id)}
                            className="btn btn-secondary"
                            style={{ padding: '8px', borderRadius: '8px', fontSize: '0.9rem', color: 'var(--danger)' }}
                            aria-label="Delete post"
                          >
                            <FiTrash2 />
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    user && (
                      <button
                        onClick={() => openReportModal(post.id, 'post')}
                        className="btn btn-secondary"
                        style={{ padding: '8px', borderRadius: '8px', fontSize: '0.9rem', color: 'var(--text-muted)' }}
                        onMouseOver={(e) => (e.currentTarget.style.color = 'var(--danger)')}
                        onMouseOut={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                        title="Report this post"
                        aria-label="Report post"
                      >
                        <FiAlertOctagon size={16} />
                      </button>
                    )
                  )}
                </div>

                {/* Content */}
                <div className="feed-card-body">
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>
                    {post.title}
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                    {post.content}
                  </p>

                  {/* Tag chips */}
                  {post.tags && post.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '12px' }}>
                      {post.tags.map((tag) => {
                        const isSelected = selectedTags.includes(tag);
                        return (
                          <span
                            key={tag}
                            onClick={() => handleTagClick(tag)}
                            style={{
                              fontSize: '0.75rem',
                              color: isSelected ? '#fff' : 'var(--color-secondary)',
                              background: isSelected ? 'var(--color-secondary)' : 'rgba(6, 182, 212, 0.08)',
                              border: isSelected ? '1px solid var(--color-secondary)' : '1px solid rgba(6, 182, 212, 0.2)',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              cursor: 'pointer',
                              fontWeight: 500,
                            }}
                          >
                            #{tag}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Recommendation reason chips (For You tab only) */}
                  {feedType === 'foryou' && post.reasons && post.reasons.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--surface-border)' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '3px', marginRight: '2px' }}>
                        <FiInfo size={10} />
                        Why you're seeing this:
                      </span>
                      {post.reasons.map((reason) => {
                        if (reason === 'followed_author') return (
                          <span key={reason} style={{
                            fontSize: '0.72rem', fontWeight: 600,
                            color: '#a78bfa',
                            background: 'rgba(167, 139, 250, 0.1)',
                            border: '1px solid rgba(167, 139, 250, 0.2)',
                            padding: '2px 8px', borderRadius: '10px',
                            display: 'inline-flex', alignItems: 'center', gap: '4px'
                          }}>
                            <FiUsers size={10} /> Followed author
                          </span>
                        );
                        if (reason === 'popular') return (
                          <span key={reason} style={{
                            fontSize: '0.72rem', fontWeight: 600,
                            color: '#f59e0b',
                            background: 'rgba(245, 158, 11, 0.1)',
                            border: '1px solid rgba(245, 158, 11, 0.2)',
                            padding: '2px 8px', borderRadius: '10px',
                            display: 'inline-flex', alignItems: 'center', gap: '4px'
                          }}>
                            <FiTrendingUp size={10} /> Popular
                          </span>
                        );
                        if (reason.startsWith('tag:')) {
                          const tag = reason.slice(4);
                          return (
                            <span key={reason} style={{
                              fontSize: '0.72rem', fontWeight: 600,
                              color: 'var(--color-secondary)',
                              background: 'rgba(6, 182, 212, 0.1)',
                              border: '1px solid rgba(6, 182, 212, 0.2)',
                              padding: '2px 8px', borderRadius: '10px',
                            }}>
                              #{tag}
                            </span>
                          );
                        }
                        return null;
                      })}
                    </div>
                  )}
                </div>

                {/* Action Bar (Likes & Comments Toggle) */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '16px', borderTop: '1px solid var(--surface-border)', paddingTop: '12px' }}>
                  {/* Like Button */}
                  <button
                    onClick={() => handleLikeToggle(post.id, post.user_id, likedByMe)}
                    className="btn btn-secondary"
                    style={{
                      padding: '6px 12px',
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      color: likedByMe ? 'var(--danger)' : 'inherit',
                      borderColor: likedByMe ? 'rgba(239, 68, 68, 0.4)' : 'var(--surface-border)',
                      background: likedByMe ? 'rgba(239, 68, 68, 0.05)' : 'var(--surface)',
                    }}
                    aria-label={likedByMe ? 'Unlike post' : 'Like post'}
                  >
                    <FiHeart style={{ fill: likedByMe ? 'var(--danger)' : 'transparent' }} />
                    <span>{post.likes?.length || 0}</span>
                  </button>

                  {/* Bookmark Button */}
                  <button
                    onClick={() => handleBookmarkToggle(post.id, bookmarkedByMe)}
                    className="btn btn-secondary"
                    style={{
                      padding: '6px 12px',
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      color: bookmarkedByMe ? 'var(--color-secondary)' : 'inherit',
                      borderColor: bookmarkedByMe ? 'rgba(6, 182, 212, 0.4)' : 'var(--surface-border)',
                      background: bookmarkedByMe ? 'rgba(6, 182, 212, 0.05)' : 'var(--surface)',
                    }}
                    aria-label={bookmarkedByMe ? 'Remove bookmark' : 'Bookmark post'}
                  >
                    <FiBookmark style={{ fill: bookmarkedByMe ? 'var(--color-secondary)' : 'transparent' }} />
                    <span>{bookmarkedByMe ? 'Saved' : 'Save'}</span>
                  </button>

                  {/* Comment Button */}
                  <button
                    onClick={() => toggleComments(post.id)}
                    className="btn btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                    aria-label="Toggle comments"
                  >
                    <FiMessageSquare />
                    <span>{expandedComments[post.id] ? 'Hide Comments' : 'Comments'}</span>
                  </button>
                </div>

                {/* Expanded Comments Panel */}
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
        </div>
      )}

      {/* Infinite Scroll Trigger / Fallback Load More Button */}
      {posts.length > 0 && hasMore && (
        <div ref={observerRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '32px 0' }}>
          {loadingMore ? (
            <div className="spinner-large" style={{ width: '32px', height: '32px' }}></div>
          ) : (
            <button
              onClick={() => {
                setPage((prev) => {
                  const nextPage = prev + 1;
                  loadPosts(nextPage, false);
                  return nextPage;
                });
              }}
              className="btn btn-secondary"
              style={{ fontSize: '0.85rem', padding: '8px 16px' }}
            >
              Load More Posts
            </button>
          )}
        </div>
      )}

      {/* --- EDIT POST MODAL OVERLAY --- */}
      <AnimatePresence>
        {editingPost && (
          <div className="modal-overlay">
            <motion.div
              className="modal-card glass-panel"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              <div className="modal-header">
                <h3>Edit Post Specifications</h3>
                <button className="modal-close-btn" onClick={closeEditModal}>
                  <FiX />
                </button>
              </div>

              {editError && (
                <div className="alert-message error-alert">
                  {editError}
                </div>
              )}

              <form onSubmit={handleUpdatePost} className="signup-form">
                {/* Title */}
                <div className="input-group">
                  <label className="input-label" htmlFor="edit-title">Post Title</label>
                  <input
                    id="edit-title"
                    type="text"
                    required
                    className="input-field"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    disabled={editLoading}
                  />
                </div>

                {/* Content */}
                <div className="input-group">
                  <label className="input-label" htmlFor="edit-content">Content</label>
                  <textarea
                    id="edit-content"
                    required
                    rows={5}
                    className="input-field"
                    style={{ resize: 'vertical', minHeight: '100px' }}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    disabled={editLoading}
                  />
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    disabled={editLoading}
                  >
                    {editLoading ? <span className="spinner"></span> : (
                      <>
                        <FiSave />
                        <span>Save Changes</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={closeEditModal}
                    disabled={editLoading}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- CUSTOM DELETE CONFIRMATION MODAL OVERLAY --- */}
      <AnimatePresence>
        {deletingPostId && (
          <div className="modal-overlay">
            <motion.div
              className="modal-card glass-panel"
              style={{ maxWidth: '440px' }}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              <div className="modal-header">
                <h3 style={{ color: 'var(--danger)' }}>Confirm Deletion</h3>
                <button className="modal-close-btn" onClick={closeDeleteModal}>
                  <FiX />
                </button>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: '1.5' }}>
                  Are you absolutely sure you want to delete this post? This action is permanent and cannot be undone.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={handleDeletePost}
                  className="btn btn-danger"
                  style={{ flex: 1 }}
                  disabled={deleteLoading}
                >
                  {deleteLoading ? <span className="spinner"></span> : (
                    <>
                      <FiTrash2 />
                      <span>Delete Post</span>
                    </>
                  )}
                </button>
                <button
                  onClick={closeDeleteModal}
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  disabled={deleteLoading}
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ReportModal
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        contentId={reportContentId || 0}
        contentType={reportContentType}
      />
    </motion.div>
  );
}
