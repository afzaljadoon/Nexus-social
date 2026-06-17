import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../context/TenantContext';
import { cacheManager } from '../lib/cacheManager';
import { FiMessageSquare, FiSend, FiTrash2, FiCpu, FiAlertCircle, FiLoader, FiAlertOctagon } from 'react-icons/fi';
import FeatureGuard from './FeatureGuard';
import ReportModal from './ReportModal';
import { scanContentLocally } from '../lib/safetyScanner';

interface ProfileType {
  full_name: string | null;
  avatar_url: string | null;
}

interface CommentType {
  id: number;
  content: string;
  created_at: string;
  user_id: string;
  profiles: ProfileType | null;
}

interface CommentsSectionProps {
  postId: number;
  postAuthorId: string;
}

export default function CommentsSection({ postId, postAuthorId }: CommentsSectionProps) {
  const { user } = useAuth();
  const { activeOrg } = useTenant();
  const [comments, setComments] = useState<CommentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Report Modal States
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportCommentId, setReportCommentId] = useState<number | null>(null);

  const openReportModal = (id: number) => {
    setReportCommentId(id);
    setIsReportOpen(true);
  };

  // Fetch comments
  const fetchComments = async () => {
    try {
      const { data, error } = await supabase
        .from('comments')
        .select('id, content, created_at, user_id, profiles(full_name, avatar_url)')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      const formattedComments: CommentType[] = (data || []).map((item: any) => {
        const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
        return {
          id: item.id,
          content: item.content,
          created_at: item.created_at,
          user_id: item.user_id,
          profiles: profile || null,
        };
      });
      setComments(formattedComments);
    } catch (err: any) {
      console.error('Error fetching comments:', err);
      setErrorMsg('Failed to load comments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComments();

    // Subscribe to realtime comment changes for this post
    const channel = supabase
      .channel(`comments-realtime-${postId}-${Math.random()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'comments',
          filter: `post_id=eq.${postId}`,
        },
        () => {
          fetchComments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId]);

  // Submit comment
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newComment.trim() || submitting) return;

    setSubmitting(true);
    setErrorMsg('');

    try {
      // Content Moderation check
      let isFlagged = false;
      let flaggedCategories: string[] = [];

      try {
        const { data: modData, error: modError } = await supabase.functions.invoke('content-moderator', {
          body: { text: newComment.trim() }
        });

        if (modError || !modData) {
          throw new Error('Edge function execution failed');
        }

        isFlagged = modData.flagged;
        flaggedCategories = modData.categories || [];
      } catch (e) {
        console.warn('Edge function moderation failed, falling back to client-side safety scanner:', e);
        const fallback = scanContentLocally(newComment.trim());
        isFlagged = fallback.flagged;
        flaggedCategories = fallback.categories;
      }

      if (isFlagged) {
        const categoriesStr = flaggedCategories.length > 0
          ? flaggedCategories.join(', ')
          : 'general safety guidelines';
        setErrorMsg(`Comment blocked. Violates safety policy for: ${categoriesStr}.`);
        setSubmitting(false);
        return;
      }

      const { error } = await supabase.from('comments').insert([
        {
          post_id: postId,
          user_id: user.id,
          content: newComment.trim(),
          organization_id: activeOrg?.id || '00000000-0000-0000-0000-000000000000',
        },
      ]);

      if (error) throw error;

      // Trigger comment notification to post author if not own post
      if (postAuthorId !== user.id) {
        await supabase.from('notifications').insert([
          {
            recipient_id: postAuthorId,
            sender_id: user.id,
            type: 'comment',
            post_id: postId,
          },
        ]);
      }

      cacheManager.invalidateByTags(['posts', 'analytics']);
      setNewComment('');
    } catch (err: any) {
      console.error('Error posting comment:', err);
      setErrorMsg(err.message || 'Failed to post comment.');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete comment
  const handleDelete = async (commentId: number) => {
    if (!user) return;
    if (!confirm('Are you sure you want to delete this comment?')) return;

    try {
      const { error } = await supabase
        .from('comments')
        .delete()
        .eq('id', commentId);

      if (error) throw error;
      cacheManager.invalidateByTags(['posts', 'analytics']);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err: any) {
      console.error('Error deleting comment:', err);
      alert('Could not delete comment.');
    }
  };

  // Suggest comment reply using OpenAI Function
  const handleAiSuggest = async () => {
    if (!user || aiGenerating) return;
    setAiGenerating(true);
    setErrorMsg('');

    try {
      // 1. Fetch post details if we need them
      const { data: postData, error: postErr } = await supabase
        .from('posts')
        .select('title, content')
        .eq('id', postId)
        .single();

      if (postErr || !postData) throw new Error('Could not retrieve post details for AI suggestion.');

      // 2. Invoke OpenAI generator Edge Function
      const { data, error } = await supabase.functions.invoke('ai-generator', {
        body: {
          action: 'comment',
          context: {
            title: postData.title,
            content: postData.content,
          },
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.result?.text) {
        setNewComment(data.result.text);
      } else {
        throw new Error('AI returned an empty suggestion.');
      }
    } catch (err: any) {
      console.error('AI Comment generation error:', err);
      setErrorMsg(err.message || 'Failed to generate AI comment suggestion.');
    } finally {
      setAiGenerating(false);
    }
  };

  const formatCommentTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div style={{ marginTop: '16px', padding: '16px 24px', background: 'rgba(255, 255, 255, 0.01)', borderTop: '1px solid var(--surface-border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h5 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
        <FiMessageSquare size={14} />
        <span>Comments ({comments.length})</span>
      </h5>

      {/* Error Message */}
      {errorMsg && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--danger)', borderRadius: '8px', fontSize: '0.8rem' }}>
          <FiAlertCircle size={14} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Comments List */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
          <div className="spinner-large" style={{ width: '20px', height: '20px' }}></div>
        </div>
      ) : comments.length === 0 ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0', fontStyle: 'italic' }}>
          No comments yet. Be the first to comment!
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '300px', overflowY: 'auto', paddingRight: '4px' }}>
          {comments.map((comment) => {
            const commenterName = comment.profiles?.full_name || 'Anonymous';
            const firstLetter = commenterName.charAt(0).toUpperCase();
            const isCommenter = user && user.id === comment.user_id;

            return (
              <div key={comment.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'rgba(255, 255, 255, 0.02)', padding: '10px 12px', borderRadius: '8px' }}>
                {comment.profiles?.avatar_url ? (
                  <img
                    src={comment.profiles.avatar_url}
                    alt={commenterName}
                    style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div className="avatar-circle" style={{ width: '28px', height: '28px', fontSize: '0.75rem' }}>
                    {firstLetter}
                  </div>
                )}

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {commenterName}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {formatCommentTime(comment.created_at)}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 0 0', lineHeight: '1.4', whiteSpace: 'pre-wrap' }}>
                    {comment.content}
                  </p>
                </div>

                {isCommenter ? (
                  <button
                    onClick={() => handleDelete(comment.id)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}
                    onMouseOver={(e) => (e.currentTarget.style.color = 'var(--danger)')}
                    onMouseOut={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                    title="Delete comment"
                  >
                    <FiTrash2 size={12} />
                  </button>
                ) : (
                  user && (
                    <button
                      type="button"
                      onClick={() => openReportModal(comment.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}
                      onMouseOver={(e) => (e.currentTarget.style.color = 'var(--danger)')}
                      onMouseOut={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                      title="Report comment"
                    >
                      <FiAlertOctagon size={12} />
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Write Comment Input Form */}
      {user ? (
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
          <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Write a comment..."
              className="input-field"
              style={{ width: '100%', paddingRight: '40px', paddingLeft: '16px', height: '38px', borderRadius: '10px' }}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              disabled={submitting || aiGenerating}
            />
            
            {/* AI Suggest Button */}
            <FeatureGuard flag="ai-comments">
              <button
                type="button"
                onClick={handleAiSuggest}
                disabled={aiGenerating || submitting}
                style={{
                  position: 'absolute',
                  right: '8px',
                  background: 'none',
                  border: 'none',
                  color: aiGenerating ? 'var(--color-secondary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '4px',
                  transition: 'color 0.2s',
                }}
                onMouseOver={(e) => {
                  if (!aiGenerating) e.currentTarget.style.color = 'var(--color-secondary)';
                }}
                onMouseOut={(e) => {
                  if (!aiGenerating) e.currentTarget.style.color = 'var(--text-muted)';
                }}
                title="Generate AI reply suggestion"
              >
                {aiGenerating ? <FiLoader className="spin" size={16} /> : <FiCpu size={16} />}
              </button>
            </FeatureGuard>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '38px', height: '38px', borderRadius: '10px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            disabled={!newComment.trim() || submitting || aiGenerating}
            title="Send comment"
          >
            <FiSend size={14} />
          </button>
        </form>
      ) : (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
          Please sign in to post comments.
        </p>
      )}

      <ReportModal
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        contentId={reportCommentId || 0}
        contentType="comment"
      />
    </div>
  );
}
