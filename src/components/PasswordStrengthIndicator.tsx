import React from 'react';
import { FiCheck, FiCircle } from 'react-icons/fi';

interface StrengthIndicatorProps {
  passwordStr: string;
}

export default function PasswordStrengthIndicator({ passwordStr }: StrengthIndicatorProps) {
  const meetsMinLength = passwordStr.length >= 6;
  const hasNumber = /\d/.test(passwordStr);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(passwordStr);

  // Calculate score (0 to 3)
  let score = 0;
  if (meetsMinLength) score++;
  if (hasNumber) score++;
  if (hasSpecialChar) score++;

  // Determine bar colors and width
  const getProgressColor = () => {
    if (score === 1) return '#EF4444'; // Red
    if (score === 2) return '#F59E0B'; // Orange
    if (score === 3) return '#10B981'; // Green/Cyan
    return 'rgba(255, 255, 255, 0.1)';
  };

  const getStrengthLabel = () => {
    if (score === 1) return 'Weak';
    if (score === 2) return 'Medium';
    if (score === 3) return 'Strong & Secure';
    return 'None';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', background: 'rgba(0, 0, 0, 0.25)', border: '1px solid var(--surface-border)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
      
      {/* Label and Score */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', fontWeight: 600 }}>
          Password Security
        </span>
        {score > 0 && (
          <span style={{ color: getProgressColor(), fontWeight: 600, fontSize: '0.8rem', textShadow: `0 0 8px ${getProgressColor()}40` }}>
            {getStrengthLabel()}
          </span>
        )}
      </div>

      {/* Progress Bar */}
      <div style={{ height: '6px', width: '100%', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '3px', overflow: 'hidden', display: 'flex', gap: '4px' }}>
        {[1, 2, 3].map((index) => (
          <div
            key={index}
            style={{
              flex: 1,
              height: '100%',
              background: index <= score ? getProgressColor() : 'rgba(255, 255, 255, 0.05)',
              transition: 'background 0.3s ease-in-out',
            }}
          />
        ))}
      </div>

      {/* Checklist Grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
        {/* Requirement 1 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: meetsMinLength ? '#10B981' : 'var(--text-muted)', transition: 'color 0.3s ease' }}>
          {meetsMinLength ? (
            <FiCheck style={{ filter: 'drop-shadow(0 0 2px rgba(16,185,129,0.5))' }} />
          ) : (
            <FiCircle size={10} style={{ opacity: 0.6 }} />
          )}
          <span style={{ fontSize: '0.8rem', fontWeight: meetsMinLength ? 500 : 400 }}>At least 6 characters</span>
        </div>

        {/* Requirement 2 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: hasNumber ? '#10B981' : 'var(--text-muted)', transition: 'color 0.3s ease' }}>
          {hasNumber ? (
            <FiCheck style={{ filter: 'drop-shadow(0 0 2px rgba(16,185,129,0.5))' }} />
          ) : (
            <FiCircle size={10} style={{ opacity: 0.6 }} />
          )}
          <span style={{ fontSize: '0.8rem', fontWeight: hasNumber ? 500 : 400 }}>At least one number (0-9)</span>
        </div>

        {/* Requirement 3 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: hasSpecialChar ? '#10B981' : 'var(--text-muted)', transition: 'color 0.3s ease' }}>
          {hasSpecialChar ? (
            <FiCheck style={{ filter: 'drop-shadow(0 0 2px rgba(16,185,129,0.5))' }} />
          ) : (
            <FiCircle size={10} style={{ opacity: 0.6 }} />
          )}
          <span style={{ fontSize: '0.8rem', fontWeight: hasSpecialChar ? 500 : 400 }}>At least one special character (!@#$)</span>
        </div>
      </div>
    </div>
  );
}
