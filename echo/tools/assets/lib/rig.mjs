// Reads the layout of an auto-generated skeleton from its shape.
//
// Tripo's rigs have no fixed layout: bone names are arbitrary, limbs hang from different joints, feet may or may
// not have toes, and stray bones turn up for hair and clothes. What the rigs do share is their shape, so that is
// what is read. The head is the joint that carries the most of the mesh (these figures have big heads); the trunk
// is the path from the root up to it; and every limb is a branch off that path: the two that end lowest are the
// legs, and the two that reach furthest out to the sides are the arms.
//
// The result names joints by their place in the skin's joint list, which is the order three.js keeps them in.

/** Tripo's figures face +X with +Y up, which puts their own left at -Z. */
const FORWARD = [1, 0, 0], LEFT = [0, 0, -1];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a, b) => Math.hypot(...sub(a, b));

/** How much of the mesh each joint carries, as a share of the whole. */
const jointShare = (doc, skin) => {
  const share = new Float64Array(skin.listJoints().length);
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
    if (!J || !W) continue;
    for (let i = 0; i < J.getCount(); i++) {
      const j = J.getElement(i, []), w = W.getElement(i, []);
      for (let k = 0; k < 4; k++) { share[j[k]] += w[k]; total += w[k]; }
    }
  }
  if (total === 0) throw new Error('the mesh is not skinned');
  return share.map((s) => s / total);
};

/**
 * @returns {{ hips: number, spine: number | null, chest: number, neck: number | null, head: number,
 *   armL: number[], armR: number[], legL: number[], legR: number[] }}
 *   `hips` is the root joint, which carries the whole figure. An arm is [shoulder, elbow, wrist] and a leg is
 *   [hip, knee, ankle]. Left and right are the figure's own.
 */
