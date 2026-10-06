/* ============================================================
 * converter.js
 * Markdown → Steam BBCode 转换器
 *
 * 基于 marked（本地引入 marked.min.js）生成的语法树进行转写，
 * 不再手写 Markdown 解析逻辑，保证可维护性。
 *
 * Steam 官方支持的标签：
 *   h1-h3, b, i, u, strike, url, img, quote, code,
 *   spoiler, list/olist[*], table/tr/th/td, hr
 * Steam 不支持的语法会被忽略/降级，并在 warnings 中给出带行号的提示。
 * ============================================================ */
(function (global) {
  'use strict';

  const marked = global.marked;

  /* ---------- marked 扩展：++下划线++ 与 !!!剧透!!! ---------- */

  const underlineExt = {
    name: 'underline',
    level: 'inline',
    start(src) { const i = src.indexOf('++'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^\+\+([\s\S]+?)\+\+(?!\+)/.exec(src);
      if (m && m[1].trim()) {
        return { type: 'underline', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
      }
    }
  };

  const spoilerExt = {
    name: 'spoiler',
    level: 'inline',
    start(src) { const i = src.indexOf('!!!'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^!!!([\s\S]+?)!!!(?!!)/.exec(src);
      if (m && m[1].trim()) {
        return { type: 'spoiler', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
      }
    }
  };

  marked.use({ gfm: true, breaks: true, extensions: [underlineExt, spoilerExt] });

  /* ---------- 转换器 ---------- */

  function convert(source, options) {
    const keepLineBreaks = !options || options.keepLineBreaks !== false;
    const warnings = [];
    const warned = {};
    let src = String(source == null ? '' : source).replace(/\r\n?/g, '\n');

    function warn(message, level, line) {
      const key = (line || 0) + '|' + message;
      if (!warned[key]) {
        warned[key] = true;
        warnings.push({ line: line || null, message: message, level: level || 'warning' });
      }
    }

    /* ---- YAML 前置元数据：marked 不识别，整体移除 ---- */
    let body = src;
    if (/^---[ \t]*$/.test(src.split('\n')[0] || '')) {
      const lines = src.split('\n');
      for (let i = 1; i < lines.length; i++) {
        if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i])) {
          warn('检测到 YAML 前置元数据（front matter），Steam 不支持，已整体移除。', 'warning', i + 1);
          body = lines.slice(i + 1).join('\n');
          break;
        }
      }
    }

    /* ---- 基于原始文本的行号定位（用于警告提示，取首个匹配） ---- */
    function lineOf(token) {
      const raw = token && token.raw;
      if (!raw) return null;
      const idx = src.indexOf(raw);
      if (idx === -1) return null;
      return src.slice(0, idx).split('\n').length;
    }

    function normalizeUrl(url, line) {
      const u = String(url || '').trim();
      if (!u) return null;
      const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(u);
      if (m) {
        const scheme = m[1].toLowerCase();
        if (scheme === 'http' || scheme === 'https') return u;
        warn('链接协议「' + scheme + ':」Steam 不支持，链接已转为纯文本。', 'warning', line);
        return null;
      }
      if (u.indexOf('//') === 0) return 'https:' + u;
      if (u.charAt(0) === '#') return null;
      return 'https://' + u;
    }

    /* ---- 行内 token 转写 ---- */

    function inlineTokens(tokens) {
      return (tokens || []).map(inlineToken).join('');
    }

    function inlineToken(t) {
      switch (t.type) {
        case 'escape': return t.text;
        case 'strong': return '[b]' + inlineTokens(t.tokens) + '[/b]';
        case 'em': return '[i]' + inlineTokens(t.tokens) + '[/i]';
        case 'del': return '[strike]' + inlineTokens(t.tokens) + '[/strike]';
        case 'underline': return '[u]' + inlineTokens(t.tokens) + '[/u]';
        case 'spoiler': return '[spoiler]' + inlineTokens(t.tokens) + '[/spoiler]';
        case 'codespan': return '[code]' + t.text + '[/code]';
        case 'br': return '\n';

        case 'link': {
          if (t.title) warn('链接标题（title）Steam 不支持，已忽略。', 'info', lineOf(t));
          const label = inlineTokens(t.tokens);
          const url = normalizeUrl(t.href, lineOf(t));
          if (url == null) return label;
          // 自动链接（文字与网址相同）保持纯文本，以便 Steam 自动生成小组件
          if (label === t.href || label === url) return t.href;
          return '[url=' + url + ']' + label + '[/url]';
        }

        case 'image': {
          if (t.title) warn('图片标题（title）Steam 不支持，已忽略。', 'info', lineOf(t));
          const url = normalizeUrl(t.href, lineOf(t));
          if (url == null) return t.text || '';
          return '[img]' + url + '[/img]';
        }

        case 'html':
          return convertHtmlInline(t.text, lineOf(t));

        case 'text': {
          let txt = t.tokens ? inlineTokens(t.tokens) : t.text;
          return cleanUnsupportedInline(txt, lineOf(t));
        }

        default:
          return t.raw || '';
      }
    }

    function cleanUnsupportedInline(txt, line) {
      return txt
        .replace(/==([\s\S]+?)==/g, function (m, c) {
          warn('文字高亮 ==…== Steam 不支持，已还原为普通文字。', 'warning', line);
          return c;
        })
        .replace(/\$([^$\n]+?)\$/g, function (m, c) {
          warn('数学公式 $…$ Steam 不支持，已按普通文本保留。', 'warning', line);
          return c;
        })
        .replace(/\[\^[^\]]+\]/g, function (m) {
          warn('脚注 ' + m + ' Steam 不支持，已按普通文本保留。', 'warning', line);
          return m;
        });
    }

    function convertHtmlInline(html, line) {
      // 整段 <a>/<img>/<script>/<style> 结构
      const aM = /^<a\b[^>]*?href\s*=\s*["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/a\s*>$/i.exec(html);
      if (aM) {
        const url = normalizeUrl(aM[1], line);
        const label = aM[2].replace(/<[^>]*>/g, '');
        return url == null ? label : '[url=' + url + ']' + label + '[/url]';
      }
      const imgM = /^<img\b[^>]*?src\s*=\s*["']?([^"'>\s]+)["']?[^>]*\/?>$/i.exec(html);
      if (imgM) {
        const url = normalizeUrl(imgM[1], line);
        return url == null ? '' : '[img]' + url + '[/img]';
      }
      if (/^<(script|style)\b/i.test(html)) {
        warn('不支持的 HTML 标签已移除。', 'warning', line);
        return '';
      }
      // 单个标签
      const single = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)[^>]*>$/.exec(html);
      if (single) {
        const closing = !!single[1];
        const name = single[2].toLowerCase();
        const map = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', s: 'strike', del: 'strike', strike: 'strike' };
        if (map[name]) return closing ? '[/' + map[name] + ']' : '[' + map[name] + ']';
        if (name === 'br') return '\n';
        warn('不支持的 HTML 标签 &lt;' + name + '&gt; 已移除。', 'warning', line);
        return '';
      }
      return html.replace(/<[^>]*>/g, '');
    }

    /* ---- 块级 token 转写 ---- */

    function blockTokens(tokens) {
      return tokens.map(blockToken).filter(function (b) { return b && b.trim(); }).join('\n\n');
    }

    function blockToken(t) {
      switch (t.type) {
        case 'space': return '';
        case 'hr': return '[hr][/hr]';

        case 'heading': {
          const inner = inlineTokens(t.tokens);
          if (t.depth <= 3) return '[h' + t.depth + ']' + inner + '[/h' + t.depth + ']';
          warn('Steam 仅支持一至三级标题，第 ' + t.depth + ' 级标题已降级为粗体。', 'warning', lineOf(t));
          return '[b]' + inner + '[/b]';
        }

        case 'code': {
          if (t.lang) warn('代码块语言标识「' + t.lang + '」Steam 不支持，已忽略。', 'info', lineOf(t));
          return '[code]\n' + t.text.replace(/\s+$/, '') + '\n[/code]';
        }

        case 'blockquote':
          return '[quote]' + blockTokens(t.tokens) + '[/quote]';

        case 'list': return listToken(t);

        case 'paragraph':
          return inlineTokens(t.tokens);

        case 'table': {
          if (t.align && t.align.some(function (a) { return a; })) {
            warn('Steam 表格不支持列对齐方式，对齐标记已忽略。', 'info', lineOf(t));
          }
          let out = '[table]\n[tr]\n' +
            t.header.map(function (h) { return '[th]' + inlineTokens(h.tokens) + '[/th]'; }).join('\n') +
            '\n[/tr]';
          t.rows.forEach(function (row) {
            out += '\n[tr]\n' +
              row.map(function (c) { return '[td]' + inlineTokens(c.tokens) + '[/td]'; }).join('\n') +
              '\n[/tr]';
          });
          return out + '\n[/table]';
        }

        case 'html': {
          warn('HTML 标签 Steam 不支持，已移除（保留其中的文字）。', 'warning', lineOf(t));
          return t.text.replace(/<[^>]*>/g, '').trim();
        }

        case 'text':
          return t.tokens ? inlineTokens(t.tokens) : cleanUnsupportedInline(t.text, lineOf(t));

        default:
          return t.raw || '';
      }
    }

    function listToken(t) {
      const tag = t.ordered ? 'olist' : 'list';
      const items = t.items.map(function (item) {
        let prefix = '';
        if (item.task) {
          prefix = (item.checked ? '☑ ' : '☐ ');
          warn('Steam 不支持交互式复选框，任务项已转换为符号 ' + (item.checked ? '☑' : '☐') + '。', 'info', lineOf(item));
        }
        const parts = item.tokens.map(function (tok) {
          if (tok.type === 'list') {
            warn('Steam 列表不支持嵌套，嵌套的子项已展平处理。', 'warning', lineOf(tok));
            return flattenList(tok);
          }
          return blockToken(tok);
        }).filter(function (p) { return p && String(p).trim(); });
        let content = parts.join('\n');
        const lines = content.split('\n');
        for (let i = 1; i < lines.length; i++) lines[i] = '    ' + lines[i];
        return '[*] ' + prefix + lines.join('\n');
      });
      return '[' + tag + ']\n' + items.join('\n') + '\n[/' + tag + ']';
    }

    function flattenList(listTok) {
      return listTok.items.map(function (it) {
        return '◦ ' + it.tokens.map(function (tk) {
          if (tk.type === 'list') return flattenList(tk);
          return tk.tokens ? inlineTokens(tk.tokens) : (tk.text || '');
        }).join('');
      }).join('\n');
    }

    /* ---- 执行 ---- */
    marked.setOptions({ breaks: keepLineBreaks });
    const tokens = marked.lexer(body);
    const bbcode = blockTokens(tokens).replace(/\n{3,}/g, '\n\n').trim();

    warnings.sort(function (a, b) { return (a.line || 0) - (b.line || 0); });
    return { bbcode: bbcode, warnings: warnings };
  }

  global.SteamMarkdown = { convert: convert };

})(typeof window !== 'undefined' ? window : this);
