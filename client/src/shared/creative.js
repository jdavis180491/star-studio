// The creative menu, shared by the Director (server), the live camera and the auto-edit.

export const MOODS = ['funny', 'dramatic', 'spooky', 'epic'];

export const MUSIC = [
  { id: 'pop', name: 'Pop', icon: '🎤' },
  { id: 'rock', name: 'Rock', icon: '🎸' },
  { id: 'orchestra', name: 'Movie', icon: '🎻' },
  { id: 'spooky', name: 'Spooky', icon: '🕸️' },
  { id: 'funky', name: 'Funky', icon: '🕺' },
  { id: 'chill', name: 'Chill', icon: '🌙' },
];

export const WEATHER = [
  { id: 'none', name: 'Clear', icon: '⛅' },
  { id: 'rain', name: 'Rain', icon: '🌧️' },
  { id: 'snow', name: 'Snow', icon: '❄️' },
  { id: 'storm', name: 'Storm', icon: '⛈️' },
  { id: 'sun', name: 'Sunshine', icon: '☀️' },
  { id: 'leaves', name: 'Leaves', icon: '🍂' },
  { id: 'confetti', name: 'Confetti', icon: '🎉' },
  { id: 'hearts', name: 'Hearts', icon: '💖' },
];

export const BACKDROPS = [
  { id: 'none', name: 'My room', icon: '🏠' },
  { id: 'space', name: 'Space', icon: '🪐' },
  { id: 'underwater', name: 'Under the sea', icon: '🐠' },
  { id: 'jungle', name: 'Jungle', icon: '🌴' },
  { id: 'city', name: 'City night', icon: '🌃' },
  { id: 'stage', name: 'Big stage', icon: '🎭' },
  { id: 'haunted', name: 'Haunted', icon: '🏚️' },
];

export const LOOKS = [
  { id: 'none', name: 'Normal', icon: '🙂' },
  { id: 'neon', name: 'Neon', icon: '💡' },
  { id: 'retro', name: 'Retro', icon: '📼' },
  { id: 'bw', name: 'Old movie', icon: '🎞️' },
  { id: 'comic', name: 'Comic', icon: '💥' },
  { id: 'spooky', name: 'Spooky', icon: '👻' },
  { id: 'sunset', name: 'Sunset', icon: '🌅' },
];

export const FRAMES = [
  { id: 'none', name: 'No frame', icon: '⬜' },
  { id: 'news', name: 'Breaking news', icon: '📰' },
  { id: 'live', name: 'Live', icon: '🔴' },
  { id: 'spotlight', name: 'Spotlight', icon: '🔦' },
  { id: 'pow', name: 'POW!', icon: '💥' },
];

export const STICKER_EMOJI = ['😎', '👑', '🎩', '🦄', '🔥', '⭐', '💥', '🍕', '🐸', '👻', '🤖', '🦖', '🎈', '🧦', '🚀', '🌈'];

// Effects the auto-edit can add at moments in the video.
export const EDIT_EFFECTS = ['flash', 'shake', 'zoom', 'glitch'];

export const ids = (list) => list.map((x) => x.id);
