// @ts-check
/**
 * nexum/no-raw-colors: owner rule #1, "no hard-coded styles".
 *
 * Outside packages/theme, colours and font sizes must come from theme tokens
 * (`cssVar('color.accent')` for the HUD, `toPixiPalette(theme)` for the map).
 * This rule reports:
 *   - string and template literals containing a hex colour (#rgb, #rgba,
 *     #rrggbb, #rrggbbaa) or a colour function (rgb(), rgba(), hsl(), hsla(),
 *     hwb(), lab(), lch(), oklab(), oklch());
 *   - hex number literals with 6 or 8 digits (0x19f0ff), the PixiJS colour form;
 *   - a `fontSize` / `font-size` property set to a number or a px string.
 *
 * A genuine non-colour (a bitmask, say) can opt out with
 * `// eslint-disable-next-line nexum/no-raw-colors -- reason`.
 */

const HEX_COLOR = /(?:^|[^&\w])(#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4}))(?![\w-])/i;
const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/i;
const HEX_NUMBER = /^0x(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const PX_VALUE = /^\s*-?\d*\.?\d+px\s*$/i;

/** @param {string} text */
function findColor(text) {
  const hex = HEX_COLOR.exec(text);
  if (hex?.[1]) return hex[1];
  const fn = COLOR_FN.exec(text);
  if (fn) return fn[0].replace(/\s+/g, '');
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw colour literals and px font sizes outside packages/theme; use theme tokens.',
    },
    schema: [],
    messages: {
      rawColor:
        'Raw colour "{{value}}". Use a theme token: cssVar(\'color.…\') in the HUD, toPixiPalette(theme) on the map.',
      rawHexNumber:
        'Raw colour number {{value}}. Read map colours from toPixiPalette(theme) instead.',
      rawFontSize: "Raw font size {{value}}. Use a type-scale token: cssVar('fontSize.…').",
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          const found = findColor(node.value);
          if (found) context.report({ node, messageId: 'rawColor', data: { value: found } });
        } else if (
          typeof node.value === 'number' &&
          'raw' in node &&
          typeof node.raw === 'string'
        ) {
          if (HEX_NUMBER.test(node.raw)) {
            context.report({ node, messageId: 'rawHexNumber', data: { value: node.raw } });
          }
        }
      },
      TemplateElement(node) {
        const found = findColor(node.value.cooked ?? node.value.raw);
        if (found) context.report({ node, messageId: 'rawColor', data: { value: found } });
      },
      Property(node) {
        const key = node.key;
        const name =
          key.type === 'Identifier' ? key.name : key.type === 'Literal' ? String(key.value) : null;
        if (name !== 'fontSize' && name !== 'font-size') return;
        const value = node.value;
        if (value.type !== 'Literal') return;
        if (
          typeof value.value === 'number' ||
          (typeof value.value === 'string' && PX_VALUE.test(value.value))
        ) {
          context.report({
            node: value,
            messageId: 'rawFontSize',
            data: { value: String(value.raw) },
          });
        }
      },
    };
  },
};

export default rule;
