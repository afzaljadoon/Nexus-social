import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiX, FiAlertOctagon, FiLoader, FiCheckCircle } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  contentId: number;
  contentType: 'post' | 'comment';
  onReportSuccess?: () => void;
}

const REPORT_REASONS = [
  { value: 'spam', label: 'Spam & Advertising' },
  { value: 'hate_speech', label: 'Hate Speech & Discrimination' },
  { value: 'harassment', label: 'Harassment & Abuse' },
  { value: 'inappropriate', label: 'Inappropriate Content' },
  { value: 'other', label: 'Other Reason' },
];

export default function ReportModal({ isOpen, onClose, contentId, contentType, onReportSuccess }: ReportModalProps) {
  const { user } = useAuth();
  const [reason, setReason] = useState<string>('spam');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setErrorMsg('You must be signed in to report content.');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      const { error } = await supabase.from('reports').insert([
        {
          reporter_id: user.id,
          content_type: contentType,
          content_id: contentId,
          reason,
          description: description.trim() || null,
          status: 'pending',
        },
      ]);

      if (error) throw error;

      setSuccess(true);
      if (onReportSuccess) onReportSuccess();
      
      setTimeout(() => {
        setSuccess(false);
        setDescription('');
        setReason('spam');
        onClose();
      }, 2000);

    } catch (err: any) {
      console.error('Error submitting report:', err);
      setErrorMsg(err.message || 'Failed to submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div 
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            backgroundColor: 'rgba(5, 8, 22, 0.85)', 
            backdropFilter: 'blur(8px)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            zIndex: 9999,
            padding: '16px' 
          }}
        >
          {/* Backdrop overlay */}
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ position: 'absolute', width: '100%', height: '100%' }}
          />

          {/* Modal Container */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="glass-panel"
            style={{ 
              width: '100%', 
              maxWidth: '480px', 
              padding: '28px', 
              position: 'relative', 
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
              border: '1px solid var(--surface-border)'
            }}
          >
            {/* Close button */}
            <button
              onClick={onClose}
              style={{
                position: 'absolute',
                top: '20px',
                right: '20px',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.2s'
              }}
              onMouseOver={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseOut={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              <FiX size={20} />
            </button>

            {success ? (
              <div style={{ textAlign: 'center', padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                <FiCheckCircle size={48} color="var(--success)" className="spin-once" />
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Thank You</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
                  We received your report. Our moderation team will review this content shortly.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px', textAlign: 'left' }}>
                
                {/* Header title */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <FiAlertOctagon size={24} color="var(--danger)" />
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Report Content</h3>
                </div>

                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0, lineHeight: '1.4' }}>
                  Help keep Nexus safe. Let us know why this {contentType} violates our community guidelines.
                </p>

                {errorMsg && (
                  <div className="error-alert" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '8px', fontSize: '0.8rem' }}>
                    <span>{errorMsg}</span>
                  </div>
                )}

                {/* Reason Selection */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Reason for Report</label>
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    style={{
                      width: '100%',
                      height: '44px',
                      padding: '0 12px',
                      borderRadius: '10px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--surface-border)',
                      outline: 'none',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                    }}
                  >
                    {REPORT_REASONS.map((opt) => (
                      <option key={opt.value} value={opt.value} style={{ background: '#090d22', color: '#fff' }}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Details input */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label htmlFor="report-desc" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Additional details (optional)</label>
                  <textarea
                    id="report-desc"
                    placeholder="Provide context or specify what part violates the rules..."
                    className="input-field"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    disabled={submitting}
                    style={{ padding: '12px 16px', borderRadius: '10px', resize: 'none', fontSize: '0.9rem', lineHeight: '1.4' }}
                  />
                </div>

                {/* Buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '4px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={onClose}
                    disabled={submitting}
                    style={{ borderRadius: '10px', padding: '10px 20px', fontSize: '0.9rem' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={submitting}
                    style={{
                      borderRadius: '10px',
                      padding: '10px 24px',
                      fontSize: '0.9rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      background: 'var(--danger)',
                      borderColor: 'var(--danger)',
                      boxShadow: '0 0 12px rgba(239, 68, 68, 0.4)'
                    }}
                  >
                    {submitting ? (
                      <>
                        <FiLoader className="spin" />
                        <span>Submitting...</span>
                      </>
                    ) : (
                      <span>Submit Report</span>
                    )}
                  </button>
                </div>

              </form>
            )}

          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
