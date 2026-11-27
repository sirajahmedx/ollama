import test from 'node:test';
import assert from 'node:assert/strict';
import { createMathExtensions, MATH_DELIMITERS } from '../public/math-markdown.js';

const [blockMath, inlineMath] = createMathExtensions((text) => text);
const equation = String.raw`\frac{1}{f} = \frac{1}{v} + \frac{1}{u}`;

test('inline LaTeX delimiters survive Markdown parsing', () => {
  const source = String.raw`\( ${equation} \)`;
  const token = inlineMath.tokenizer(source);

  assert.equal(token.raw, source);
  assert.equal(token.text, ` ${equation} `);
  assert.equal(token.displayMode, false);
  assert.equal(
    inlineMath.renderer(token),
    `<span class="math-source">${source}</span>`
  );
});

test('display LaTeX delimiters survive Markdown parsing', () => {
  const source = String.raw`\[
${equation}
\]
`;
  const token = blockMath.tokenizer(source);

  assert.equal(token.raw, source);
  assert.equal(token.text, `\n${equation}\n`);
  assert.equal(token.displayMode, true);
  assert.equal(
    blockMath.renderer(token),
    `<div class="math-source math-display">${source.trimEnd()}</div>\n`
  );
});

test('dollar-delimited inline and display math remain supported', () => {
  const inline = inlineMath.tokenizer('$x^2$');
  const display = blockMath.tokenizer('$$\nx^2\n$$\n');

  assert.equal(inline.text, 'x^2');
  assert.equal(inline.displayMode, false);
  assert.equal(display.text, '\nx^2\n');
  assert.equal(display.displayMode, true);
});

test('KaTeX receives single-backslash delimiters for inline and display math', () => {
  assert.deepEqual(MATH_DELIMITERS, [
    { left: '$$', right: '$$', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\[', right: '\\]', display: true },
    { left: '\\(', right: '\\)', display: false }
  ]);
});
