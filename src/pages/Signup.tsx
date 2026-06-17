import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiMail, FiLock, FiEye, FiEyeOff, FiUserPlus, FiUser } from 'react-icons/fi';
import { FcGoogle } from 'react-icons/fc';
import { supabase } from '../lib/supabaseClient';
import PasswordStrengthIndicator from '../components/PasswordStrengthIndicator';

/**
 * Signup Page Component:
 * This page handles user registration using Supabase Auth.
 * 
 * Terminology for Junior Developers:
 * 1. "useState": A React hook that lets us store values (like email or password) 
 *    that change over time. When these values change, React re-renders the screen.
 * 2. "async/await": JavaScript's way of handling operations that take time 
 *    (like calling a database across the internet). We "await" the response 
 *    so the code stops and waits for Supabase to finish before moving to the next line.
 */
export default function Signup() {
  const navigate = useNavigate();

  // 1. Form fields states
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // 2. UI interaction states
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Helper validation: Check if email is valid
  const validateEmail = (emailStr: string) => {
    return /\S+@\S+\.\S+/.test(emailStr);
  };

  // 3. Form Submit Handler (calls Supabase Auth)
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault(); // Prevents the browser from reloading the page
    setErrorMsg('');
    setSuccessMsg('');

    // Clean up input by removing any leading or trailing spaces
    const cleanEmail = email.trim();
    const cleanName = fullName.trim();

    // Client-side validations
    if (!cleanName) {
      setErrorMsg('Please enter your full name.');
      return;
    }
    if (!validateEmail(cleanEmail)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    const meetsMinLength = password.length >= 6;
    const hasNumber = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (!meetsMinLength || !hasNumber || !hasSpecialChar) {
      setErrorMsg('Password must be at least 6 characters, and contain a number and a special character.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      /**
       * WHY: supabase.auth.signUp()
       * We pass options.data containing full_name. This saves the name in the user's
       * metadata inside Supabase Auth, which then triggers our Database Trigger to
       * copy the name automatically to the public profiles table!
       */
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: cleanName
          }
        }
      });

      if (error) {
        setErrorMsg(error.message);
      } else if (data.user) {
        // If email confirmation is disabled, Supabase returns a session instantly.
        // We log them in and redirect automatically to the dashboard!
        if (data.session) {
          navigate('/feed');
        } else {
          setSuccessMsg('Account created successfully! Please check your email inbox to confirm your account.');
          // Reset inputs
          setFullName('');
          setEmail('');
          setPassword('');
          setConfirmPassword('');
        }
      }
    } catch (err: any) {
      setErrorMsg('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signup-container">
      {/* 
        Framer Motion: <motion.div> allows us to animate this card.
        We fade it in (opacity 0 -> 1) and slide it up (y: 20 -> 0) when it mounts.
      */}
      <motion.div
        className="signup-card glass-panel"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        <div className="card-header">
          <div className="logo-glow">
            <FiUserPlus className="header-icon" />
          </div>
          <h2>Create Account</h2>
          <p className="subtitle">Join Nexus Social and connect with the future</p>
        </div>

        {errorMsg && (
          <div className="alert-message error-alert">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="alert-message success-alert">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSignup} className="signup-form">
          {/* Full Name Input */}
          <div className="input-group">
            <label className="input-label" htmlFor="name-input">Full Name</label>
            <div className="input-with-icon">
              <FiUser className="field-icon" />
              <input
                id="name-input"
                type="text"
                required
                className="input-field"
                placeholder="Enter your name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          {/* Email Input */}
          <div className="input-group">
            <label className="input-label" htmlFor="email-input">Email Address</label>
            <div className="input-with-icon">
              <FiMail className="field-icon" />
              <input
                id="email-input"
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
            <label className="input-label" htmlFor="password-input">Password</label>
            <div className="input-with-icon">
              <FiLock className="field-icon" />
              <input
                id="password-input"
                type={showPassword ? 'text' : 'password'}
                required
                className="input-field"
                placeholder="Create password"
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

          {/* Confirm Password Input */}
          <div className="input-group">
            <label className="input-label" htmlFor="confirm-password-input">Confirm Password</label>
            <div className="input-with-icon">
              <FiLock className="field-icon" />
              <input
                id="confirm-password-input"
                type={showConfirmPassword ? 'text' : 'password'}
                required
                className="input-field"
                placeholder="Confirm password"
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

          {/* Password Strength Indicator */}
          <PasswordStrengthIndicator passwordStr={password} />

          {/* Submit Button */}
          <button
            type="submit"
            className="btn btn-primary submit-btn"
            disabled={loading}
          >
            {loading ? (
              <span className="spinner"></span>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="auth-divider">
          <span>or join with</span>
        </div>

        {/* Social Sign Up (Mocked OAuth UI) */}
        <button
          type="button"
          className="btn btn-secondary google-btn"
          disabled={loading}
          onClick={() => alert('Google authentication can be configured in your Supabase Auth provider dashboard!')}
        >
          <FcGoogle size={20} />
          Sign up with Google
        </button>

        <p className="auth-footer">
          Already have an account?{' '}
          <Link to="/login" className="auth-link">
            Log In
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
