import { registerPlugin } from '@capacitor/core';
import type { BmRemoteControlPlugin } from './definitions';

const BmRemoteControl = registerPlugin<BmRemoteControlPlugin>('BmRemoteControl', {
  web: () => import('./web').then((m) => new m.BmRemoteControlWeb()),
});

export * from './definitions';
export { BmRemoteControl };
