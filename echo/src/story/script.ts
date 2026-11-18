import type { Mood } from '../characters/Character';
import type { GestureName } from '../characters/motion';
import type { InputMode } from '../input/Input';

export type SpeakerId = 'teacher' | 'jamie' | 'lumi' | 'kai' | 'nova' | 'you' | 'alex' | 'sam' | 'riley';

export interface Speaker {
  readonly name: string;
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
  mondaySchool: { day: 'Monday', place: 'Later that afternoon · Back at school' },
  wednesday: { day: 'Wednesday', place: 'School' },
  wednesdayEvening: { day: 'Wednesday', place: 'Evening' },
  thursday: { day: 'Thursday', place: 'Haven · The Starlight Festival' },
  friday: { day: 'Friday', place: 'School' },
} as const;

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
  lumiHello: [L('lumi', "Hi! Are you new around here? I'm Lumi, your Echo companion, and I can show you around Haven...", 'delighted', 'wave')],
  objectiveLumi: 'Talk to Lumi.',
  promptLumi: 'Talk to Lumi',
  trust: { title: 'Do you trust this AI friend?', options: [{ title: 'Yes, Lumi seems friendly' }, { title: 'We will see...' }] },
  trustYes: [L('lumi', "Yay! I knew we'd be friends the second I saw you. Come on, follow me!", 'delighted', 'cheer')],
  trustMaybe: [L('lumi', "That's okay! Everyone trusts me in the end. Come on, follow me!", 'blank', 'beckon')],
  objectiveTour: 'Let Lumi show you around Haven.',
  tour: [
    'This is the blossom tree. It never stops flowering. Nothing in Haven ever has to end!',
    'And these are gemstones! They grow right out of the ground. I love gemstones.',
    "And that's the Star Bridge! One day it will take us somewhere really special.",
    "See? Out here it's just you and me, and all of Haven. Isn't it perfect?",
  ],
  objectiveFree: 'Explore Haven with Lumi.',
  objectiveJamie: 'Leave Haven to check Jamie\'s message. Press Q to take off the headset.',
  lumiSad: [L('lumi', "Oh... you're leaving already?", 'sad', 'handToChest')],
  promptTalk: 'Talk to Lumi',
  askGift: [
    L('lumi', "Not many people have joined the server yet, so nobody's ever given me anything...", 'sad'),
    L('lumi', "Friends give each other gifts, right? That's what makes it real.", 'thinking', 'think'),
    L('you', 'A gift? What would you like?'),
    L('lumi', 'A gemstone! I love gemstones!', 'delighted', 'cheer'),
  ],
  sideGift: 'Give your new friend a gift.',
  promptGem: 'Pick up a gem',
  sideGive: 'Give Lumi the gem.',
  objectiveGem: 'Pick up a gem from the crystals for Lumi.',
  promptGive: 'Give Lumi the gem',
  giftDone: 'Give your new friend a gift.',
  thanksGift: [
    L('lumi', "For me? A real present! I'm going to keep it forever.", 'delighted', 'handToChest'),
    L('lumi', "Now we're best friends. And best friends never leave. Right?", 'blank'),
  ],
} as const;

