import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../context/TenantContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FiFileText, FiPlus, FiTrash2, FiUser, FiClock,
  FiAlertCircle, FiX, FiRotateCcw, FiLoader, FiWifi, FiInfo, FiUsers,
} from 'react-icons/fi';

// ================================================================
// Types
// ================================================================
interface SharedNote {
  id: string;
  title: string;
  content: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  creator_profile?: { full_name: string | null; username: string | null } | null;
  updater_profile?: { full_name: string | null; username: string | null } | null;
}

interface CollaboratorPresence {
  user_id: string;
  full_name: string;
  color: string;
}

// ================================================================
// Constants
// ================================================================

/**
 * 10-color palette for collaborator avatar rings.
 * Color is assigned deterministically from user_id hash.
 */
const COLLAB_COLORS = [
  '#06b6d4', '#a78bfa', '#f59e0b', '#34d399', '#f87171',
  '#60a5fa', '#fb923c', '#e879f9', '#4ade80', '#fbbf24',
];

/** Debounce delay before auto-saving to DB after local typing stops */
const AUTO_SAVE_DELAY = 1500;

/**
 * Duration (ms) after which a remote "X is typing..." badge
 * is cleared if no new broadcast arrives from that user.
 */
const TYPING_EXPIRE_MS = 2000;

