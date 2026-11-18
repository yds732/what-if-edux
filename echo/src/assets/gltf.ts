import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

export const loadGltf = (url: string, onProgress?: (loaded: number, total: number) => void): Promise<GLTF> =>
  loader.loadAsync(url, (e) => onProgress?.(e.loaded, e.lengthComputable ? e.total : 0));
