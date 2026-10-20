import { registerPlugin } from '@capacitor/core';
import type { BmBackgroundPlugin } from './definitions';

const BmBackground = registerPlugin<BmBackgroundPlugin>('BmBackground', {
  web: () => import('./web').then((m) => new m.BmBackgroundWeb()),
});

export * from './definitions';
export { BmBackground };
