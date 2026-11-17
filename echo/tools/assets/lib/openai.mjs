// OpenAI image generation: design reference sheets, key art and flat textures.
import { key, ledger, sleep } from './env.mjs';

const API = 'https://api.openai.com/v1/images';
/** Sunburst is the detailed, reference-faithful model; Flare is the quick one for drafts. */
export const IMAGE_MODELS = { detailed: 'gpt-image-2.6-sunburst', draft: 'gpt-image-2.6-flare' };
/** US dollars per million tokens, for the ledger's estimate. */
const PRICE = { text: 5, imageIn: 8, imageOut: 30 };

const estimate = (usage) => {
  if (!usage) return null;
  const d = usage.input_tokens_details ?? {};
  return +(((d.text_tokens ?? 0) * PRICE.text + (d.image_tokens ?? 0) * PRICE.imageIn + (usage.output_tokens ?? 0) * PRICE.imageOut) / 1e6).toFixed(4);
};

/**
 * Makes one image and returns it as a PNG buffer.
 * `references` are images the result should stay consistent with (a style key, an earlier sheet): `{ name, buffer }`.
 */
export const generateImage = async ({ asset, prompt, size = '1536x1024', quality = 'high', background = 'opaque', model = IMAGE_MODELS.detailed, references = [] }) => {
  const headers = { Authorization: `Bearer ${key('OPENAI_API_KEY')}` };
  let request;
  if (references.length) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', quality);
    form.append('background', background);
    for (const ref of references) form.append('image[]', new Blob([ref.buffer], { type: ref.name.endsWith('.png') ? 'image/png' : 'image/jpeg' }), ref.name);
    request = { url: `${API}/edits`, init: { method: 'POST', headers, body: form } };
  } else {
    request = { url: `${API}/generations`, init: { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ model, prompt, size, quality, background, output_format: 'png' }) } };
  }
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    const response = await fetch(request.url, request.init);
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.data?.[0]?.b64_json) {
      const usd = estimate(body.usage);
      ledger({ service: 'openai', asset, model, size, quality, references: references.length, seconds: Math.round((Date.now() - started) / 1000), tokens: body.usage?.total_tokens ?? null, usd });
      return Buffer.from(body.data[0].b64_json, 'base64');
    }
    const message = body.error?.message ?? `HTTP ${response.status}`;
    // rate limits and server hiccups are worth waiting out; anything else is a real answer
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await sleep(8000 * attempt);
      continue;
    }
    throw new Error(`OpenAI image request for "${asset}" failed: ${message}`);
  }
};
