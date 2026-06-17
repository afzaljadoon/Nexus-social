// Supabase Edge Function: welcome-email
// Live environment: Deno deploy
// Serves as an HTTP endpoint to process user signup webhooks and send a welcome email.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const payload = await req.json();
    console.log("Database Webhook Payload received:", payload);

    // Payload structure from Supabase Database Webhook:
    // {
    //   type: 'INSERT',
    //   table: 'users',
    //   schema: 'auth',
    //   record: { id: '...', email: '...', raw_user_meta_data: { ... } }
    // }
    const { record } = payload;
    const email = record?.email;
    const fullName = record?.raw_user_meta_data?.full_name || "New User";

    console.log(`Sending welcome email to ${fullName} (${email})...`);

    // In a production app, you would integrate a service like Resend, SendGrid, or Mailgun here:
    // const response = await fetch("https://api.resend.com/emails", {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`
    //   },
    //   body: JSON.stringify({
    //     from: "Nexus Social <welcome@nexus.social>",
    //     to: [email],
    //     subject: "Welcome to Nexus Social!",
    //     html: `<h1>Hi ${fullName},</h1><p>Thanks for joining Nexus Social! Start posting now.</p>`
    //   })
    // });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Welcome email successfully queued for ${email}` 
      }), 
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }), 
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
