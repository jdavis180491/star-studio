// Phase 1: hard-coded test briefs. From Phase 2 these come from Claude + parent keywords.
// `chunks` optionally overrides the automatic phonics chunker for tricky words.

export const sampleBriefs = [
  {
    id: 'sock-monster',
    title: 'The Sock Monster',
    emoji: '🧦',
    ageGroup: 'star', // age 8 track
    text:
      'Breaking news! A sneaky monster has stolen every left sock in your house. ' +
      'You must whisper a secret plan to catch it, because monsters have super ears. ' +
      'Show us your best sneaky tiptoe. Then shout your big monster move!',
    keywords: ['monster', 'whisper', 'because'],
    chunks: {
      because: ['be', 'cause'],
      whisper: ['whis', 'per'],
      monster: ['mon', 'ster'],
    },
  },
  {
    id: 'robot-chef',
    title: 'Robot Chef',
    emoji: '🤖',
    ageGroup: 'star',
    text:
      'You are a robot chef on your very first day. ' +
      'Your job is to make the silliest breakfast in the world. ' +
      'Oh no, something goes wrong and it turns into a total disaster! ' +
      'Show us how a robot panics, then fix it with a dance.',
    keywords: ['robot', 'breakfast', 'disaster'],
    chunks: {
      robot: ['ro', 'bot'],
      breakfast: ['break', 'fast'],
      disaster: ['dis', 'as', 'ter'],
    },
  },
  {
    id: 'gravity-switch',
    title: 'Gravity Switch',
    emoji: '🪐',
    ageGroup: 'star',
    text:
      'Suddenly, gravity switches off in your bedroom! ' +
      'Your teddy, your toys and even your snacks start to float away. ' +
      'Show us how you swim through the air to grab them. ' +
      'Then gravity comes back on. What happens next?',
    keywords: ['gravity', 'float', 'suddenly'],
    chunks: {
      gravity: ['grav', 'i', 'ty'],
      suddenly: ['sud', 'den', 'ly'],
      float: ['fl', 'oat'],
    },
  },
  {
    id: 'big-bug',
    title: 'The Big Bug',
    emoji: '🐛',
    ageGroup: 'little', // Little Stars (age 5) preview
    text: 'A big bug is on my hat! Can you hop like a bug?',
    keywords: ['bug'],
    chunks: {
      bug: ['b', 'ug'],
    },
  },
];
