export const DEFAULT_SETTINGS = {
  channelName: 'Star Crew TV',
  star: { yearGroup: 'Y3', weeklyWords: [], todayWords: {} },
  little: { yearGroup: 'R', weeklyWords: [], todayWords: {} },
  directorVoiceId: null,
};

export function withDefaults(s = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    star: { ...DEFAULT_SETTINGS.star, ...(s.star || {}) },
    little: { ...DEFAULT_SETTINGS.little, ...(s.little || {}) },
  };
}
