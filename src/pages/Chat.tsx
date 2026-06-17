import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { FiSend, FiMessageSquare, FiAlertCircle } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';

interface MessageType {
  id: number;
  message: string;
  sender_id: string;
  created_at: string;
  profiles?: {
    full_name: string | null;
    avatar_url: string | null;
  };
}

/**
 * Chat Component:
 * Implements real-time messaging using Supabase's Realtime Engine.
 */
export default function Chat() {
  const { user, onlineUsers, profile } = useAuth();
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<any>(null);

  // Typing state variables
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<any>(null);

  // Cache of user profiles to avoid repeated DB calls for real-time messages
  const profileCacheRef = useRef<Record<string, { full_name: string | null; avatar_url: string | null }>>({});

  // Fetch or retrieve a profile from cache/DB
  const getProfileForUser = async (userId: string) => {
    if (profileCacheRef.current[userId]) {
      return profileCacheRef.current[userId];
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', userId)
        .single();
      if (!error && data) {
        profileCacheRef.current[userId] = data;
        return data;
      }
    } catch (err) {
      console.error('Error fetching profile for chat:', err);
    }
    return { full_name: 'Anonymous User', avatar_url: null };
  };

  // Scroll to bottom helper
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 1. Fetch initial message history
  useEffect(() => {
    const fetchMessages = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*, profiles(full_name, avatar_url)')
          .order('created_at', { ascending: true })
          .limit(100);

        if (error) {
          setErrorMsg(error.message);
        } else {
          // Pre-populate cache with loaded profiles
          data?.forEach((msg) => {
            if (msg.profiles && msg.sender_id) {
              profileCacheRef.current[msg.sender_id] = msg.profiles;
            }
          });
          setMessages(data || []);
        }
      } catch (err) {
        setErrorMsg('Could not load message history.');
      } finally {
        setLoading(false);
        setTimeout(scrollToBottom, 100);
      }
    };

    fetchMessages();
  }, []);

  // 2. Real-time Subscription Setup
  useEffect(() => {
    /**
     * WHY: supabase.channel()
     * It creates a new subscription group (channel) for real-time traffic.
     * We call this channel 'chat-room'.
     */
    const channel = supabase
      .channel('chat-room')
      /**
       * WHY: .on('postgres_changes')
       * Listens to changes in our database. We target the 'INSERT' event
       * on the 'messages' table in the 'public' schema.
       */
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          console.log('New message received via realtime:', payload);
          
          const newRawMsg = payload.new as {
            id: number;
            message: string;
            sender_id: string;
            created_at: string;
          };

          // Fetch the profile for the sender to attach it to the message
          const senderProfile = await getProfileForUser(newRawMsg.sender_id);
          
          const completeMessage: MessageType = {
            ...newRawMsg,
            profiles: senderProfile,
          };

          // Append to message list state
          setMessages((prevMessages) => [...prevMessages, completeMessage]);
        }
      )
      /**
       * Broadcast listener:
       * Ephemeral client-to-client notifications (like typing indicators).
       */
      .on('broadcast', { event: 'typing' }, (payload) => {
        const { userId, isTyping: userIsTyping, userName } = payload.payload;
        setTypingUsers((prev) => {
          const updated = { ...prev };
          if (userIsTyping) {
            updated[userId] = userName;
          } else {
            delete updated[userId];
          }
          return updated;
        });
      })
      /**
       * WHY: .subscribe()
       * Establishes the connection. Once subscribed, the client stays connected via WebSockets,
       * waiting for the database server to broadcast new inserts.
       */
      .subscribe();

    channelRef.current = channel;

    // Clean up subscription when the user leaves the page
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Auto scroll when message list length changes
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Broadcast typing behavior to other room occupants
  const triggerTypingIndicator = (userIsTyping: boolean) => {
    if (!user) return;
    channelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: {
        userId: user.id,
        userName: profile?.full_name || user.email?.split('@')[0] || 'Someone',
        isTyping: userIsTyping,
      },
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    
    if (!user) return;

    if (!isTyping) {
      setIsTyping(true);
      triggerTypingIndicator(true);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      triggerTypingIndicator(false);
    }, 2000);
  };

  // 3. Send Message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user) return;

    // Clear typing timeout and broadcast typing stop state immediately
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    setIsTyping(false);
    triggerTypingIndicator(false);

    const messageText = newMessage.trim();
    setNewMessage(''); // Clear input box immediately for responsiveness

    try {
      const { error } = await supabase
        .from('messages')
        .insert([
          {
            message: messageText,
            sender_id: user.id,
          },
        ]);

      if (error) {
        setErrorMsg(error.message);
      }
    } catch (err) {
      setErrorMsg('Failed to send message.');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.4 }}
      className="page-container"
    >
      <div className="glass-panel page-header-panel">
        <h2>Cyber Chat</h2>
        <p className="subtitle">Realtime encrypted conversations with other users</p>
      </div>

      {errorMsg && (
        <div className="alert-message error-alert">
          <FiAlertCircle /> {errorMsg}
        </div>
      )}

      <div className="chat-interface glass-panel">
        {/* Chat Feed */}
        <div className="chat-window">
          {loading ? (
            <div className="chat-loader">
              <span className="spinner"></span>
              <p>Syncing feed...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="chat-empty">
              <FiMessageSquare size={36} />
              <p>No messages yet. Start the conversation!</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = user && msg.sender_id === user.id;
              const senderName = msg.profiles?.full_name || 'Anonymous';
              const firstLetter = senderName.charAt(0).toUpperCase();

              return (
                <div key={msg.id} className={`message-bubble-wrapper ${isMe ? 'me' : 'them'}`}>
                  {!isMe && (
                    <div className="user-avatar-glow" style={{ position: 'relative' }}>
                      {msg.profiles?.avatar_url ? (
                        <img 
                          src={msg.profiles.avatar_url} 
                          alt={senderName} 
                          className="chat-avatar" 
                        />
                      ) : (
                        <div className="chat-avatar-letter">{firstLetter}</div>
                      )}
                      {onlineUsers[msg.sender_id] && (
                        <span
                          style={{
                            position: 'absolute',
                            bottom: '0',
                            right: '0',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: 'var(--success)',
                            border: '1.5px solid var(--bg-primary)',
                            display: 'block',
                          }}
                          title="Online"
                        />
                      )}
                    </div>
                  )}
                  <div className="message-content-wrapper">
                    {!isMe && <span className="message-sender">{senderName}</span>}
                    <div className="message-bubble">
                      <p>{msg.message}</p>
                    </div>
                    <span className="message-timestamp">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              );
            })
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Typing Indicators */}
        {Object.keys(typingUsers).length > 0 && (
          <div style={{ padding: '8px 24px', fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '4px', height: '14px', alignItems: 'center' }}>
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  animate={{ y: [0, -4, 0] }}
                  transition={{
                    duration: 0.6,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.15,
                  }}
                  style={{
                    width: '5px',
                    height: '5px',
                    backgroundColor: 'var(--color-secondary)',
                    borderRadius: '50%',
                    display: 'inline-block',
                  }}
                />
              ))}
            </div>
            <span>
              {Object.values(typingUsers).join(', ')} {Object.keys(typingUsers).length === 1 ? 'is' : 'are'} typing...
            </span>
          </div>
        )}

        {/* Input Bar */}
        <form onSubmit={handleSendMessage} className="chat-input-bar">
          <input
            type="text"
            className="input-field chat-input-field"
            placeholder="Type a message..."
            value={newMessage}
            onChange={handleInputChange}
            disabled={loading}
          />
          <button type="submit" className="btn btn-primary send-btn" disabled={loading || !newMessage.trim()}>
            <FiSend />
          </button>
        </form>
      </div>
    </motion.div>
  );
}
