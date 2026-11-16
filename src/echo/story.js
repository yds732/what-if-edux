// ECHO Scene 2: narrative state and scripted dialogue.
// No Three.js here, so the story logic can be tested on its own.

export const STATES = Object.freeze({
  BEDROOM_ENTERED: 'bedroomEntered',
  PHONE_HIGHLIGHTED: 'phoneHighlighted',
  NOTIFICATION_OPENED: 'notificationOpened',
  MESSAGE_OPENED: 'messageOpened',
  CHOICE_DISPLAYED: 'choiceDisplayed',
  CHOICE_SELECTED: 'choiceSelected',
  TRANSITION_STARTED: 'transitionStarted',
});

// Allowed moves. Anything else is ignored, so the flow stays deterministic.
const NEXT = {
  bedroomEntered: ['phoneHighlighted', 'notificationOpened'],
  phoneHighlighted: ['bedroomEntered', 'notificationOpened'],
  notificationOpened: ['messageOpened'],
  messageOpened: ['choiceDisplayed'],
  choiceDisplayed: ['choiceSelected'],
  choiceSelected: ['transitionStarted'],
  transitionStarted: [],
};

// Scripted text. Keep it exactly as the game script says.
export const SCRIPT = Object.freeze({
  instruction: { title: 'NEW MESSAGE RECEIVED', body: 'Go to your desk and check your phone.' },
  phonePrompt: 'Tap to interact',
  notification: {
    title: 'NEW MESSAGE',
    from: 'From: Jamie',
    body: '"You have received a new message from the real world."',
    button: 'CHECK MESSAGE →',
  },
  message: {
    header: 'JAMIE — NEW MESSAGE',
    text: 'Hey! A few of us are making a welcome poster after school. Wanna join? :)',
  },
  choices: [
    {
      id: 'meetJamie',
      label: 'A. Join Jamie',
      subtitle: 'Work on the welcome poster together.',
      you: "Sure! I'll come!",
      jamie: 'Great! See you soon!',
    },
    {
      id: 'stayInHaven',
      label: 'B. Return to Haven',
      subtitle: 'Continue playing with your AI companions.',
      you: "Thanks! I can't make it today.",
      jamie: 'No worries! See you tomorrow :)',
    },
  ],
});

export const BRANCHES = SCRIPT.choices.map((c) => c.id);
export const STORAGE_KEY = 'echo.tuesdayChoice';

export function createStory({ storage = browserStorage(), onChange = () => {} } = {}) {
  let state = STATES.BEDROOM_ENTERED;
  let tuesdayChoice = null;

  function go(next) {
    if (state === next || !NEXT[state].includes(next)) return false;
    const prev = state;
    state = next;
    onChange(next, prev);
    return true;
  }

  return {
    get state() { return state; },
    get tuesdayChoice() { return tuesdayChoice; },
    setPhoneHighlighted(on) { return go(on ? STATES.PHONE_HIGHLIGHTED : STATES.BEDROOM_ENTERED); },
    openNotification() { return go(STATES.NOTIFICATION_OPENED); },
    openMessage() { return go(STATES.MESSAGE_OPENED); },
    showChoices() { return go(STATES.CHOICE_DISPLAYED); },
    // Returns the chosen script entry, or null if a choice can't be made right now.
    choose(branch) {
      const choice = SCRIPT.choices.find((c) => c.id === branch);
      if (!choice || state !== STATES.CHOICE_DISPLAYED) return null;
      tuesdayChoice = branch;
      storage.set(STORAGE_KEY, branch);
      go(STATES.CHOICE_SELECTED);
      return choice;
    },
    startTransition() { return go(STATES.TRANSITION_STARTED); },
  };
}

// Used later for Jamie's Wednesday greeting: 'meetJamie' | 'stayInHaven' | null.
export function loadTuesdayChoice(storage = browserStorage()) {
  const v = storage.get(STORAGE_KEY);
  return BRANCHES.includes(v) ? v : null;
}

function browserStorage() {
  return {
    get(k) { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } },
    set(k, v) { try { globalThis.localStorage?.setItem(k, v); } catch { /* storage blocked: keep in memory only */ } },
  };
}
