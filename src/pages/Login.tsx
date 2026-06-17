import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiMail, FiLock, FiEye, FiEyeOff, FiLogIn } from 'react-icons/fi';
import { FcGoogle } from 'react-icons/fc';
import { supabase } from '../lib/supabaseClient';

/**
 * Login Page Component:
 * Handles user authentication via email & password using Supabase.
 */
export default function Login() {
  const navigate = useNavigate();

  // 1. Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  // 2. UI states
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // 3. Form Submit Handler (calls Supabase Sign In)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); // Prevents page reload
    setErrorMsg('');
    setLoading(true);

    const cleanEmail = email.trim();

    try {
      /**
       * WHY: supabase.auth.signInWithPassword()
       * This method requests the Supabase Authentication server to verify
       * the credentials. If correct, Supabase returns a JSON Web Token (JWT)
       * representing the user's active session.
       * 
       * WHERE is it called:
       * Triggered immediately when the user clicks the "Log In" submit button.
       */
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: password,
      });

      if (error) {
        setErrorMsg(error.message);
      } else if (data.session) {
        // Successful login, navigate to the Feed page (which we will build next)
        navigate('/feed');
      }
    } catch (err) {
      setErrorMsg('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signup-container">
      {/* 
        Matches Signup design with identical Framer Motion card wrapper
      */}
      <motion.div 
        className="signup-card glass-panel"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        <div className="card-header">
          <div className="logo-glow">
            <FiLogIn className="header-icon" />
          </div>
          <h2>Welcome Back</h2>
          <p className="subtitle">Sign in to your Nexus Social account</p>
        </div>

        {errorMsg && (
          <div className="alert-message error-alert">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleLogin} className="signup-form">
          {/* Email Input */}
          <div className="input-group">
            <label className="input-label" htmlFor="login-email">Email Address</label>
            <div className="input-with-icon">
              <FiMail className="field-icon" />
              <input
                id="login-email"
                type="email"
                required
                className="input-field"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          {/* Password Input */}
          <div className="input-group">
            <label className="input-label" htmlFor="login-password">Password</label>
            <div className="input-with-icon">
              <FiLock className="field-icon" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                required
                className="input-field"
                placeholder="Enter password"
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

          {/* Remember Me & Forgot Password wrapper */}
          <div className="login-options">
            <label className="remember-me-label">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={loading}
              />
              <span>Remember me</span>
            </label>
            <Link 
              to="/forgot-password" 
              className="forgot-password-link"
            >
              Forgot Password?
            </Link>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="btn btn-primary submit-btn"
            disabled={loading}
          >
            {loading ? (
              <span className="spinner"></span>
            ) : (
              'Log In'
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="auth-divider">
          <span>or log in with</span>
        </div>

        {/* Social Log In */}
        <button
          type="button"
          className="btn btn-secondary google-btn"
          disabled={loading}
          onClick={() => alert('Google authentication is configured in your Supabase Auth provider settings.')}
        >
          <FcGoogle size={20} />
          Log in with Google
        </button>

        <p className="auth-footer">
          Don't have an account?{' '}
          <Link to="/signup" className="auth-link">
            Sign Up
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
