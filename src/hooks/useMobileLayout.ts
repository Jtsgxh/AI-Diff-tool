import { useSyncExternalStore } from 'react';

// Keep the phone layout when a touch device rotates into landscape.
const query = '(max-width: 767px), (max-width: 1023px) and (max-height: 500px) and (pointer: coarse)';
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};

/** Presentation only: never overwrites the user's desktop layout preferences. */
export function useMobileLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

const landscapeQuery = '(max-width: 1023px) and (max-height: 500px) and (orientation: landscape) and (pointer: coarse)';
const subscribeLandscape = (notify: () => void) => {
  const media = window.matchMedia(landscapeQuery);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};

export function usePhoneLandscape() {
  return useSyncExternalStore(subscribeLandscape, () => window.matchMedia(landscapeQuery).matches, () => false);
}
