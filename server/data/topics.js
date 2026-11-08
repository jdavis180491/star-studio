// Writing prompts. {to} is replaced with who they're writing to.
export const TOPICS = [
  'Tell {to} about the morning your shoes started talking.',
  'Write to {to} about the day it rained jelly.',
  'Tell {to} about a secret door you found behind the sofa.',
  'Write to {to} about your pet dragon’s first day at school.',
  'Tell {to} what happened when the fridge ran away.',
  'Write to {to} about a holiday on a planet made of cheese.',
  'Tell {to} about the night your teddy came to life.',
  'Write to {to} about a robot who only speaks in songs.',
  'Tell {to} how you became the king or queen of the playground for one day.',
  'Write to {to} about a treasure map you found in a cereal box.',
  'Tell {to} about the cat who became a detective.',
  'Write to {to} about the biggest sandcastle in the world.',
  'Tell {to} about a time machine hidden in the garden shed.',
  'Write to {to} about a monster who is scared of the dark.',
  'Tell {to} what you would do with a magic paintbrush.',
  'Write to {to} about the day gravity switched off.',
  'Tell {to} about the alien who landed in the park.',
  'Write to {to} about a pizza that could fly.',
  'Tell {to} about your adventure inside a giant’s pocket.',
  'Write to {to} about the dog who won the Olympics.',
  'Tell {to} about the day everyone swapped bodies with their pets.',
  'Write to {to} about a tree house that floats in the sky.',
  'Tell {to} about the snowman who wanted to go on holiday.',
  'Write to {to} about a superpower you woke up with today.',
  'Tell {to} about a pirate ship that sailed down your street.',
  'Write to {to} about a shop that sells bottled giggles.',
  'Tell {to} about the penguin who moved into your bathtub.',
  'Write to {to} about a race between a snail and a rocket.',
  'Tell {to} about a sock that went on a big adventure.',
  'Write to {to} about the best birthday party ever (even if it hasn’t happened yet).',
];

export function pickTopic(to, exclude = '') {
  const pool = TOPICS.filter((t) => !exclude || !exclude.includes(t.slice(0, 20)));
  const t = pool[Math.floor(Math.random() * pool.length)];
  return t.replace('{to}', to);
}
