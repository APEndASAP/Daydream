import { registerPlugin } from '@capacitor/core';
const BmBackground = registerPlugin('BmBackground', {
    web: () => import('./web').then((m) => new m.BmBackgroundWeb()),
});
export * from './definitions';
export { BmBackground };
