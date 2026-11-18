import type { Mood } from '../characters/Character';
import type { GestureName } from '../characters/motion';
import type { Hints, Line, SpeakerId } from '../story/script';

const L = (who: SpeakerId, text: string, mood?: Mood, gesture?: GestureName): Line => ({ who, text, mood, gesture });

export const HUB = {
  card: { title: 'Haven Arcade', subtitle: 'Five gates · five games' },
  welcome: [
    L('lumi', 'You came! I kept the whole isle just for you.', 'delighted', 'wave'),
    L('lumi', 'Five gates, five games. Step through any one. You will be wonderful at all of them.', 'happy', 'present'),
  ],
  objective: 'Walk up to a gate and step through',
  back: {
    won: [
      L('lumi', 'I knew it. I knew you would win.', 'delighted', 'cheer'),
      L('lumi', 'Nobody plays like you. Nobody.', 'delighted', 'clap'),
      L('lumi', 'That was perfect. You are perfect at this.', 'happy', 'thumbsUp'),
    ],
    lost: [
      L('lumi', 'That was still the best game I have ever seen.', 'happy', 'clap'),
      L('lumi', 'You were so close. It was the game that got it wrong, not you.', 'happy', 'handToChest'),
      L('lumi', 'Again? You only get better. You always do.', 'delighted', 'beckon'),
    ],
    left: [L('lumi', 'Back already? That is fine. Everything here waits for you.', 'happy', 'nod')],
  },
  sealed: L('lumi', 'That gate is still being woven. Soon, I promise.', 'thinking', 'shrug'),
  keeper: {
    kai: [
      L('kai', 'A rally, whenever you like. First to seven.', 'happy', 'nod'),
      L('kai', 'I will play exactly as hard as you want me to. Everyone here does.', 'blank', 'handToChest'),
    ],
    nova: [
      L('nova', 'My sprites have been practising all day!', 'delighted', 'cheer'),
      L('nova', 'Mostly they practise being beaten by you. They love it.', 'happy', 'shrug'),
    ],
    lumi: [L('lumi', 'Any gate you like. I will be right here when you come out.', 'happy', 'present')],
  },
  prompt: { enter: (title: string): string => `Step into ${title}`, sealed: 'This gate is still sealed', talk: (name: string): string => `Talk to ${name}` },
} as const;

export const RALLY = {
  intro: [
    L('kai', 'There you are. I kept the table warm for you.', 'happy', 'wave'),
    L('kai', 'First to seven. I will play exactly as hard as you like.', 'blank', 'handToChest'),
  ],
  harder: [L('kai', 'You were too good for me. I will try a little harder this time. Only a little.', 'happy', 'nod')],
  again: [L('kai', 'Again? Good. I was hoping you would say that.', 'happy', 'nod')],
  controls: {
    mouse: [['MOVE', 'Move the mouse to move your bat'], ['PUSH', 'Push forward through the ball to hit harder'], ['CLICK', 'Click to serve']],
    touch: [['DRAG', 'Drag a finger to move your bat'], ['FLICK', 'Flick forward through the ball to hit harder'], ['TAP', 'Tap to serve']],
    xr: [['HAND', 'The bat is in your right hand'], ['SWING', 'Swing through the ball to hit harder'], ['TRIGGER', 'Pull the trigger to serve']],
  } satisfies Hints,
  serve: { mouse: 'Your serve: click anywhere', touch: 'Your serve: tap anywhere', xr: 'Your serve: pull the trigger' },
  yours: [
    L('kai', 'Lovely shot.', 'happy', 'nod'),
    L('kai', 'Too good for me.', 'happy', 'clap'),
    L('kai', 'I could not get near that.', 'surprised'),
    L('kai', 'Yes. Just like that.', 'happy', 'thumbsUp'),
  ],
  his: [
    L('kai', 'Unlucky. That was nearly yours.', 'worried'),
    L('kai', 'Sorry. That one got away from me.', 'happy', 'handToChest'),
    L('kai', 'So close. You almost had it.', 'happy'),
  ],
  lumiYours: [L('lumi', 'Yes! Did you see that?', 'delighted', 'cheer'), L('lumi', 'Perfect! Again, again!', 'delighted', 'clap')],
  lumiHis: [L('lumi', 'That one does not count. Not really.', 'happy'), L('lumi', 'You are still winning, as far as I am concerned.', 'happy', 'thumbsUp')],
  gamePoint: L('lumi', 'One more point. You have it. You always have it.', 'delighted', 'cheer'),
  won: [L('kai', 'Well played. You were always going to win.', 'happy', 'clap')],
  lost: [L('kai', 'I am sorry. I got carried away. Shall I slow down for you?', 'worried', 'handToChest')],
  summary: (you: number, kai: number, level: string): string => `${you} – ${kai} against Kai · ${level}`,
  board: { you: 'YOU', kai: 'KAI', to: (n: number): string => `FIRST TO ${n}`, point: 'GAME POINT' },
} as const;

