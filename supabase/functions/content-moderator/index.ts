// Supabase Edge Function: content-moderator
// Intercepts and checks content against OpenAI's Moderation API or a local regex fallback.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOCAL_SAFETY_RULES = [
  { category: "hate", keywords: ["hate speech slur test", "slur", "hate speech", "xenophobia", "racist"] },
  { category: "violence", keywords: ["kill", "murder", "bomb", "attack", "violence", "shoot"] },
  { category: "self-harm", keywords: ["suicide", "self-harm test", "cut myself", "end my life"] },
  { category: "harassment", keywords: ["harass", "bully", "stalk", "abusive", "exploit"] },
  { category: "sexual", keywords: ["porn", "explicit", "nsfw", "xxx", "sexual content test"] }
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { text } = await req.json();

    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "Missing required string parameter: text" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    let flagged = false;
    const flaggedCategories: string[] = [];

    if (!apiKey) {
      // Offline/Local regex fallback
      const lowerText = text.toLowerCase();
      for (const rule of LOCAL_SAFETY_RULES) {
        for (const kw of rule.keywords) {
          if (lowerText.includes(kw)) {
            flagged = true;
            if (!flaggedCategories.includes(rule.category)) {
              flaggedCategories.push(rule.category);
            }
          }
        }
      }
    } else {
      // Call OpenAI Moderation API
      const openAiResponse = await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ input: text }),
      });

      const moderationData = await openAiResponse.json();

      if (moderationData.error) {
        throw new Error(moderationData.error.message || "Failed to communicate with OpenAI Moderation API.");
      }

      const result = moderationData.results?.[0];
      if (result) {
        flagged = result.flagged;
        if (result.categories) {
          for (const [category, val] of Object.entries(result.categories)) {
            if (val === true) {
              flaggedCategories.push(category);
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        flagged,
        categories: flaggedCategories,
        reason: flagged ? `Content violates safety policy under categories: ${flaggedCategories.join(", ")}` : null,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
