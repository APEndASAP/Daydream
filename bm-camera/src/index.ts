import { registerPlugin } from '@capacitor/core';
import type { BmCameraPlugin } from './definitions';

const BmCamera = registerPlugin<BmCameraPlugin>('BmCamera', {
  web: () => import('./web').then((m) => new m.BmCameraWeb()),
});

export * from './definitions';
export { BmCamera };
