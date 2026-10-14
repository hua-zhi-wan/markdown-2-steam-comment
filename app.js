/* ============================================================
 * app.js
 * UI 交互：实时转换、预览、警告、复制 BBCode、帮助弹窗。
 * ============================================================ */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };

  const input = $('md-input');
  const gutter = $('md-gutter');
  const preview = $('preview');
  const bbcodeEl = $('bbcode');
  const warningsEl = $('warnings');
  const mdCount = $('md-count');
  const bbCount = $('bb-count');
  const optBreaks = $('opt-breaks');
  const toast = $('toast');

  const PLACEHOLDER =
    '# 示例标题\n\n' +
    '支持 **粗体**、*斜体*、~~删除线~~、`行内代码` 等常见语法。\n\n' +
    '- 列表项\n\n' +
    '> 引用\n\n' +
    '不支持的格式会在上方给出提示。';

  let lastBbcode = '';
  let lastWarnings = [];

  /* 行号栏：按行号列出数字，并在有警告 / 提示的行做标记。
     由于 textarea 开启软换行，一个逻辑行可能占用多个视觉行，
     这里用一个与 textarea 字体、宽度完全一致的隐藏镜像元素，
     逐行测量其实际占用的视觉行数，再让对应行号条目占据同等高度，
     从而保证行号与正文在换行时依然严格对齐。 */
  let gutterMirror = null;

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function measureRows(lines) {
    if (!gutterMirror) {
      gutterMirror = document.createElement('div');
      gutterMirror.setAttribute('aria-hidden', 'true');
      gutterMirror.style.cssText =
        'position:absolute;top:-99999px;left:0;visibility:hidden;pointer-events:none;' +
        'margin:0;border:0;padding:0;white-space:pre-wrap;overflow-wrap:break-word;';
      document.body.appendChild(gutterMirror);
    }
    const cs = getComputedStyle(input);
    const rowH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.65;
    // textarea 文本可用宽度 = clientWidth 减去左右内边距（clientWidth 已排除滚动条）
    const contentW = input.clientWidth -
      parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);

    gutterMirror.style.width = Math.max(0, contentW) + 'px';
    gutterMirror.style.fontFamily = cs.fontFamily;
    gutterMirror.style.fontSize = cs.fontSize;
    gutterMirror.style.lineHeight = cs.lineHeight;
    gutterMirror.style.letterSpacing = cs.letterSpacing;
    gutterMirror.style.wordSpacing = cs.wordSpacing;
    gutterMirror.style.tabSize = cs.tabSize;

    gutterMirror.innerHTML = lines.map(function (line) {
      // 空行用零宽空格占位，确保仍生成一个行盒
      return '<span>' + (line === '' ? '\u200b' : escHtml(line)) + '</span>';
    }).join('\n');

    const spans = gutterMirror.querySelectorAll('span');
    const rect = gutterMirror.getBoundingClientRect();
    const totalH = rect.height;
    const tops = [];
    for (let i = 0; i < spans.length; i++) {
      tops.push(spans[i].getBoundingClientRect().top - rect.top);
    }

    const rows = lines.map(function (_, i) {
      const next = i + 1 < lines.length ? tops[i + 1] : totalH;
      return Math.max(1, Math.round((next - tops[i]) / rowH));
    });
    return { rows: rows, rowH: rowH };
  }

  function renderGutter(warnings) {
    const lines = input.value.split('\n');
    const marks = {}; // 行号(1-based) -> { level, msgs }
    warnings.forEach(function (w) {
      if (!w.line) return;
      const m = marks[w.line] || (marks[w.line] = { level: 'info', msgs: [] });
      if (w.level === 'warning') m.level = 'warning'; // 警告优先级高于提示
      m.msgs.push(w.message);
    });

    const meas = measureRows(lines);
    gutter.innerHTML = lines.map(function (_, i) {
      const m = marks[i + 1];
      const cls = 'ln' + (m ? ' has-' + m.level : '');
      const h = (meas.rows[i] * meas.rowH).toFixed(3) + 'px';
      return '<div class="' + cls + '" style="height:' + h + '">' + (i + 1) + '</div>';
    }).join('');

    const lineEls = gutter.querySelectorAll('.ln');
    lineEls.forEach(function (el, i) {
      const m = marks[i + 1];
      if (m) el.title = '第 ' + (i + 1) + ' 行：' + m.msgs.join('；');
    });

    gutter.scrollTop = input.scrollTop;
  }

  /* textarea 与行号栏滚动同步 */
  input.addEventListener('scroll', function () { gutter.scrollTop = input.scrollTop; });

  /* 窗口宽度变化会改变软换行的折行结果，需要重新测量 */
  window.addEventListener('resize', function () { renderGutter(lastWarnings); });

  function renderWarnings(warnings) {
    if (!warnings.length) {
      warningsEl.classList.add('hidden');
      warningsEl.innerHTML = '';
      return;
    }
    warningsEl.innerHTML = warnings.map(function (w) {
      const label = w.level === 'info' ? '提示' : '警告';
      const lineText = w.line ? '第 ' + w.line + ' 行' : '';
      return '<div class="warn-item">' +
             '<span class="warn-badge ' + w.level + '">' + label + '</span>' +
             (lineText ? '<span class="warn-line">' + lineText + '</span>' : '') +
             '<span class="warn-msg"></span>' +
             '</div>';
    }).join('');
    const msgEls = warningsEl.querySelectorAll('.warn-msg');
    warnings.forEach(function (w, i) { msgEls[i].textContent = w.message; });
    warningsEl.classList.remove('hidden');
  }

  function update() {
    const result = window.SteamMarkdown.convert(input.value, {
      keepLineBreaks: optBreaks.checked
    });
    lastBbcode = result.bbcode;
    lastWarnings = result.warnings;
    preview.innerHTML = window.BBCodePreview.render(result.bbcode);
    bbcodeEl.textContent = result.bbcode;
    mdCount.textContent = input.value.length + ' 字符';
    bbCount.textContent = result.bbcode.length + ' 字符';
    renderWarnings(result.warnings);
    renderGutter(result.warnings);
  }

  let timer = null;
  input.addEventListener('input', function () {
    // 行数变化时立即刷新行号（标记沿用上一次结果），其余转换走防抖
    if (gutter.children.length !== input.value.split('\n').length) renderGutter(lastWarnings);
    if (timer) clearTimeout(timer);
    timer = setTimeout(update, 120);
  });
  optBreaks.addEventListener('change', update);

  /* 选项卡 */
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      const name = tab.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach(function (t) {
        t.classList.toggle('active', t === tab);
      });
      $('tab-preview').classList.toggle('active', name === 'preview');
      $('tab-code').classList.toggle('active', name === 'code');
    });
  });

  /* Toast */
  let toastTimer = null;
  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.add('hidden'); }, 2000);
  }

  /* 复制 */
  $('btn-copy').addEventListener('click', function () {
    if (!lastBbcode) { showToast('暂无内容可复制'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastBbcode).then(function () {
        showToast('BBCode 已复制到剪贴板');
      }, function () {
        showToast('复制失败，请手动选择代码复制');
      });
    } else {
      showToast('复制失败，请手动选择代码复制');
    }
  });

  /* 帮助弹窗：直接读取 README.md，抽取 HELP:START / HELP:END 章节后用 marked 渲染 */
  const helpModal = $('help-modal');
  const helpBody = $('help-body');
  let helpState = 'idle'; // idle | loading | done | error
  function renderHelp() {
    if (helpState === 'loading' || helpState === 'done') return;
    helpState = 'loading';
    helpBody.innerHTML = '<p>正在读取 README.md…</p>';
    fetch('README.md', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        const start = text.indexOf('<!-- HELP:START -->');
        const end = text.indexOf('<!-- HELP:END -->');
        const section = start !== -1 && end !== -1
          ? text.slice(start + '<!-- HELP:START -->'.length, end)
          : text;
        helpBody.innerHTML = window.marked.parse(section);
        helpState = 'done';
      })
      .catch(function () {
        helpBody.innerHTML =
          '<p>当前以 <code>file://</code> 方式直接双击打开页面，浏览器安全策略禁止页面读取本地 README.md 文件。</p>' +
          '<p>可以选择：</p>' +
          '<ul>' +
          '<li>直接查看 <a href="README.md" target="_blank" rel="noopener">README.md</a>；</li>' +
          '<li>或在项目目录运行 <code>python -m http.server</code>，通过 <code>http://localhost:8000</code> 打开，格式说明即可正常内联显示。</li>' +
          '</ul>';
        helpState = 'error';
      });
  }
  $('btn-help').addEventListener('click', function () { renderHelp(); helpModal.classList.remove('hidden'); });
  $('help-close').addEventListener('click', function () { helpModal.classList.add('hidden'); });
  helpModal.addEventListener('click', function (e) {
    if (e.target === helpModal) helpModal.classList.add('hidden');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') helpModal.classList.add('hidden');
  });

  /* 初始化 */
  input.value = PLACEHOLDER;
  update();

})();
