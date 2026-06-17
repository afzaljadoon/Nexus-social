import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FiCamera, FiTrash2, FiUser, FiCheckCircle, FiLoader, FiMail, FiEdit3, FiBook, FiGlobe, FiCpu, FiAward, FiMessageSquare, FiHeart, FiPlusCircle } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';

interface ProfileData {
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  website: string | null;
  reputation_points?: number;
}

/**
 * Profile Component:
 * Manages user profile information and profile photo uploads using Supabase Storage.
 */
export default function Profile() {
  const { userId } = useParams();
  const { user, fetchProfile } = useAuth();
  const isOwnProfile = !userId || (user && user.id === userId);

  const [isFollowing, setIsFollowing] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const handleAiGenerateBio = async () => {
    setAiLoading(true);
    setErrorMsg('');
    try {
      const contextText = profile.bio?.trim() || `My name is ${profile.full_name || 'User'}`;
      const { data, error } = await supabase.functions.invoke('ai-generator', {
        body: { action: 'bio', context: contextText }
      });
      if (error) throw error;
      if (data?.success && data?.result?.text) {
        setProfile(prev => ({ ...prev, bio: data.result.text }));
      } else {
        throw new Error(data?.error || 'Failed to generate bio details.');
      }
    } catch (err: any) {
      console.error('Error generating AI bio:', err);
      setErrorMsg(err.message || 'Failed to connect to the AI service.');
    } finally {
      setAiLoading(false);
    }
  };

  // 1. Profile information states
  const [profile, setProfile] = useState<ProfileData>({
    full_name: '',
    username: '',
    avatar_url: null,
    bio: '',
    website: '',
  });

  const [loading, setLoading] = useState(true);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [updating, setUpdating] = useState(false);
  
  // 2. Alert/Notice states
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [userBadges, setUserBadges] = useState<any[]>([]);

  // Fetch target user profile data
  const getProfile = async () => {
    const targetUserId = userId || user?.id;
    if (!targetUserId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, username, avatar_url, bio, website, reputation_points')
        .eq('id', targetUserId)
        .single();

      if (error) {
        if (error.code === 'PGRST116' && isOwnProfile && user) {
          const defaultName = user.email ? user.email.split('@')[0] : 'User';
          const { error: insertError } = await supabase
            .from('profiles')
            .insert([{ id: user.id, full_name: defaultName, username: defaultName }]);
          
          if (!insertError) {
            setProfile({ full_name: defaultName, username: defaultName, avatar_url: null, bio: '', website: '', reputation_points: 0 });
          }
        } else {
          setErrorMsg(error.message);
        }
      } else if (data) {
        setProfile({
          full_name: data.full_name || '',
          username: data.username || '',
          avatar_url: data.avatar_url,
          bio: data.bio || '',
          website: data.website || '',
          reputation_points: data.reputation_points || 0,
        });
      }

      // Fetch user badges
      const { data: badgesData } = await supabase
        .from('user_badges')
        .select('awarded_at, badges:badge_id(id, name, description, icon)')
        .eq('user_id', targetUserId);
      
      if (badgesData) {
        setUserBadges(badgesData.map((ub: any) => ub.badges).filter(Boolean));
      }

      // Fetch Follow count stats
      const { count: followers } = await supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('following_id', targetUserId);

      const { count: following } = await supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('follower_id', targetUserId);

      setFollowerCount(followers || 0);
      setFollowingCount(following || 0);

      // Check if logged in user follows this public profile
      if (!isOwnProfile && user) {
        const { data: followCheck } = await supabase
          .from('follows')
          .select('id')
          .eq('follower_id', user.id)
          .eq('following_id', targetUserId)
          .maybeSingle();
        
        setIsFollowing(!!followCheck);

        // Record a profile visit
        await supabase
          .from('profile_visits')
          .insert([{ profile_id: targetUserId, visitor_id: user.id }]);
      }
    } catch (err) {
      setErrorMsg('Failed to load profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getProfile();
  }, [user, userId]);

  const handleFollowToggle = async () => {
    if (!user || !userId) return;
    const originalFollowing = isFollowing;
    const originalCount = followerCount;

    setIsFollowing(!isFollowing);
    setFollowerCount(isFollowing ? followerCount - 1 : followerCount + 1);

    try {
      if (originalFollowing) {
        // Unfollow
        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', user.id)
          .eq('following_id', userId);
        if (error) throw error;

        // Trigger Unfollow Notification
        await supabase
          .from('notifications')
          .insert([{
            recipient_id: userId,
            sender_id: user.id,
            type: 'unfollow',
            post_id: null
          }]);
      } else {
        // Follow
        const { error } = await supabase
          .from('follows')
          .insert([{ follower_id: user.id, following_id: userId }]);
        if (error) throw error;

        // Trigger Follow Notification
        await supabase
          .from('notifications')
          .insert([{
            recipient_id: userId,
            sender_id: user.id,
            type: 'follow',
            post_id: null
          }]);
      }
    } catch (err) {
      console.error('Error toggling follow from profile:', err);
      setIsFollowing(originalFollowing);
      setFollowerCount(originalCount);
    }
  };

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  };

  // 3. Update Text Fields handler
  const handleUpdateDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setUpdating(true);
    setErrorMsg('');

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: profile.full_name?.trim(),
          username: profile.username?.trim(),
          bio: profile.bio?.trim(),
          website: profile.website?.trim(),
        })
        .eq('id', user.id);

      if (error) {
        setErrorMsg(error.message);
      } else {
        await fetchProfile();
        triggerSuccess('Profile information updated successfully!');
      }
    } catch (err) {
      setErrorMsg('Failed to update profile details.');
    } finally {
      setUpdating(false);
    }
  };

  // 4. Upload Avatar image handler (calls Supabase Storage)
  const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!user || !e.target.files || e.target.files.length === 0) return;
    setUploading(true);
    setErrorMsg('');

    const file = e.target.files[0];
    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}-${Math.random()}.${fileExt}`;
    const filePath = `${fileName}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });

      if (uploadError) {
        throw uploadError;
      }

      // Retrieve public URL from bucket
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // Save public URL link inside profile row in DB
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      if (updateError) {
        throw updateError;
      }

      setProfile(prev => ({ ...prev, avatar_url: publicUrl }));
      await fetchProfile();
      triggerSuccess('Profile picture updated successfully!');
    } catch (err: any) {
      setErrorMsg(err.message || 'Error uploading image.');
    } finally {
      setUploading(false);
    }
  };

  // 5. Remove Avatar handler
  const handleRemoveAvatar = async () => {
    if (!user || !profile.avatar_url) return;
    if (!window.confirm('Are you sure you want to remove your profile picture?')) return;

    setUploading(true);
    setErrorMsg('');

    try {
      // Set DB avatar_url to null
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', user.id);

      if (updateError) {
        throw updateError;
      }

      setProfile(prev => ({ ...prev, avatar_url: null }));
      await fetchProfile();
      triggerSuccess('Profile picture removed successfully.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Error removing image.');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="glass-panel page-header-panel skeleton" style={{ height: '100px' }}></div>
        <div className="glass-panel skeleton" style={{ height: '350px' }}></div>
      </div>
    );
  }

  const defaultLetter = profile.full_name?.charAt(0).toUpperCase() || 'U';

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      className="page-container"
      style={{ position: 'relative' }}
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

      <div className="glass-panel page-header-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2>{isOwnProfile ? 'Your Profile' : `${profile.full_name || 'User'}'s Profile`}</h2>
          <p className="subtitle">{isOwnProfile ? 'Manage details, biography, and profile photo settings' : `View bio, statistics, and follow options`}</p>
        </div>
        {!isOwnProfile && user && (
          <button
            onClick={handleFollowToggle}
            className={`btn ${isFollowing ? 'btn-secondary' : 'btn-primary'}`}
            style={{ padding: '10px 24px', borderRadius: '12px', fontSize: '0.9rem' }}
          >
            {isFollowing ? 'Unfollow' : 'Follow'}
          </button>
        )}
      </div>

      <div className="signup-container" style={{ minHeight: 'auto', padding: 0 }}>
        <div className="signup-card glass-panel" style={{ maxWidth: '640px', textAlign: 'left', padding: '40px' }}>
          
          {errorMsg && (
            <div className="alert-message error-alert">
              {errorMsg}
            </div>
          )}

          {/* AVATAR MANAGEMENT SECTION */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '32px', gap: '16px' }}>
            <div className="user-avatar-glow" style={{ width: '96px', height: '96px', borderRadius: '50%' }}>
              {profile.avatar_url ? (
                <img 
                  src={profile.avatar_url} 
                  alt="Profile Avatar" 
                  style={{ width: '96px', height: '96px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--bg-primary)' }}
                />
              ) : (
                <div 
                  className="avatar-circle" 
                  style={{ width: '96px', height: '96px', borderRadius: '50%', fontSize: '2.5rem', border: '3px solid var(--bg-primary)' }}
                >
                  {defaultLetter}
                </div>
              )}
            </div>

            {isOwnProfile && (
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {/* Upload New Image Button */}
                <label className="btn btn-secondary" style={{ cursor: 'pointer', padding: '10px 16px', fontSize: '0.85rem' }}>
                  {uploading ? <FiLoader className="spinner" /> : <FiCamera />}
                  <span>{profile.avatar_url ? 'Change Photo' : 'Upload Photo'}</span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleUploadAvatar} 
                    disabled={uploading} 
                    style={{ display: 'none' }}
                  />
                </label>

                {/* Remove Image Button */}
                {profile.avatar_url && (
                  <button 
                    onClick={handleRemoveAvatar}
                    className="btn btn-secondary"
                    style={{ color: 'var(--danger)', padding: '10px 16px', fontSize: '0.85rem' }}
                    disabled={uploading}
                  >
                    <FiTrash2 />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            )}

            {/* Follow Stats */}
            <div style={{ display: 'flex', gap: '32px', marginTop: '8px' }}>
              <div style={{ textAlign: 'center' }}>
                <span style={{ display: 'block', fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-secondary)' }}>{followerCount}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Followers</span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <span style={{ display: 'block', fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-secondary)' }}>{followingCount}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Following</span>
              </div>
            </div>
          </div>

          {/* REPUTATION & LEVEL PROGRESS */}
          {(() => {
            const points = profile.reputation_points || 0;
            const lvl = Math.floor(1 + Math.sqrt(points / 50));
            const currentLevelMin = 50 * Math.pow(lvl - 1, 2);
            const nextLevelMin = 50 * Math.pow(lvl, 2);
            const pointsInCurrentLevel = points - currentLevelMin;
            const pointsRequiredForNext = nextLevelMin - currentLevelMin;
            const progressPercent = Math.min(100, Math.max(0, (pointsInCurrentLevel / pointsRequiredForNext) * 100));

            return (
              <div className="glass-panel" style={{ width: '100%', padding: '20px', borderRadius: '16px', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--surface-border)', marginBottom: '28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nexus Level</span>
                    <h4 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: 'var(--color-secondary)' }}>Level {lvl}</h4>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reputation</span>
                    <h4 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>{points} <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>pts</span></h4>
                  </div>
                </div>

                {/* Progress Bar */}
                <div style={{ width: '100%', height: '8px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
                  <div style={{ width: `${progressPercent}%`, height: '100%', background: 'linear-gradient(90deg, var(--color-secondary) 0%, #06b6d4 100%)', borderRadius: '4px', transition: 'width 0.5s ease-out' }}></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  <span>Lvl {lvl} ({currentLevelMin} pts)</span>
                  <span>Lvl {lvl + 1} ({nextLevelMin} pts)</span>
                </div>
              </div>
            );
          })()}

          {/* UNLOCKED BADGES */}
          {userBadges.length > 0 && (
            <div style={{ width: '100%', marginBottom: '28px' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px' }}>Unlocked Badges ({userBadges.length})</h4>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {userBadges.map((badge: any) => {
                  const renderSmallBadgeIcon = (iconName: string) => {
                    const size = 14;
                    const color = 'var(--color-secondary)';
                    switch (iconName) {
                      case 'FiPlusCircle': return <FiPlusCircle size={size} color={color} />;
                      case 'FiMessageSquare': return <FiMessageSquare size={size} color={color} />;
                      case 'FiHeart': return <FiHeart size={size} color={color} />;
                      default: return <FiAward size={size} color={color} />;
                    }
                  };

                  return (
                    <div 
                      key={badge.id} 
                      title={badge.description}
                      style={{ 
                        display: 'inline-flex', 
                        alignItems: 'center', 
                        gap: '6px', 
                        padding: '6px 12px', 
                        background: 'rgba(6, 182, 212, 0.05)', 
                        border: '1px solid rgba(6, 182, 212, 0.2)', 
                        borderRadius: '20px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        color: 'var(--color-secondary)',
                        cursor: 'help'
                      }}
                    >
                      {renderSmallBadgeIcon(badge.icon)}
                      <span>{badge.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* USER SPECIFICATION DETAILS FORM */}
          <form onSubmit={isOwnProfile ? handleUpdateDetails : (e) => e.preventDefault()} className="signup-form">
            <div className="input-group">
              <label className="input-label" htmlFor="profile-email">Email Address</label>
              <div className="input-with-icon">
                <FiMail className="field-icon" />
                <input
                  id="profile-email"
                  type="email"
                  className="input-field"
                  disabled
                  value={isOwnProfile ? (user?.email || '') : 'Hidden Profile Email'}
                  style={{ opacity: 0.5, cursor: 'not-allowed' }}
                />
              </div>
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="profile-name">Full Name</label>
              <div className="input-with-icon">
                <FiUser className="field-icon" />
                <input
                  id="profile-name"
                  type="text"
                  required
                  className="input-field"
                  placeholder="Enter your name"
                  value={profile.full_name || ''}
                  onChange={(e) => setProfile(prev => ({ ...prev, full_name: e.target.value }))}
                  disabled={!isOwnProfile || updating}
                />
              </div>
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="profile-username">Username</label>
              <div className="input-with-icon">
                <FiEdit3 className="field-icon" />
                <input
                  id="profile-username"
                  type="text"
                  required
                  className="input-field"
                  placeholder="Enter your username"
                  value={profile.username || ''}
                  onChange={(e) => setProfile(prev => ({ ...prev, username: e.target.value }))}
                  disabled={!isOwnProfile || updating}
                />
              </div>
            </div>

            {/* BIO INPUT */}
            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="input-label" htmlFor="profile-bio">Biography</label>
                {isOwnProfile && (
                  <button
                    type="button"
                    onClick={handleAiGenerateBio}
                    className="btn btn-secondary"
                    style={{ padding: '2px 8px', fontSize: '0.7rem', borderRadius: '4px', height: '20px', display: 'inline-flex', alignItems: 'center', gap: '4px', borderColor: 'rgba(6,182,212,0.3)', color: 'var(--color-secondary)' }}
                    disabled={aiLoading}
                  >
                    <FiCpu size={12} />
                    <span>{aiLoading ? 'Drafting...' : 'AI Bio'}</span>
                  </button>
                )}
              </div>
              <div className="input-with-icon">
                <FiBook className="field-icon" />
                <textarea
                  id="profile-bio"
                  className="input-field"
                  placeholder="Tell us about yourself..."
                  value={profile.bio || ''}
                  onChange={(e) => setProfile(prev => ({ ...prev, bio: e.target.value }))}
                  disabled={!isOwnProfile || updating}
                  rows={3}
                  style={{ width: '100%', paddingLeft: '46px', fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>
            </div>

            {/* WEBSITE / SOCIAL LINK INPUT */}
            <div className="input-group">
              <label className="input-label" htmlFor="profile-website">Website / Social Links</label>
              <div className="input-with-icon">
                <FiGlobe className="field-icon" />
                <input
                  id="profile-website"
                  type="url"
                  className="input-field"
                  placeholder="https://example.com"
                  value={profile.website || ''}
                  onChange={(e) => setProfile(prev => ({ ...prev, website: e.target.value }))}
                  disabled={!isOwnProfile || updating}
                />
              </div>
            </div>

            {isOwnProfile && (
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '12px' }}
                disabled={updating}
              >
                {updating ? <span className="spinner"></span> : 'Update Profile Details'}
              </button>
            )}
          </form>

        </div>
      </div>
    </motion.div>
  );
}
