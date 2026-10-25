/* Local-only SRT structure comparison. No translation or semantic judgment. */
const SubtitleCheck = (() => {
  'use strict';
  const VERSION = '0.1.0';
  const MAX_CHARS = 2 * 1024 * 1024;
  const MAX_CUES = 10000;
  const MAX_CANDIDATES = 1000000;
  const TIME = /^(\d{2,}):([0-5]\d):([0-5]\d)([,.])(\d{3})\s+-->\s+(\d{2,}):([0-5]\d):([0-5]\d)([,.])(\d{3})\s*$/;
  function decodeSrtBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('文件内容必须是字节数组。');
    if (bytes.byteLength > MAX_CHARS) throw new RangeError('文件超过 2 MiB。请先拆分字幕，再分批核对。');
    let encoding = 'utf-8';
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    let text;
    try { text = new TextDecoder(encoding, {fatal: true}).decode(bytes); }
    catch (_) { throw new Error('无法按 UTF-8 或带 BOM 的 UTF-16 读取。请在字幕编辑器中另存为 UTF-8 后重试。'); }
    if (text.includes('\0')) throw new Error('文件含有空字符，可能使用了未识别的编码。请另存为 UTF-8 后重试。');
    return {text: text.replace(/^\uFEFF/, ''), encoding};
  }
  function formatTime(ms) {
    if (!Number.isSafeInteger(ms) || ms < 0) return '—';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor(ms / 60000) % 60;
    const s = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  }
  function issue(code, level, title, message, sourceCue = null, targetCue = null, sourceLine = null, targetLine = null) {
    return {code, level, title, message, sourceCue, targetCue,
      sourceLine: sourceLine ?? sourceCue?.line ?? null,
      targetLine: targetLine ?? targetCue?.line ?? null};
  }
  function interval(cue) { return `${cue.startMs}:${cue.endMs}`; }
  function parseSrt(text, side) {
    const cues = [], issues = [];
    const label = side === 'source' ? '原文' : '译文';
    const add = (code, level, title, message, cue = null, line = null) => {
      issues.push(issue(code, level, `${label}：${title}`, message,
        side === 'source' ? cue : null, side === 'target' ? cue : null,
        side === 'source' ? line : null, side === 'target' ? line : null));
    };
    if (typeof text !== 'string') throw new TypeError('字幕内容必须是文本。');
    if (text.length > MAX_CHARS) throw new RangeError('单份字幕文本过大，请使用 2 MiB 以内的文件。');
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!normalized.trim()) {
      add('EMPTY_FILE', 'error', '没有字幕内容', '请载入或粘贴一份 SRT 字幕。');
      return {cues, issues};
    }
    if (normalized.includes('\0')) {
      add('INVALID_ENCODING', 'error', '文本包含空字符', '可能使用了不正确的编码。请另存为 UTF-8，或通过文件选择读取带 BOM 的 UTF-16 字幕。');
      return {cues, issues};
    }
    if (/^WEBVTT(?:\s|$)/.test(normalized.trimStart())) {
      add('UNSUPPORTED_FORMAT', 'error', '当前只支持 SRT', '请先在字幕编辑器中导出 SRT 文件。WebVTT、ASS 等格式尚未支持。');
      return {cues, issues};
    }
    const lines = normalized.split('\n');
    let pos = 0, blockNumber = 0;
    while (pos < lines.length) {
      while (pos < lines.length && !lines[pos].trim()) pos++;
      if (pos >= lines.length) break;
      const first = pos;
      while (pos < lines.length && lines[pos].trim()) pos++;
      const block = lines.slice(first, pos);
      blockNumber++;
      if (blockNumber > MAX_CUES) throw new RangeError('单份字幕最多支持 10,000 个字幕块。请拆分后检查。');
      const hasId = /^\d+$/.test(block[0].trim());
      const ti = hasId ? 1 : 0;
      const timing = (block[ti] || '').trim();
      const m = TIME.exec(timing);
      if (!m) {
        add('BAD_TIME_FORMAT', 'error', '字幕块无法解析', `第 ${blockNumber} 个非空块缺少可识别的时间行。支持 00:00:01,000 --> 00:00:02,000 格式；不会忽略这个块后宣称检查通过。`, null, first + ti + 1);
        continue;
      }
      const startMs = Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number(m[5]);
      const endMs = Number(m[6]) * 3600000 + Number(m[7]) * 60000 + Number(m[8]) * 1000 + Number(m[10]);
      const body = block.slice(ti + 1);
      if (body.some((line, i) => line.includes('-->') &&
          (/^\s*[+-]?\d+:\d/.test(line) || (i > 0 && /^\s*\d+\s*$/.test(body[i - 1]))))) {
        add('MISSING_SEPARATOR', 'error', '相邻字幕块缺少空行', '一个字幕块中出现了另一条时间行。请先补齐块之间的空行再比较，避免误把下一段当成正文。', null, first + ti + 1);
        continue;
      }
      const valid = Number.isSafeInteger(startMs) && Number.isSafeInteger(endMs) && endMs > startMs;
      const cue = {position: blockNumber, id: hasId ? block[0].trim() : '', line: first + ti + 1, startMs, endMs, text: body.join('\n'), valid};
      cues.push(cue);
      if (!hasId) add('MISSING_ID', 'warning', '缺少段落编号', '已按时间行读取。请核对导出的 SRT 编号。', cue);
      else if (/^0+$/.test(cue.id)) add('ZERO_ID', 'warning', '编号从零开始', '常见 SRT 从 1 开始编号；本工具仍按时间区间比较。', cue);
      if (m[4] === '.' || m[9] === '.') add('DOT_MILLISECONDS', 'info', '毫秒使用了小数点', '已兼容读取。常见 SRT 使用逗号分隔毫秒，导入其他软件前可核对。', cue);
      if (!valid) add('INVALID_DURATION', 'error', '结束时间必须晚于开始时间', '这段字幕不会参与时间匹配。请核对原文件。', cue);
      // Tokenize complete tags first; do not scan repeatedly across nested '<'.
      const visibleText = cue.text.replace(/<[^<>]*>/g, tag =>
        /^<\/?(?:i|b|u|font)(?:\s[^<>]*)?>$/i.test(tag) ? '' : tag);
      if (!visibleText.trim()) {
        add('EMPTY_TEXT', 'error', '字幕正文为空', '时间段存在，但没有可显示的字幕正文。', cue);
      }
    }
    const ids = new Map(), times = new Map();
    let previous = null;
    for (const cue of cues) {
      if (cue.id) {
        const canonical = cue.id.replace(/^0+(?=\d)/, '');
        if (ids.has(canonical)) add('DUPLICATE_ID', 'warning', '段落编号重复', `编号 ${cue.id} 也用于第 ${ids.get(canonical).position} 个字幕块；不以编号决定对应关系。`, cue);
        else ids.set(canonical, cue);
      }
      if (!cue.valid) continue;
      if (previous && cue.startMs < previous.startMs) add('OUT_OF_ORDER', 'warning', '时间顺序倒置', '这段在文件中的开始时间早于前一段，请核对是否有意调整顺序。', cue);
      previous = cue;
      const key = interval(cue);
      if (times.has(key)) add('DUPLICATE_INTERVAL', 'warning', '时间段重复', `与第 ${times.get(key).position} 个字幕块时间完全相同；可能是多说话人内容，需人工核对。`, cue);
      else times.set(key, cue);
    }
    let active = null;
    for (const cue of cues.filter(c => c.valid).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
      if (active && cue.startMs < active.endMs && interval(cue) !== interval(active)) add('OVERLAP', 'warning', '字幕时间重叠', `与第 ${active.position} 个字幕块发生重叠。重叠可以是合理安排，本工具不会自动修改。`, cue);
      if (!active || cue.endMs > active.endMs) active = cue;
    }
    return {cues, issues};
  }
  function group(cues) {
    const map = new Map();
    for (const cue of cues) {
      const key = interval(cue);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(cue);
    }
    return map;
  }
  function lowerBound(array, value) {
    let lo = 0, hi = array.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (array[mid].startMs < value) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function analyze(sourceText, targetText, options = {}) {
    const toleranceMs = options.toleranceMs ?? 0;
    if (!Number.isInteger(toleranceMs) || toleranceMs < 0 || toleranceMs > 1000) throw new RangeError('时间容差必须是 0 到 1000 之间的整数毫秒。');
    const source = parseSrt(sourceText, 'source'), target = parseSrt(targetText, 'target');
    const issues = [...source.issues, ...target.issues], pairs = [];
    const sc = source.cues.filter(c => c.valid), tc = target.cues.filter(c => c.valid);
    const usedS = new Set(), usedT = new Set(), ambS = new Set(), ambT = new Set();
    const sg = group(sc), tg = group(tc);
    for (const [key, ss] of sg) {
      const tt = tg.get(key) || [];
      if (ss.length === 1 && tt.length === 1) {
        pairs.push({sourceCue: ss[0], targetCue: tt[0], kind: 'exact'}); usedS.add(ss[0]); usedT.add(tt[0]);
      } else if (tt.length) {
        ss.forEach(c => ambS.add(c)); tt.forEach(c => ambT.add(c));
        issues.push(issue('AMBIGUOUS_MATCH', 'warning', '相同时间段有多个候选', `原文 ${ss.length} 段、译文 ${tt.length} 段共用这个区间。没有强行决定逐段对应关系。`, ss[0], tt[0]));
      }
    }
    if (toleranceMs > 0) {
      const remainingT = tc.filter(c => !usedT.has(c) && !ambT.has(c)).sort((a, b) => a.startMs - b.startMs);
      const candidatesS = new Map(), candidatesT = new Map();
      let comparisons = 0, limited = false;
      outer: for (const s of sc.filter(c => !usedS.has(c) && !ambS.has(c))) {
        for (let i = lowerBound(remainingT, s.startMs - toleranceMs); i < remainingT.length && remainingT[i].startMs <= s.startMs + toleranceMs; i++) {
          if (++comparisons > MAX_CANDIDATES) { limited = true; break outer; }
          const t = remainingT[i];
          if (Math.abs(s.endMs - t.endMs) > toleranceMs) continue;
          const a = candidatesS.get(s) || {count: 0, first: t}; a.count++; candidatesS.set(s, a);
          const b = candidatesT.get(t) || {count: 0, first: s}; b.count++; candidatesT.set(t, b);
        }
      }
      if (limited) {
        sc.filter(c => !usedS.has(c) && !ambS.has(c)).forEach(c => ambS.add(c));
        remainingT.forEach(c => ambT.add(c));
        issues.push(issue('MATCH_LIMIT', 'error', '容差匹配未完成', '相近时间段过于密集，已停止容差搜索。请使用 0 毫秒容差或拆分字幕；未比较部分不能视为通过。'));
      } else {
        for (const [s, candidate] of candidatesS) {
          const t = candidate.first;
          if (candidate.count === 1 && candidatesT.get(t).count === 1) {
            usedS.add(s); usedT.add(t); pairs.push({sourceCue: s, targetCue: t, kind: 'tolerance'});
            issues.push(issue('TIME_WITHIN_TOLERANCE', 'info', '时间存在容差内变化', `开始变化 ${t.startMs - s.startMs} 毫秒，结束变化 ${t.endMs - s.endMs} 毫秒；已按你设置的 ${toleranceMs} 毫秒容差匹配。`, s, t));
          } else ambS.add(s);
        }
        for (const t of candidatesT.keys()) if (!usedT.has(t)) ambT.add(t);
        if ([...candidatesS.keys()].some(s => ambS.has(s))) issues.push(issue('AMBIGUOUS_TOLERANCE', 'warning', '容差范围内存在多种对应关系', '没有强行选择候选。请减小容差或在字幕编辑器中核对这些相近的时间段。'));
      }
    }
    const unmatchedS = sc.filter(c => !usedS.has(c) && !ambS.has(c));
    const unmatchedT = tc.filter(c => !usedT.has(c) && !ambT.has(c));
    for (const s of unmatchedS) issues.push(issue('UNMATCHED_SOURCE', 'warning', '原文未找到对应时间段', '译文中未找到相同或容差内的唯一时间区间。可能漏段、合并、拆分或调整了时间，需要人工核对。', s));
    for (const t of unmatchedT) issues.push(issue('UNMATCHED_TARGET', 'warning', '译文有未对应的时间段', '原文中未找到相同或容差内的唯一时间区间。可能新增、合并、拆分或调整了时间，需要人工核对。', null, t));
    for (const pair of pairs) if (pair.sourceCue.id && pair.targetCue.id && pair.sourceCue.id !== pair.targetCue.id) {
      issues.push(issue('RENUMBERED', 'info', '对应时间段的编号不同', '时间段已匹配，重新编号可以是正常操作，不代表漏译或译文错误。', pair.sourceCue, pair.targetCue));
    }
    pairs.sort((a, b) => a.sourceCue.position - b.sourceCue.position);
    const pairBySource = new Map(pairs.map(p => [p.sourceCue, p.targetCue]));
    const pairByTarget = new Map(pairs.map(p => [p.targetCue, p.sourceCue]));
    for (const item of issues) {
      if (item.sourceCue && !item.targetCue && pairBySource.has(item.sourceCue)) {
        item.targetCue = pairBySource.get(item.sourceCue); item.targetLine = item.targetCue.line;
      } else if (item.targetCue && !item.sourceCue && pairByTarget.has(item.targetCue)) {
        item.sourceCue = pairByTarget.get(item.targetCue); item.sourceLine = item.sourceCue.line;
      }
    }
    const summary = {sourceCues: source.cues.length, targetCues: target.cues.length, matched: pairs.length,
      exactMatches: pairs.filter(p => p.kind === 'exact').length, toleranceMatches: pairs.filter(p => p.kind === 'tolerance').length,
      unmatchedSource: unmatchedS.length, unmatchedTarget: unmatchedT.length, ambiguousSource: ambS.size, ambiguousTarget: ambT.size,
      errors: issues.filter(i => i.level === 'error').length, warnings: issues.filter(i => i.level === 'warning').length, infos: issues.filter(i => i.level === 'info').length};
    return {version: VERSION, options: {toleranceMs}, source, target, summary, issues, pairs};
  }
  const examples = {
    source: '1\n00:00:01,000 --> 00:00:03,000\nWelcome to the workshop.\n\n2\n00:00:04,000 --> 00:00:06,500\nToday we will make a small lamp.\n\n3\n00:00:07,000 --> 00:00:09,000\nFirst, prepare your materials.\n\n4\n00:00:10,000 --> 00:00:12,000\nKeep the power switched off.\n',
    good: '1\n00:00:01,000 --> 00:00:03,000\n欢迎来到手作课堂。\n\n2\n00:00:04,000 --> 00:00:06,500\n今天，我们来做一盏小灯。\n\n3\n00:00:07,000 --> 00:00:09,000\n首先，准备好材料。\n\n4\n00:00:10,000 --> 00:00:12,000\n请保持电源关闭。\n',
    bad: '1\n00:00:01,000 --> 00:00:03,000\n欢迎来到手作课堂。\n\n3\n00:00:07,800 --> 00:00:09,800\n首先，准备好材料。\n\n4\n00:00:10,000 --> 00:00:12,000\n\n'
  };
  return {analyze, parseSrt, decodeSrtBytes, formatTime, examples, version: VERSION};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SubtitleCheck;
if (typeof window !== 'undefined') window.SubtitleCheck = SubtitleCheck;
