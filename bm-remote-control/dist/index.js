import { registerPlugin } from '@capacitor/core';
const BmRemoteControl = registerPlugin('BmRemoteControl', {
    web: () => import('./web').then((m) => new m.BmRemoteControlWeb()),
});
export * from './definitions';
export { BmRemoteControl };
