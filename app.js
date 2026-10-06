/* ============================================================
 * app.js
 * UI 交互：实时转换、预览、警告、复制 BBCode、帮助弹窗。
 * ============================================================ */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };

  const input = $('md-input');
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
    preview.innerHTML = window.BBCodePreview.render(result.bbcode);
    bbcodeEl.textContent = result.bbcode;
    mdCount.textContent = input.value.length + ' 字符';
    bbCount.textContent = result.bbcode.length + ' 字符';
    renderWarnings(result.warnings);
  }

  let timer = null;
  input.addEventListener('input', function () {
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

  /* 帮助弹窗 */
  const helpModal = $('help-modal');
  $('btn-help').addEventListener('click', function () { helpModal.classList.remove('hidden'); });
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