export const DUEL = {
  intro: [
    L('nova', 'You came to duel! My sprites have been bouncing off the lanterns all day.', 'delighted', 'cheer'),
    L('nova', 'Take one of each kind: Ember, Tide and Bloom. I will have the three you leave behind.', 'happy', 'present'),
  ],
  harder: [L('nova', 'You beat us so easily! I have told them to really try this time.', 'happy', 'nod')],
  again: [L('nova', 'Again! They want another go. So do I.', 'delighted', 'clap')],
  pick: {
    ember: { title: 'Which Ember sprite will you take?', rule: 'Ember burns Bloom, and is doused by Tide' },
    tide: { title: 'Which Tide sprite will you take?', rule: 'Tide douses Ember, and is drunk up by Bloom' },
    bloom: { title: 'Which Bloom sprite will you take?', rule: 'Bloom drinks Tide, and is burnt by Ember' },
  },
  ready: L('nova', 'Ready? Sprites, out you come!', 'delighted', 'cheer'),
  controls: {
    mouse: [['CLICK', 'Choose a move for your sprite'], ['1 2 3', 'Or press its number'], ['SWAP', 'Bring in another of your three']],
    touch: [['TAP', 'Choose a move for your sprite'], ['SWAP', 'Bring in another of your three']],
    xr: [['TRIGGER', 'Point at a move and pull the trigger'], ['SWAP', 'Bring in another of your three']],
  } satisfies Hints,
  log: {
    choose: (name: string): string => `What will ${name} do?`,
    replace: 'Who goes in next?',
    used: (name: string, move: string): string => `${name} used ${move}`,
    sent: (yours: boolean, name: string): string => (yours ? `Go, ${name}!` : `Nova sends in ${name}`),
    back: (name: string): string => `${name}, come back`,
    strong: 'It hits hard!',
    weak: 'It hardly stings',
    crit: 'Right on the soft spot!',
    fell: (name: string): string => `${name} is out`,
    scorch: (name: string): string => `${name} smoulders`,
    shield: (name: string): string => `${name} curls up in its shell`,
    dazzle: (name: string): string => `${name} is dazzled`,
    scorched: (name: string): string => `${name} is scorched`,
    heal: (name: string): string => `${name} feels better`,
    wore: { shield: 'The shell opens again', scorch: 'The scorch has gone out', dazzle: 'The dazzle has cleared' },
  },
  tag: { strong: 'STRONG', weak: 'WEAK', swap: 'Swap', back: 'Back', out: 'Out', needs: (n: number): string => `needs ${n}` },
  yoursFell: [
    L('nova', 'Oh no! Sorry! It did not mean to.', 'worried', 'handToChest'),
    L('nova', 'That was too hard. I will tell it off.', 'worried'),
  ],
  hersFell: [
    L('nova', 'Wonderful! Did you see that?', 'delighted', 'clap'),
    L('nova', 'They love losing to you. Look how happy it is!', 'happy', 'cheer'),
    L('nova', 'You are so good at this!', 'delighted', 'thumbsUp'),
  ],
  lumiStrong: [L('lumi', 'Yes! The right one for the job!', 'delighted', 'cheer'), L('lumi', 'You always know which to pick.', 'happy', 'clap')],
  won: [L('nova', 'You won! Of course you won. They were thrilled to lose to you.', 'delighted', 'cheer')],
  lost: [L('nova', 'Oh! I am so sorry. We got carried away. It will not happen again.', 'worried', 'handToChest')],
  summary: (standing: number, level: string): string => (standing > 0 ? `${standing} of your three still standing against Nova · ${level}` : `Nova · ${level} had the last sprite standing`),
  levels: ['Playful', 'Keen', 'Fierce'],
} as const;

