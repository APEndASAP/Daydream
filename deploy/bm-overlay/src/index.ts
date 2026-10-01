import { registerPlugin } from '@capacitor/core';
import type { BmOverlayPlugin } from './definitions';

const BmOverlay = registerPlugin<BmOverlayPlugin>('BmOverlay', {
  web: () => import('./web').then((m) => new m.BmOverlayWeb()),
});

export * from './definitions';
export { BmOverlay };
