// ES Module loader for ORBITRA Ground Station Server
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('./server.cjs');
