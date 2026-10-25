const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const cue = (id, start, end, text = '字幕 text') => `${id}\n${C.formatTime(start)} --> ${C.formatTime(end)}\n${text}\n`;
const file = (...blocks) => blocks.join('\n');
const has = (r, code) => r.issues.some(i => i.code === code);
test('UTF-8 and BOM UTF-16 LE/BE decode losslessly', () => {
  const text = '中文字幕 🌟\nEnglish';
  const cases = [
    [Buffer.from(text, 'utf8'), 'utf-8'],
    [Buffer.concat([Buffer.from([239,187,191]), Buffer.from(text)]), 'utf-8'],
    [Buffer.concat([Buffer.from([255,254]), Buffer.from(text, 'utf16le')]), 'utf-16le'],
    [Buffer.concat([Buffer.from([254,255]), Buffer.from(text, 'utf16le').swap16()]), 'utf-16be']
  ];
  for (const [bytes, encoding] of cases) assert.deepEqual(C.decodeSrtBytes(bytes), {text, encoding});
});
test('invalid encoding, NUL and oversized bytes fail explicitly', () => {
  for (const bytes of [Buffer.from([255,255,128]), Buffer.from([255,254,65]), Buffer.from([65,0,66,0])]) {
    assert.throws(() => C.decodeSrtBytes(bytes), Error);
  }
  assert.throws(() => C.decodeSrtBytes(new Uint8Array(2 * 1024 * 1024 + 1)), RangeError);
});

