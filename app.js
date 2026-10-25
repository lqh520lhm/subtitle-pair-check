'use strict';

(() => {
  const MAX_BYTES = 2 * 1024 * 1024;
  const PAGE_SIZE = 100;
  const $ = (id) => document.getElementById(id);
  const state = { result: null, dirty: true, createdAt: null, tab: 'issues', issueLimit: PAGE_SIZE, pairLimit: PAGE_SIZE };
  const sides = {};
  for (const key of ['source', 'target']) {
    sides[key] = { key, text: $(key + '-text'), file: $(key + '-file'), name: $(key + '-name'), error: $(key + '-error'), count: $(key + '-count'), drop: $(key + '-drop'), token: 0, loading: false, fileError: false, filename: key === 'source' ? '原文（粘贴）' : '译文（粘贴）' };
  }
  const levels = { error: '格式错误', warning: '需要核对', info: '信息提示' };
  const api = () => typeof SubtitleCheck === 'undefined' ? null : SubtitleCheck;
  const num = (value) => Number(value || 0).toLocaleString('zh-CN');
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }
  function setError(side, message) {
    side.error.textContent = message;
    side.error.hidden = !message;
    side.text.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (message) side.text.setAttribute('aria-describedby', side.key + '-error');
    else side.text.removeAttribute('aria-describedby');
  }
  function updateCounts(side) { side.count.textContent = num(side.text.value.length) + ' 字符'; }
  function updateButtons() {
    const loading = Object.values(sides).some((side) => side.loading);
    $('analyze').disabled = loading;
    $('analyze').replaceChildren(document.createTextNode(loading ? '正在读取文件…' : '开始核对 '));
    if (!loading) $('analyze').append(node('span', '', '→'));
    for (const id of ['export-text', 'export-json']) $(id).disabled = !state.result || state.dirty || loading;
  }
  function markDirty() {
    state.dirty = true;
    $('global-error').hidden = true;
    if (state.result) {
      $('stale-notice').hidden = false;
      $('report-title').textContent = '输入已变化，等待重新核对';
      $('report').classList.add('is-stale');
    }
    updateButtons();
  }
  function resetResult(message) {
    state.result = null;
    state.dirty = true;
    $('report-content').hidden = true;
    $('report-empty').hidden = false;
    $('stale-notice').hidden = true;
    $('report').classList.remove('is-stale');
    $('report-title').textContent = message || '准备好后，开始第一次核对';
    updateButtons();
  }
  function editSide(side) {
    side.token += 1;
    side.loading = false;
    side.fileError = false;
    side.filename = side.key === 'source' ? '原文（粘贴或编辑）' : '译文（粘贴或编辑）';
    side.name.textContent = '已粘贴或编辑 · 内容留在本机';
    side.file.value = '';
    setError(side, '');
    updateCounts(side);
    markDirty();
  }
  async function loadFile(side, file) {
    if (!file) return;
    const token = ++side.token;
    side.loading = true;
    side.fileError = false;
    setError(side, '');
    markDirty();
    try {
      if (!/\.srt$/i.test(file.name)) throw new Error('请选择 .srt 字幕文件。此版本暂不支持 VTT、ASS 或视频。');
      if (file.size > MAX_BYTES) throw new Error('文件超过 2 MiB。请先拆分字幕，再分批核对。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (side.token !== token) return;
      if (!api()) throw new Error('检查程序未加载，请确认 core.js 与页面位于同一文件夹。');
      const {text, encoding} = api().decodeSrtBytes(bytes);
      side.text.value = text;
      side.filename = file.name;
      side.name.textContent = file.name + ' · ' + encoding.toUpperCase();
      updateCounts(side);
    } catch (error) {
      if (side.token !== token) return;
      side.fileError = true;
      setError(side, error.message || '读取文件失败，请重试。');
    } finally {
      if (side.token === token) { side.loading = false; updateButtons(); }
    }
  }
  function loadExample(kind) {
    if (!api() || !api().examples) { fail('检查程序未加载，请确认 core.js 与此页面位于同一文件夹。'); return; }
    for (const key of ['source', 'target']) {
      const side = sides[key];
      side.token += 1; side.loading = false; side.fileError = false;
      side.file.value = '';
      side.text.value = key === 'source' ? api().examples.source : api().examples[kind];
      side.filename = key === 'source' ? '示例原文.srt' : (kind === 'good' ? '正常译文.srt' : '待核对译文.srt');
      side.name.textContent = side.filename + ' · 内置合成示例';
      setError(side, ''); updateCounts(side);
    }
    $('tolerance').value = '0';
    markDirty();
    analyze();
  }
  function fail(message) {
    resetResult('本次核对未完成');
    $('global-error').textContent = message;
    $('global-error').hidden = false;
  }
  function analyze() {
    if (Object.values(sides).some((side) => side.loading)) return;
    if (!api() || typeof api().analyze !== 'function') { fail('检查程序未加载，请确认 core.js 与此页面位于同一文件夹。'); return; }
    let invalidSide = null;
    for (const side of Object.values(sides)) {
      if (side.fileError) { invalidSide = invalidSide || side; continue; }
      setError(side, '');
      let message = '';
      if (!side.text.value.trim()) message = '请先选择 SRT 文件，或粘贴字幕内容。';
      else if (new TextEncoder().encode(side.text.value).length > MAX_BYTES) message = '内容超过 2 MiB，请拆分后再核对。';
      if (message) { setError(side, message); invalidSide = invalidSide || side; }
    }
    if (invalidSide) { resetResult('请先补全或修正字幕输入'); invalidSide.text.focus(); return; }
    $('global-error').hidden = true;
    try {
      const result = api().analyze(sides.source.text.value, sides.target.text.value, { toleranceMs: Number($('tolerance').value) });
      state.result = result;
      state.dirty = false;
      state.createdAt = new Date().toISOString();
      state.issueLimit = PAGE_SIZE; state.pairLimit = PAGE_SIZE;
      $('issue-filter').value = 'all';
      $('stale-notice').hidden = true;
      $('report').classList.remove('is-stale');
      $('report-empty').hidden = true;
      $('report-content').hidden = false;
      renderSummary(); renderIssues(); renderPairs(); selectTab('issues'); updateButtons();
    } catch (error) { fail(error.message || '本次检查未完成，请确认输入是有效的 SRT 文件。'); }
  }
  function renderSummary() {
    const s = state.result.summary;
    $('report-title').textContent = s.errors ? '发现格式问题，请先核对' : (s.warnings ? '核对完成，有段落需要确认' : s.infos ? '核对完成，请查看时间与编号提示' : '核对完成，未发现结构异常');
    const metrics = [
      ['原文 / 译文', num(s.sourceCues) + ' / ' + num(s.targetCues), '已解析的字幕条数'],
      ['已匹配时间段', num(s.matched), num(s.exactMatches) + ' 严格一致 · ' + num(s.toleranceMatches) + ' 容差内'],
      ['未匹配 / 待确认', num(s.unmatchedSource + s.unmatchedTarget + s.ambiguousSource + s.ambiguousTarget), '两侧段落合计，可能包含合并或改时'],
      ['检查提示', num(s.errors + s.warnings + s.infos), num(s.errors) + ' 错误 · ' + num(s.warnings) + ' 核对 · ' + num(s.infos) + ' 信息']
    ];
    const grid = $('summary-grid'); grid.replaceChildren();
    for (const [label, value, note] of metrics) {
      const box = node('div', 'metric');
      box.append(node('div', 'metric-label', label), node('div', 'metric-value', value), node('div', 'metric-note', note)); grid.append(box);
    }
    $('report-explainer').textContent = '原文未匹配 ' + num(s.unmatchedSource) + ' 条，译文未匹配 ' + num(s.unmatchedTarget) + ' 条；存在多个可能对应的原文 ' + num(s.ambiguousSource) + ' 条、译文 ' + num(s.ambiguousTarget) + ' 条。' + (s.errors ? '存在格式错误时，已解析条数可能不完整。' : '');
    $('issues-count').textContent = num(state.result.issues.length);
    $('pairs-count').textContent = num(state.result.pairs.length);
  }
  function time(cue) {
    if (!cue || !Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs)) return '时间不可读';
    return api().formatTime(cue.startMs) + ' → ' + api().formatTime(cue.endMs);
  }
  function cueBox(cue, label, line) {
    const box = node('div', 'cue-box');
    const heading = node('div', 'cue-label');
    heading.append(node('span', '', label + (cue ? ' · 第 ' + cue.position + ' 条 · 编号 ' + cue.id : '') + ((line || (cue && cue.line)) ? ' · 文件第 ' + (line || cue.line) + ' 行' : '')));
    if (cue) heading.append(node('span', 'cue-time', time(cue)));
    box.append(heading);
    box.append(cue ? node('pre', 'cue-text', cue.text || '（空白内容）') : node('p', 'cue-placeholder', '未确定对应段落，请结合问题说明核对'));
    return box;
  }
  function renderIssues() {
    if (!state.result) return;
    const filter = $('issue-filter').value;
    const issues = state.result.issues.filter((issue) => filter === 'all' || issue.level === filter);
    const list = $('issue-list'); list.replaceChildren();
    if (!issues.length) {
      const empty = node('div', 'list-empty');
      empty.append(node('strong', '', filter === 'all' ? '没有发现结构问题' : '此类别没有提示'), node('span', '', filter === 'all' ? '仍需人工确认译文含义，并结合视频检查同步。' : '可以切换筛选条件，查看其他提示。'));
      list.append(empty);
    }
    for (const issue of issues.slice(0, state.issueLimit)) {
      const article = node('article', 'issue-card');
      const heading = node('div', 'issue-heading');
      heading.append(node('span', 'badge badge-' + (levels[issue.level] ? issue.level : 'info'), levels[issue.level] || '提示'), node('h3', '', issue.title));
      article.append(heading, node('p', 'issue-message', issue.message));
      if (issue.sourceCue || issue.targetCue || issue.sourceLine || issue.targetLine) {
        const cues = node('div', 'cue-grid');
        cues.append(cueBox(issue.sourceCue, '原文', issue.sourceLine), cueBox(issue.targetCue, '译文', issue.targetLine)); article.append(cues);
      }
      list.append(article);
    }
    $('more-issues').hidden = issues.length <= state.issueLimit;
    $('more-issues').textContent = '显示更多 · 已显示 ' + Math.min(issues.length, state.issueLimit) + ' / ' + issues.length + ' 条';
  }
  function renderPairs() {
    if (!state.result) return;
    const pairs = state.result.pairs;
    const list = $('pair-list'); list.replaceChildren();
    if (!pairs.length) list.append(node('p', 'list-empty', '没有可唯一匹配的时间段。请先查看问题清单。'));
    for (const pair of pairs.slice(0, state.pairLimit)) {
      const article = node('article', 'pair-card');
      const label = node('div', 'pair-label');
      label.append(node('span', 'badge ' + (pair.kind === 'exact' ? 'badge-exact' : 'badge-info'), pair.kind === 'exact' ? '时间一致' : '容差内匹配'), node('span', '', '仅确认时间对应，未验证翻译含义'));
      const cues = node('div', 'cue-grid'); cues.append(cueBox(pair.sourceCue, '原文'), cueBox(pair.targetCue, '译文'));
      article.append(label, cues); list.append(article);
    }
    $('more-pairs').hidden = pairs.length <= state.pairLimit;
    $('more-pairs').textContent = '显示更多 · 已显示 ' + Math.min(pairs.length, state.pairLimit) + ' / ' + pairs.length + ' 对';
  }
  function selectTab(tab, moveFocus = false) {
    state.tab = tab;
    for (const name of ['issues', 'pairs']) {
      const active = name === tab;
      $(name + '-tab').classList.toggle('active', active);
      $(name + '-tab').setAttribute('aria-selected', String(active));
      $(name + '-tab').tabIndex = active ? 0 : -1;
      $(name + '-panel').hidden = !active;
    }
    $('filter-wrap').hidden = tab !== 'issues';
    if (moveFocus) $(tab + '-tab').focus();
  }
  function reportObject() {
    return { reportCreatedAt: state.createdAt, sourceName: sides.source.filename, targetName: sides.target.filename, scope: '仅核对 SRT 结构与时间，不判断翻译准确性或音画同步。未匹配不等于漏译。', ...state.result };
  }
  function textReport(data) {
    const s = data.summary;
    const lines = ['字幕对照检查报告', '生成时间：' + data.reportCreatedAt, '原文：' + data.sourceName, '译文：' + data.targetName, '匹配容差：' + data.options.toleranceMs + ' ms', data.scope, '', '原文 / 译文条数：' + s.sourceCues + ' / ' + s.targetCues, '已匹配时间段：' + s.matched, '原文 / 译文未匹配：' + s.unmatchedSource + ' / ' + s.unmatchedTarget, '原文 / 译文对应不唯一：' + s.ambiguousSource + ' / ' + s.ambiguousTarget, '格式错误 / 需要核对 / 信息：' + s.errors + ' / ' + s.warnings + ' / ' + s.infos, '', '问题清单'];
    if (!data.issues.length) lines.push('没有发现结构异常。');
    for (const [index, issue] of data.issues.entries()) {
      lines.push('', (index + 1) + '. [' + (levels[issue.level] || issue.level) + '] ' + issue.title, issue.message);
      for (const [key, label] of [['sourceCue', '原文'], ['targetCue', '译文']]) {
        const cue = issue[key];
        if (cue) lines.push(label + ' · 第 ' + cue.position + ' 条 · 编号 ' + cue.id + ' · 文件第 ' + cue.line + ' 行', time(cue), cue.text || '（空白内容）');
        else { const line = issue[key === 'sourceCue' ? 'sourceLine' : 'targetLine']; if (line) lines.push(label + ' · 文件第 ' + line + ' 行'); }
      }
    }
    lines.push('', '已匹配时间段对照');
    for (const pair of data.pairs) lines.push('', '[' + (pair.kind === 'exact' ? '时间一致' : '容差内匹配') + ']', '原文 · 第 ' + pair.sourceCue.position + ' 条 · ' + time(pair.sourceCue), pair.sourceCue.text, '译文 · 第 ' + pair.targetCue.position + ' 条 · ' + time(pair.targetCue), pair.targetCue.text);
    return lines.join('\n');
  }
  function download(format) {
    if (!state.result || state.dirty) return;
    const data = reportObject();
    const content = format === 'json' ? JSON.stringify(data, null, 2) : textReport(data);
    const blob = new Blob([content], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = node('a'); link.href = url; link.download = '字幕核对报告-' + new Date().toISOString().replace(/[:.]/g, '-') + '.' + format;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  for (const side of Object.values(sides)) {
    side.text.addEventListener('input', () => editSide(side));
    side.file.addEventListener('change', () => loadFile(side, side.file.files[0]));
    $(side.key + '-clear').addEventListener('click', () => { side.text.value = ''; editSide(side); side.name.textContent = '未选择文件，也可以直接粘贴'; side.text.focus(); });
    side.drop.addEventListener('dragover', (event) => { event.preventDefault(); side.drop.classList.add('drag-over'); });
    side.drop.addEventListener('dragleave', (event) => { if (!side.drop.contains(event.relatedTarget)) side.drop.classList.remove('drag-over'); });
    side.drop.addEventListener('drop', (event) => {
      event.preventDefault(); side.drop.classList.remove('drag-over');
      if (event.dataTransfer.files.length !== 1) { side.token += 1; side.loading = false; side.fileError = true; markDirty(); setError(side, '每次请拖入一份 SRT 文件。'); return; }
      side.file.value = ''; loadFile(side, event.dataTransfer.files[0]);
    });
    updateCounts(side);
  }
  $('tolerance').addEventListener('change', markDirty);
  $('analyze').addEventListener('click', analyze);
  $('bad-example').addEventListener('click', () => loadExample('bad'));
  $('good-example').addEventListener('click', () => loadExample('good'));
  $('issue-filter').addEventListener('change', () => { state.issueLimit = PAGE_SIZE; renderIssues(); });
  $('more-issues').addEventListener('click', () => { state.issueLimit += PAGE_SIZE; renderIssues(); });
  $('more-pairs').addEventListener('click', () => { state.pairLimit += PAGE_SIZE; renderPairs(); });
  for (const name of ['issues', 'pairs']) {
    $(name + '-tab').addEventListener('click', () => selectTab(name));
    $(name + '-tab').addEventListener('keydown', (event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); selectTab(event.key === 'Home' ? 'issues' : event.key === 'End' ? 'pairs' : name === 'issues' ? 'pairs' : 'issues', true); }
    });
  }
  $('export-json').addEventListener('click', () => download('json'));
  $('export-text').addEventListener('click', () => download('txt'));
  updateButtons();
})();
