import { supabase } from './supabaseClient';

/**
 * Enterprise Audit Logger:
 * Pushes structured activity events to the `audit_logs` database table.
 * Automatically resolves the active user session ID and email.
 * 
 * Example:
 * logAction('user.ban', 'user-uuid-123', { oldStatus: false, newStatus: true });
 */
export const logAction = async (
  action: string,
  targetId: string | null = null,
  metadata: Record<string, any> = {}
) => {
  try {
    // 1. Resolve current active user session
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !session.user) {
      console.warn(`Cannot write audit log for action "${action}": No active session.`);
      return;
    }

    const actor = session.user;

    // 2. Write record to Supabase audit_logs table
    const { error } = await supabase.from('audit_logs').insert([
      {
        action,
        target_id: targetId,
        user_id: actor.id,
        user_email: actor.email || 'unknown@nexus.social',
        metadata: {
          ...metadata,
          client_agent: navigator.userAgent,
        },
      },
    ]);

    if (error) {
      console.error(`Supabase DB reject on writing audit log:`, error.message);
    }
  } catch (err) {
    console.error(`Failed to dispatch audit log helper:`, err);
  }
};
