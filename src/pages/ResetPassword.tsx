import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FiLock, FiEye, FiEyeOff, FiCheckCircle } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';
import PasswordStrengthIndicator from '../components/PasswordStrengthIndicator';

/**
 * ResetPassword Page Component:
 * Validates strength and updates user password on a valid recovery session.
 */
export default function ResetPassword() {
  const navigate = useNavigate();

  // 1. Password fields
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // 2. UI/Error states
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [success, setSuccess] = useState(false);

  // 3. Password strength rules
  const meetsMinLength = password.length >= 6;
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccess(false);

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    if (!meetsMinLength || !hasNumber || !hasSpecialChar) {
      setErrorMsg('Password does not meet the complexity requirements.');
      return;
    }

    setLoading(true);

    try {
      /**
       * WHY: supabase.auth.updateUser()
       * Replaces authenticated credentials on the current session.
       * If successful, the user's password hash is safely replaced in the auth schema.
       */
      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) {
        setErrorMsg(error.message);
      } else {
        setSuccess(true);
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      }
    } catch (err) {
      setErrorMsg('Failed to update password. Please try again.');
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
          <div className="logo-glow">
            <FiLock className="header-icon" />
          </div>
          <h2>New Password</h2>
          <p className="subtitle">Securely set your new account password</p>
        </div>

        {errorMsg && (
          <div className="alert-message error-alert">
            {errorMsg}
          </div>
        )}

        <AnimatePresence mode="wait">
          {!success ? (
            <motion.form
              key="reset-form"
              onSubmit={handleResetPassword}
              className="signup-form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* New Password */}
              <div className="input-group">
                <label className="input-label" htmlFor="reset-password">New Password</label>
                <div className="input-with-icon">
                  <FiLock className="field-icon" />
                  <input
                    id="reset-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    className="input-field"
                    placeholder="Minimum 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <FiEyeOff /> : <FiEye />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="input-group">
                <label className="input-label" htmlFor="confirm-password">Confirm Password</label>
                <div className="input-with-icon">
                  <FiLock className="field-icon" />
                  <input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    className="input-field"
                    placeholder="Repeat new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? <FiEyeOff /> : <FiEye />}
                  </button>
                </div>
              </div>

              {/* Password strength indicator */}
              <PasswordStrengthIndicator passwordStr={password} />

              {/* Submit Button */}
              <button
                type="submit"
                className="btn btn-primary submit-btn"
                disabled={loading || !password || !confirmPassword}
              >
                {loading ? (
                  <span className="spinner"></span>
                ) : (
                  'Update Password'
                )}
              </button>
            </motion.form>
          ) : (
            <motion.div
              key="reset-success"
              className="success-state"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{ textAlign: 'center', padding: '20px 0' }}
            >
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px', color: 'var(--success)' }}>
                <FiCheckCircle size={48} />
              </div>
              <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Password Updated</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: '1.5' }}>
                Your password has been changed successfully. Redirecting you back to login...
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
