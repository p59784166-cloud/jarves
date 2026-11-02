import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
const src = fs.readFileSync(path.resolve('frontend/scripts/ui.js'), 'utf8');
const w = {}; vm.runInNewContext(src, { window: w, document: {}, String });
const md = w.renderMarkdown;

test('markdown: ** e ` dentro de bloco de codigo ficam literais', () => {
  const out = md('antes **negrito**\n```python\ndef f(**kwargs): return `x`\n```\ndepois `ok`');
  assert.match(out, /<strong>negrito<\/strong>/);
  assert.match(out, /<pre class="code-block"><code>def f\(\*\*kwargs\): return `x`<\/code><\/pre>/);
  assert.match(out, /<code class="inline-code">ok<\/code>/);
});
test('markdown: HTML do modelo e escapado (sem XSS)', () => {
  assert.ok(!md('<img src=x onerror=alert(1)>').includes('<img'));
  assert.ok(!md('```\n<script>alert(1)</script>\n```').includes('<script'));
});
test('markdown: bloco sem quebra de linha apos ``` tambem funciona', () => {
  assert.match(md('```js const a=1```'), /<pre class="code-block">/);
});
