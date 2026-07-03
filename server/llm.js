// ---------------------------------------------------------------------------
// Optional conversational layer for the Discord bot.
// Phrases answers like a friendly colleague using a hosted LLM. Supports Google
// Gemini (preferred) or Groq, selected by whichever API key is configured. With
// no key set, callers fall back to their built-in templates, so the bot still
// works with zero external dependencies.
//
// KEY ROTATION: multiple Gemini keys can be provided as a comma-separated list
// in GEMINI_API_KEY. The module round-robins through them and automatically
// skips a key that returns 429 (rate limited) or 5xx.
// ---------------------------------------------------------------------------

const SYSTEM = `You are the office energy assistant for a small startup that runs everything on Discord.
You help the boss keep an eye on the office lights, fans and electricity use.
Voice: warm, concise, a little witty - one or two sentences, like a helpful colleague, never a robotic data dump.
Rules: only use the numbers you are given, never invent devices or values. No markdown headers or bullet lists.`;

// Parse comma-separated Gemini keys for rotation.
const RAW_GEMINI_KEYS = (process.env.GEMINI_API_KEY || '').split(',').map((k) => k.trim()).filter(Boolean);
const GROQ_KEY = process.env.GROQ_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const provider = RAW_GEMINI_KEYS.length > 0 ? 'gemini' : GROQ_KEY ? 'groq' : null;
export const llmEnabled = provider !== null;
export const llmProvider = provider;

// Round-robin index for Gemini keys.
let geminiKeyIndex = 0;
function nextGeminiKey() {
  const key = RAW_GEMINI_KEYS[geminiKeyIndex % RAW_GEMINI_KEYS.length];
  geminiKeyIndex++;
  return key;
}

if (provider === 'gemini') {
  console.log(`[llm] conversational replies via Gemini (${GEMINI_MODEL}) — ${RAW_GEMINI_KEYS.length} API key(s) loaded for rotation.`);
} else if (provider === 'groq') {
  console.log(`[llm] conversational replies via Groq (${GROQ_MODEL}).`);
}

// Gemini REST: POST .../models/<model>:generateContent?key=<key>
async function callGemini(prompt) {
  const maxAttempts = RAW_GEMINI_KEYS.length;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = nextGeminiKey();
    const keyHint = `…${key.slice(-6)}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
        }),
      });

      if (res.status === 429 || res.status >= 500) {
        const body = (await res.text()).slice(0, 120);
        console.warn(`[llm] key ${keyHint} returned ${res.status}, rotating… (${body})`);
        lastError = new Error(`Gemini ${res.status}`);
        continue; // try the next key
      }
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);

      const data = await res.json();
      return (
        data?.candidates?.[0]?.content?.parts
          ?.map((p) => p.text)
          .join('')
          .trim() || null
      );
    } catch (err) {
      if (err.message?.startsWith('Gemini')) throw err; // non-retriable
      console.warn(`[llm] key ${keyHint} network error, rotating:`, err.message);
      lastError = err;
    }
  }
  throw lastError || new Error('All Gemini keys exhausted');
}

// Groq is OpenAI-compatible: POST /openai/v1/chat/completions
async function callGroq(prompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 300,
      temperature: 0.7,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || null;
}

// facts: a plain object of the real data. instruction: what to say.
export async function humanize(instruction, facts) {
  if (!provider) return null;
  const prompt = `${instruction}\n\nHere is the live data (JSON):\n${JSON.stringify(facts)}`;
  try {
    return provider === 'gemini' ? await callGemini(prompt) : await callGroq(prompt);
  } catch (err) {
    console.warn('[llm] humanize failed, using template:', err.message);
    return null;
  }
}
