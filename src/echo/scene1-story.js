// ECHO Scene 1 (Monday, school): narrative state and scripted dialogue.
// No Three.js here, so the story logic can be tested on its own.

export const STATES = Object.freeze({
  SEATED: 'seated',                          // the teacher introduces Echo
  WALK_PROMPTED: 'walkPrompted',             // "Walk to the front of the classroom."
  HEADSET_HIGHLIGHTED: 'headsetHighlighted', // at the table: "Pick up the Echo headset."
  HEADSET_COLLECTED: 'headsetCollected',     // the teacher says thank you
  TRANSITION_STARTED: 'transitionStarted',
});

// Allowed moves. Anything else is ignored, so the flow stays deterministic.
const NEXT = {
  seated: ['walkPrompted'],
  walkPrompted: ['headsetHighlighted'],
  headsetHighlighted: ['walkPrompted', 'headsetCollected'],
  headsetCollected: ['transitionStarted'],
  transitionStarted: [],
};

// Scripted text. Keep it exactly as the game script says.
export const SCRIPT = Object.freeze({
  day: 'MONDAY | SCHOOL',
  screen: {
    title: 'ECHO PILOT PROGRAMME',
    question: 'Can AI companionship help young people feel less lonely?',
  },
  speaker: 'TEACHER',
  intro: [
    'Our city is testing a new AI companion called Echo.',
    'Echo can listen, remember your interests and play games with you.',
    'But could AI friendships change the way we connect with real people?',
    "We're looking for volunteers to try Echo for one week.",
    "On Friday, you'll help the City Youth Council decide whether Echo should be offered to more young people.",
    'Would anyone like to volunteer?',
  ],
  walkPrompt: 'Walk to the front of the classroom.',
  pickupPrompt: 'Pick up the Echo headset.',
  headsetPrompt: 'Tap to pick up',
  thanks: ['Thank you! Remember, everyone might experience Echo differently.'],
  next: {
    title: 'MONDAY — AFTER SCHOOL',
    body: 'Next: your bedroom, where you put on the Echo headset for the first time.',
  },
});

export function createStory({ onChange = () => {} } = {}) {
  let state = STATES.SEATED;

  function go(next) {
    if (state === next || !NEXT[state].includes(next)) return false;
    const prev = state;
    state = next;
    onChange(next, prev);
    return true;
  }

  return {
    get state() { return state; },
    promptWalk() { return go(STATES.WALK_PROMPTED); },
    setNearTable(on) { return go(on ? STATES.HEADSET_HIGHLIGHTED : STATES.WALK_PROMPTED); },
    collectHeadset() { return go(STATES.HEADSET_COLLECTED); },
    startTransition() { return go(STATES.TRANSITION_STARTED); },
  };
}
