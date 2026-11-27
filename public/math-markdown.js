export const MATH_DELIMITERS = [
  { left: '$$', right: '$$', display: true },
  { left: '$', right: '$', display: false },
  { left: '\\[', right: '\\]', display: true },
  { left: '\\(', right: '\\)', display: false }
];

export function createMathExtensions(escapeHtml) {
  const mathInlineExtension = {
    name: 'mathInline',
    level: 'inline',
    start(src) {
      const index = src.search(/\$|\\\(|\\\[/);
      return index === -1 ? undefined : index;
    },
    tokenizer(src) {
      const patterns = [
        { pattern: /^\$\$((?:\\.|[^$])+?)\$\$/, open: '$$', close: '$$', display: true },
        { pattern: /^\\\[([\s\S]+?)\\\]/, open: '\\[', close: '\\]', display: true },
        { pattern: /^\\\(([\s\S]+?)\\\)/, open: '\\(', close: '\\)', display: false },
        { pattern: /^\$((?:\\.|[^$])+?)\$/, open: '$', close: '$', display: false }
      ];

      for (const { pattern, open, close, display } of patterns) {
        const match = pattern.exec(src);
        if (match) {
          return {
            type: 'mathInline',
            raw: match[0],
            text: match[1],
            delimiterOpen: open,
            delimiterClose: close,
            displayMode: display
          };
        }
      }
    },
    renderer(token) {
      const source = token.delimiterOpen + token.text + token.delimiterClose;
      return `<span class="math-source">${escapeHtml(source)}</span>`;
    }
  };

  const mathBlockExtension = {
    name: 'mathBlock',
    level: 'block',
    start(src) {
      const index = src.search(/^\$\$|^\\\[/m);
      return index >= 0 ? index : undefined;
    },
    tokenizer(src) {
      const patterns = [
        { pattern: /^\$\$([\s\S]+?)\$\$(?:\n+|$)/, open: '$$', close: '$$' },
        { pattern: /^\\\[([\s\S]+?)\\\](?:\n+|$)/, open: '\\[', close: '\\]' }
      ];

      for (const { pattern, open, close } of patterns) {
        const match = pattern.exec(src);
        if (match) {
          return {
            type: 'mathBlock',
            raw: match[0],
            text: match[1],
            delimiterOpen: open,
            delimiterClose: close,
            displayMode: true
          };
        }
      }
    },
    renderer(token) {
      const source = token.delimiterOpen + token.text + token.delimiterClose;
      return `<div class="math-source math-display">${escapeHtml(source)}</div>\n`;
    }
  };

  return [mathBlockExtension, mathInlineExtension];
}
