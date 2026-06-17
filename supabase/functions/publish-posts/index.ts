// Supabase Edge Function: publish-posts
// Automatically triggered via pg_cron to publish scheduled posts whose publish time has arrived.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Update posts that are marked as unpublished but whose scheduled published_at date is in the past
    const { data, error } = await supabase
      .from("posts")
      .update({ is_published: true })
      .eq("is_published", false)
      .lte("published_at", new Date().toISOString())
      .select("id, title, user_id");

    if (error) {
      console.error("Supabase Database error processing scheduled posts:", error.message);
      throw error;
    }

    console.log(`Successfully published ${data?.length || 0} scheduled posts.`);

    return new Response(
      JSON.stringify({
        message: "Scheduled posts processed successfully.",
        published_count: data?.length || 0,
        published_posts: data || [],
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err: any) {
    console.error("Failed to run scheduled publish edge function:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal Server Error" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
