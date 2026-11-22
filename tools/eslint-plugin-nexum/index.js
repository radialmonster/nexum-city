// @ts-check
/** Local ESLint plugin for Nexum City's own rules. */
import noRawColors from './no-raw-colors.js';

const plugin = {
  meta: { name: 'eslint-plugin-nexum' },
  rules: { 'no-raw-colors': noRawColors },
};

export default plugin;
