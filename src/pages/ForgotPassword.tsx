import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FiMail, FiArrowLeft, FiSend, FiCheckCircle } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';

/**
 * ForgotPassword Page Component:
 * Handles sending a secure password reset magic link to the user's email.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [success, setSuccess] = useState(false);

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccess(false);
    setLoading(true);

    const cleanEmail = email.trim();

    try {
      /**
       * WHY: supabase.auth.resetPasswordForEmail()
       * Triggers a recovery email with a secure link. Clicking the link redirects the user 
       * to the specified page containing the authentication hash token.
       */
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: 'http://localhost:5173/reset-password',
      });

      if (error) {
        setErrorMsg(error.message);
      } else {
        setSuccess(true);
        setEmail('');
      }
    } catch (err) {
      setErrorMsg('Failed to send reset link. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signup-container">
      <motion.div
        className="signup-card glass-panel"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        <div className="card-header">
          <div className="logo-glow" style={{ color: 'var(--color-secondary)', boxShadow: '0 0 15px var(--color-secondary-glow)' }}>
            <FiSend className="header-icon" />
          </div>
          <h2>Reset Password</h2>
          <p className="subtitle">Enter your email to receive a secure recovery link</p>
        </div>

        {errorMsg && (
          <div className="alert-message error-alert">
            {errorMsg}
          </div>
        )}

        <AnimatePresence mode="wait">
          {!success ? (
            <motion.form
              key="forgot-form"
              onSubmit={handleResetRequest}
              className="signup-form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Email Input */}
              <div className="input-group">
                <label className="input-label" htmlFor="forgot-email">Email Address</label>
                <div className="input-with-icon">
                  <FiMail className="field-icon" />
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    className="input-field"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="btn btn-primary submit-btn"
                disabled={loading || !email}
              >
                {loading ? (
                  <span className="spinner"></span>
                ) : (
                  <>
                    <span>Send Reset Link</span>
                    <FiSend size={16} />
                  </>
                )}
              </button>
            </motion.form>
          ) : (
            <motion.div
              key="forgot-success"
              className="success-state"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{ textAlign: 'center', padding: '20px 0' }}
            >
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px', color: 'var(--success)' }}>
                <FiCheckCircle size={48} />
              </div>
              <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Reset Link Sent</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: '1.5' }}>
                We've sent a password reset link to your email. Click the link to complete the reset.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="auth-footer" style={{ borderTop: '1px solid var(--surface-border)', paddingTop: '20px', marginTop: '24px' }}>
          <Link to="/login" className="auth-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <FiArrowLeft size={16} />
            <span>Back to Log In</span>
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
