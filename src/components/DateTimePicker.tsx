import React, { useState, useEffect, useRef } from 'react';
import { FiCalendar, FiClock, FiChevronLeft, FiChevronRight } from 'react-icons/fi';

interface CustomCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export const CustomCheckbox: React.FC<CustomCheckboxProps> = ({ checked, onChange, label, disabled }) => {
  return (
    <label style={{ 
      display: 'inline-flex', 
      alignItems: 'center', 
      cursor: disabled ? 'not-allowed' : 'pointer', 
      gap: '12px', 
      userSelect: 'none',
      opacity: disabled ? 0.6 : 1
    }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          style={{ display: 'none' }}
        />
        <div style={{
          width: '22px',
          height: '22px',
          borderRadius: '6px',
          border: `2px solid ${checked ? 'var(--color-secondary)' : 'var(--surface-border)'}`,
          background: checked ? 'rgba(6, 182, 212, 0.1)' : 'rgba(0, 0, 0, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-secondary)',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: checked ? '0 0 10px rgba(6, 182, 212, 0.25)' : 'none'
        }}>
          {checked && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          )}
        </div>
      </div>
      <span style={{ fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 500 }}>{label}</span>
    </label>
  );
};

interface CustomDateTimePickerProps {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  label?: string;
}

export const CustomDateTimePicker: React.FC<CustomDateTimePickerProps> = ({ value, onChange, disabled, label }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse initial or default date states
  const initialDate = value ? new Date(value) : new Date();
  const [viewDate, setViewDate] = useState(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | null>(value ? new Date(value) : null);
  
  // Time selector states
  const [hour, setHour] = useState(initialDate.getHours() % 12 || 12);
  const [minute, setMinute] = useState(Math.round(initialDate.getMinutes() / 5) * 5 % 60); // nearest 5 mins
  const [ampm, setAmpm] = useState<'AM' | 'PM'>(initialDate.getHours() >= 12 ? 'PM' : 'AM');

  // Handle outside clicks to close picker
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const daysOfWeek = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  // Days in currently viewed month calculation
  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const handlePrevMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  };

  const handleDaySelect = (dayNum: number) => {
    const newSelect = new Date(viewDate.getFullYear(), viewDate.getMonth(), dayNum);
    setSelectedDate(newSelect);
  };

  const triggerChange = (date: Date, hr: number, min: number, amPmVal: 'AM' | 'PM') => {
    let finalHour = hr % 12;
    if (amPmVal === 'PM') finalHour += 12;
    if (amPmVal === 'AM' && hr === 12) finalHour = 0;

    const finalDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), finalHour, min);
    // Format to local ISO-like string expected by datetime-local input fields (YYYY-MM-DDTHH:mm)
    const offset = finalDate.getTimezoneOffset();
    const localDate = new Date(finalDate.getTime() - offset * 60 * 1000);
    onChange(localDate.toISOString().slice(0, 16));
  };

  const handleApply = () => {
    const dateToUse = selectedDate || new Date();
    setSelectedDate(dateToUse);
    triggerChange(dateToUse, hour, minute, ampm);
    setIsOpen(false);
  };

  // Human friendly label
  const getDisplayValue = () => {
    if (!value) return 'Select date and time';
    const d = new Date(value);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Build calendar days grid
  const daysInMonth = getDaysInMonth(viewDate);
  const firstDayIndex = getFirstDayOfMonth(viewDate);
  const calendarGrid = [];

  // Offset empty days
  for (let i = 0; i < firstDayIndex; i++) {
    calendarGrid.push(<div key={`empty-${i}`} />);
  }

  // Days list
  for (let day = 1; day <= daysInMonth; day++) {
    const isSelected = selectedDate && 
      selectedDate.getDate() === day && 
      selectedDate.getMonth() === viewDate.getMonth() && 
      selectedDate.getFullYear() === viewDate.getFullYear();

    const isToday = new Date().getDate() === day &&
      new Date().getMonth() === viewDate.getMonth() &&
      new Date().getFullYear() === viewDate.getFullYear();

    calendarGrid.push(
      <button
        key={`day-${day}`}
        type="button"
        onClick={() => handleDaySelect(day)}
        style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.85rem',
          fontWeight: isSelected || isToday ? '600' : '400',
          cursor: 'pointer',
          background: isSelected ? 'var(--color-secondary)' : 'none',
          color: isSelected ? '#fff' : isToday ? 'var(--color-secondary)' : 'var(--text-primary)',
          boxShadow: isSelected ? '0 0 10px var(--color-secondary-glow)' : 'none',
          outline: 'none',
          transition: 'all 0.15s ease',
        }}
        className={isSelected ? '' : 'day-hover-btn'}
      >
        {day}
      </button>
    );
  }

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative' }}>
      {label && (
        <span style={{ 
          fontSize: '0.85rem', 
          color: 'var(--text-muted)', 
          fontWeight: 500, 
          textTransform: 'uppercase', 
          letterSpacing: '0.05em' 
        }}>
          {label}
        </span>
      )}
      
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'rgba(0, 0, 0, 0.3)',
          border: '1px solid var(--surface-border)',
          color: value ? '#fff' : 'var(--text-muted)',
          padding: '12px 16px',
          borderRadius: '12px',
          outline: 'none',
          fontSize: '0.95rem',
          width: '280px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'border-color 0.2s',
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)',
        }}
      >
        <span>{getDisplayValue()}</span>
        <FiCalendar size={18} style={{ color: 'var(--color-secondary)' }} />
      </button>

      {/* Calendar & Time Picker Dropdown Card */}
      {isOpen && (
        <div 
          className="custom-datetime-picker-card"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 0,
            zIndex: 999,
            width: '320px',
            background: 'rgba(10, 14, 39, 0.95)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid var(--surface-border)',
            borderRadius: '16px',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          
          {/* Header Switcher */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button type="button" onClick={handlePrevMonth} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>
              <FiChevronLeft size={20} />
            </button>
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
              {months[viewDate.getMonth()]} {viewDate.getFullYear()}
            </span>
            <button type="button" onClick={handleNextMonth} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>
              <FiChevronRight size={20} />
            </button>
          </div>

          {/* Days Label Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center' }}>
            {daysOfWeek.map(d => (
              <span key={d} style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{d}</span>
            ))}
          </div>

          {/* Days Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', minHeight: '180px' }}>
            {calendarGrid}
          </div>

          {/* Time Picker Slider/Dials Section */}
          <div style={{ 
            borderTop: '1px solid var(--surface-border)', 
            paddingTop: '14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-primary)' }}>
              <FiClock size={16} style={{ color: 'var(--color-secondary)', marginRight: '4px' }} />
              {/* Hour input */}
              <input
                type="number"
                min="1"
                max="12"
                value={hour}
                onChange={(e) => setHour(Math.max(1, Math.min(12, Number(e.target.value))))}
                style={{
                  width: '40px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--surface-border)',
                  color: '#fff',
                  borderRadius: '6px',
                  padding: '4px',
                  textAlign: 'center',
                  fontSize: '0.9rem',
                  outline: 'none'
                }}
              />
              <span>:</span>
              {/* Minute input */}
              <input
                type="number"
                min="0"
                max="59"
                value={minute < 10 ? `0${minute}` : minute}
                onChange={(e) => setMinute(Math.max(0, Math.min(59, Number(e.target.value))))}
                style={{
                  width: '40px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--surface-border)',
                  color: '#fff',
                  borderRadius: '6px',
                  padding: '4px',
                  textAlign: 'center',
                  fontSize: '0.9rem',
                  outline: 'none'
                }}
              />
            </div>

            {/* AM/PM Toggle */}
            <div style={{ display: 'flex', gap: '2px', background: 'rgba(0,0,0,0.3)', padding: '2px', borderRadius: '8px', border: '1px solid var(--surface-border)' }}>
              {['AM', 'PM'].map(val => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAmpm(val as any)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    border: 'none',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: ampm === val ? 'var(--color-secondary)' : 'none',
                    color: ampm === val ? '#fff' : 'var(--text-muted)',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>

          {/* Confirm Button */}
          <button
            type="button"
            onClick={handleApply}
            className="btn btn-primary"
            style={{ width: '100%', padding: '10px', borderRadius: '10px', fontSize: '0.85rem' }}
          >
            Apply Date & Time
          </button>
        </div>
      )}

      {/* Global Calendar Hover Effect Styles */}
      <style>{`
        .day-hover-btn:hover {
          background: rgba(255, 255, 255, 0.05) !important;
          color: #fff !important;
        }
        /* Hide spin buttons Chrome, Safari, Edge, Opera */
        .custom-datetime-picker-card input::-webkit-outer-spin-button,
        .custom-datetime-picker-card input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        /* Hide spin buttons Firefox */
        .custom-datetime-picker-card input[type=number] {
          -moz-appearance: textfield;
        }
      `}</style>
    </div>
  );
};
