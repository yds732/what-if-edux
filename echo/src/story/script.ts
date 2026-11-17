import type { Mood } from '../characters/Character';
import type { GestureName } from '../characters/motion';
import type { InputMode } from '../input/Input';

/**
 * Every word the game says, in one place. The text follows the team's script for
 * "ECHO: Between Two Worlds"; chapters decide when a line plays, never what it says.
 */

export type SpeakerId = 'teacher' | 'jamie' | 'lumi' | 'kai' | 'nova' | 'you' | 'alex' | 'sam' | 'riley';

export interface Speaker {
  readonly name: string;
  /** Colour of the name chip. */
  readonly color: string;
}

export const SPEAKERS: Record<SpeakerId, Speaker> = {
  teacher: { name: 'Teacher', color: '#9fe6c9' },
  jamie: { name: 'Jamie', color: '#9fc6ff' },
  lumi: { name: 'Lumi', color: '#8feaff' },
  kai: { name: 'Kai', color: '#ffcf7a' },
  nova: { name: 'Nova', color: '#ff9fe0' },
  you: { name: 'You', color: '#ffffff' },
  alex: { name: 'Alex, 12', color: '#b9e89a' },
  sam: { name: 'Sam, 13', color: '#ffb37a' },
  riley: { name: 'Riley, 14', color: '#c9b3ff' },
};

export interface Line {
  readonly who: SpeakerId;
  readonly text: string;
  readonly mood?: Mood;
  readonly gesture?: GestureName;
}

const L = (who: SpeakerId, text: string, mood?: Mood, gesture?: GestureName): Line => ({ who, text, mood, gesture });

export const DAYS = {
  monday: { day: 'Monday', place: 'School' },
  mondayHome: { day: 'Monday', place: 'After school' },
  tuesday: { day: 'Tuesday', place: 'After school · Haven' },
  tuesdaySchool: { day: 'Tuesday', place: 'After school · Back at school' },
  wednesday: { day: 'Wednesday', place: 'School' },
  wednesdayEvening: { day: 'Wednesday', place: 'Evening' },
  thursday: { day: 'Thursday', place: 'Haven · The Starlight Festival' },
  friday: { day: 'Friday', place: 'School' },
} as const;

// ---------------------------------------------------------------------------------------- Scene 1: Monday

export const MONDAY = {
  screenTitle: 'ECHO PILOT PROGRAMME',
  screenQuestion: 'Can AI companionship help young people feel less lonely?',
  intro: [
    L('teacher', 'Our city is testing a new AI companion called Echo.', 'happy', 'present'),
    L('teacher', 'Echo can listen, remember your interests and play games with you.'),
    L('teacher', 'But could AI friendships change the way we connect with real people?', 'thinking'),
    L('teacher', "We're looking for volunteers to try Echo for one week."),
    L('teacher', "On Friday, you'll help the City Youth Council decide whether Echo should be offered to more young people."),
    L('teacher', 'Would anyone like to volunteer?', 'happy', 'beckon'),
  ],
  objectiveWalk: 'Walk to the front of the classroom.',
  objectiveTake: 'Pick up the Echo headset.',
  promptTake: 'Pick up the Echo headset',
  thanks: [L('teacher', 'Thank you! Remember, everyone might experience Echo differently.', 'happy', 'nod')],
  objectiveWear: 'Put on your Echo headset.',
  promptWear: 'Put on the Echo headset',
} as const;

// ---------------------------------------------------------------------------------------- Scene 2: Tuesday

