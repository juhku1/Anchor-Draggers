/**
 * Application entry point
 * Coordinates map initialization and feature modules
 */

import { initMap } from './map.js';
import { initVessels } from './vessel.js';
import { initBuoys } from './buoy.js';

// Initialize application when DOM and map are ready
const map = initMap();

map.on('load', async () => {
  // Initialize vessel tracking system
  await initVessels(map);
  
  // Initialize wave buoy monitoring
  await initBuoys(map);
});
