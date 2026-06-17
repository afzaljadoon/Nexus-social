import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { motion } from 'framer-motion';
import { FiPlusCircle, FiCpu, FiAlertCircle, FiArrowLeft, FiLoader } from 'react-icons/fi';
import FeatureGuard from '../components/FeatureGuard';
import { logAction } from '../lib/auditLogger';
import { CustomCheckbox, CustomDateTimePicker } from '../components/DateTimePicker';
import { scanContentLocally } from '../lib/safetyScanner';
import { useTenant } from '../context/TenantContext';
import { cacheManager } from '../lib/cacheManager';

export default function CreatePost() {
  const { user } = useAuth();
  const { activeOrg } = useTenant();
  const navigate = useNavigate();

  // Form States
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // AI Assistant States
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  // Scheduling States
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');

  // Submit Post to DB
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!activeOrg) {
      setErrorMsg('No active organization selected. Please create or join an organization first.');
      return;
    }
    if (!title.trim() || !content.trim()) {
      setErrorMsg('Title and content are required.');
      return;
    }

    if (isScheduled && !scheduledDate) {
      setErrorMsg('Please select a publication date and time.');
      return;
    }

    if (isScheduled && new Date(scheduledDate) <= new Date()) {
      setErrorMsg('Publication date must be in the future.');
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      // Content Moderation check
      const textToModerate = `${title.trim()}\n\n${content.trim()}`;
      let isFlagged = false;
      let flaggedCategories: string[] = [];

      try {
        const { data: modData, error: modError } = await supabase.functions.invoke('content-moderator', {
          body: { text: textToModerate }
        });

        if (modError || !modData) {
          throw new Error('Edge function execution failed');
        }

        isFlagged = modData.flagged;
        flaggedCategories = modData.categories || [];
      } catch (e) {
        console.warn('Edge function moderation failed, falling back to client-side safety scanner:', e);
        const fallback = scanContentLocally(textToModerate);
        isFlagged = fallback.flagged;
        flaggedCategories = fallback.categories;
      }

      if (isFlagged) {
        const categoriesStr = flaggedCategories.length > 0
          ? flaggedCategories.join(', ')
          : 'general safety guidelines';
        setErrorMsg(`Post blocked. Violates safety policy for: ${categoriesStr}. Please revise your content.`);
        setLoading(false);
        return;
      }

      const parsedTags = tagsInput
        .toLowerCase()
        .replace(/,/g, ' ')
        .split(/\s+/)
        .map((t) => t.trim().replace(/^#/, ''))
        .filter((t) => t.length > 0);

      const finalTags = parsedTags.length > 0 ? parsedTags : ['general'];

      const { data, error } = await supabase.from('posts').insert([
        {
          title: title.trim(),
          content: content.trim(),
          user_id: user.id,
          organization_id: activeOrg.id,
          tags: finalTags,
          is_published: !isScheduled,
          published_at: isScheduled ? new Date(scheduledDate).toISOString() : new Date().toISOString(),
        },
      ]).select('id').single();

      if (error) throw error;
      
      if (data) {
        logAction(
          isScheduled ? 'post.schedule' : 'post.create', 
          String(data.id), 
          { title: title.trim(), published_at: isScheduled ? scheduledDate : 'immediate' }
        );
      }

      // Invalidate feed and analytics cache
      cacheManager.invalidateByTags(['posts', 'analytics']);
      
      navigate('/feed');
    } catch (err: any) {
      console.error('Error creating post:', err);
      setErrorMsg(err.message || 'Failed to create post. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Draft Post using OpenAI Edge Function
  const handleAiDraft = async () => {
    if (!user || !aiPrompt.trim() || aiLoading) return;

    setAiLoading(true);
    setAiError('');

    try {
      const { data, error } = await supabase.functions.invoke('ai-generator', {
        body: {
          action: 'post',
          context: aiPrompt.trim(),
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      if (data?.result?.title && data?.result?.content) {
        setTitle(data.result.title);
        setContent(data.result.content);
        setAiPrompt('');
      } else {
        throw new Error('AI returned an incomplete response. Try a different prompt.');
      }
    } catch (err: any) {
      console.error('AI Draft Error:', err);
      setAiError(err.message || 'Failed to generate AI draft. Please try again.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="page-container"
      style={{ maxWidth: '800px', margin: '0 auto', padding: '24px 16px' }}
    >
      {/* Header with Back button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
        <button
          onClick={() => navigate(-1)}
          className="btn btn-secondary"
          style={{ padding: '10px', borderRadius: '12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          aria-label="Go back"
        >
          <FiArrowLeft size={18} />
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 700 }}>Create New Post</h2>
          <p className="subtitle" style={{ margin: 0 }}>Share your thoughts with the Nexus community</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* AI Content Assistant (Optional helper box) */}
        <FeatureGuard flag="ai-draft-post">
          <div className="glass-panel" style={{ padding: '24px', border: '1px dashed var(--color-secondary)' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--color-secondary)' }}>
              <FiCpu />
              <span>AI Draft Assistant</span>
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Need inspiration? Enter a topic or prompt below, and our AI assistant will generate a draft title and post body for you!
            </p>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="e.g. The future of decentralized social networks..."
                className="input-field"
                style={{ flex: 1, minWidth: '240px', height: '42px', borderRadius: '10px' }}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                disabled={aiLoading || loading}
              />
              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  height: '42px',
                  borderRadius: '10px',
                  borderColor: 'var(--color-secondary)',
                  color: 'var(--color-secondary)',
                  background: 'rgba(6, 182, 212, 0.05)',
                }}
                onClick={handleAiDraft}
                disabled={!aiPrompt.trim() || aiLoading || loading}
              >
                {aiLoading ? (
                  <>
                    <FiLoader className="spin" />
                    <span>Drafting...</span>
                  </>
                ) : (
                  <>
                    <FiCpu />
                    <span>Draft with AI</span>
                  </>
                )}
              </button>
            </div>

            {aiError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', color: 'var(--danger)', fontSize: '0.85rem' }}>
                <FiAlertCircle />
                <span>{aiError}</span>
              </div>
            )}
          </div>
        </FeatureGuard>

        {/* Main Post Form */}
        <form onSubmit={handleSubmit} className="glass-panel" style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {errorMsg && (
            <div className="error-alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: '10px' }}>
              <FiAlertCircle size={18} />
              <span>{errorMsg}</span>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label htmlFor="post-title" style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Post Title
            </label>
            <input
              id="post-title"
              type="text"
              placeholder="Give your post a catchy title..."
              className="input-field"
              style={{ width: '100%', height: '44px', borderRadius: '10px' }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={loading || aiLoading}
              required
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label htmlFor="post-content" style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Content Body
            </label>
            <textarea
              id="post-content"
              placeholder="What's on your mind? Type here..."
              className="input-field"
              style={{ width: '100%', minHeight: '180px', padding: '12px 16px', borderRadius: '10px', resize: 'vertical', lineHeight: '1.5' }}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={loading || aiLoading}
              required
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label htmlFor="post-tags" style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Tags / Topics (Optional)
            </label>
            <input
              id="post-tags"
              type="text"
              placeholder="e.g. tech science announcement (space or comma separated)..."
              className="input-field"
              style={{ width: '100%', height: '44px', borderRadius: '10px' }}
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              disabled={loading || aiLoading}
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Add topics to help others find your content using full-text search.
            </span>
          </div>

          {/* Scheduling Options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px dashed var(--surface-border)', paddingTop: '20px', textAlign: 'left' }}>
            <CustomCheckbox
              checked={isScheduled}
              onChange={setIsScheduled}
              disabled={loading || aiLoading}
              label="Schedule this post for future publication"
            />

            {isScheduled && (
              <div style={{ paddingLeft: '34px' }}>
                <CustomDateTimePicker
                  value={scheduledDate}
                  onChange={setScheduledDate}
                  disabled={loading || aiLoading}
                  label="Publication Date & Time (Local Time)"
                />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/feed')}
              disabled={loading || aiLoading}
              style={{ borderRadius: '10px', padding: '10px 24px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || aiLoading || !title.trim() || !content.trim()}
              style={{
                borderRadius: '10px',
                padding: '10px 28px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {loading ? (
                <>
                  <FiLoader className="spin" />
                  <span>{isScheduled ? 'Scheduling...' : 'Publishing...'}</span>
                </>
              ) : (
                <>
                  <FiPlusCircle />
                  <span>{isScheduled ? 'Schedule Post' : 'Publish Post'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </motion.div>
  );
}