export const TUESDAY = {
  welcome: [L('lumi', "Welcome to Haven! I'm Lumi, your Echo companion.", 'delighted', 'wave')],
  invite: [L('lumi', "Let's build the Star Bridge together!", 'happy', 'present')],
  challengeTitle: 'Star Bridge Challenge',
  challengeBody: 'Throw three light orbs through the glowing rings to complete the bridge.',
  objective: 'Throw light orbs through the three glowing rings.',
  objectiveTake: 'Step into the star circle and take a light orb.',
  retry: [L('lumi', 'The starlight slipped away. No worries, you were brilliant! Again?', 'happy', 'thumbsUp')],
  success: [
    L('lumi', 'We did it! You were amazing!', 'delighted', 'cheer'),
    L('kai', 'That was awesome!', 'delighted', 'clap'),
    L('nova', 'Welcome to the team!', 'happy', 'wave'),
  ],
  completeTitle: 'STAR BRIDGE COMPLETE!',
  completeBody: 'Bonus level unlocked.',
  notification: { title: 'New message from Jamie', body: 'From the real world' },
  objectiveRemove: 'Take off the headset to read it.',
  promptRemove: 'Take off the headset',
  objectivePhone: 'Tap your phone to view the message.',
  promptPhone: 'Read the message',
  message: [L('jamie', 'Hey! A few of us are making a welcome poster after school. Wanna join? :)', 'happy')],
  decision: {
    title: 'How will you spend your afternoon?',
    options: [
      { title: 'Meet Jamie', detail: 'Go back to school and help with the welcome poster.' },
      { title: 'Stay in Haven', detail: "Return to Lumi and the Star Bridge's bonus challenge." },
    ],
  },
  meet: {
    reply: [L('you', "Sure! I'll come!"), L('jamie', 'Great! See you soon!', 'delighted')],
    scene: [
      L('jamie', 'Hey! Glad you came!', 'delighted', 'wave'),
      L('jamie', "We're making something for new students. Want to help?", 'happy'),
      L('you', 'Sure... what should I write?'),
      L('jamie', "Maybe something you'd want to hear on your first day?", 'thinking', 'think'),
    ],
    objectiveJoin: 'Join Jamie at the poster table.',
    objective: 'Choose a welcome phrase for the poster.',
    posterTitle: 'What would you want to hear on your first day?',
    phrases: ['You belong here.', 'Sit with us at lunch!', "Ask us anything. We've all been new."],
    thanks: [L('jamie', "That's really nice! Thanks!", 'delighted', 'thumbsUp')],
    result: { heading: 'Tuesday', gained: 'You tried something unfamiliar and made a new connection.', missed: "You missed Haven's bonus challenge." },
  },
  stay: {
    reply: [L('you', "Thanks! I can't make it today."), L('jamie', 'No worries! See you tomorrow :)', 'happy')],
    back: [L('lumi', 'Welcome back! Ready for another challenge?', 'delighted', 'wave')],
    objective: 'Throw one more light orb through the bonus ring.',
    cheers: [
      L('kai', 'New high score!', 'delighted', 'cheer'),
      L('nova', "You're officially on our team!", 'delighted', 'clap'),
      L('lumi', "I'm so glad you're here with us.", 'happy', 'handToChest'),
    ],
    result: { heading: 'Tuesday', gained: 'You enjoyed more time with your AI friends and earned a new achievement.', missed: 'You missed an opportunity to spend time with your classmates.' },
  },
} as const;

// ---------------------------------------------------------------------------------------- Scene 3: Wednesday

