# Qualtrics -> Cloudflare Worker -> OpenAI Proxy

Minimal Cloudflare Workers (Free tier) proxy for routing Qualtrics participant free text to an OpenAI model, then returning/storing the model response in Qualtrics data.

## 1) What this does

1. Qualtrics sends participant text to a Worker endpoint.
2. Worker forwards text to OpenAI.
3. Worker returns JSON with model output.
4. Qualtrics stores returned value in Embedded Data.

## 2) Files

- `src/index.js`: Worker endpoint and OpenAI call
- `wrangler.toml`: Worker config
- `package.json`: scripts and dependency metadata

## 3) Prerequisites

- Cloudflare account (Free tier is fine)
- Node.js 18+
- Wrangler CLI (`npm i -g wrangler` or `npx wrangler ...`)
- OpenAI API key

## 4) Configure + Deploy

```bash
npm install
npx wrangler login
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put QUALTRICS_SHARED_SECRET
npx wrangler deploy
```

After deploy, copy your Worker URL, e.g.:

`https://qualtrics-openai-proxy.<your-subdomain>.workers.dev/v1/qualtrics-chat`

## 5) Environment variables

Set in `wrangler.toml` (non-secret):

- `OPENAI_MODEL` (default in project: `gpt-4o-mini`)
- `SYSTEM_PROMPT_OUTLINE` (system prompt when `mode=outline`)
- `SYSTEM_PROMPT_DRAFT` (system prompt when `mode=draft`)
- `OUTPUT_MAX_WORDS_OUTLINE` (default `100`)
- `OUTPUT_MAX_WORDS_DRAFT` (default `400`)
- `QUALTRICS_TEXT_FIELD` (request key to read free text, default: `participantText`)

Set as Wrangler secrets:

- `OPENAI_API_KEY`
- `QUALTRICS_SHARED_SECRET`

## 6) Qualtrics setup (minimal)

In Survey Flow (after the block that collects free text):

1. Add a **Web Service** element.
2. URL:
   - `https://<your-worker>/v1/qualtrics-chat`
3. Method:
   - `POST`
4. Body parameters:
   - `participantText` = piped text from your free-text question
   - `sharedSecret` = same value as `QUALTRICS_SHARED_SECRET`
   - `mode` = `outline` or `draft`
5. Response parsing:
   - Map `model_response` from JSON into an Embedded Data field (for example `AI_Response`).

Now `AI_Response` is included in Qualtrics response exports.

## 7) Worker request/response contract

Accepts either:

- JSON: `{"participantText":"...","sharedSecret":"...","mode":"outline"}`
- Form-encoded: `participantText=...&sharedSecret=...&mode=draft`

Returns JSON:

```json
{
  "ok": true,
  "model": "gpt-4o-mini",
  "mode": "outline",
  "model_response": "..."
}
```

## 8) Two-call setup in Qualtrics (outline + draft)

1. Add Embedded Data fields in Survey Flow:
   - `AI_Outline`
   - `AI_Draft`
2. Add Web Service call for outline:
   - `participantText` = `${q://QID25/ChoiceTextEntryValue}` (replace with your QID)
   - `sharedSecret` = your shared secret
   - `mode` = `outline`
   - Response mapping: `model_response` -> `AI_Outline`
3. Add Web Service call for draft:
   - `participantText` = `${q://QID25/ChoiceTextEntryValue}`
   - `sharedSecret` = your shared secret
   - `mode` = `draft`
   - Response mapping: `model_response` -> `AI_Draft`

You can run both calls, or branch and run only one based on prior survey logic.

## 9) Local test

```bash
npx wrangler dev
```

In another terminal:

```bash
curl -X POST "http://127.0.0.1:8787/v1/qualtrics-chat" \
  -H "content-type: application/json" \
  -d '{"participantText":"I feel good about this task.","sharedSecret":"<same-secret>","mode":"outline"}'
```

## 10) Notes

- This project is intentionally minimal for easy Free-tier deployment.
- Add rate limits / logging / stricter schema validation before production at scale.
