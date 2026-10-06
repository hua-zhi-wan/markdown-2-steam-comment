/* ============================================================
 * app.js
 * UI 交互：实时转换、视觉预览、BBCode 展示、警告提示、
 * 复制 / 下载 / 示例 / 清空、本地持久化。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- 示例文本 ---------------- */

  const SAMPLE = [
    '# 游戏评测：示例标题',
    '',
    '## 主要优点',
    '',
    '这是一段**普通文字**，包含 *斜体*、~~删除线~~、++下划线++ 和 ***粗斜体***，',
    '行内代码 `sv_cheats 1` 也可以正常显示。',
    '',
    '- 出色的画面与音效',
    '- 流畅的战斗系统',
    '  - 丰富的武器搭配',
    '  - BOSS 战设计精彩',
    '- 超过 40 小时的主线流程',
    '',
    '## 评分步骤',
    '',
    '1. 进入游戏完成序章',
    '2. 体验至少三种武器',
    '3. 给出综合评价',
    '',
    '> 这是我近年玩过最惊喜的续作。',
    '> — 某资深玩家',
    '',
    '| 项目 | 评分 |',
    '| :--- | ---: |',
    '| 画面 | 95 |',
    '| 玩法 | 92 |',
    '| 音乐 | 88 |',
    '',
    '```javascript',
    '// 代码块的语言标识会被忽略',
    'console.log("Hello, Steam!");',
    '```',
    '',
    '#### 小标题（Steam 不支持四级标题）',
    '',
    '- [x] 通关主线剧情',
    '- [ ] 收集全部成就',
    '',
    '!!!最终结局带有强烈反转，请谨慎观看!!!',
    '',
    '---',
    '',
    '更多信息请访问 [Steam 官网](https://store.steampowered.com)。',
    '',
    '独占一行的链接会由 Steam 自动生成小组件：',
    '',
    'https://www.youtube.com/watch?v=tax4e4hBBZc',
    '',
    'https://store.steampowered.com/app/323190/'
  ].join('\n');

  /* ---------------- DOM 引用 ---------------- */

  const $ = function (id) { return document.getElementById(id); };

  const input = $('md-input');
  const preview = $('preview');
  const bbcodeEl = $('bbcode');
  const warningsEl = $('warnings');
  const mdCount = $('md-count');
  const bbCount = $('bb-count');
  const optBreaks = $('opt-breaks');
  const toast = $('toast');

  const STORAGE_KEY = 'md2steam.input.v1';
  const OPT_KEY = 'md2steam.keepBreaks.v1';

  /* ---------------- 本地持久化 ---------------- */

  function loadSettings() {
    try {
      const saved = localStorage.getItem(OPT_KEY);
      if (saved != null) optBreaks.checked = saved === '1';
    } catch (e) { /* 忽略 */ }
  }

  function saveSettings() {
    try { localStorage.setItem(OPT_KEY, optBreaks.checked ? '1' : '0'); } catch (e) { /* 忽略 */ }
  }

  function loadInput() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved != null) return saved;
    } catch (e) { /* 忽略 */ }
    return SAMPLE;
  }

  function saveInput() {
    try { localStorage.setItem(STORAGE_KEY, input.value); } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 转换与渲染 ---------------- */

  let lastBbcode = '';

  function renderWarnings(warnings) {
    if (!warnings.length) {
      warningsEl.classList.add('hidden');
      warningsEl.innerHTML = '';
      return;
    }

    const html = warnings.map(function (w) {
      const label = w.level === 'info' ? '提示' : '警告';
      return '<div class="warn-item">' +
             '<span class="warn-badge ' + w.level + '">' + label + '</span>' +
             '<span class="warn-line">第 ' + w.line + ' 行</span>' +
             '<span class="warn-msg"></span>' +
             '</div>';
    }).join('');

    warningsEl.innerHTML = html;

    // 安全地填充消息文本
    const msgEls = warningsEl.querySelectorAll('.warn-msg');
    warnings.forEach(function (w, i) {
      msgEls[i].textContent = w.message;
    });

    warningsEl.classList.remove('hidden');
  }

  function update() {
    const result = window.SteamMarkdown.convert(input.value, {
      keepLineBreaks: optBreaks.checked
    });

    lastBbcode = result.bbcode;
    preview.innerHTML = window.BBCodePreview.render(result.bbcode);
    bbcodeEl.textContent = result.bbcode;

    mdCount.textContent = input.value.length + ' 字符';
    bbCount.textContent = result.bbcode.length + ' 字符';

    renderWarnings(result.warnings);
    saveInput();
  }

  let updateTimer = null;
  function scheduleUpdate() {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(update, 120);
  }

  /* ---------------- 选项卡 ---------------- */

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      const name = tab.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach(function (t) {
        t.classList.toggle('active', t === tab);
      });
      document.getElementById('tab-preview').classList.toggle('active', name === 'preview');
      document.getElementById('tab-code').classList.toggle('active', name === 'code');
    });
  });

  /* ---------------- Toast ---------------- */

  let toastTimer = null;
  function showToast(message) {
    toast.textContent = message;
    toast.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.add('hidden');
    }, 2000);
  }

  /* ---------------- 复制 ---------------- */

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copyBBCode() {
    if (!lastBbcode) {
      showToast('暂无内容可复制');
      return;
    }
    const done = function () { showToast('BBCode 已复制到剪贴板'); };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(lastBbcode).then(done, function () {
        if (fallbackCopy(lastBbcode)) done();
        else showToast('复制失败，请手动选择代码复制');
      });
    } else if (fallbackCopy(lastBbcode)) {
      done();
    } else {
      showToast('复制失败，请手动选择代码复制');
    }
  }

  /* ---------------- 下载 ---------------- */

  function downloadBBCode() {
    if (!lastBbcode) {
      showToast('暂无内容可下载');
      return;
    }
    const blob = new Blob([lastBbcode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'steam-comment.bbcode.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast('已下载 BBCode 文件');
  }

  /* ---------------- 帮助弹窗 ---------------- */

  const helpModal = $('help-modal');

  function openHelp() { helpModal.classList.remove('hidden'); }
  function closeHelp() { helpModal.classList.add('hidden'); }

  /* ---------------- 事件绑定 ---------------- */

  input.addEventListener('input', scheduleUpdate);
  optBreaks.addEventListener('change', function () {
    saveSettings();
    update();
  });

  $('btn-copy').addEventListener('click', copyBBCode);
  $('btn-download').addEventListener('click', downloadBBCode);
  $('btn-help').addEventListener('click', openHelp);
  $('help-close').addEventListener('click', closeHelp);

  helpModal.addEventListener('click', function (e) {
    if (e.target === helpModal) closeHelp();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !helpModal.classList.contains('hidden')) closeHelp();
  });

  $('btn-sample').addEventListener('click', function () {
    input.value = SAMPLE;
    update();
    showToast('已载入示例内容');
    input.focus();
  });

  $('btn-clear').addEventListener('click', function () {
    if (!input.value) return;
    if (window.confirm('确定要清空当前输入的全部内容吗？')) {
      input.value = '';
      update();
      input.focus();
    }
  });

  /* ---------------- 初始化 ---------------- */

  loadSettings();
  input.value = loadInput();
  update();

})();
