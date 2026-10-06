/* ============================================================
 * preview.js
 * Steam BBCode → HTML 视觉预览渲染器（纯本地、无依赖）
 * 模拟 Steam 社区的渲染效果：标题、引用、代码、列表、表格、
 * 剧透、分割线，以及 YouTube / Steam 链接的小组件占位。
 * ============================================================ */
(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stripHtml(s) {
    return String(s).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
  }

  /* ---------- 小组件识别 ---------- */

  function isWidgetUrl(u) {
    return /youtube\.com\/watch|youtu\.be\/|store\.steampowered\.com\/app|steamcommunity\.com\/(?:sharedfiles|app)\b/i.test(u);
  }

  function widgetHtml(url) {
    let icon = '🔗';
    let label = 'Steam 小组件';
    if (/youtube\.com\/watch|youtu\.be\//i.test(url)) { icon = '▶️'; label = 'YouTube 视频'; }
    else if (/store\.steampowered\.com\/app/i.test(url)) { icon = '🎮'; label = 'Steam 商店页面'; }
    else if (/steamcommunity\.com\/sharedfiles/i.test(url)) { icon = '🧩'; label = 'Steam 创意工坊物品'; }
    else if (/steamcommunity\.com\//i.test(url)) { icon = '🧩'; label = 'Steam 社区中心'; }
    return '<div class="bb-widget"><span class="widget-icon">' + icon +
      '</span><span class="widget-text"><strong>' + label +
      '</strong><span>' + escapeHtml(url) + '</span></span></div>';
  }

  /* ---------- 文本处理：链接 / 小组件 / 换行 ---------- */

  function linkifyLine(line) {
    // 独占一行的 YouTube / Steam 链接 → 小组件占位
    const bare = line.trim();
    if (/^https?:\/\/\S+$/.test(bare) && isWidgetUrl(bare)) {
      const leading = line.match(/^\s*/)[0];
      return leading + widgetHtml(bare);
    }

    // 普通链接
    return line.replace(/https?:\/\/[^\s<>]+/g, function (raw) {
      let url = raw;
      const trimTail = url.match(/[.,!?;:'")\]\u3002\uFF0C\u3001\uFF1B\uFF1A\uFF01\uFF1F\uFF09\u3011\u300D\u300F]+$/);
      if (trimTail) url = url.slice(0, url.length - trimTail[0].length);
      return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' +
             escapeHtml(raw) + '</a>';
    });
  }

  function textToHtml(txt, frameName) {
    const lines = txt.split('\n');
    const parts = lines.map(function (line) {
      if (line.trim() === '') return '';
      return linkifyLine(escapeHtml(line));
    });
    return parts.join('<br>');
  }

  /* ---------- 颜色 / 尺寸校验 ---------- */

  const NAMED_COLORS = {
    red: 1, blue: 1, green: 1, orange: 1, yellow: 1, purple: 1, pink: 1,
    white: 1, black: 1, gray: 1, grey: 1, brown: 1, cyan: 1, lime: 1,
    gold: 1, silver: 1, navy: 1, teal: 1, maroon: 1, violet: 1
  };

  function validColor(c) {
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return c;
    if (NAMED_COLORS[c.toLowerCase()]) return c;
    return null;
  }

  /* ---------- 渲染主流程 ---------- */

  const FRAMED_TAGS = {
    h1: 1, h2: 1, h3: 1, b: 1, i: 1, u: 1, strike: 1, s: 1,
    url: 1, quote: 1, spoiler: 1, list: 1, olist: 1, li: 1,
    table: 1, tr: 1, th: 1, td: 1, center: 1, size: 1, color: 1
  };

  function render(bbcode) {
    const source = String(bbcode == null ? '' : bbcode);
    const root = { name: '#root', attr: null, buf: [] };
    const stack = [root];

    function top() { return stack[stack.length - 1]; }

    function emitText(t) {
      if (t === '') return;
      const tn = top().name;
      if ((tn === 'list' || tn === 'olist' || tn === 'table' || tn === 'tr') &&
          t.trim() === '') return;
      top().buf.push(textToHtml(t, tn));
    }

    function emitRaw(h) { top().buf.push(h); }

    // 在当前位置之后查找某闭合标签，返回截取的原始内容
    function captureUntilClose(nm) {
      const closeRe = new RegExp('\\[/' + nm + '\\]', 'i');
      const mm = closeRe.exec(source.slice(pos));
      if (!mm) return null;
      const content = source.slice(pos, pos + mm.index);
      pos += mm.index + mm[0].length;
      return content;
    }

    function popFrame(frame) {
      const idx = stack.indexOf(frame);
      if (idx === -1) return;
      while (stack.length - 1 > idx) popFrame(top()); // 先闭合内部未关闭的帧
      stack.pop();
      const html = composeFrame(frame);
      if (html) stack[stack.length - 1].buf.push(html);
    }

    /* ---- 帧的闭合组装 ---- */
    function composeFrame(f) {
      const buf = f.buf.join('');

      switch (f.name) {
        case 'h1': return '<h1 class="bb-h1">' + buf + '</h1>';
        case 'h2': return '<h2 class="bb-h2">' + buf + '</h2>';
        case 'h3': return '<h3 class="bb-h3">' + buf + '</h3>';
        case 'b': return '<strong>' + buf + '</strong>';
        case 'i': return '<em>' + buf + '</em>';
        case 'u': return '<span style="text-decoration:underline">' + buf + '</span>';
        case 'strike':
        case 's': return '<del>' + buf + '</del>';
        case 'center': return '<div style="text-align:center">' + buf + '</div>';

        case 'size': {
          if (/^\d{1,3}$/.test(f.attr || '')) {
            const n = Math.max(8, Math.min(72, parseInt(f.attr, 10)));
            return '<span style="font-size:' + n + 'px">' + buf + '</span>';
          }
          return buf;
        }
        case 'color': {
          const c = validColor(f.attr || '');
          if (c) return '<span style="color:' + c + '">' + buf + '</span>';
          return buf;
        }

        case 'url': {
          let href = f.attr ? f.attr.trim() : stripHtml(buf).trim();
          if (!href) return buf;
          if (!/^(?:https?:)?\/\//i.test(href) && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
            href = 'https://' + href;
          }
          return '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' +
                 (buf || escapeHtml(href)) + '</a>';
        }

        case 'quote': {
          let header = '';
          if (f.attr) {
            const author = f.attr.split(';')[0];
            header = '<div class="bb-quote-h">Originally posted by ' +
                     escapeHtml(author) + ':</div>';
          }
          return '<blockquote class="bb-quote">' + header + buf + '</blockquote>';
        }

        case 'spoiler':
          return '<details class="bb-spoiler"><summary>剧透内容（点击展开）</summary>' +
                 '<div class="bb-spoiler-inner">' + buf + '</div></details>';

        case 'li': return '<li>' + buf + '</li>';

        case 'list':
        case 'olist': {
          const tag = f.name === 'olist' ? 'ol' : 'ul';
          return '<' + tag + ' class="bb-' + f.name + '">' + buf + '</' + tag + '>';
        }

        case 'tr': return '<tr>' + buf + '</tr>';
        case 'th': return '<th>' + buf + '</th>';
        case 'td': return '<td>' + buf + '</td>';

        case 'table': {
          let cls = 'bb-table';
          if (f.attr) {
            if (/noborder\s*=\s*1/i.test(f.attr)) cls += ' noborder';
            if (/equalcells\s*=\s*1/i.test(f.attr)) cls += ' equalcells';
          }
          return '<table class="' + cls + '"><tbody>' + buf + '</tbody></table>';
        }
        default: return buf;
      }
    }

    /* ---- [*] 处理 ---- */
    function handleStar() {
      let liIdx = -1;
      let listIdx = -1;
      for (let k = stack.length - 1; k > 0; k--) {
        if (liIdx === -1 && stack[k].name === 'li') liIdx = k;
        if (stack[k].name === 'list' || stack[k].name === 'olist') {
          listIdx = k;
          break;
        }
      }
      if (listIdx === -1) { emitRaw('[*]'); return; }
      if (liIdx === listIdx + 1) popFrame(stack[liIdx]);
      stack.push({ name: 'li', attr: null, buf: [] });
    }

    /* ---- 开标签 ---- */
    function handleOpen(name, attr, token) {
      if (name === 'hr') { emitRaw('<hr>'); return; }

      // 需要原始内容的标签
      if (name === 'code' || name === 'noparse' || name === 'img') {
        const content = captureUntilClose(name);
        if (content === null) {
          emitRaw(escapeHtml(token));
          return;
        }
        if (name === 'img') {
          const src = content.trim();
          if (/^https?:\/\//i.test(src)) {
            emitRaw('<img class="bb-img" src="' + escapeHtml(src) + '" alt="" loading="lazy">');
          } else {
            emitRaw(escapeHtml(src));
          }
        } else if (name === 'noparse') {
          emitRaw(textToHtml(content, top().name));
        } else {
          const lineStart = tokenIndex === 0 || source.charAt(tokenIndex - 1) === '\n';
          const isBlock = lineStart || content.indexOf('\n') !== -1;
          if (isBlock) {
            emitRaw('<pre class="bb-pre">' +
                    escapeHtml(content.replace(/^\n/, '').replace(/\n$/, '')) + '</pre>');
          } else {
            emitRaw('<code class="bb-inline-code">' + escapeHtml(content) + '</code>');
          }
        }
        return;
      }

      if (!FRAMED_TAGS[name]) {
        emitRaw(escapeHtml(token));
      } else {
        stack.push({ name: name, attr: attr, buf: [] });
      }
    }

    /* ---- 闭标签 ---- */
    function handleClose(name, token) {
      if (name === 'hr') return; // [hr][/hr] 只产生一次

      // 特殊标签在开标签时已整体消费
      if (name === 'code' || name === 'noparse' || name === 'img') return;

      // 关闭列表前先收尾列表项
      if (name === 'list' || name === 'olist') {
        if (top().name === 'li') popFrame(top());
      }
      if (name === 'tr' && (top().name === 'th' || top().name === 'td')) {
        popFrame(top());
      }
      if (name === 'table' && top().name === 'tr') popFrame(top());

      let idx = -1;
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) { idx = k; break; }
      }
      if (idx === -1) {
        emitRaw(escapeHtml(token));
      } else {
        popFrame(stack[idx]);
      }
    }

    /* ---- 扫描循环 ---- */
    const tagRe = /\[(\/?)([a-zA-Z][a-zA-Z0-9]*)(?:=([^\]]*))?\]|\[\*\]/g;
    let pos = 0;
    let m;
    let tokenIndex = 0;

    while ((m = tagRe.exec(source))) {
      tokenIndex = m.index;
      if (m.index > pos) emitText(source.slice(pos, m.index));
      pos = m.index + m[0].length;

      if (m[0] === '[*]') {
        handleStar();
        continue;
      }
      const closing = m[1] === '/';
      const nm = m[2].toLowerCase();
      const attr = m[3] === undefined ? null : m[3];
      if (closing) handleClose(nm, m[0]);
      else handleOpen(nm, attr, m[0]);
    }
    if (pos < source.length) emitText(source.slice(pos));

    while (stack.length > 1) popFrame(stack[stack.length - 1]);

    return root.buf.join('');
  }

  global.BBCodePreview = { render: render, escapeHtml: escapeHtml };

})(typeof window !== 'undefined' ? window : this);