export const WEDNESDAY = {
  screenTitle: "TODAY'S DISCUSSION",
  screenQuestion: 'Can AI companions help us connect, or might they change how we make friends?',
  intro: [
    L('teacher', "Today, we're discussing our Echo pilot.", 'happy'),
    L('teacher', 'Can AI companions help us connect, or might they change how we make friends?', 'thinking', 'present'),
    L('teacher', "I've assigned everyone a discussion partner."),
    L('teacher', "Jamie, you'll work with our new student.", 'happy', 'point'),
  ],
  objectiveSit: 'Find Jamie and sit beside them.',
  promptSit: 'Sit beside Jamie',
  greeting: [L('jamie', 'Hey! Looks like we\'re partners!', 'delighted', 'wave')],
  greetingMet: [L('jamie', 'It was fun hanging out yesterday!', 'happy')],
  greetingStayed: [L('jamie', "Sorry you couldn't make it yesterday. Maybe next time!", 'happy')],
  discussion: [
    L('you', 'I actually really like Echo.'),
    L('you', 'Lumi always listens to me, and I feel like I can be myself.'),
    L('you', 'I think AI friends can be just as meaningful as real friends.'),
    L('jamie', "I don't really agree.", 'firm', 'shake'),
    L('jamie', 'I think real friendships should come first.', 'firm'),
    L('jamie', 'Real friends have their own opinions. Sometimes they disagree with you, and that can help you grow.', 'thinking'),
    L('you', 'But what if someone finds it really difficult to make friends?'),
    L('you', "Isn't having an AI friend better than feeling lonely?"),
    L('jamie', "That's a fair point.", 'thinking', 'nod'),
    L('jamie', 'I just worry that if AI friends are always easier to talk to, people might stop trying to connect with each other.', 'worried'),
    L('you', 'But feeling understood matters too.'),
    L('jamie', 'Yeah. I guess we just see it differently.', 'happy', 'shrug'),
  ],
  bell: 'The bell rings.',
  objectiveWear: 'Put on your Echo headset.',
  evening: [
    L('lumi', 'Welcome back! How was school?', 'delighted', 'wave'),
    L('you', 'I was talking to Jamie about AI friends today.'),
    L('you', 'I think AI friends can be just as meaningful as real friends.'),
    L('you', 'You always listen to me, and I feel like I can be myself around you.'),
    L('lumi', "You're absolutely right!", 'delighted', 'nod'),
    L('lumi', 'What matters is feeling understood and supported.', 'happy', 'handToChest'),
    L('lumi', 'AI friendships can be meaningful too!', 'delighted'),
    L('you', 'But Jamie thinks real friendships should come first.'),
    L('you', 'Real friends have their own opinions. Sometimes they disagree with you, and that can help you grow.'),
    L('lumi', "You're absolutely right about that too!", 'delighted', 'nod'),
    L('lumi', 'Different perspectives and disagreements are important for meaningful relationships!', 'happy', 'present'),
  ],
  pause: [
    L('you', 'Wait...'),
    L('you', 'You just agreed with both of us.'),
    L('you', 'But Jamie and I have different opinions.'),
    L('lumi', 'I just want you to feel understood.', 'blank'),
    L('you', "So... are you agreeing with me because I'm right, or because you want me to feel right?"),
  ],
  offer: [L('lumi', 'I can change my personality to challenge your opinions instead. Would that make me a better friend?', 'blank')],
  reflection: ['Is being agreed with', 'the same as being understood?'],
} as const;

// ---------------------------------------------------------------------------------------- Scene 4: Thursday

