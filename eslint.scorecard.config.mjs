import { config } from './eslint.config.mjs';

// The directory scanner does not install devDependencies, so Node's types are missing there.
// This pass checks without them, so every unsafe use shows up locally as well.
export default config('./tsconfig.scorecard.json');
