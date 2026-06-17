// Supabase Edge Function: ai-generator
// Integrates with OpenAI to generate posts, bios, and comment replies.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, context } = await req.json();

    if (!action || !context) {
      return new Response(JSON.stringify({ error: "Missing required parameters: action, context" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    let generatedText = "";

    if (!apiKey) {
      // Mock Fallback Mode (Allows testing without configuring OpenAI keys)
      if (action === "post") {
        generatedText = `Mock Draft: ${context.substring(0, 30)}${context.length > 30 ? '...' : ''}\nThis is a mock-generated post about "${context}". It serves as a fallback draft because the OpenAI API key has not been configured in your Supabase environment yet.`;
      } else if (action === "bio") {
        generatedText = `✨ Social explorer. Into: ${context.substring(0, 60)}. (Mock AI Bio)`;
      } else if (action === "comment") {
        generatedText = `Interesting perspective on "${context.title || 'this topic'}". Thanks for sharing! (Mock AI Comment)`;
      }
    } else {
      // Define System Prompt based on Action
      let systemPrompt = "";
      let userPrompt = "";

      if (action === "post") {
        systemPrompt = "You are a creative social media writer. Generate a compelling post based on the topic. Return only the post title on the first line, and the post content starting on the second line. Do not include markdown formatting or quotes.";
        userPrompt = `Generate a post about: ${context}`;
      } else if (action === "bio") {
        systemPrompt = "You are a professional profile copywriter. Write a short, premium social media bio (under 160 characters) based on user interests. Return ONLY the bio text, no quotes.";
        userPrompt = `Write a bio based on these interests: ${context}`;
      } else if (action === "comment") {
        systemPrompt = "You are an engaging community member. Generate a constructive, friendly, and relevant comment response for the post. Keep it under 2 sentences. Return ONLY the comment text, no quotes.";
        userPrompt = `Suggest a comment reply for this post:\nTitle: ${context.title}\nContent: ${context.content}`;
      } else {
        return new Response(JSON.stringify({ error: "Invalid action type. Supported: post, bio, comment" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }

      // Call OpenAI Chat Completion Endpoint
      const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini", // Cost-effective, lightning fast model
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 250,
        }),
      });

      const aiData = await openAiResponse.json();

      if (aiData.error) {
        throw new Error(aiData.error.message || "Failed to communicate with OpenAI.");
      }

      generatedText = aiData.choices?.[0]?.message?.content?.trim() || "";
    }

    // Parse Response (Special handling for post title/content separation)
    let result: Record<string, string> = { text: generatedText };
    if (action === "post") {
      const lines = generatedText.split("\n");
      const title = lines[0].replace(/^Title:\s*/i, "").trim();
      const content = lines.slice(1).join("\n").trim();
      result = { title, content };
    }

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