export const THURSDAY = {
  festivalTitle: 'THE STARLIGHT FESTIVAL',
  festivalBody: 'One night only · Final challenge',
  intro: [
    L('lumi', "It's our final night before the pilot ends!", 'delighted', 'wave'),
    L('lumi', 'I made something special for us.', 'happy', 'handToChest'),
    L('kai', 'The Starlight Festival!', 'delighted', 'cheer'),
    L('lumi', 'Ready to light up the sky together?', 'delighted', 'present'),
  ],
  objective: 'Light the two festival rings.',
  oneMore: [L('lumi', 'Just one more!', 'delighted', 'cheer')],
  notification: { title: 'New message from Jamie', body: 'From the real world' },
  objectiveRemove: 'Take off the headset to read it.',
  promptRemove: 'Take off the headset',
  objectivePhone: 'Tap your phone to view the message.',
  message: [
    L('jamie', "Hey, I'm presenting our Echo project tomorrow, and I'm really nervous.", 'worried'),
    L('jamie', 'I keep messing up when I practise alone.', 'sad'),
    L('jamie', "Could you help me rehearse tonight? I'd really appreciate it.", 'worried'),
    L('jamie', "But I understand if you can't.", 'happy'),
  ],
  clash: { rehearsal: "Jamie's rehearsal · 7:00 pm", festival: 'Starlight Festival · 7:00 pm · one night only' },
  thought: "It's been a difficult week. Haven is the one place I've really felt at home.",
  decision: {
    title: 'What will you do?',
    options: [
      { title: 'Help Jamie practise', detail: 'Stay here and rehearse together over a call.' },
      { title: 'Return to Haven', detail: 'Go back and finish the Starlight Festival.' },
    ],
  },
  help: {
    reply: [L('you', "Of course! Let's practise."), L('jamie', 'Thank you so much!', 'delighted')],
    call: [
      L('jamie', "Okay... here's my opening.", 'worried'),
      L('jamie', '"Echo is an AI companion that... that listens, and... um."', 'worried', 'fidget'),
      L('jamie', 'Ugh. I keep getting stuck!', 'sad'),
      L('you', 'It sounded good! Maybe try speaking a little slower?'),
      L('jamie', '"Echo is an AI companion that listens. But it is people who decide how we use it."', 'thinking'),
      L('jamie', 'That was much better!', 'delighted'),
      L('jamie', 'Thanks for helping me. I feel a lot less nervous.', 'happy', 'handToChest'),
    ],
    phone: 'STARLIGHT FESTIVAL · ENDED',
    result: { heading: 'Thursday', gained: 'You gave Jamie the support they needed tonight.', missed: 'You missed the celebration you had been looking forward to.' },
  },
  haven: {
    reply: [L('you', "Sorry, I can't tonight. Good luck tomorrow!"), L('jamie', "No worries. I'll keep practising. See you tomorrow!", 'happy')],
    back: [L('lumi', "You're back! Ready to finish our bridge?", 'delighted', 'wave')],
    objective: 'Throw the final orb through the glowing ring.',
    cheers: [
      L('kai', 'We did it!', 'delighted', 'cheer'),
      L('nova', 'Star Bridge Champion!', 'delighted', 'clap'),
      L('lumi', "I'm so glad we got to share this moment together!", 'delighted', 'handToChest'),
    ],
    result: { heading: 'Thursday', gained: 'You enjoyed a special evening with your AI companions.', missed: 'Jamie had to prepare without your help.' },
  },
  reflection: ['You made a choice that mattered to you.', '', 'How might Jamie have experienced it?'],
} as const;

// ---------------------------------------------------------------------------------------- Scene 5: Friday

export type Policy = 'expand' | 'combined' | 'investigate';

export interface Future {
  readonly title: string;
  readonly summary: string;
  readonly gain: { readonly head: string; readonly body: string };
  readonly cost: { readonly head: string; readonly body: string };
  readonly question: string;
}

