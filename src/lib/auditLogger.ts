import { supabase } from './supabaseClient';

/**
 * Enterprise Audit Logger:
 * Securely dispatches activity events to the `log-audit` Supabase Edge Function.
 * The Edge Function validates the session JWT token server-side before writing the entry.
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
    // 1. Validate active local session before attempting to invoke Edge Function
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !session.user) {
      console.warn(`Cannot write audit log for action "${action}": No active session.`);
      return;
    }

    // 2. Invoke our secure Deno Edge Function
    const { data, error } = await supabase.functions.invoke('log-audit', {
      body: {
        action,
        targetId,
        metadata
      }
    });

    if (error) {
      console.warn(`Secure Edge Function logging failed: ${error.message}. Checking fallback write...`);
      
      // Fallback: If edge function is not deployed in current environment,
      // fallback to direct client-side DB insert so functionality remains intact.
      const { error: dbError } = await supabase.from('audit_logs').insert([
        {
          action,
          target_id: targetId,
          user_id: session.user.id,
          user_email: session.user.email || 'unknown@nexus.social',
          metadata: {
            ...metadata,
            client_agent: navigator.userAgent,
            fallback_used: true
          },
        },
      ]);
      if (dbError) {
        console.error(`Direct DB insert fallback failed:`, dbError.message);
      }
    } else {
      console.debug('Secure audit log captured via Edge Function:', data);
    }
  } catch (err) {
    console.error(`Failed to dispatch secure audit log:`, err);
  }
};
