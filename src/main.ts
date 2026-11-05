import { Application } from 'pixi.js';

const app = new Application();
await app.init({ resizeTo: window, background: '#1b1d21' });
document.getElementById('app')!.appendChild(app.canvas);
