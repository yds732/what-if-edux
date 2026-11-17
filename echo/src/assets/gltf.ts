import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** Loads a glTF binary. `onProgress` is given bytes received and, where the server says, bytes expected. */
export const loadGltf = (url: string, onProgress?: (loaded: number, total: number) => void): Promise<GLTF> =>
  loader.loadAsync(url, (e) => onProgress?.(e.loaded, e.lengthComputable ? e.total : 0));
