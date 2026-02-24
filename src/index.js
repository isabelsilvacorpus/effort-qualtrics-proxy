const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/qualtrics-chat") {
      return json({ ok: false, error: "Not found" }, 404);
    }

    try {
      const payload = await parsePayload(request);
      const textField = env.QUALTRICS_TEXT_FIELD || "participantText";
      const participantText = (payload[textField] || "").toString().trim();
      const sharedSecret = (payload.sharedSecret || "").toString();
      const mode = normalizeMode(payload.mode);

      if (!env.OPENAI_API_KEY) {
        return json({ ok: false, error: "Missing OPENAI_API_KEY" }, 500);
      }
      if (!env.QUALTRICS_SHARED_SECRET) {
        return json({ ok: false, error: "Missing QUALTRICS_SHARED_SECRET" }, 500);
      }
      if (sharedSecret !== env.QUALTRICS_SHARED_SECRET) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      if (!participantText) {
        return json(
          {
            ok: false,
            error: `Missing or empty "${textField}" in request body`
          },
          400
        );
      }
      if (!mode) {
        return json(
          {
            ok: false,
            error: 'Invalid mode. Use "outline" or "draft".'
          },
          400
        );
      }

      const model = env.OPENAI_MODEL || "gpt-4o-mini";
      const systemPrompt = getSystemPromptForMode(env, mode);
      const maxWords = getMaxWordsForMode(env, mode);

      const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: "system",
              content: [{ type: "input_text", text: systemPrompt }]
            },
            {
              role: "user",
              content: [{ type: "input_text", text: participantText }]
            }
          ]
        })
      });

      if (!openAiResponse.ok) {
        console.error("OpenAI request failed", {
          status: openAiResponse.status
        });
        return json(
          {
            ok: false,
            error: "OpenAI request failed",
            status: openAiResponse.status
          },
          502
        );
      }

      const data = await openAiResponse.json();
      const usage = extractNumericUsage(data?.usage);
      if (Object.keys(usage).length > 0) {
        console.log("OpenAI usage", { model, mode, ...usage });
      }
      const modelResponse = truncateToWordLimit(extractOutputText(data), maxWords);

      if (!modelResponse) {
        console.error("OpenAI response missing output text");
        return json(
          {
            ok: false,
            error: "OpenAI response did not contain output text"
          },
          502
        );
      }

      return json(
        {
          ok: true,
          model,
          mode,
          model_response: modelResponse
        },
        200
      );
    } catch (error) {
      console.error("Unhandled worker error", {
        message: String(error && error.message ? error.message : error)
      });
      return json(
        {
          ok: false,
          error: "Unhandled worker error"
        },
        500
      );
    }
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS_HEADERS
    }
  });
}

async function parsePayload(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return await request.json();
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }

  try {
    return await request.json();
  } catch {
    return {};
  }
}

function extractOutputText(data) {
  if (!data || typeof data !== "object") {
    return "";
  }

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data.output) ? data.output : [];
  const chunks = [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function truncateToWordLimit(text, maxWords) {
  if (!text || typeof text !== "string") {
    return "";
  }
  if (!maxWords || maxWords < 1) {
    return text.trim();
  }
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) {
    return text.trim();
  }
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function normalizeMode(input) {
  const mode = (input || "outline").toString().trim().toLowerCase();
  if (mode === "outline" || mode === "draft") {
    return mode;
  }
  return "";
}

function getSystemPromptForMode(env, mode) {
  const outlinePrompt =
    env.SYSTEM_PROMPT_OUTLINE ||
    env.SYSTEM_PROMPT ||
    [
      "You are helping write a petition outline.",
      "Return only valid HTML using <h3>, <h4>, <ul>, <li>, <p>.",
      "No markdown and no code fences."
    ].join(" ");
  const draftPrompt =
    env.SYSTEM_PROMPT_DRAFT ||
    [
      "You are helping write a full petition draft.",
      "Return only valid HTML using <h3>, <h4>, <ul>, <li>, <p>.",
      "No markdown and no code fences."
    ].join(" ");
  return mode === "draft" ? draftPrompt : outlinePrompt;
}

function getMaxWordsForMode(env, mode) {
  const defaultLimit = mode === "draft" ? 400 : 100;
  const configured =
    mode === "draft" ? env.OUTPUT_MAX_WORDS_DRAFT : env.OUTPUT_MAX_WORDS_OUTLINE;
  const parsed = Number.parseInt(configured || "", 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return defaultLimit;
}

function extractNumericUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return {};
  }

  const result = {};
  collectNumericFields(usage, "", result);
  return result;
}

function collectNumericFields(value, prefix, target) {
  if (typeof value === "number" && Number.isFinite(value)) {
    target[prefix] = value;
    return;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    collectNumericFields(nestedValue, nextPrefix, target);
  }
}
