import { Engine } from './engine';
import { ExcavatorScene } from './scenes/excavator';
import { MenuScene } from './scenes/menu';
import { PizzaScene } from './scenes/pizza';
import type { SceneNavigator, SceneId } from './types';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing');

const engine = new Engine(root);

const nav: SceneNavigator = {
  go(scene: SceneId) {
    switch (scene) {
      case 'menu':       engine.setScene(new MenuScene(nav)); break;
      case 'excavator':  engine.setScene(new ExcavatorScene(nav)); break;
      case 'pizza':      engine.setScene(new PizzaScene(nav)); break;
      case 'burger':     /* coming soon */ engine.setScene(new MenuScene(nav)); break;
    }
  },
};

nav.go('menu');
engine.start();
