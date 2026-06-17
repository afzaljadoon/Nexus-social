import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  FiActivity, 
  FiHeart, 
  FiMessageSquare, 
  FiPlusCircle, 
  FiUserPlus, 
  FiEdit3, 
  FiSearch, 
  FiClock 
} from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';

interface ActorProfileType {
  full_name: string | null;
  avatar_url: string | null;
  username: string | null;
}

interface ActivityType {
  id: number;
  created_at: string;
  action_type: 'post.create' | 'post.like' | 'comment.create' | 'user.follow' | 'profile.update';
  target_id: string | null;
  description: string;
  metadata: Record<string, any>;
  actor: ActorProfileType | null;
}

export default function ActivityFeed() {
  const { user } = useAuth();
  
  const [activities, setActivities] = useState<ActivityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [isLiveConnected, setIsLiveConnected] = useState(false);

  // Humanize timestamp
  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return 'Just now'; // Handle minor clock drift

    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays}d ago`;
  };

  // Fetch initial activities
  const fetchActivities = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const { data, error } = await supabase
        .from('activities')
        .select(`
          id,
          created_at,
          action_type,
          target_id,
          description,
          metadata,
          actor:profiles!actor_id(full_name, avatar_url, username)
        `)
        .order('created_at', { ascending: false })
        .limit(80);

      if (error) {
        setErrorMsg(error.message);
      } else {
        setActivities((data as any) || []);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error fetching global feed activities.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    
    fetchActivities();

    // Setup realtime channel
    const channel = supabase
      .channel('activities-feed-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'activities',
        },
        async (payload) => {
          const newRecord = payload.new;
          
          // Fetch actor details
          const { data: actorProfile } = await supabase
            .from('profiles')
            .select('full_name, avatar_url, username')
            .eq('id', newRecord.actor_id)
            .single();

          const enrichedActivity: ActivityType = {
            id: newRecord.id,
            created_at: newRecord.created_at,
            action_type: newRecord.action_type,
            target_id: newRecord.target_id,
            description: newRecord.description,
            metadata: newRecord.metadata || {},
            actor: actorProfile || null
          };

          setActivities(prev => [enrichedActivity, ...prev]);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsLiveConnected(true);
        } else {
          setIsLiveConnected(false);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Activity action helpers (icon & colors)
  const getActivityMeta = (actionType: string) => {
    switch (actionType) {
      case 'post.create':
        return {
          icon: <FiPlusCircle size={16} />,
          color: 'var(--color-primary)',
          bgColor: 'rgba(59, 130, 246, 0.1)',
          label: 'Post'
        };
      case 'post.like':
        return {
          icon: <FiHeart size={16} />,
          color: 'var(--danger)',
          bgColor: 'rgba(239, 68, 68, 0.1)',
          label: 'Like'
        };
      case 'comment.create':
        return {
          icon: <FiMessageSquare size={16} />,
          color: 'var(--color-secondary)',
          bgColor: 'rgba(16, 185, 129, 0.1)',
          label: 'Comment'
        };
      case 'user.follow':
        return {
          icon: <FiUserPlus size={16} />,
          color: 'var(--color-accent)',
          bgColor: 'rgba(139, 92, 246, 0.1)',
          label: 'Follow'
        };
      case 'profile.update':
        return {
          icon: <FiEdit3 size={16} />,
          color: '#eab308',
          bgColor: 'rgba(234, 179, 8, 0.1)',
          label: 'Profile'
        };
      default:
        return {
          icon: <FiActivity size={16} />,
          color: 'var(--text-muted)',
          bgColor: 'rgba(255, 255, 255, 0.05)',
          label: 'Event'
        };
    }
  };

  // Filter and Search logic
  const filteredActivities = activities.filter(activity => {
    const actionMeta = getActivityMeta(activity.action_type);
    
    // 1. Filter Type Match
    if (filterType !== 'all' && actionMeta.label.toLowerCase() !== filterType) {
      return false;
    }
    
    // 2. Search Query Match
    const searchLower = searchQuery.toLowerCase();
    const matchesDescription = activity.description.toLowerCase().includes(searchLower);
    const matchesActorName = activity.actor?.full_name?.toLowerCase().includes(searchLower);
    const matchesUsername = activity.actor?.username?.toLowerCase().includes(searchLower);
    
    return matchesDescription || matchesActorName || matchesUsername;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-container"
    >
      {/* Header */}
      <div className="glass-panel page-header-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2>Platform Activity Hub</h2>
          <p className="subtitle">Realtime social updates, user interactions, and timeline activities</p>
        </div>
        
        {/* Realtime Status Indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          background: isLiveConnected ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.03)',
          border: `1px solid ${isLiveConnected ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.05)'}`,
          borderRadius: '99px',
          fontSize: '0.85rem',
          fontWeight: 600,
          color: isLiveConnected ? 'var(--success)' : 'var(--text-muted)'
        }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: isLiveConnected ? 'var(--success)' : 'var(--text-muted)',
            boxShadow: isLiveConnected ? '0 0 10px var(--success)' : 'none',
            display: 'inline-block',
            animation: isLiveConnected ? 'pulse 2s infinite' : 'none'
          }} />
          <span>{isLiveConnected ? 'Live Stream Active' : 'Offline'}</span>
        </div>
      </div>

      {/* Control Actions Row (Search & Filters) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
        
        {/* Search Bar */}
        <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', padding: '6px 14px', gap: '12px' }}>
          <FiSearch className="text-muted" size={18} />
          <input
            type="text"
            placeholder="Search timeline activities (e.g. usernames, content tags)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-primary)',
              width: '100%',
              fontSize: '0.95rem',
              outline: 'none'
            }}
          />
        </div>

        {/* Filter Pills */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {['all', 'post', 'like', 'comment', 'follow', 'profile'].map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`btn ${filterType === type ? 'btn-primary' : 'btn-secondary'}`}
              style={{ 
                padding: '6px 16px', 
                borderRadius: '99px', 
                fontSize: '0.85rem', 
                textTransform: 'capitalize' 
              }}
            >
              {type === 'all' ? 'All Activities' : `${type}s`}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline List Panel */}
      <div className="glass-panel" style={{ padding: '32px' }}>
        {errorMsg && (
          <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
            <span>{errorMsg}</span>
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {[1, 2, 3, 4].map(idx => (
              <div key={idx} className="skeleton" style={{ height: '80px', borderRadius: '12px' }}></div>
            ))}
          </div>
        ) : filteredActivities.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
            <FiActivity size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
            <h4>No Activities Logged</h4>
            <p style={{ fontSize: '0.9rem', marginTop: '4px' }}>Timeline is quiet. Check back later or interact with the platform!</p>
          </div>
        ) : (
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '30px' }}>
            
            {/* Timeline Vertical Path Line */}
            <div style={{
              position: 'absolute',
              top: '20px',
              bottom: '20px',
              left: '20px',
              width: '2px',
              background: 'linear-gradient(to bottom, var(--surface-border) 0%, rgba(255,255,255,0.01) 100%)',
              zIndex: 0
            }} />

            {/* List entries */}
            <AnimatePresence initial={false}>
              {filteredActivities.map((act) => {
                const meta = getActivityMeta(act.action_type);
                const letter = act.actor?.full_name?.charAt(0).toUpperCase() || 'U';
                const metadata = act.metadata || {};
                
                return (
                  <motion.div
                    key={act.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.3 }}
                    style={{
                      display: 'flex',
                      gap: '16px',
                      position: 'relative',
                      zIndex: 1
                    }}
                  >
                    {/* Actor Avatar Profile + Action Icon Overlay */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      {act.actor?.avatar_url ? (
                        <img 
                          src={act.actor.avatar_url} 
                          alt="" 
                          style={{ width: '42px', height: '42px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--surface-border)' }} 
                        />
                      ) : (
                        <div className="avatar-circle" style={{ width: '42px', height: '42px', fontSize: '0.95rem', border: '2px solid var(--surface-border)' }}>
                          {letter}
                        </div>
                      )}
                      
                      {/* Floating Badge representing the specific action */}
                      <div style={{
                        position: 'absolute',
                        bottom: '-2px',
                        right: '-2px',
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        background: '#0a0d24',
                        border: `1.5px solid ${meta.color}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: meta.color,
                        boxShadow: `0 0 6px ${meta.color}44`
                      }}>
                        {meta.icon}
                      </div>
                    </div>

                    {/* Description Timeline Card */}
                    <div className="glass-panel" style={{
                      flexGrow: 1,
                      padding: '16px 20px',
                      borderRadius: '16px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px'
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left' }}>
                        <span style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-primary)', lineHeight: '1.4' }}>
                          {act.description}
                        </span>
                        
                        {/* Display target metadata metadata details if available */}
                        {Object.keys(metadata).length > 0 && (
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                            {metadata.title && (
                              <span style={{
                                padding: '2px 8px',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid var(--surface-border)',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                color: 'var(--text-muted)'
                              }}>
                                Title: {metadata.title}
                              </span>
                            )}
                            {metadata.post_title && (
                              <span style={{
                                padding: '2px 8px',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid var(--surface-border)',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                color: 'var(--text-muted)'
                              }}>
                                Post: {metadata.post_title}
                              </span>
                            )}
                            {metadata.username && (
                              <span style={{
                                padding: '2px 8px',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid var(--surface-border)',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                color: 'var(--text-muted)'
                              }}>
                                User: @{metadata.username}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Timeline Timestamp */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: 'var(--text-muted)',
                        fontSize: '0.8rem',
                        whiteSpace: 'nowrap'
                      }}>
                        <FiClock size={12} />
                        <span>{formatRelativeTime(act.created_at)}</span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
}
