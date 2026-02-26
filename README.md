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
npx wrangler secret put QUALTRICS_URL_ENCRYPTION_KEY
npx wrangler deploy
```

After deploy, copy your Worker URL, e.g.:

`https://qualtrics-openai-proxy.<your-subdomain>.workers.dev/v1/qualtrics-chat`

## 5) Environment variables

Set in `wrangler.toml` (non-secret):

- `OPENAI_MODEL` (default in project: `gpt-4o-mini`)
- `SYSTEM_PROMPT_OUTLINE` (system prompt when `mode=outline`)
- `SYSTEM_PROMPT_DRAFT` (system prompt when `mode=draft`)
- `SYSTEM_PROMPT_TITLE` (system prompt when `mode=title`)
- `OUTPUT_MAX_WORDS_OUTLINE` (default `100`)
- `OUTPUT_MAX_WORDS_DRAFT` (default `400`)
- `OUTPUT_MAX_WORDS_TITLE` (default `20`)
- `QUALTRICS_TEXT_FIELD` (request key to read free text, default: `participantText`)
- `QUALTRICS_RESPONSE_ID_FIELD` (request key to read response ID for URL generation, default: `responseId`)
- `PETITION_BASE_URL` (prefix for generated petition URLs, default: `https://cornellpetitionplatform.github.io/petition_platform/petitions/`)

Set as Wrangler secrets:

- `OPENAI_API_KEY`
- `QUALTRICS_SHARED_SECRET`
- `QUALTRICS_URL_ENCRYPTION_KEY` (used for HMAC token generation)

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
   - `mode` = `outline`, `draft`, or `title`
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

## 8) Three-call setup in Qualtrics (outline + draft + title)

1. Add Embedded Data fields in Survey Flow:
   - `AI_Outline`
   - `AI_Draft`
   - `AI_Title`
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
4. Add Web Service call for title:
   - `participantText` = `${q://QID25/ChoiceTextEntryValue}`
   - `sharedSecret` = your shared secret
   - `mode` = `title`
   - Response mapping: `model_response` -> `AI_Title`

You can run all three calls, or branch and run only the one(s) needed based on prior survey logic.

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

## 11) URL generation endpoint (`/v1/qualtrics-url`)

Use this endpoint when you want a deterministic petition URL from a Qualtrics response ID.

Accepts either:

- JSON: `{"responseId":"R_abc123","sharedSecret":"..."}`
- Form-encoded: `responseId=R_abc123&sharedSecret=...`

`responseId` can be renamed by setting `QUALTRICS_RESPONSE_ID_FIELD`.

Returns JSON:

```json
{
  "ok": true,
  "response_id": "R_abc123",
  "petition_token": "generated_token",
  "petition_url": "https://cornellpetitionplatform.github.io/petition_platform/petitions/petition-generated_token/"
}
```

Token generation matches:

1. `HMAC-SHA256(key=QUALTRICS_URL_ENCRYPTION_KEY, message=responseId)`
2. Truncate digest to first 15 bytes
3. URL-safe base64 encode and strip `=`

Example local test:

```bash
curl -X POST "http://127.0.0.1:8787/v1/qualtrics-url" \
  -H "content-type: application/json" \
  -d '{"responseId":"R_abc123","sharedSecret":"<same-secret>"}'
```