test('translated text may differ completely while all timings remain intact', () => {
  const r = C.analyze(C.examples.source, C.examples.good);
  assert.equal(r.summary.matched, 4);
  assert.equal(r.summary.errors, 0);
  assert.equal(r.summary.warnings, 0);
});
test('problem demo reports deletion, altered interval and an empty translation', () => {
  const r = C.analyze(C.examples.source, C.examples.bad);
  assert.equal(r.summary.sourceCues, 4);
  assert.equal(r.summary.targetCues, 3);
  assert.equal(r.summary.matched, 2);
  assert.equal(r.summary.unmatchedSource, 2);
  assert.equal(r.summary.unmatchedTarget, 1);
  assert(has(r, 'EMPTY_TEXT'));
  assert.equal(r.issues.find(i => i.code === 'EMPTY_TEXT').sourceCue.id, '4');
});
test('deletion followed by renumbering does not cascade into wrong matches', () => {
  const source = file(cue(1, 0, 1000), cue(2, 2000, 3000), cue(3, 4000, 5000));
  const target = file(cue(1, 0, 1000, '翻译一'), cue(2, 4000, 5000, '翻译三'));
  const r = C.analyze(source, target);
  assert.deepEqual(r.pairs.map(p => [p.sourceCue.id, p.targetCue.id]), [['1', '1'], ['3', '2']]);
  assert.equal(r.summary.unmatchedSource, 1);
  assert.equal(r.summary.unmatchedTarget, 0);
  assert.equal(r.issues.find(i => i.code === 'UNMATCHED_SOURCE').sourceCue.id, '2');
  assert(has(r, 'RENUMBERED'));
});
test('equal cue counts cannot hide an altered time interval', () => {
  const r = C.analyze(cue(1, 0, 1000), cue(1, 5000, 6000));
  assert.equal(r.summary.matched, 0);
  assert.equal(r.summary.unmatchedSource, 1);
  assert.equal(r.summary.unmatchedTarget, 1);
});
test('deliberate splitting is a review difference, not a translation failure', () => {
  const r = C.analyze(cue(1, 0, 4000), file(cue(1, 0, 2000), cue(2, 2000, 4000)));
  assert.equal(r.summary.errors, 0);
  assert.equal(r.summary.unmatchedSource, 1);
  assert.equal(r.summary.unmatchedTarget, 2);
  assert(r.issues.every(i => i.message.includes('可能')));
});
test('default tolerance is exact; opted-in tolerance reports the timing change', () => {
  const source = cue(1, 1000, 2000), target = cue(1, 1050, 1950);
  assert.equal(C.analyze(source, target).summary.matched, 0);
  const r = C.analyze(source, target, {toleranceMs: 50});
  assert.equal(r.summary.toleranceMatches, 1);
  assert(has(r, 'TIME_WITHIN_TOLERANCE'));
  assert.equal(C.analyze(source, target, {toleranceMs: 49}).summary.matched, 0);
});
test('both endpoints must satisfy tolerance', () => {
  assert.equal(C.analyze(cue(1, 1000, 2000), cue(1, 1010, 2200), {toleranceMs: 50}).summary.matched, 0);
});
test('multiple tolerance candidates stay ambiguous and are not guessed', () => {
  const r = C.analyze(cue(1, 1000, 2000), file(cue(1, 990, 1990), cue(2, 1010, 2010)), {toleranceMs: 50});
  assert.equal(r.summary.matched, 0);
  assert.equal(r.summary.ambiguousSource, 1);
  assert.equal(r.summary.ambiguousTarget, 2);
  assert.equal(r.summary.unmatchedTarget, 0);
});
test('two sources competing for one target cannot both be matched', () => {
  const r = C.analyze(file(cue(1, 990, 1990), cue(2, 1010, 2010)), cue(1, 1000, 2000), {toleranceMs: 50});
  assert.equal(r.summary.matched, 0);
  assert.equal(r.summary.ambiguousSource, 2);
  assert.equal(r.summary.ambiguousTarget, 1);
});
test('duplicate intervals are flagged instead of silently pairing by order', () => {
  const source = file(cue(1, 0, 1000), cue(2, 0, 1000));
  const r = C.analyze(source, cue(1, 0, 1000));
  assert(has(r, 'AMBIGUOUS_MATCH'));
  assert(has(r, 'DUPLICATE_INTERVAL'));
  assert.equal(r.summary.matched, 0);
  assert.equal(r.summary.ambiguousSource, 2);
});
test('repeated sequence numbers do not replace time-based matching', () => {
  const source = file(cue(1, 0, 1000), cue(1, 2000, 3000));
  const r = C.analyze(source, file(cue(1, 0, 1000), cue(2, 2000, 3000)));
  assert.equal(r.summary.matched, 2);
  assert(has(r, 'DUPLICATE_ID'));
});
test('invalid minutes, seconds and timing garbage are errors, not discarded success', () => {
  for (const time of ['00:60:00,000', '00:00:60,000', '-00:00:01,000', 'nonsense']) {
    const r = C.analyze(`1\n${time} --> 00:00:02,000\ntext`, cue(1, 0, 1000));
    assert(has(r, 'BAD_TIME_FORMAT'));
    assert(r.summary.errors > 0);
  }
});
test('zero or negative durations never enter matching', () => {
  for (const end of [0, 999]) {
    const r = C.analyze(cue(1, 1000, end), cue(1, 1000, end));
    assert.equal(r.summary.matched, 0);
    assert(has(r, 'INVALID_DURATION'));
  }
});
test('missing separators are rejected, preserving the affected line number', () => {
  const source = cue(1, 0, 1000) + cue(2, 2000, 3000);
  const r = C.analyze(source, file(cue(1, 0, 1000), cue(2, 2000, 3000)));
  assert(has(r, 'MISSING_SEPARATOR'));
  assert.equal(r.source.issues[0].sourceLine, 2);
});
test('a malformed second time row without a separator cannot hide inside the first cue', () => {
  const source = '1\n00:00:00,000 --> 00:00:01,000\nFirst\n2\n00:00:02 --> 00:00:03\nSecond';
  const r = C.analyze(source, cue(1, 0, 1000, '第一段'));
  assert(has(r, 'MISSING_SEPARATOR'));
  assert(r.summary.errors > 0);
});
test('missing cue IDs are recoverable but explicitly reported', () => {
  const r = C.analyze('00:00:00,000 --> 00:00:01,000\nhello', cue(1, 0, 1000));
  assert.equal(r.summary.matched, 1);
  assert(has(r, 'MISSING_ID'));
});
test('BOM, CRLF and multi-line CJK subtitles preserve content and line references', () => {
  const source = '\uFEFF' + file(cue(1, 0, 1000, '你好\nHello'), cue(2, 2000, 3000, '第二段')).replace(/\n/g, '\r\n');
  const r = C.analyze(source, file(cue(1, 0, 1000, 'Bonjour'), cue(2, 2000, 3000, 'Deux')));
  assert.equal(r.summary.matched, 2);
  assert.equal(r.source.cues[0].text, '你好\nHello');
  assert.equal(r.source.cues[1].line, 7);
});
test('empty body and markup-only body are errors', () => {
  for (const body of ['', '<i></i>', '   ']) assert(has(C.analyze(cue(1, 0, 1000), cue(1, 0, 1000, body)), 'EMPTY_TEXT'));
});
test('intentional overlap and out-of-order intervals remain review warnings', () => {
  const source = file(cue(1, 2000, 4000), cue(2, 1000, 3000));
  const r = C.analyze(source, source);
  assert.equal(r.summary.matched, 2);
  assert.equal(r.summary.errors, 0);
  assert(has(r, 'OVERLAP')); assert(has(r, 'OUT_OF_ORDER'));
});
test('HTML-looking subtitle text remains literal content', () => {
  const text = '<img src=x onerror=alert(1)>\n<script>alert(2)</script>';
  const r = C.analyze(cue(1, 0, 1000, text), cue(1, 0, 1000, text));
  assert.equal(r.source.cues[0].text, text);
  assert.equal(r.summary.errors, 0);
});
test('large incomplete markup remains literal and finishes within a practical bound', {timeout: 2000}, () => {
  for (const text of ['<font '.repeat(100000), '<font ' + ' '.repeat(500000)]) {
    const r = C.analyze(cue(1, 0, 1000, text), cue(1, 0, 1000, '译文'));
    assert.equal(r.source.cues[0].text, text);
    assert.equal(r.summary.errors, 0);
  }
});
test('wrong formats, empty files and NUL text do not report a clean result', () => {
  for (const [text, code] of [['', 'EMPTY_FILE'], ['WEBVTT\n', 'UNSUPPORTED_FORMAT'], ['abc\0', 'INVALID_ENCODING']]) {
    const r = C.analyze(text, C.examples.good); assert(has(r, code)); assert(r.summary.errors > 0);
  }
});
test('dot milliseconds are compatible with explicit format information', () => {
  const text = cue(1, 0, 1000).replaceAll(',', '.');
  const r = C.analyze(text, cue(1, 0, 1000));
  assert.equal(r.summary.matched, 1); assert(has(r, 'DOT_MILLISECONDS'));
});
test('unreasonably large timestamps remain errors', () => {
  const r = C.analyze('1\n99999999999999999:00:00,000 --> 99999999999999999:00:01,000\ntext', cue(1, 0, 1000));
  assert(has(r, 'INVALID_DURATION')); assert.equal(r.summary.matched, 0);
});
test('bounded input and invalid options fail visibly', () => {
  assert.throws(() => C.analyze('x'.repeat(2 * 1024 * 1024 + 1), ''), RangeError);
  assert.throws(() => C.analyze(null, ''), TypeError);
  for (const t of [-1, 0.5, 1001, '50']) assert.throws(() => C.analyze('', '', {toleranceMs: t}), RangeError);
  assert.throws(() => C.analyze(Array.from({length: 10001}, (_, i) => cue(i + 1, i * 2000, i * 2000 + 1000)).join('\n'), ''), RangeError);
});
test('ten thousand aligned cues are handled without pair loss', () => {
  const text = Array.from({length: 10000}, (_, i) => cue(i + 1, i * 2000, i * 2000 + 1000)).join('\n');
  const r = C.analyze(text, text); assert.equal(r.summary.matched, 10000); assert.equal(r.summary.errors, 0);
});
test('dense tolerance input aborts visibly instead of calling unexamined cues missing', () => {
  const a = [], b = [];
  for (let i = 0; i < 1100; i++) { a.push(cue(i + 1, 1000 + i, 5000 + i)); b.push(cue(i + 1, 1500 + i, 5501 + i)); }
  const r = C.analyze(file(...a), file(...b), {toleranceMs: 1000});
  assert(has(r, 'MATCH_LIMIT')); assert.equal(r.summary.unmatchedSource, 0); assert(r.summary.ambiguousSource > 0);
});
