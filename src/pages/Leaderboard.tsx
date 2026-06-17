import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { cacheManager } from '../lib/cacheManager';
import { motion } from 'framer-motion';
import { FiAward, FiPlusCircle, FiMessageSquare, FiHeart, FiTrendingUp, FiLock, FiCheckCircle } from 'react-icons/fi';

interface LeaderboardUser {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  reputation_points: number;
}

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  points_required: number;
}

export default function Leaderboard() {
  const { user } = useAuth();
  const [leaderboard, setLeaderboard] = useState<LeaderboardUser[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [unlockedBadgeIds, setUnlockedBadgeIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Helper to map DB icon string to React Icon component
  const renderBadgeIcon = (iconName: string, isUnlocked: boolean) => {
    const size = 28;
    const color = isUnlocked ? 'var(--color-secondary)' : 'var(--text-muted)';
    
    switch (iconName) {
      case 'FiPlusCircle':
        return <FiPlusCircle size={size} color={color} />;
      case 'FiMessageSquare':
        return <FiMessageSquare size={size} color={color} />;
      case 'FiHeart':
        return <FiHeart size={size} color={color} />;
      case 'FiAward':
      default:
        return <FiAward size={size} color={color} />;
    }
  };

  // Level formula matching Profile page
  const calculateLevel = (points: number) => {
    return Math.floor(1 + Math.sqrt(points / 50));
  };

  useEffect(() => {
    const fetchData = async () => {
      const cacheKey = `leaderboard:data:${user?.id || 'anonymous'}`;
      const cachedData = cacheManager.get<any>(cacheKey);
      if (cachedData) {
        setLeaderboard(cachedData.leaderboard);
        setBadges(cachedData.badges);
        setUnlockedBadgeIds(cachedData.unlockedBadgeIds);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        
        // 1. Fetch top users by reputation
        const { data: usersData, error: usersError } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url, reputation_points')
          .order('reputation_points', { ascending: false })
          .limit(20);

        if (usersError) throw usersError;

        // 2. Fetch all badges
        const { data: badgesData, error: badgesError } = await supabase
          .from('badges')
          .select('*')
          .order('points_required', { ascending: true });

        if (badgesError) throw badgesError;

        // 3. Fetch current user's unlocked badges
        let userUnlockedIds: string[] = [];
        if (user) {
          const { data: userBadgesData, error: userBadgesError } = await supabase
            .from('user_badges')
            .select('badge_id')
            .eq('user_id', user.id);

          if (userBadgesError) throw userBadgesError;
          userUnlockedIds = (userBadgesData || []).map((ub) => ub.badge_id);
        }

        setLeaderboard(usersData || []);
        setBadges(badgesData || []);
        setUnlockedBadgeIds(userUnlockedIds);

        // Save to cache
        cacheManager.set(
          cacheKey,
          {
            leaderboard: usersData || [],
            badges: badgesData || [],
            unlockedBadgeIds: userUnlockedIds
          },
          30000, // 30 seconds TTL
          ['leaderboard']
        );
      } catch (err) {
        console.error('Error fetching leaderboard data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user]);

  if (loading) {
    return (
      <div className="page-container">
        <div className="glass-panel page-header-panel skeleton" style={{ height: '100px' }}></div>
        <div className="glass-panel skeleton" style={{ height: '400px' }}></div>
      </div>
    );
  }

  // Separate podium users (1st, 2nd, 3rd) from the rest of the list
  const podium = leaderboard.slice(0, 3);
  const runnersUp = leaderboard.slice(3);

  // Re-order podium for standard visual representation: [2nd, 1st, 3rd]
  const visualPodium = [];
  if (podium[1]) visualPodium.push({ ...podium[1], rank: 2 });
  if (podium[0]) visualPodium.push({ ...podium[0], rank: 1 });
  if (podium[2]) visualPodium.push({ ...podium[2], rank: 3 });

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-container"
      style={{ maxWidth: '1000px', margin: '0 auto', padding: '24px 16px' }}
    >
      {/* Header Panel */}
      <div className="glass-panel page-header-panel" style={{ marginBottom: '24px' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <FiTrendingUp className="logo-icon" />
          <span>Nexus Leaderboard</span>
        </h2>
        <p className="subtitle">
          Earn points and level up by contributing to the community. Unlock achievements and claim the top ranks!
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '32px' }}>
        
        {/* PODIUM & TOP USERS LIST */}
        <div className="glass-panel" style={{ padding: '32px' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '24px', textAlign: 'center' }}>
            🏆 Top Contributors
          </h3>

          {/* Visual Podium */}
          {podium.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: '16px', marginBottom: '40px', flexWrap: 'wrap', minHeight: '220px' }}>
              {visualPodium.map((podiumUser) => {
                const rankColor = podiumUser.rank === 1 ? '#F59E0B' : podiumUser.rank === 2 ? '#94A3B8' : '#B45309';
                const podiumHeight = podiumUser.rank === 1 ? '160px' : podiumUser.rank === 2 ? '120px' : '90px';
                const displayName = podiumUser.full_name || podiumUser.username || 'Anonymous';
                const level = calculateLevel(podiumUser.reputation_points);

                return (
                  <div key={podiumUser.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '130px' }}>
                    
                    {/* Glowing Avatar representation */}
                    <div style={{ position: 'relative', marginBottom: '8px' }}>
                      <div 
                        style={{
                          width: podiumUser.rank === 1 ? '80px' : '64px',
                          height: podiumUser.rank === 1 ? '80px' : '64px',
                          borderRadius: '50%',
                          border: `3px solid ${rankColor}`,
                          boxShadow: `0 0 20px ${rankColor}40`,
                          overflow: 'hidden',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'var(--bg-primary)'
                        }}
                      >
                        {podiumUser.avatar_url ? (
                          <img src={podiumUser.avatar_url} alt={displayName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <span style={{ fontSize: podiumUser.rank === 1 ? '1.8rem' : '1.4rem', fontWeight: 'bold' }}>
                            {displayName.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <span 
                        style={{ 
                          position: 'absolute', 
                          top: '-8px', 
                          right: '-8px', 
                          background: rankColor, 
                          color: '#fff', 
                          fontWeight: 'bold', 
                          fontSize: '0.8rem', 
                          padding: '2px 8px', 
                          borderRadius: '10px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
                        }}
                      >
                        #{podiumUser.rank}
                      </span>
                    </div>

                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden', width: '100%', textAlign: 'center' }}>
                      {displayName}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                      Lvl {level}
                    </span>

                    {/* Visual Podium Base block */}
                    <motion.div 
                      initial={{ height: 0 }}
                      animate={{ height: podiumHeight }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                      style={{ 
                        width: '100%', 
                        background: `linear-gradient(180deg, ${rankColor}25 0%, ${rankColor}05 100%)`, 
                        border: `1px solid ${rankColor}40`,
                        borderBottom: 'none',
                        borderRadius: '8px 8px 0 0',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                        color: 'var(--text-primary)'
                      }}
                    >
                      <span style={{ fontWeight: 800, fontSize: '1.2rem', color: rankColor }}>{podiumUser.reputation_points}</span>
                      <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.8 }}>Points</span>
                    </motion.div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Runners up list */}
          {runnersUp.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {runnersUp.map((leader, index) => {
                const rank = index + 4;
                const displayName = leader.full_name || leader.username || 'Anonymous';
                const level = calculateLevel(leader.reputation_points);
                const isCurrentUser = user && leader.id === user.id;

                return (
                  <div 
                    key={leader.id} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      padding: '12px 20px',
                      background: isCurrentUser ? 'rgba(6, 182, 212, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                      border: isCurrentUser ? '1px solid var(--color-secondary)' : '1px solid var(--surface-border)',
                      borderRadius: '12px',
                      transition: 'transform 0.2s, background 0.2s',
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      if (!isCurrentUser) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      if (!isCurrentUser) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <span style={{ fontWeight: 700, width: '28px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        #{rank}
                      </span>
                      
                      {leader.avatar_url ? (
                        <img src={leader.avatar_url} alt={displayName} style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover' }} />
                      ) : (
                        <div className="avatar-circle" style={{ width: '36px', height: '36px', fontSize: '0.85rem' }}>
                          {displayName.charAt(0).toUpperCase()}
                        </div>
                      )}

                      <div>
                        <span style={{ fontWeight: 600, fontSize: '0.9rem', color: isCurrentUser ? 'var(--color-secondary)' : 'var(--text-primary)' }}>
                          {displayName}
                        </span>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Level {level}
                        </span>
                      </div>
                    </div>

                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                      {leader.reputation_points} pts
                    </span>
                  </div>
                );
              })}
            </div>
          ) : podium.length === 0 && (
            <p style={{ textAlign: 'center', fontStyle: 'italic', color: 'var(--text-muted)' }}>
              No scores recorded yet. Be the first to earn points!
            </p>
          )}
        </div>

        {/* BADGE DIRECTORY */}
        <div className="glass-panel" style={{ padding: '32px' }}>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '12px', textAlign: 'center' }}>
            🏅 Achievements & Badges
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '32px' }}>
            Earn specific milestones to unlock community badges shown on your public profile.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '20px' }}>
            {badges.map((badge) => {
              const isUnlocked = unlockedBadgeIds.includes(badge.id);

              return (
                <div 
                  key={badge.id} 
                  style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center', 
                    padding: '24px 16px',
                    background: isUnlocked ? 'rgba(6, 182, 212, 0.03)' : 'rgba(255, 255, 255, 0.01)',
                    border: isUnlocked ? '1.5px solid var(--color-secondary)' : '1px solid var(--surface-border)',
                    borderRadius: '16px',
                    position: 'relative',
                    textAlign: 'center',
                    boxShadow: isUnlocked ? '0 0 16px rgba(6, 182, 212, 0.1)' : 'none',
                    opacity: isUnlocked ? 1 : 0.65
                  }}
                >
                  {/* Lock/Unlock corner indicator */}
                  <div style={{ position: 'absolute', top: '12px', right: '12px' }}>
                    {isUnlocked ? (
                      <FiCheckCircle size={14} color="var(--color-secondary)" title="Unlocked" />
                    ) : (
                      <FiLock size={14} color="var(--text-muted)" title="Locked" />
                    )}
                  </div>

                  {/* Icon Circle */}
                  <div 
                    style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '50%',
                      background: isUnlocked ? 'rgba(6, 182, 212, 0.1)' : 'rgba(255, 255, 255, 0.03)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '16px',
                      border: isUnlocked ? '2px solid var(--color-secondary)' : '1px dashed var(--surface-border)'
                    }}
                  >
                    {renderBadgeIcon(badge.icon, isUnlocked)}
                  </div>

                  <span style={{ fontWeight: 700, fontSize: '0.95rem', color: isUnlocked ? 'var(--color-secondary)' : 'var(--text-primary)' }}>
                    {badge.name}
                  </span>
                  
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px', lineHeight: '1.4' }}>
                    {badge.description}
                  </p>

                  {!isUnlocked && badge.points_required > 0 && (
                    <span style={{ display: 'inline-block', marginTop: '12px', fontSize: '0.7rem', padding: '2px 8px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', color: 'var(--text-muted)' }}>
                      Requires {badge.points_required} pts
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </motion.div>
  );
}