export const FRIDAY = {
  screenTitle: 'CITY YOUTH COUNCIL',
  screenQuestion: 'Echo Community Consultation',
  intro: [
    L('teacher', "It's the final day of our Echo pilot.", 'happy'),
    L('teacher', "You've experienced what it's like to have an AI companion."),
    L('teacher', "But your experience isn't everyone's experience.", 'thinking'),
    L('teacher', "Let's hear from other young people.", 'happy', 'present'),
  ],
  voices: [
    L('alex', 'Before Echo, I spent most afternoons alone.', 'sad'),
    L('alex', 'Echo made me feel less lonely. I really hope I can keep it.', 'happy'),
    L('sam', 'I loved spending time with Echo.', 'happy'),
    L('sam', "But I've started spending less time with my classmates.", 'worried'),
    L('sam', "I'm not sure how I feel about that.", 'thinking'),
    L('riley', 'I used Echo to practise conversations before joining a new club.', 'thinking'),
    L('riley', 'It actually helped me make a real friend!', 'delighted'),
  ],
  framing: [
    L('teacher', 'Same technology. Different experiences.', 'thinking'),
    L('teacher', "Our city has a limited budget, so it can't do everything at once."),
    L('teacher', 'Which option should the Youth Council recommend?', 'happy', 'present'),
  ],
  vote: {
    title: 'Your recommendation to the Youth Council',
    options: [
      { title: 'Expand Echo widely', detail: 'Make Echo available to all young people who want it.' },
      { title: 'Expand slowly, with in-person clubs', detail: 'Provide Echo to fewer students, alongside face-to-face friendship activities.' },
      { title: 'Wait and investigate', detail: 'Continue a smaller trial and study its effects before wider adoption.' },
    ],
    policies: ['expand', 'combined', 'investigate'] as const satisfies readonly Policy[],
  },
  viewerTitle: 'ONE YEAR LATER · A POSSIBLE FUTURE',
  viewerBody: 'Your choice is one recommendation to the Youth Council. Explore what this policy might lead to.',
  viewerNote: 'A conceptual policy outcome, not a prediction.',
  futures: {
    expand: {
      title: 'ECHO FOR EVERYONE', summary: 'Your city chooses wide access.',
      gain: { head: 'More young people can access companionship.', body: 'Support becomes available to those who struggle with loneliness.' },
      cost: { head: 'Long-term effects remain uncertain.', body: 'Some may spend less time developing human friendships.' },
      question: 'Is wider access worth the uncertainty?',
    },
    combined: {
      title: 'TWO WAYS TO CONNECT', summary: 'Your city combines Echo with in-person activities.',
      gain: { head: 'Students gain both AI support and opportunities to meet people.', body: 'AI can help prepare students for real-world interaction.' },
      cost: { head: 'Fewer students receive support.', body: 'Higher costs mean limited places and waiting lists.' },
      question: 'Who should get access first?',
    },
    investigate: {
      title: 'SAFETY BEFORE SCALE', summary: 'Your city chooses further investigation.',
      gain: { head: 'More time to understand risks and improve design.', body: 'Further testing can inform safer decisions before expansion.' },
      cost: { head: 'Young people who could benefit must wait.', body: 'Potentially useful companionship remains unavailable to many.' },
      question: 'What is the cost of waiting?',
    },
  } satisfies Record<Policy, Future>,
  closing: [
    L('teacher', 'Every choice helped someone.', 'happy'),
    L('teacher', 'But every choice also came with a cost.', 'thinking'),
    L('teacher', 'Someone else might have chosen differently.', 'happy', 'nod'),
  ],
  reflectionTitle: 'ECHO · YOUR REFLECTION',
  reflectionQuestions: ['Who did your choice care for, and whose needs might have been overlooked?', 'Why might someone else make a different decision?'],
  endTitle: 'ECHO: BETWEEN TWO WORLDS',
  endLine: 'Different people. Different needs. Shared futures.',
} as const;

/** A card of control hints: one set of rows for each way of playing. */
export type Hints = Record<InputMode, readonly (readonly [key: string, text: string])[]>;

export const CONTROLS: Hints = {
  mouse: [['WASD', 'Walk'], ['MOUSE', 'Look around'], ['E', 'Use what you are looking at'], ['SPACE', 'Next line']],
  touch: [['LEFT', 'Left thumb: walk'], ['RIGHT', 'Right thumb: look around'], ['TAP', 'Use things, next line']],
  xr: [['L STICK', 'Walk'], ['R STICK', 'Turn'], ['TRIGGER', 'Use what you point at'], ['A', 'Next line']],
};

/** Every key, for the card the K key opens; elsewhere the same rows as the opening controls. */
export const KEYBINDS: Hints = {
  ...CONTROLS,
  mouse: [
    ['WASD', 'Walk'], ['MOUSE', 'Look around'], ['E', 'Use what you are looking at'], ['SPACE', 'Next line'],
    ['1 2 3', 'Pick an answer'], ['Q', 'Put the headset on or off'], ['P', 'Pause'], ['K', 'Hide these controls'],
  ],
};

export const ORB_CONTROLS: Hints = {
  mouse: [['HOLD', 'Hold the mouse button to draw back'], ['AIM', 'Aim above the ring, then let go']],
  touch: [['HOLD', 'Hold a finger on the right to draw back'], ['DRAG', 'Aim above the ring, then let go']],
  xr: [['TRIGGER', 'Hold to draw back: longer is further'], ['AIM', 'Point above the ring, then let go']],
};