// ================================================================
// Component
// ================================================================
export default function SharedNotes() {
  const { user, profile } = useAuth();
  const { activeWorkspace, memberRole } = useTenant();

  // ── Note list & editor state ──────────────────────────────────
  const [notes, setNotes] = useState<SharedNote[]>([]);
  const [selectedNote, setSelectedNote] = useState<SharedNote | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  // ── Persistence state ─────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // ── Version history state ─────────────────────────────────────
  const [versions, setVersions] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<any | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);

  // ── Collaboration state ───────────────────────────────────────
  /** Presence list: other users currently viewing/editing this note */
  const [collaborators, setCollaborators] = useState<CollaboratorPresence[]>([]);
  /**
   * Map of remote users actively typing right now.
   * Entries auto-expire after TYPING_EXPIRE_MS with no new broadcast.
   */
  const [typingUsers, setTypingUsers] = useState<{ [userId: string]: { name: string; color: string } }>({});
  const [showSyncInfo, setShowSyncInfo] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const syncInfoBtnRef = useRef<HTMLButtonElement>(null);
  const syncInfoPopoverRef = useRef<HTMLDivElement>(null);
  const [syncInfoPos, setSyncInfoPos] = useState({ top: 0, right: 0 });

  // Position the popover relative to the parent card container
  useEffect(() => {
    if (!showSyncInfo || !syncInfoBtnRef.current || !containerRef.current) return;

    const updatePos = () => {
      if (syncInfoBtnRef.current && containerRef.current) {
        const btnRect = syncInfoBtnRef.current.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();
        setSyncInfoPos({
          top: btnRect.bottom - containerRect.top + 8,
          right: containerRect.right - btnRect.right,
        });
      }
    };

    updatePos();
    window.addEventListener('resize', updatePos);
    return () => window.removeEventListener('resize', updatePos);
  }, [showSyncInfo]);

  // Close the popover on outside clicks
  useEffect(() => {
    if (!showSyncInfo) return;
    const handler = (e: MouseEvent) => {
      if (syncInfoBtnRef.current?.contains(e.target as Node)) return;
      if (syncInfoPopoverRef.current?.contains(e.target as Node)) return;
      setShowSyncInfo(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSyncInfo]);

  // ── Refs ──────────────────────────────────────────────────────
  const autoSaveTimerRef = useRef<any | null>(null);

  /**
   * SYNCHRONIZATION STRATEGY: Last-Write-Wins + Sequence Numbers
   *
   * localSeqRef: incremented on every local keystroke.
   * lastRemoteSeqRef: tracks the highest remote seq accepted.
   *
   * Broadcast rule: send {seq: localSeqRef, content, title} on every change.
   * Receive rule: drop if payload.seq <= lastRemoteSeqRef (stale update guard).
   *
   * This prevents older in-flight messages from overwriting newer local state
   * when two users type concurrently.
   */
  const localSeqRef = useRef(0);
  const lastRemoteSeqRef = useRef(0);

  /**
   * isLocallyTypingRef: set to true while the user is actively editing.
   * The postgres_changes handler checks this before applying a DB update —
   * preventing a remote save from overwriting unsaved local keystrokes.
   */
  const isLocallyTypingRef = useRef(false);
  const localTypingTimerRef = useRef<any | null>(null);

  /** Per-user timers that clear the "X is typing" badge after silence */
  const typingBadgeTimers = useRef<{ [userId: string]: any }>({});

  /** The active Supabase Realtime channel (Broadcast + Presence) */
  const broadcastChannelRef = useRef<any>(null);

  /** Stable ref to selectedNote for use inside channel callbacks */
  const selectedNoteRef = useRef<SharedNote | null>(null);
  useEffect(() => { selectedNoteRef.current = selectedNote; }, [selectedNote]);

  // ================================================================
  // Helpers
  // ================================================================

  /**
   * Deterministically assigns a color from COLLAB_COLORS for a given user_id.
   * Same user always gets the same color within a session.
   */
  const getUserColor = useCallback((userId: string): string => {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return COLLAB_COLORS[Math.abs(hash) % COLLAB_COLORS.length];
  }, []);

  // ================================================================
  // Version history
  // ================================================================
  const fetchVersions = async (noteId: string) => {
    setLoadingVersions(true);
    try {
      const { data, error } = await supabase
        .from('shared_note_versions')
        .select('id, note_id, title, content, version_number, created_at, created_by, creator_profile:created_by(full_name, username)')
        .eq('note_id', noteId)
        .order('version_number', { ascending: false });
      if (error) throw error;
      setVersions(data || []);
    } catch (err) {
      console.error('Error fetching version history:', err);
    } finally {
      setLoadingVersions(false);
    }
  };

  // ================================================================
  // Fetch note list
  // ================================================================
  const fetchNotes = async () => {
    if (!activeWorkspace) return;
    try {
      const { data, error } = await supabase
        .from('shared_notes')
        .select(`
          id, title, content, created_by, updated_by, created_at, updated_at,
          creator_profile:created_by(full_name, username),
          updater_profile:updated_by(full_name, username)
        `)
        .eq('workspace_id', activeWorkspace.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setNotes((data as any[]) || []);

      // Auto-select first note if none selected yet
      if (data && data.length > 0 && !selectedNoteRef.current) {
        handleSelectNote(data[0] as any);
      }
    } catch (err) {
      console.error('Error fetching notes:', err);
    }
  };

  // ================================================================
  // Collaboration channel setup
  //
  // Uses two Supabase Realtime features per note:
  //
  // 1. PRESENCE — tracks who is viewing/editing this note right now.
  //    Each client calls channel.track() when a note is opened.
  //    channel.presenceState() gives a live map of all connected users.
  //
  // 2. BROADCAST — sends ephemeral messages to all channel subscribers.
  //    Every keystroke is broadcast with a monotonically increasing seq.
  //    Receiving clients update their textarea in ~50ms without a DB round-trip.
  //    Only the debounced auto-save actually writes to the database.
  // ================================================================
  const setupCollabChannel = useCallback((noteId: string) => {
    // Tear down the previous note's channel
    if (broadcastChannelRef.current) {
      supabase.removeChannel(broadcastChannelRef.current);
      broadcastChannelRef.current = null;
    }

    // Reset collaboration state for the new note
    setCollaborators([]);
    setTypingUsers({});
    localSeqRef.current = 0;
    lastRemoteSeqRef.current = 0;

    if (!user) return;

    const myColor = getUserColor(user.id);
    const myName = profile?.full_name || user.email?.split('@')[0] || 'Anonymous';

    const channel = supabase.channel(`collab-note-${noteId}`, {
      config: {
        broadcast: { self: false }, // don't echo own broadcasts back
        presence: { key: user.id },
      },
    });

    // ── Presence sync: update collaborator avatar list ──────────
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const others: CollaboratorPresence[] = [];

      for (const [key, presences] of Object.entries(state)) {
        if (key === user.id) continue; // exclude self
        const p = (presences as any[])[0];
        if (p) {
          others.push({
            user_id: p.user_id,
            full_name: p.full_name || 'Anonymous',
            color: p.color || getUserColor(p.user_id),
          });
        }
      }
      setCollaborators(others);
    });

    // ── Broadcast receive: apply remote typing update ───────────
    channel.on('broadcast', { event: 'typing' }, ({ payload }: any) => {
      if (!payload) return;
      const { user_id, seq, content, title } = payload;

      // Echo prevention: ignore messages from self
      if (user_id === user.id) return;

      // Stale update guard: drop if this is an older broadcast than last accepted
      if (seq <= lastRemoteSeqRef.current) return;
      lastRemoteSeqRef.current = seq;

      // Apply the remote update to the local editor
      setEditContent(content ?? '');
      if (title !== undefined) {
        setEditTitle(title === 'Untitled Note' ? '' : title);
      }

      // Show the "X is typing..." badge
      const presenceState = channel.presenceState();
      const remotePresence = (presenceState[user_id] as any[])?.[0];
      const remoteName = remotePresence?.full_name || 'Someone';
      const remoteColor = remotePresence?.color || getUserColor(user_id);

      setTypingUsers((prev) => ({ ...prev, [user_id]: { name: remoteName, color: remoteColor } }));

      // Auto-clear typing badge after 2 seconds of silence from that user
      if (typingBadgeTimers.current[user_id]) {
        clearTimeout(typingBadgeTimers.current[user_id]);
      }
      typingBadgeTimers.current[user_id] = setTimeout(() => {
        setTypingUsers((prev) => {
          const next = { ...prev };
          delete next[user_id];
          return next;
        });
      }, TYPING_EXPIRE_MS);
    });

    // ── Subscribe & track own presence ──────────────────────────
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ user_id: user.id, full_name: myName, color: myColor, note_id: noteId });
      }
    });

    broadcastChannelRef.current = channel;
  }, [user, profile, getUserColor]);

  // ================================================================
  // Workspace-level: list subscription + postgres_changes
  // ================================================================
  useEffect(() => {
    fetchNotes();
    if (!activeWorkspace) return;

    const workspaceChannel = supabase
      .channel(`workspace-shared-notes-${activeWorkspace.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shared_notes', filter: `workspace_id=eq.${activeWorkspace.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE') {
            // Always refresh the list on structural changes
            fetchNotes();
          } else if (payload.eventType === 'UPDATE') {
            /**
             * SMART MERGE STRATEGY:
             * If the local user is actively typing (isLocallyTypingRef = true),
             * skip this DB update entirely — it would overwrite unsaved keystrokes.
             * The broadcast channel already delivered the in-flight content to others.
             * Once auto-save fires and the user stops typing, DB state and local state converge.
             */
            if (isLocallyTypingRef.current) return;

            const updated = payload.new as SharedNote;
            if (updated.id === selectedNoteRef.current?.id) {
              // Only apply if content actually changed from local state
              setEditTitle((prev) => {
                const incoming = updated.title === 'Untitled Note' ? '' : updated.title;
                return incoming !== prev ? incoming : prev;
              });
              setEditContent((prev) => (updated.content !== prev ? updated.content : prev));
            }
            setNotes((prev) => prev.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(workspaceChannel);
      if (broadcastChannelRef.current) {
        supabase.removeChannel(broadcastChannelRef.current);
        broadcastChannelRef.current = null;
      }
    };
  }, [activeWorkspace]);

  // ================================================================
  // Select note
  // ================================================================
  const handleSelectNote = (note: SharedNote) => {
    setSelectedNote(note);
    setEditTitle(note.title === 'Untitled Note' ? '' : note.title);
    setEditContent(note.content);
    setSaveStatus('idle');
    setSelectedVersion(null);
    fetchVersions(note.id);
    // Set up collab channel scoped to this note
    setupCollabChannel(note.id);
    localSeqRef.current = 0;
    lastRemoteSeqRef.current = 0;
  };

  // ================================================================
  // Create note
  // ================================================================
  const handleCreateNote = async () => {
    if (!activeWorkspace || !user) return;
    try {
      setErrorMsg('');
      const { data, error } = await supabase
        .from('shared_notes')
        .insert([{ workspace_id: activeWorkspace.id, title: '', content: '', created_by: user.id, updated_by: user.id }])
        .select(`
          id, title, content, created_by, updated_by, created_at, updated_at,
          creator_profile:created_by(full_name, username),
          updater_profile:updated_by(full_name, username)
        `)
        .single();

      if (error) throw error;
      if (data) {
        setNotes([data as any, ...notes]);
        handleSelectNote(data as any);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create note. Verify workspace membership.');
    }
  };

  // ================================================================
  // Save to DB
  // ================================================================
  const saveNote = async (title: string, content: string, noteId: string) => {
    if (!user) return;
    setSaveStatus('saving');
    try {
      const { error } = await supabase
        .from('shared_notes')
        .update({
          title: title.trim() || 'Untitled Note',
          content,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', noteId);

      if (error) throw error;
      setSaveStatus('saved');
      fetchVersions(noteId);
    } catch (err) {
      console.error('Error saving note:', err);
      setSaveStatus('idle');
    }
  };

  // ================================================================
  // Handle local typing
  //
  // On every keystroke this function:
  //   1. Marks the user as locally typing (blocks DB update overwrite)
  //   2. Increments the local sequence number
  //   3. Broadcasts the current content to all collaborators (~50ms)
  //   4. Schedules an auto-save after AUTO_SAVE_DELAY ms of inactivity
  // ================================================================
  const handleLocalChange = (newTitle: string, newContent: string) => {
    if (!selectedNote) return;

    // Mark as locally typing — prevents postgres_changes from overwriting mid-edit
    isLocallyTypingRef.current = true;
    if (localTypingTimerRef.current) clearTimeout(localTypingTimerRef.current);
    localTypingTimerRef.current = setTimeout(() => {
      isLocallyTypingRef.current = false;
    }, AUTO_SAVE_DELAY + 300);

    // Increment sequence counter for this keystroke
    localSeqRef.current += 1;

    // Broadcast to collaborators (ephemeral, not persisted)
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          user_id: user?.id,
          seq: localSeqRef.current,
          content: newContent,
          title: newTitle,
        },
      });
    }

    // Debounced DB auto-save
    setSaveStatus('saving');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      saveNote(newTitle, newContent, selectedNote.id);
    }, AUTO_SAVE_DELAY);
  };

  // ================================================================
  // Restore version
  // ================================================================
  const handleRestoreVersion = async (version: any) => {
    if (!selectedNote || !user) return;
    if (!window.confirm(`Restore to version ${version.version_number}?`)) return;
    try {
      setSaving(true);
      const { error } = await supabase
        .from('shared_notes')
        .update({ title: version.title, content: version.content, updated_by: user.id, updated_at: new Date().toISOString() })
        .eq('id', selectedNote.id);

      if (error) throw error;

      setEditTitle(version.title === 'Untitled Note' ? '' : version.title);
      setEditContent(version.content);
      setSelectedVersion(null);
      setSelectedNote({ ...selectedNote, title: version.title, content: version.content, updated_at: new Date().toISOString() });
      setNotes(notes.map((n) => n.id === selectedNote.id ? { ...n, title: version.title, content: version.content } : n));
      fetchVersions(selectedNote.id);
      setSaveStatus('saved');
    } catch (err) {
      setErrorMsg('Failed to restore note version.');
    } finally {
      setSaving(false);
    }
  };

  // ================================================================
  // Delete note
  // ================================================================
  const handleDeleteNote = async (noteId: string) => {
    if (!window.confirm('Delete this shared note permanently?')) return;
    try {
      const { error } = await supabase.from('shared_notes').delete().eq('id', noteId);
      if (error) throw error;

      const filtered = notes.filter((n) => n.id !== noteId);
      setNotes(filtered);
      if (selectedNote?.id === noteId) {
        if (filtered.length > 0) handleSelectNote(filtered[0]);
        else { setSelectedNote(null); setEditTitle(''); setEditContent(''); }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Unauthorized to delete this note.');
    }
  };

  // ================================================================
  // Derived values
  // ================================================================
  const isOwnerOrAdmin = memberRole === 'owner' || memberRole === 'admin';
  const myColor = user ? getUserColor(user.id) : '#06b6d4';
  const myInitial = (profile?.full_name || user?.email || 'Y').charAt(0).toUpperCase();
  const typingUsersList = Object.entries(typingUsers);

  // ================================================================
  // RENDER
  // ================================================================
  return (
    <div
      ref={containerRef}
      className="glass-panel"
      style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '540px', textAlign: 'left', marginTop: '24px', position: 'relative' }}
    >
      {/* ── Header ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '16px', borderBottom: '1px solid var(--surface-border)', paddingBottom: '12px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiFileText color="var(--color-secondary)" />
            <span>Shared Notes &amp; Docs</span>
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Real-time collaborative workspace · {activeWorkspace?.name}
          </p>
        </div>
        <button onClick={handleCreateNote} className="btn btn-primary" style={{ padding: '6px 14px', borderRadius: '8px', fontSize: '0.8rem', height: '34px', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <FiPlus /><span>New Note</span>
        </button>
      </div>

      {errorMsg && (
        <div className="error-alert" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '0.8rem' }}>
          <FiAlertCircle size={14} /><span>{errorMsg}</span>
        </div>
      )}

      {/* ── Main layout ───────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, gap: '16px', overflow: 'hidden', position: 'relative' }}>

        {/* Left: Note List Sidebar — vertically scrollable with gradient fade */}
        <div style={{ width: '180px', borderRight: '1px solid var(--surface-border)', paddingRight: '16px', display: 'flex', flexDirection: 'column', position: 'relative', minHeight: 0 }}>
          {/* Top fade gradient */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: '16px', height: '28px', zIndex: 2, pointerEvents: 'none',
            background: 'linear-gradient(to bottom, var(--bg-primary, #0a0f1e) 0%, transparent 100%)',
          }} />
          {/* Bottom fade gradient */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: '16px', height: '28px', zIndex: 2, pointerEvents: 'none',
            background: 'linear-gradient(to top, var(--bg-primary, #0a0f1e) 0%, transparent 100%)',
          }} />

          {/* Scrollable list */}
          <div style={{
            display: 'flex', flexDirection: 'column', gap: '6px',
            overflowY: 'auto', flex: 1, paddingTop: '6px', paddingBottom: '6px',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(6,182,212,0.25) transparent',
          }}>
            {notes.length === 0 ? (
              <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem' }}>No notes yet.</div>
            ) : notes.map((note, i) => (
              <motion.button
                key={note.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, duration: 0.2 }}
                onClick={() => handleSelectNote(note)}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: '8px',
                  background: selectedNote?.id === note.id ? 'rgba(6, 182, 212, 0.08)' : 'transparent',
                  border: selectedNote?.id === note.id ? '1px solid rgba(6, 182, 212, 0.25)' : '1px solid transparent',
                  color: selectedNote?.id === note.id ? 'var(--color-secondary)' : 'var(--text-primary)',
                  textAlign: 'left', cursor: 'pointer', fontSize: '0.8rem',
                  fontWeight: selectedNote?.id === note.id ? 600 : 500,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', transition: 'all 0.2s',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => { if (selectedNote?.id !== note.id) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={(e) => { if (selectedNote?.id !== note.id) e.currentTarget.style.background = 'transparent'; }}
              >
                {note.title.trim() || 'Untitled Note'}
              </motion.button>
            ))}
          </div>
        </div>

        {/* Right: Editor panel */}
        <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
          {selectedNote ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingRight: showHistory ? '260px' : 0, transition: 'padding 0.2s', height: '100%', gap: '8px' }}>

              {/* ── Toolbar ─────────────────────────────────── */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                borderBottom: '1px solid var(--surface-border)',
                paddingBottom: '8px',
                overflowX: 'auto',
                whiteSpace: 'nowrap',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                width: '100%',
              }}>

                {/* Left: meta + save status */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)',
                  flexShrink: 0,
                  marginRight: 'auto', // Push right side to the end
                }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <FiUser size={11} />
                    {selectedNote.creator_profile?.full_name || 'Anonymous'}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <FiClock size={11} />
                    {new Date(selectedNote.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {/* Save status indicator */}
                  {saveStatus !== 'idle' && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600,
                      color: saveStatus === 'saved' ? 'var(--success)' : 'var(--color-secondary)',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}>
                      {saveStatus === 'saving' && <FiLoader className="spin" size={10} />}
                      {saveStatus === 'saved' ? 'Saved ✓' : 'Saving...'}
                    </span>
                  )}
                </div>

                {/* Right: presence avatars + action buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>

                  {/* Presence avatar strip — horizontally scrollable with gradient fade edges */}
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center', maxWidth: '180px' }}>
                    {/* Left fade */}
                    <div style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0, width: '20px', zIndex: 3, pointerEvents: 'none',
                      background: 'linear-gradient(to right, var(--bg-primary, #0a0f1e) 0%, transparent 100%)',
                    }} />
                    {/* Right fade */}
                    <div style={{
                      position: 'absolute', right: 0, top: 0, bottom: 0, width: '20px', zIndex: 3, pointerEvents: 'none',
                      background: 'linear-gradient(to left, var(--bg-primary, #0a0f1e) 0%, transparent 100%)',
                    }} />

                    {/* Scrollable avatar row */}
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      overflowX: 'auto', gap: '0px',
                      scrollbarWidth: 'none',
                      msOverflowStyle: 'none',
                      padding: '2px 4px',
                    }}>
                      {/* Self avatar */}
                      <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                        title="You (editing)"
                        style={{
                          width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
                          background: `linear-gradient(135deg, ${myColor}, ${myColor}cc)`,
                          border: '2px solid var(--bg-primary)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.65rem', fontWeight: 700, color: '#fff',
                          marginRight: '-5px', zIndex: 10, position: 'relative',
                          boxShadow: `0 0 0 2px ${myColor}60, 0 2px 8px ${myColor}40`,
                          cursor: 'default',
                        }}
                      >
                        {myInitial}
                      </motion.div>

                      {/* Collaborator avatars — all shown, scroll for overflow */}
                      <AnimatePresence>
                        {collaborators.map((c, i) => (
                          <motion.div
                            key={c.user_id}
                            initial={{ scale: 0, opacity: 0, marginLeft: 0 }}
                            animate={{ scale: 1, opacity: 1, marginLeft: '-5px' }}
                            exit={{ scale: 0, opacity: 0, marginLeft: 0 }}
                            transition={{ type: 'spring', stiffness: 380, damping: 22, delay: i * 0.05 }}
                            title={`${c.full_name} is editing`}
                            style={{
                              width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
                              background: `linear-gradient(135deg, ${c.color}, ${c.color}cc)`,
                              border: '2px solid var(--bg-primary)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '0.65rem', fontWeight: 700, color: '#fff',
                              zIndex: 9 - i, position: 'relative',
                              boxShadow: `0 0 0 2px ${c.color}60, 0 2px 8px ${c.color}40`,
                              cursor: 'default',
                            }}
                          >
                            {c.full_name.charAt(0).toUpperCase()}
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>

                    {collaborators.length > 0 && (
                      <span style={{
                        fontSize: '0.68rem', color: 'var(--text-muted)',
                        marginLeft: '14px', display: 'inline-flex', alignItems: 'center',
                        gap: '4px', whiteSpace: 'nowrap', flexShrink: 0,
                      }}>
                        <FiUsers size={10} />
                        {collaborators.length} {collaborators.length === 1 ? 'other' : 'others'}
                      </span>
                    )}
                  </div>

                   {/* Sync info button + floating popover */}
                  <div style={{ position: 'relative' }}>
                    <button
                      ref={syncInfoBtnRef}
                      onClick={() => setShowSyncInfo(!showSyncInfo)}
                      title="How real-time sync works"
                      style={{
                        background: showSyncInfo ? 'rgba(6, 182, 212, 0.1)' : 'none',
                        border: showSyncInfo ? '1px solid rgba(6, 182, 212, 0.25)' : 'none',
                        color: showSyncInfo ? 'var(--color-secondary)' : 'var(--text-muted)',
                        cursor: 'pointer', display: 'flex', alignItems: 'center',
                        borderRadius: '6px', padding: '4px 6px', transition: 'all 0.2s',
                      }}
                    >
                      <FiInfo size={13} />
                    </button>

                  </div>

                  {/* Version history button */}
                  <button
                    onClick={() => { setShowHistory(!showHistory); if (!showHistory && selectedNote) fetchVersions(selectedNote.id); }}
                    style={{
                      background: showHistory ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255,255,255,0.03)',
                      border: showHistory ? '1px solid rgba(6, 182, 212, 0.3)' : '1px solid var(--surface-border)',
                      color: showHistory ? 'var(--color-secondary)' : 'var(--text-muted)',
                      padding: '5px', borderRadius: '6px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    title="Version History"
                  >
                    <FiRotateCcw size={12} />
                  </button>

                  {/* Delete button (admin/owner only) */}
                  {isOwnerOrAdmin && (
                    <button
                      onClick={() => handleDeleteNote(selectedNote.id)}
                      style={{
                        background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)',
                        color: '#ef4444', padding: '5px', borderRadius: '6px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      title="Delete Note"
                    >
                      <FiTrash2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* ── Typing indicators ────────────────────────── */}
              <AnimatePresence>
                {typingUsersList.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', overflow: 'hidden' }}
                  >
                    {typingUsersList.map(([uid, info]) => (
                      <motion.span
                        key={uid}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        style={{
                          fontSize: '0.7rem', fontWeight: 600,
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                          padding: '2px 9px', borderRadius: '10px',
                          background: `${info.color}15`,
                          border: `1px solid ${info.color}35`,
                          color: info.color,
                        }}
                      >
                        {/* Pulsing dot */}
                        <span style={{
                          width: '6px', height: '6px', borderRadius: '50%',
                          background: info.color, display: 'inline-block',
                          animation: 'pulse 1s ease-in-out infinite',
                        }} />
                        {info.name} is typing...
                      </motion.span>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Title input ──────────────────────────────── */}
              <input
                type="text"
                placeholder="Note heading..."
                value={editTitle}
                onChange={(e) => {
                  setEditTitle(e.target.value);
                  handleLocalChange(e.target.value, editContent);
                }}
                style={{
                  background: 'transparent', border: 'none',
                  borderBottom: '1px solid var(--surface-border)',
                  color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 700,
                  outline: 'none', paddingBottom: '8px', width: '100%',
                }}
              />

              {/* ── Content textarea ─────────────────────────── */}
              <textarea
                placeholder="Start writing collaboratively — changes sync in real time to all editors..."
                value={editContent}
                onChange={(e) => {
                  setEditContent(e.target.value);
                  handleLocalChange(editTitle, e.target.value);
                }}
                style={{
                  flex: 1, background: 'transparent', border: 'none',
                  color: 'var(--text-primary)', fontSize: '0.85rem',
                  lineHeight: '1.65', outline: 'none', resize: 'none', padding: '8px 0',
                }}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-muted)', gap: '12px' }}>
              <FiFileText size={42} />
              <span style={{ fontSize: '0.85rem' }}>Select a note or create a new one to begin collaborating.</span>
            </div>
          )}
        </div>

        {/* ── Version History Drawer ─────────────────────────── */}
        <AnimatePresence>
          {showHistory && selectedNote && (
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              style={{
                position: 'absolute', top: 0, right: 0, width: '250px', height: '100%',
                background: 'rgba(10, 15, 30, 0.98)', backdropFilter: 'blur(16px)',
                borderLeft: '1px solid var(--surface-border)',
                padding: '16px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-border)', paddingBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <FiRotateCcw /><span>Version History</span>
                </span>
                <button onClick={() => setShowHistory(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}>
                  <FiX size={14} />
                </button>
              </div>

              {loadingVersions ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                  <FiLoader className="spin" size={20} color="var(--color-secondary)" />
                </div>
              ) : versions.length === 0 ? (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>No version history found.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      onClick={() => setSelectedVersion(v)}
                      style={{
                        padding: '10px', borderRadius: '8px',
                        background: 'rgba(255,255,255,0.01)', border: '1px solid var(--surface-border)',
                        cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '4px',
                        textAlign: 'left', transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.25)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.01)'; e.currentTarget.style.borderColor = 'var(--surface-border)'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>Version {v.version_number}</span>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                          {new Date(v.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v.title || 'Untitled Note'}
                      </span>
                      <span style={{ fontSize: '0.65rem', color: 'var(--color-secondary)' }}>
                        By {v.creator_profile?.full_name || 'Anonymous'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Version Preview Modal ─────────────────────────── */}
        <AnimatePresence>
          {selectedVersion && (
            <>
              <div
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 20 }}
                onClick={() => setSelectedVersion(null)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                style={{
                  position: 'absolute', top: '10%', left: '5%', right: '5%', bottom: '10%',
                  background: '#0a0f1e', border: '1px solid rgba(6, 182, 212, 0.3)',
                  borderRadius: '12px', padding: '20px', zIndex: 21,
                  display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surface-border)', paddingBottom: '8px' }}>
                  <div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      Preview Version {selectedVersion.version_number}
                    </span>
                    <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>
                      Saved {new Date(selectedVersion.created_at).toLocaleString()} · by {selectedVersion.creator_profile?.full_name || 'Anonymous'}
                    </p>
                  </div>
                  <button onClick={() => setSelectedVersion(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <FiX size={16} />
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', borderBottom: '1px solid var(--surface-border)', paddingBottom: '4px' }}>
                    {selectedVersion.title || 'Untitled Note'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>
                    {selectedVersion.content || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Empty content</span>}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid var(--surface-border)', paddingTop: '10px' }}>
                  <button onClick={() => handleRestoreVersion(selectedVersion)} className="btn btn-primary" style={{ padding: '6px 14px', borderRadius: '8px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px', height: '32px' }}>
                    {saving ? <FiLoader className="spin" size={12} /> : <FiRotateCcw size={12} />}
                    <span>Restore Version</span>
                  </button>
                  <button onClick={() => setSelectedVersion(null)} className="btn btn-secondary" style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '0.78rem', height: '32px' }}>
                    Close
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Sync Info Popover (rendered at the card root to escape the main layout's overflow:hidden) */}
      <AnimatePresence>
        {showSyncInfo && (
          <motion.div
            ref={syncInfoPopoverRef}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'absolute',
              top: syncInfoPos.top,
              right: syncInfoPos.right,
              width: '280px',
              padding: '14px 16px',
              borderRadius: '12px',
              fontSize: '0.78rem',
              background: 'rgba(10, 15, 30, 0.97)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(6, 182, 212, 0.25)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(6,182,212,0.08)',
              color: 'var(--text-muted)',
              lineHeight: 1.6,
              zIndex: 100, // Float above the other elements in the card
            }}
          >
            <span style={{ fontWeight: 700, color: 'var(--color-secondary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', fontSize: '0.8rem' }}>
              <FiWifi size={13} /> How real-time sync works
            </span>
            <p style={{ margin: '0 0 6px' }}>
              Changes are <strong style={{ color: 'var(--text-primary)' }}>broadcast instantly</strong> to all collaborators (~50ms) via Supabase Realtime.
            </p>
            <p style={{ margin: '0 0 6px' }}>
              Every <strong style={{ color: 'var(--text-primary)' }}>1.5 seconds</strong> of inactivity, they are persisted to the database automatically.
            </p>
            <p style={{ margin: '0 0 6px' }}>
              If two users edit simultaneously, the <strong style={{ color: 'var(--text-primary)' }}>last save wins</strong> (LWW strategy).
            </p>
            <p style={{ margin: 0 }}>
              Use <strong style={{ color: 'var(--text-primary)' }}>Version History ↺</strong> to recover any overwritten content.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
