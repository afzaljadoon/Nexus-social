// Supabase Edge Function: log-audit
// Securely processes and records user activities to the database.
// Authenticates the user's JWT token server-side before writing the log.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight options request
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Resolve Authorization token from header
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/, "");

    if (!token) {
      return new Response(JSON.stringify({ error: "Missing authorization token" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Create connection client using service role permissions to bypass table write RLS rules for logging
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // 2. Validate JWT token server-side using Supabase Auth
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid session token" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    // 3. Read audit payload
    const { action, targetId, metadata = {} } = await req.json();

    if (!action) {
      return new Response(JSON.stringify({ error: "Missing required parameter: action" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // 4. Record the secure, validated audit entry
    const { error: dbError } = await supabase.from("audit_logs").insert([
      {
        action,
        target_id: targetId,
        user_id: user.id,
        user_email: user.email || "unknown@nexus.social",
        metadata: {
          ...metadata,
          client_agent: req.headers.get("user-agent") || "EdgeFunction",
        },
      },
    ]);

    if (dbError) {
      console.error("Database insert failed for audit log:", dbError.message);
      throw dbError;
    }

    return new Response(
      JSON.stringify({ success: true, message: "Audit log captured securely" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Failed to process audit logging request:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal Server Error" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
