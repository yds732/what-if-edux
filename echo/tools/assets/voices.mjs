// Run from echo/ with Node 24: node --env-file=../../../common/.env tools/assets/voices.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as story from '../../src/story/script.ts';
import * as arcade from '../../src/arcade/script.ts';
import { voiceFile } from '../../src/audio/voiceFile.ts';
import { ensureDir, key, ledger, PUBLIC_ASSETS } from './lib/env.mjs';

const cast = {
  teacher: 'Xb7hH8MSUJpSbSDYk0k2', // Alice
  lumi: 'nDJIICjR9zfJExIFeSCN', // Emmaline — bright, curious companion
  jamie: 'TOHdGJrknwd4eal0jqpE', // Archie — gentle, boyish classmate
  kai: 'loY1uopAz31XyhAEhNSa', // Valf — playful arcade rival
  nova: 'BlgEcC0TfWpBak7FmvHW', // Fena — spirited sprite keeper
  alex: 'atemG3csutMIyK7AbS5c', // Quang Anh — bright, earnest
  sam: 'sfEqHIAPrP82grzla9Ji', // Juvy — gentle, hesitant
  riley: 'gyeuMTz1KvJp8hqXmFe9', // Michelle Queen — conversational British teen
};

const lines = new Map();
function collect(value) {
  if (!value || typeof value !== 'object') return;
  if (!('who' in value)) {
    Object.values(value).forEach(collect);
    return;
  }
  if (value.who === 'you') return;
  if (!cast[value.who]) throw new Error(`No voice assigned for ${value.who}`);
  const name = voiceFile(value);
  if (lines.has(name) && lines.get(name).text !== value.text) throw new Error(`Two lines use ${name}`);
  lines.set(name, value);
}
collect(story);
collect(arcade);

const dir = path.join(PUBLIC_ASSETS, 'voices');
const pending = [...lines].filter(([name]) => !fs.existsSync(path.join(dir, name)));
console.log(`${lines.size} distinct lines; ${pending.length} clips to generate`);
if (process.argv.includes('--check') && pending.length) {
  throw new Error(`Missing recordings:\n${pending.map(([name]) => name).join('\n')}`);
}
const model = 'eleven_flash_v2_5';
for (const [name, { who, text }] of pending) {
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${cast[who]}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': key('ELEVENLABS_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: model, text: text.replace(/\s*(?::\)|\p{Extended_Pictographic})/gu, '').trim(), language_code: 'en' }),
  });
  if (!response.ok) throw new Error(`${name}: ElevenLabs ${response.status} ${await response.text()}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`Empty recording for ${name}`);
  const file = path.join(dir, name);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file + '.tmp', bytes);
  fs.renameSync(file + '.tmp', file);
  ledger({ service: 'elevenlabs', model, file: name, characters: text.length });
  console.log(name);
}