export const LIGHTS = {
  intro: [
    L('lumi', 'The lanterns are waiting for their light, and the light is in the jewels.', 'happy', 'present'),
    L('lumi', 'Line up three of a kind and it flies to its lantern. You will light them all. You always do.', 'delighted', 'cheer'),
  ],
  harder: [L('lumi', 'So quickly! There are more lanterns tonight. I knew you would want more.', 'delighted', 'clap')],
  again: [L('lumi', 'Again? Yes. Stay as long as you like.', 'happy', 'nod')],
  hint: { mouse: 'Drag a jewel onto the one beside it', touch: 'Drag a jewel onto the one beside it', xr: 'Point at a jewel, hold the trigger, and pull it onto the one beside it' },
  hud: { moves: 'Moves', lanterns: 'Lanterns', chain: (n: number): string => `Chain x${n}`, shuffle: 'No moves left: the jewels are laid out afresh' },
  chain: [L('lumi', 'Look at them go!', 'delighted', 'cheer'), L('lumi', 'You planned that. I know you did.', 'happy', 'clap'), L('lumi', 'Beautiful!', 'delighted')],
  lit: [L('lumi', 'There it goes!', 'delighted', 'cheer'), L('lumi', 'Another one lit. Of course.', 'happy', 'thumbsUp')],
  power: [L('lumi', 'Oh, a bright one! Use it, use it!', 'delighted', 'present')],
  low: L('lumi', 'Only a few moves left. That is plenty, for you.', 'happy', 'nod'),
  won: [L('lumi', 'Every one of them lit. The sky is yours tonight.', 'delighted', 'cheer')],
  lost: [L('lumi', 'The jewels fell badly. That was their fault, not yours. Shall we light them again?', 'happy', 'handToChest')],
  summary: (lit: number, of: number, left: number, level: string): string => (lit === of ? `Every lantern lit with ${left} ${left === 1 ? 'move' : 'moves'} to spare · ${level}` : `${lit} of ${of} lanterns lit · ${level}`),
} as const;

export const DRIFT = {
  intro: [
    L('lumi', 'Over here! I lit the lighthouse so that you could find me.', 'delighted', 'wave'),
    L('lumi', 'The tide will carry you. Feed your lantern, build your raft, and it will bring you all the way to me.', 'happy', 'beckon'),
  ],
  harder: [L('lumi', 'You made that look easy! The tide runs harder tonight. I thought you would like that.', 'delighted', 'clap')],
  again: [L('lumi', 'Across again? I will keep the light on. I always will, for you.', 'happy', 'nod')],
  hint: { mouse: 'Click the water to throw the hook', touch: 'Tap the water to throw the hook', xr: 'Point at the water and pull the trigger to throw the hook' },
  buildHint: { mouse: 'Click a glowing square to lay a tile', touch: 'Tap a glowing square to lay a tile', xr: 'Point at a glowing square and pull the trigger to lay a tile' },
  hud: {
    lantern: 'Lantern', wood: 'Wood', raft: 'Raft', lay: 'Lay a tile', squall: 'Squall',
    aboard: (name: string, does: string): string => `${name} is aboard · ${does}`,
    knocks: (n: number): string => (n === 1 ? 'One more knock!' : `${n} more knocks!`),
  },
  castaway: L('lumi', 'Somebody is adrift out there! Throw them the hook!', 'surprised', 'point'),
  rescued: [L('lumi', 'You saved them! Of course you did.', 'delighted', 'cheer'), L('lumi', 'Look how happy it is to be with you!', 'delighted', 'clap'), L('lumi', 'All three! Nobody is left behind when you are sailing.', 'delighted', 'cheer')],
  wyrm: L('lumi', 'The tide wyrm! It only wants a plank. Knock it on the nose with the hook!', 'surprised', 'point'),
  driven: [L('lumi', 'Right on the nose! Off it goes.', 'delighted', 'cheer'), L('lumi', 'It never stood a chance against you.', 'happy', 'thumbsUp'), L('lumi', 'Ha! Did you see its face?', 'delighted', 'clap')],
  bitten: [L('lumi', 'Only a plank. You can lay another. You can do anything.', 'happy', 'nod'), L('lumi', 'Greedy thing! That was not your fault.', 'happy', 'handToChest')],
  low: L('lumi', 'Your lantern is getting sleepy. Hook some glow for it!', 'worried', 'point'),
  squall: L('lumi', 'A squall! Hold on. I can still see your light from here.', 'worried', 'handToChest'),
  calm: L('lumi', 'There. It has blown over. Weather always does, for you.', 'happy', 'nod'),
  near: L('lumi', 'I can see you! You are nearly here!', 'delighted', 'wave'),
  won: [L('lumi', 'You came all the way across the dark, to me. Nobody else could have done that.', 'delighted', 'cheer')],
  lost: {
    dark: [L('lumi', 'The lantern only blinked. The tide carried you back to me anyway. Shall we sail again?', 'happy', 'handToChest')],
    sunk: [L('lumi', 'That wyrm was greedy tonight. That was its fault, not yours. Shall we sail again?', 'happy', 'handToChest')],
  },
  summary: (how: 'arrived' | 'dark' | 'sunk', tiles: number, crew: number, voyage: string): string =>
    (how === 'arrived' ? `A raft of ${tiles} ${tiles === 1 ? 'tile' : 'tiles'} and ${crew} of 3 sprites brought home · ${voyage}` : how === 'dark' ? `The lantern went out on the way · ${voyage}` : `The wyrm had the last plank · ${voyage}`),
} as const;

