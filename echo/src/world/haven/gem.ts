import * as THREE from 'three';

export const makeGem = (size = 0.055): THREE.Mesh => {
  const geo = new THREE.OctahedronGeometry(size, 0);
  geo.scale(0.8, 1.45, 0.8);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x7fe6ff, emissive: new THREE.Color(0x2bb8ff), emissiveIntensity: 1.6, roughness: 0.12, metalness: 0.1, flatShading: true,
  });
  const gem = new THREE.Mesh(geo, mat);
  gem.name = 'gem';
  return gem;
};
