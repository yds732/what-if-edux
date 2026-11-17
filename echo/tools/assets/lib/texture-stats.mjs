// Mean and spread of a model's colour texture: Tripo's texturing now and then hands back a flat grey sheet.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

/** @returns {Promise<{ mean: number[], spread: number[] } | null>} null when there is no colour texture at all */
export const colourStats = async (file) => {
  const texture = (await io.read(file)).getRoot().listMaterials()[0]?.getBaseColorTexture();
  if (!texture) return null;
  const { channels } = await sharp(Buffer.from(texture.getImage())).removeAlpha().stats();
  return { mean: channels.map((c) => c.mean), spread: channels.map((c) => c.stdev) };
};