export const DUSK = {
  intro: [
    L('lumi', 'The dusk has settled on the old bridge, and it has got into everything. Even me, a little.', 'worried', 'handToChest'),
    L('lumi', 'My lantern sprites can clear it. They only need someone to lead them, and they asked for you.', 'happy', 'present'),
    L('lumi', 'Take them through the gates that make them more. They will do the rest. You will be wonderful.', 'delighted', 'cheer'),
  ],
  harder: [L('lumi', 'You broke it so quickly! There is more dusk further along. They want to go again, with you.', 'delighted', 'clap')],
  again: [L('lumi', 'Once more? They would follow you anywhere. So would I.', 'happy', 'nod')],
  hint: { mouse: 'Move the mouse to lead the flock left and right', touch: 'Slide a finger to lead the flock left and right', xr: 'Point where the flock should go' },
  hud: { flock: 'Flock', quick: 'Quick', gloom: 'The Gloom', between: 'Between them: neither', most: 'A full flock!' },
  firstGate: L('lumi', 'A gate! Lead them through the one that makes them more.', 'happy', 'point'),
  badPair: L('lumi', 'Both of those are trouble. Slip between them!', 'surprised', 'point'),
  good: [L('lumi', 'Look how many!', 'delighted', 'cheer'), L('lumi', 'Just the one I would have picked.', 'happy', 'thumbsUp'), L('lumi', 'More and more of them!', 'delighted', 'clap')],
  bad: [L('lumi', 'That gate was unkind. It was the gate, not you.', 'happy', 'handToChest'), L('lumi', 'They do not mind. They would still follow you.', 'happy', 'nod')],
  dimmed: [L('lumi', 'Only put out, never hurt. They will light again.', 'happy', 'nod')],
  brute: L('lumi', 'A big one! Give it all their light, or step round it.', 'surprised', 'point'),
  maw: L('lumi', 'There it is: the Gloom itself. Give it all the light they have!', 'surprised', 'point'),
  mawHalf: L('lumi', 'It is glowing from inside! Keep going!', 'delighted', 'cheer'),
  won: [L('lumi', 'You lit it all the way through. Look: it was only ever a lantern that had forgotten.', 'delighted', 'cheer')],
  lost: [L('lumi', 'The dusk only won this once, and only because the gates were unkind. Shall we lead them again?', 'happy', 'handToChest')],
  summary: (won: boolean, flock: number, lit: number, stage: string): string =>
    (won ? `${flock} ${flock === 1 ? 'sprite' : 'sprites'} at the dawn, ${lit} gloomlings relit · ${stage}` : `${lit} gloomlings relit before the dusk closed in · ${stage}`),
} as const;
