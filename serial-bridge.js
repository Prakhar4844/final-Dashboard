// ES Module loader for ORBITRA Standalone Serial Bridge
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('./serial-bridge.cjs');