export const readRig = (doc) => {
  const skins = doc.getRoot().listSkins();
  if (skins.length !== 1) throw new Error(`expected one skin, found ${skins.length}`);
  const joints = skins[0].listJoints();
  const index = new Map(joints.map((j, i) => [j, i]));
  const parent = joints.map((j) => index.get(j.getParentNode()) ?? -1);
  const kids = joints.map(() => []);
  parent.forEach((p, i) => { if (p >= 0) kids[p].push(i); });
  const roots = parent.flatMap((p, i) => (p < 0 ? [i] : []));
  if (roots.length !== 1) throw new Error(`expected one root joint, found ${roots.length}`);
  const at = joints.map((j) => j.getWorldTranslation());
  const share = jointShare(doc, skins[0]);
  const subtree = (i) => [i, ...kids[i].flatMap(subtree)];
  const lowest = Math.min(...at.map((p) => p[1])), span = Math.max(...at.map((p) => p[1])) - lowest;

  const head = share.indexOf(Math.max(...share));
  const trunk = [];
  for (let i = head; i >= 0; i = parent[i]) trunk.unshift(i);
  const onTrunk = new Set(trunk);
  // a branch that forks into limbs at its very top (a pelvis with both legs under it) is each of those limbs
  const split = (b) => {
    const limbs = kids[b.top].filter((c) => subtree(c).length >= 3);
    return limbs.length >= 2 ? limbs.flatMap((top) => split({ from: b.from, top, joints: subtree(top) })) : [b];
  };
  const branches = trunk
    .flatMap((from) => kids[from].filter((c) => !onTrunk.has(c)).map((top) => ({ from, top, joints: subtree(top) })))
    .flatMap(split)
    .map((b) => ({ ...b, low: Math.min(...b.joints.map((j) => at[j][1])) }))
    .sort((a, b) => a.low - b.low);

  const legs = branches.slice(0, 2);
  if (legs.length !== 2 || legs.some((b) => b.joints.length < 3)) throw new Error('expected two legs of at least a hip, knee and ankle');
  if (legs[0].from !== legs[1].from) throw new Error('the two legs hang from different joints');
  if (Math.abs(at[legs[0].top][1] - at[legs[1].top][1]) > 0.05 * span) throw new Error('the two hips are not level');

  const hipsAt = at[legs[0].top].map((v, k) => (v + at[legs[1].top][k]) / 2);
  const side = (j) => dot(sub(at[j], hipsAt), LEFT);
  const reach = (b) => b.joints.map(side).reduce((best, s) => (Math.abs(s) > Math.abs(best) ? s : best), 0);
  // hair and clothing hang off the head or are too short to be an arm
  const candidates = branches.slice(2).filter((b) => b.from !== head && b.joints.length >= 3).map((b) => ({ ...b, reach: reach(b) }));
  const furthest = (sign) => candidates.filter((b) => b.reach * sign > 0).sort((a, b) => Math.abs(b.reach) - Math.abs(a.reach))[0];
  const arms = [furthest(1), furthest(-1)];
  if (!arms[0] || !arms[1]) throw new Error('expected an arm on each side');
  if (arms[0].from !== arms[1].from) throw new Error('the two arms hang from different joints');

  const chestAt = trunk.indexOf(arms[0].from), legsAt = trunk.indexOf(legs[0].from);
  if (!(legsAt < chestAt && chestAt < trunk.length - 1)) throw new Error('the arms do not hang between the legs and the head');

  // down a limb: at every fork, the way with the most joints below it
  const chain = (from) => {
    const out = [from];
    for (let i = from; kids[i].length;) {
      i = kids[i].reduce((a, b) => (subtree(b).length > subtree(a).length ? b : a));
      out.push(i);
    }
    return out;
  };
  const armChains = arms.map((b) => chain(b.top));
  // the wrist is where the fingers fan out; a hand with a single chain of bones takes its place from the other arm,
  // and failing both, the upper arm and forearm are the two longest bones in a row
  const fan = armChains.map((c) => c.findIndex((j, k) => k >= 2 && kids[j].length >= 2));
  const afterTwoLongest = (c) => {
    let best = -1, wrist = -1;
    for (let k = 0; k + 2 < c.length; k++) {
      const length = dist(at[c[k]], at[c[k + 1]]) + dist(at[c[k + 1]], at[c[k + 2]]);
      if (length > best) { best = length; wrist = k + 2; }
    }
    return wrist;
  };
  const armJoints = armChains.map((c, n) => {
    const wrist = fan[n] >= 0 ? fan[n] : fan[1 - n] >= 0 ? fan[1 - n] : afterTwoLongest(c);
    if (wrist < 2 || wrist >= c.length) throw new Error('an arm has too few joints for a shoulder, elbow and wrist');
    return [c[wrist - 2], c[wrist - 1], c[wrist]];
  });
  for (let k = 0; k < 3; k++) {
    if (Math.abs(at[armJoints[0][k]][1] - at[armJoints[1][k]][1]) > 0.08 * span) throw new Error('the two arms do not mirror each other');
  }
  const legJoints = legs.map((b) => {
    const c = chain(b.top);
    // a foot that has a toe says which way the figure faces
    if (c.length > 3) {
      const toe = sub(at[c[3]], at[c[2]]);
      if (dot(toe, FORWARD) < 0.7 * Math.hypot(toe[0], toe[2])) throw new Error('a foot does not point along +X: this figure does not face the usual way');
    }
    return c.slice(0, 3);
  });

  const sided = (pair, what) => {
    const first = side(pair[0][0]) > 0;
    if (first === side(pair[1][0]) > 0) throw new Error(`both ${what} are on the same side`);
    return first ? pair : [pair[1], pair[0]];
  };
  const [armL, armR] = sided(armJoints, 'arms'), [legL, legR] = sided(legJoints, 'legs');
  return {
    hips: roots[0],
    spine: chestAt - legsAt > 1 ? trunk[legsAt + 1] : null,
    chest: trunk[chestAt],
    neck: trunk.length - 1 - chestAt > 1 ? trunk[trunk.length - 2] : null,
    head,
    armL, armR, legL, legR,
  };
};

/** The same, with each joint's name: for a person to check. */
export const describeRig = (doc, rig) => {
  const names = doc.getRoot().listSkins()[0].listJoints().map((j) => j.getName());
  const name = (v) => (v === null ? '-' : Array.isArray(v) ? v.map((i) => names[i]).join(' > ') : names[v]);
  return Object.entries(rig).map(([k, v]) => `${k.padEnd(6)} ${name(v)}`).join('\n');
};
