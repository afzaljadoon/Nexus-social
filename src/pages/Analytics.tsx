import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FiEye, FiHeart, FiMessageSquare, FiUserCheck, FiBarChart2, FiAlertCircle, FiTrendingUp } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { cacheManager } from '../lib/cacheManager';

interface PostStatType {
  id: number;
  title: string;
  created_at: string;
  likes: { count: number }[] | any;
  comments: { count: number }[] | any;
  post_views: { count: number }[] | any;
}

export default function Analytics() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // Metrics States
  const [totalViews, setTotalViews] = useState(0);
  const [totalLikes, setTotalLikes] = useState(0);
  const [totalComments, setTotalComments] = useState(0);
  const [totalVisits, setTotalVisits] = useState(0);
  const [postsBreakdown, setPostsBreakdown] = useState<any[]>([]);

  const fetchAnalytics = async () => {
    if (!user) return;
    
    const cacheKey = `analytics:${user.id}`;
    const cachedData = cacheManager.get<any>(cacheKey);
    if (cachedData) {
      setTotalVisits(cachedData.totalVisits);
      setTotalLikes(cachedData.totalLikes);
      setTotalComments(cachedData.totalComments);
      setTotalViews(cachedData.totalViews);
      setPostsBreakdown(cachedData.postsBreakdown);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      // 1. Fetch Total Profile Visits
      const { count: visitsCount, error: visitsError } = await supabase
        .from('profile_visits')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', user.id);

      if (visitsError) throw visitsError;
      setTotalVisits(visitsCount || 0);

      // 2. Fetch Total Likes Received on Creator's Posts
      const { count: likesCount, error: likesError } = await supabase
        .from('likes')
        .select('id, posts!inner(user_id)', { count: 'exact', head: true })
        .eq('posts.user_id', user.id);

      if (likesError) throw likesError;
      setTotalLikes(likesCount || 0);

      // 3. Fetch Total Comments Received on Creator's Posts
      const { count: commentsCount, error: commentsError } = await supabase
        .from('comments')
        .select('id, posts!inner(user_id)', { count: 'exact', head: true })
        .eq('posts.user_id', user.id);

      if (commentsError) throw commentsError;
      setTotalComments(commentsCount || 0);

      // 4. Fetch Total Post Views on Creator's Posts
      const { count: viewsCount, error: viewsError } = await supabase
        .from('post_views')
        .select('id, posts!inner(user_id)', { count: 'exact', head: true })
        .eq('posts.user_id', user.id);

      if (viewsError) throw viewsError;
      setTotalViews(viewsCount || 0);

      // 5. Fetch Individual Posts Breakdown
      // Using PostgREST aggregate select count syntax
      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select(`
          id,
          title,
          created_at,
          likes:likes(count),
          comments:comments(count),
          post_views:post_views(count)
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (postsError) throw postsError;

      const formattedPosts = (postsData || []).map((post: any) => {
        // Handle counts from PostgREST format
        const lCount = post.likes?.[0]?.count || 0;
        const cCount = post.comments?.[0]?.count || 0;
        const vCount = post.post_views?.[0]?.count || 0;
        return {
          id: post.id,
          title: post.title,
          created_at: post.created_at,
          likesCount: lCount,
          commentsCount: cCount,
          viewsCount: vCount,
        };
      });

      setPostsBreakdown(formattedPosts);
      
      // Save to cache
      cacheManager.set(
        cacheKey,
        {
          totalVisits: visitsCount || 0,
          totalLikes: likesCount || 0,
          totalComments: commentsCount || 0,
          totalViews: viewsCount || 0,
          postsBreakdown: formattedPosts
        },
        300000, // 5 min TTL
        ['analytics']
      );
    } catch (err: any) {
      console.error('Error fetching creator analytics:', err);
      setErrorMsg(err.message || 'Failed to fetch analytics data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [user]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="glass-panel page-header-panel skeleton" style={{ height: '80px', marginBottom: '24px' }}></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '32px' }}>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="glass-panel skeleton" style={{ height: '120px' }}></div>
          ))}
        </div>
        <div className="glass-panel skeleton" style={{ height: '300px' }}></div>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="page-container">
        <div className="glass-panel placeholder-card error-alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <FiAlertCircle size={40} />
          <h3>Analytics Fetch Error</h3>
          <p>{errorMsg}</p>
          <button className="btn btn-secondary" onClick={fetchAnalytics}>
            Retry Load
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
      {/* Header */}
      <div className="glass-panel page-header-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2>Creator Analytics</h2>
          <p className="subtitle">Track metrics, engagement stats, and viewer activity on your content</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-secondary)', fontSize: '0.9rem', fontWeight: 500, padding: '8px 16px', background: 'rgba(6, 182, 212, 0.05)', border: '1px solid rgba(6, 182, 212, 0.15)', borderRadius: '12px' }}>
          <FiTrendingUp />
          <span>Real-time Syncing</span>
        </div>
      </div>

      {/* Overview Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '32px' }}>
        {/* Post Views */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(6, 182, 212, 0.1)', color: 'var(--color-secondary)' }}>
            <FiEye size={24} />
          </div>
          <div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Post Views</span>
            <span style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px', display: 'inline-block' }}>{totalViews}</span>
          </div>
        </div>

        {/* Likes Received */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)' }}>
            <FiHeart size={24} />
          </div>
          <div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Likes Received</span>
            <span style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px', display: 'inline-block' }}>{totalLikes}</span>
          </div>
        </div>

        {/* Comments Received */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(124, 58, 237, 0.1)', color: 'var(--color-primary)' }}>
            <FiMessageSquare size={24} />
          </div>
          <div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Comments</span>
            <span style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px', display: 'inline-block' }}>{totalComments}</span>
          </div>
        </div>

        {/* Profile Visits */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(245, 158, 11, 0.1)', color: 'var(--color-accent)' }}>
            <FiUserCheck size={24} />
          </div>
          <div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Profile Visits</span>
            <span style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px', display: 'inline-block' }}>{totalVisits}</span>
          </div>
        </div>
      </div>

      {/* Individual Posts Breakdown */}
      <div className="glass-panel" style={{ padding: '32px', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
          <FiBarChart2 size={20} style={{ color: 'var(--color-secondary)' }} />
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>Posts Engagement Performance</h3>
        </div>

        {postsBreakdown.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            <p>You haven't written any posts yet. Publish a post to start tracking analytics!</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--surface-border)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Post Title</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500 }}>Date Published</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500 }}>Views</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500 }}>Likes</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500 }}>Comments</th>
                </tr>
              </thead>
              <tbody>
                {postsBreakdown.map((post) => (
                  <tr key={post.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.02)' }} className="table-row-hover">
                    <td style={{ padding: '16px', fontWeight: 500, color: 'var(--text-primary)' }}>{post.title}</td>
                    <td style={{ padding: '16px', color: 'var(--text-muted)' }}>{formatDate(post.created_at)}</td>
                    <td style={{ padding: '16px', textAlign: 'right', color: 'var(--color-secondary)', fontWeight: 600 }}>{post.viewsCount}</td>
                    <td style={{ padding: '16px', textAlign: 'right', color: 'var(--danger)', fontWeight: 600 }}>{post.likesCount}</td>
                    <td style={{ padding: '16px', textAlign: 'right', color: 'var(--color-primary)', fontWeight: 600 }}>{post.commentsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}
