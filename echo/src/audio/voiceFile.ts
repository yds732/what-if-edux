import type { Line } from '../story/script';

export const voiceFile = ({ who, text }: Line): string =>
  `${who}/${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.mp3`;