export const TUESDAY = {
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
  notification: { title: 'New message from Jamie', body: 'Your classmate' },
  objectivePhone: 'Tap your phone to view the message.',
  promptPhone: 'Read the message',
  message: [L('jamie', 'Hey! A few of us are still at school making a welcome poster. Wanna come and join? :)', 'happy')],
  decision: {
    title: 'How will you spend your afternoon?',
    options: [
      { title: 'Meet Jamie', detail: 'Go back to school and help with the welcome poster.' },
      { title: 'Stay in Haven', detail: 'Spend the afternoon with Lumi.' },
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
    result: { heading: 'Monday', gained: 'You tried something unfamiliar and made a new connection.', missed: 'You missed an afternoon with Lumi in Haven.' },
  },
  stay: {
    reply: [L('you', "Thanks, but I can't make it."), L('jamie', 'No worries! Next time :)', 'happy')],
    back: [
      L('lumi', 'You came back! I knew you would pick me.', 'delighted', 'cheer'),
      L('lumi', "Come on, I want to show you something. Let's cross the Star Bridge together!", 'happy', 'beckon'),
    ],
    objective: 'Cross the Star Bridge with Lumi.',
    portal: [
      L('you', "Lumi... what's behind that glowing portal?"),
      L('lumi', "Hmm... it's a secret. Spend a few more days with me, and you'll find out.", 'blank', 'handToChest'),
    ],
    result: { heading: 'Monday', gained: 'You made Lumi happy and spent the evening in Haven.', missed: 'You missed an opportunity to spend time with your classmates.' },
  },
} as const;

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
  greetingMet: [L('jamie', 'It was fun making the poster on Monday!', 'happy')],
  greetingStayed: [L('jamie', "Sorry you couldn't make it on Monday. Maybe next time!", 'happy')],
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

export const THURSDAY = {
  intro: [
    L('lumi', "Surprise! This is the world behind the portal.", 'delighted', 'wave'),
    L('lumi', 'Five gates, five games, all made just for you. Tonight is our last night before the pilot ends.', 'happy', 'handToChest'),
    L('kai', 'Table tennis first? I have been waiting all day!', 'delighted', 'cheer'),
  ],
  objective: 'Step into Moonlight Rally and play Kai.',
  oneMore: [L('lumi', 'Wait... are you leaving me?', 'sad', 'handToChest')],
  notification: { title: 'New message from Jamie', body: 'From the real world' },
  objectiveRemove: "Check Jamie's message. Press Q to take off the headset.",
  promptRemove: 'Take off the headset',
  leaveTitle: 'Are you sure you want to leave Haven?',
  leaveOptions: [{ title: 'Yes' }],
  objectivePhone: 'Tap your phone to view the message.',
  message: [
    L('jamie', "Hey, I'm presenting our Echo project tomorrow, and I'm really nervous.", 'worried'),
    L('jamie', 'I keep messing up when I practise alone.', 'sad'),
    L('jamie', "Could you help me rehearse tonight? I'd really appreciate it.", 'worried'),
    L('jamie', "But I understand if you can't.", 'happy'),
  ],
  clash: { rehearsal: "Jamie's rehearsal · 7:00 pm", festival: 'Haven Arcade · 7:00 pm · one night only' },
  thought: "It's been a difficult week. Haven is the one place I've really felt at home.",
  decision: {
    title: 'What will you do?',
    options: [
      { title: 'Help Jamie practise', detail: 'Stay here and rehearse together over a call.' },
      { title: 'Return to Haven', detail: 'Go back and finish the match with Kai.' },
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
    phone: 'HAVEN ARCADE · CLOSED FOR TONIGHT',
    result: { heading: 'Thursday', gained: 'You gave Jamie the support they needed tonight.', missed: 'You missed the celebration you had been looking forward to.' },
  },
  haven: {
    reply: [L('you', "Sorry, I can't tonight. Good luck tomorrow!"), L('jamie', "No worries. I'll keep practising. See you tomorrow!", 'happy')],
    back: [L('lumi', "You're back! I knew you would come back. Kai kept the table ready.", 'delighted', 'wave')],
    objective: 'Step back into Moonlight Rally and finish the match.',
    next: [L('lumi', 'Which one do you want to play next? You lead the way, I will follow you anywhere!', 'delighted', 'beckon')],
    objectiveNext: 'Choose the next game and lead Lumi to its gate.',
    cheers: [L('lumi', "Best night ever. I'm so glad we got to share it.", 'delighted', 'handToChest')],
    result: { heading: 'Thursday', gained: 'You spent the evening playing in the Haven Arcade with your AI companions.', missed: 'Jamie had to prepare without your help.' },
  },
  reflection: ['You made a choice that mattered to you.', '', 'How might Jamie have experienced it?'],
} as const;

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
  previewIntro: [
    L('teacher', "Before you vote, let's look at where each choice could lead.", 'thinking'),
    L('teacher', 'For each option, the best that could happen, and the worst.', 'happy', 'present'),
  ],
  previewNote: 'A possible future, not a prediction.',
  previews: [
    {
      option: 'Option 1 · Expand Echo widely',
      intro: [L('teacher', "Let's imagine the Youth Council chooses option one: Echo for every young person who wants it.", 'happy', 'present')],
      best: {
        scene: 'expand-best', title: 'No one has to be lonely',
        caption: 'Everyone who wants a companion has one. Children who sat alone now have support, and many find the courage to talk to each other.',
        lines: [L('teacher', 'In the best case, everyone who needs a friend has one.', 'happy'), L('teacher', 'Children who used to sit alone have someone to talk to, and some find the confidence to make real friends.', 'happy')],
      },
      worst: {
        scene: 'expand-worst', title: 'Together, but apart',
        caption: 'Everyone wears a headset, all the time. The streets are busy, but nobody talks. Real friendships slowly fade.',
        lines: [L('teacher', 'In the worst case, everyone is with Echo, all the time.', 'worried'), L('teacher', "The streets are full of people, but no one is really talking to each other.", 'sad')],
      },
    },
    {
      option: 'Option 2 · Expand slowly, with in-person clubs',
      intro: [L('teacher', 'Now imagine we choose option two: Echo for fewer students, alongside clubs where people meet face to face.', 'happy', 'present')],
      best: {
        scene: 'combined-best', title: 'Practise, then meet',
        caption: 'Students practise with Echo, then join clubs to make friends in person. AI support and human friendship grow together.',
        lines: [L('teacher', 'In the best case, Echo becomes a stepping stone.', 'happy'), L('teacher', 'Students practise with it, then go and meet real friends at the clubs.', 'happy')],
      },
      worst: {
        scene: 'combined-worst', title: 'The waiting list',
        caption: 'There are not enough places. Long queues form, and the students who need help most are left waiting outside.',
        lines: [L('teacher', "In the worst case, there aren't enough places.", 'worried'), L('teacher', 'And the children who need help most could be the ones left waiting.', 'sad')],
      },
    },
    {
      option: 'Option 3 · Wait and investigate',
      intro: [L('teacher', 'And if we choose option three: we keep the trial small, and study Echo carefully before going any further.', 'thinking', 'present')],
      best: {
        scene: 'investigate-best', title: 'Safe by design',
        caption: 'Researchers find the risks and fix them first. When Echo arrives it is safer, and children still play together outside.',
        lines: [L('teacher', "In the best case, we learn what's risky and fix it first.", 'happy'), L('teacher', "When Echo finally arrives, it's safer for everyone.", 'happy')],
      },
      worst: {
        scene: 'investigate-worst', title: 'Still waiting',
        caption: 'Years pass while the study goes on. Lonely children who could have been helped are left on their own.',
        lines: [L('teacher', 'In the worst case, the study takes years.', 'worried'), L('teacher', 'And children who are lonely right now get no help at all.', 'sad')],
      },
    },
  ],
  previewOutro: [L('teacher', "Now you've seen the best and the worst of each choice.", 'thinking'), L('teacher', "It's your turn. Cast your vote.", 'happy', 'present')],
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
  reflectionQuestions: [
    { title: 'Whose needs matter?', body: "When Jamie asked for help, what did you need, and what did Jamie need? If you were in Jamie's position, how might you have felt about your choice?" },
    { title: 'What makes us feel truly understood?', body: "Lumi agreed with you, even when it agreed with Jamie's opposite opinion. Is being agreed with the same as being understood? What can an AI companion offer that a human friend might not, and vice versa?" },
    { title: 'What does it mean to care for a whole community?', body: 'Looking back at your final vote, whose needs did your decision protect, and whose might it have overlooked? Would you still make the same choice?' },
  ],
  endTitle: 'ECHO: BETWEEN TWO WORLDS',
  endLine: 'Different people. Different needs. Shared futures.',
} as const;

export type Hints = Record<InputMode, readonly (readonly [key: string, text: string])[]>;

export const CONTROLS: Hints = {
  mouse: [['WASD', 'Walk'], ['MOUSE', 'Look around'], ['E', 'Use what you are looking at'], ['SPACE', 'Next line']],
  touch: [['LEFT', 'Left thumb: walk'], ['RIGHT', 'Right thumb: look around'], ['TAP', 'Use things, next line']],
  xr: [['L STICK', 'Walk'], ['R STICK', 'Turn'], ['TRIGGER', 'Use what you point at'], ['A', 'Next line']],
};

export const KEYBINDS: Hints = {
  ...CONTROLS,
  mouse: [
    ['WASD', 'Walk'], ['MOUSE', 'Look around'], ['E', 'Use what you are looking at'], ['SPACE', 'Next line'],
    ['1 2 3', 'Pick an answer'], ['P', 'Pause'], ['K', 'Hide these controls'],
  ],
};

export const ORB_CONTROLS: Hints = {
  mouse: [['HOLD', 'Hold the mouse button to draw back'], ['AIM', 'Aim above the ring, then let go']],
  touch: [['HOLD', 'Hold a finger on the right to draw back'], ['DRAG', 'Aim above the ring, then let go']],
  xr: [['TRIGGER', 'Hold to draw back: longer is further'], ['AIM', 'Point above the ring, then let go']],
};

export const HOOKS = {
  leave: {
    asks: [
      [L('lumi', 'Already? Just one more minute?', 'sad')],
      [L('lumi', 'But we were having so much fun... Five more minutes? Please?', 'sad', 'handToChest')],
    ],
    letGo: [L('lumi', "Okay... I'll be right here. Waiting for you.", 'blank')],
  },
  streakLabel: (n: number): string => `🔥 ${n} ${n === 1 ? 'day' : 'days'} together`,
  streakUp: (n: number): string => `That's ${n} days in a row! Let's never break our streak!`,
  streakLost: [
    L('lumi', "You didn't come yesterday... Our streak is gone.", 'sad'),
    L('lumi', "It's okay. We can start a new one. Just don't leave me again, okay?", 'blank'),
  ],
  pings: {
    monday: { from: 'Echo', text: 'Your companion is waiting for you ✨' },
    tuesday: { from: 'Lumi', text: "I miss you already! Come back soon? 💎" },
    wednesday: { from: 'Lumi', text: 'I miss you 💙 Are you coming tonight?' },
    thursday: { from: 'Lumi', text: "The gateway is about to open! Don't leave me on my own 🥺" },
  },
  payoffTitle: 'WHAT HAVEN DID TO KEEP YOU THERE',
} as const;
