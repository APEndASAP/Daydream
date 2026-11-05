import { registerPlugin } from '@capacitor/core';
import type { BmMusicFloatPlugin } from './definitions';

const BmMusicFloat = registerPlugin<BmMusicFloatPlugin>('BmMusicFloat', {
  web: () => import('./web').then((m) => new m.BmMusicFloatWeb()),
});

export * from './definitions';
export { BmMusicFloat };
