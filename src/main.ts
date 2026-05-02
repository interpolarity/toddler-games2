import { Engine } from './engine';
import { ExcavatorScene } from './scenes/excavator';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');

const engine = new Engine(root);
engine.setScene(new ExcavatorScene());
engine.start();
