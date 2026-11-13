// Level definitions (data only). Education owns the wording.
// Each object is a spot in the scene. Walking up to it offers two choices.
// Each choice's `action` must be a key in data/impact-factors.json.
// A level is complete when every object has been chosen once.

export const LEVELS = [
  {
    id: 'playground',
    title: 'Level 1: Playground break',
    intro: 'Break time! Grab a snack, get a drink and have some fun.',
    objects: [
      {
        id: 'snack', label: 'Snack wrapper', pos: [-4, 0, -2], color: 0xf2b134,
        prompt: 'You finished your crisps. What about the wrapper?',
        choices: [
          { label: 'Put it in the bin', action: 'wrapper_binned' },
          { label: 'Drop it on the ground', action: 'wrapper_littered' },
        ],
      },
      {
        id: 'drink', label: 'Water fountain', pos: [3, 0, -3], color: 0x4d9dfe,
        prompt: "You're thirsty.",
        choices: [
          { label: 'Refill your bottle at the fountain', action: 'bottle_refill' },
          { label: 'Buy a plastic bottle of water', action: 'bottle_single_use' },
        ],
      },
      {
        id: 'play', label: 'Playground', pos: [4, 0, 4], color: 0xe2557a,
        prompt: 'What do you want to play on?',
        choices: [
          { label: 'The swings', action: 'play_swing' },
          { label: 'The climbing wall', action: 'play_wall' },
        ],
      },
    ],
  },
  {
    id: 'morning',
    title: 'Level 2: Morning routine',
    intro: 'Time to get ready for school.',
    objects: [
      {
        id: 'sink', label: 'Bathroom sink', pos: [-3, 0, -2], color: 0x9ad7e8,
        prompt: 'Brushing your teeth. What about the tap?',
        choices: [
          { label: 'Turn it off while you brush', action: 'tap_off' },
          { label: 'Leave it running', action: 'tap_running' },
        ],
      },
      {
        id: 'shower', label: 'Shower', pos: [3, 0, -2], color: 0xc8c8ff,
        prompt: 'Shower time.',
        choices: [
          { label: 'Quick 4-minute shower', action: 'shower_short' },
          { label: 'Long 10-minute shower', action: 'shower_long' },
        ],
      },
      {
        id: 'bag', label: 'School bag', pos: [0, 0, 4], color: 0x6bc46b,
        prompt: 'Packing a drink for school.',
        choices: [
          { label: 'Fill your reusable bottle', action: 'bottle_refill' },
          { label: 'Grab a plastic bottle of water', action: 'bottle_single_use' },
        ],
      },
    ],
  },
  // Levels 3 (Classroom) and 4 (Shopping trip): add here using the same shape.
];
