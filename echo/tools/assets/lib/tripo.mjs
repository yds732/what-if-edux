// Tripo: images to 3D models, and rigging. Every task is created, polled to the end, and its files fetched at once
// (download links last five minutes).
import fs from 'node:fs';
import { key, ledger, sleep } from './env.mjs';

const API = 'https://api.tripo3d.ai/v2/openapi';
/** H3.1: the high-detail geometry model. */
export const MODEL_VERSION = 'v3.1-20260211';
export const RIG_VERSION = 'v2.5-20260210';

const call = async (path, init = {}) => {
  const response = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${key('TRIPO_API_KEY')}`, ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 0) throw new Error(`Tripo ${init.method ?? 'GET'} ${path}: ${body.message ?? `HTTP ${response.status}`}${body.suggestion ? ` (${body.suggestion})` : ''}`);
  return body.data;
};

export const balance = () => call('/user/balance');

/** Uploads an image and returns the file object a task takes. */
export const upload = async (buffer, name) => {
  const form = new FormData();
  const type = name.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
  form.append('file', new Blob([buffer], { type: `image/${type}` }), name);
  const data = await call('/upload', { method: 'POST', body: form });
  return { type: type === 'png' ? 'png' : 'jpg', file_token: data.image_token };
};

export const createTask = async (body) => (await call('/task', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).task_id;

export const getTask = (id) => call(`/task/${id}`);

/** Polls until the task ends. Resolves with the finished task; throws if it did not succeed. */
export const waitTask = async (id, { label = id, onProgress = null, timeoutMinutes = 40 } = {}) => {
  const deadline = Date.now() + timeoutMinutes * 60000;
  let last = -1;
  for (;;) {
    const task = await getTask(id);
    if (task.status === 'success') return task;
    if (!['queued', 'running'].includes(task.status)) throw new Error(`Tripo task ${label} (${id}) ended as ${task.status}`);
    if (onProgress && task.progress !== last) onProgress((last = task.progress), task);
    if (Date.now() > deadline) throw new Error(`Tripo task ${label} (${id}) did not finish in ${timeoutMinutes} minutes`);
    await sleep(4000);
  }
};

/** Runs a task to the end and records what it cost. */
export const runTask = async (asset, action, body, options = {}) => {
  const id = await createTask(body);
  const task = await waitTask(id, { label: `${asset}/${action}`, ...options });
  ledger({ service: 'tripo', asset, action, task: id, credits: task.consumed_credit ?? null });
  return task;
};

export const download = async (url, file) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed (${response.status}) for ${file}`);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
};
