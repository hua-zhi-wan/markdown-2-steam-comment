/* ============================================================
 * converter.js
 * Markdown → Steam BBCode 转换引擎（纯本地、无依赖）
 *
 * 支持范围依据 Steam 官方格式帮助：
 *   h1-h3, b, i, u, strike, url, img, quote(=author), code,
 *   spoiler, list/olist[*], table/tr/th/td, hr, noparse
 * 不支持的语法会被忽略/降级，并在 warnings 中给出带行号的提示。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 工具函数 ---------------- */

  function leadingSpaces(s) {
    const m = /^[ ]*/.exec(s);
    return m ? m[0].length : 0;
  }

  function isBlank(s) { return /^[ \t]*$/.test(s); }

  // 去除成对包裹的一层空格（代码span规则）
  function stripCodePadding(content) {
    if (content.length > 1 && /^ .* $/.test(content) && /[^ ]/.test(content)) {
      return content.slice(1, -1);
    }
    return content;
  }

  function decodeEntities(s) {
    return s
      .replace(/&#x([0-9a-fA-F]+);/g, function (m, hex) {
        return String.fromCodePoint(parseInt(hex, 16));
      })
      .replace(/&#([0-9]+);/g, function (m, dec) {
        return String.fromCodePoint(parseInt(dec, 10));
      })
      .replace(/&nbsp;/g, '\u00A0')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  // GFM 表格行拆分（支持 \| 转义、可省略首尾管道符）
  function splitTableRow(raw) {
    let s = raw.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.length > 0 && s.charAt(s.length - 1) === '|' && s.charAt(s.length - 2) !== '\\') {
      s = s.slice(0, -1);
    }
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\' && (s[i + 1] === '|' || s[i + 1] === '\\')) {
        cur += s[i + 1];
        i++;
      } else if (ch === '|') {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  }

  /* ---------------- 转换器 ---------------- */

  function Converter() {
    this.warnings = [];
    this.refs = {};
    this._warnedKeys = {};
    this._htmlWarnedTags = {};
    this._htmlWarnedAttrs = {};
    this.options = { keepLineBreaks: true };
  }

  Converter.prototype.warn = function (line, message, level) {
    const key = line + '|' + message;
    if (!this._warnedKeys[key]) {
      this._warnedKeys[key] = true;
      this.warnings.push({ line: line, message: message, level: level || 'warning' });
    }
  };

  Converter.prototype.convert = function (source, options) {
    this.warnings = [];
    this.refs = {};
    this._warnedKeys = {};
    this._htmlWarnedTags = {};
    this._htmlWarnedAttrs = {};
    this.options = Object.assign({ keepLineBreaks: true }, options || {});

    let text = String(source == null ? '' : source).replace(/\r\n?/g, '\n');
    let rawLines = text.split('\n');

    // YAML 前置元数据
    if (/^---[ \t]*$/.test(rawLines[0] || '')) {
      let end = -1;
      for (let i = 1; i < rawLines.length; i++) {
        if (/^(?:---|\.\.\.)[ \t]*$/.test(rawLines[i])) { end = i; break; }
      }
      if (end > 0) {
        this.warn(end + 1, '检测到 YAML 前置元数据（front matter），Steam 不支持，已整体移除。', 'warning');
        rawLines = rawLines.slice(end + 1);
      }
    }

    // 收集引用链接定义 [label]: dest
    const items = [];
    for (let i = 0; i < rawLines.length; i++) {
      const m = /^[ ]{0,3}\[([^\]]+)\]:[ \t]*(?:<([^>\s]+)>|(\S+))[ \t]*(?:["'(]([^"')]*)["')])?[ \t]*$/.exec(rawLines[i]);
      if (m) {
        this.refs[m[1].trim().toLowerCase()] = { url: m[2] || m[3], title: m[4] || '' };
      } else {
        items.push({ t: rawLines[i], n: i + 1 });
      }
    }

    const blocks = this.blockParse(items);
    let output = blocks
      .filter(function (b) { return b && b.trim(); })
      .join('\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { bbcode: output, warnings: this.warnings.slice() };
  };

  /* ============ 块级解析 ============ */

  Converter.prototype.blockParse = function (items) {
    const out = [];
    let i = 0;

    while (i < items.length) {
      const it = items[i];
      if (isBlank(it.t)) { i++; continue; }

      const indent = leadingSpaces(it.t);
      const line = it.t.slice(indent);

      let m;

      // 围栏代码块
      if ((m = /^(`{3,}|~{3,3})[ \t]*([^\n]*)$/.exec(line))) {
        const fence = m[1];
        const ch = fence.charAt(0);
        const info = m[2].trim();
        const body = [];
        let j = i + 1;
        let closed = false;
        while (j < items.length) {
          const l = items[j].t;
          const ind = leadingSpaces(l);
          const trimmed = l.slice(ind);
          if (ind <= 3 && trimmed.charAt(0) === ch &&
              new RegExp('^' + ch + '{' + fence.length + ',}[ \\t]*$').test(trimmed)) {
            closed = true;
            break;
          }
          body.push(items[j].t);
          j++;
        }
        if (info) {
          this.warn(it.n, '代码块语言标识「' + info + '」Steam 不支持，已忽略。', 'info');
        }
        if (!closed) {
          this.warn(it.n, '代码块缺少结束围栏，已按到文本末尾处理。', 'info');
        }
        out.push(this.codeBlock(body.join('\n')));
        i = closed ? j + 1 : j;
        continue;
      }

      // ATX 标题
      if ((m = /^(#{1,6})[ \t]*(.*?)[ \t]*#*[ \t]*$/.exec(line))) {
        const level = m[1].length;
        const content = this.parseInline(m[2], it.n);
        if (level <= 3) {
          out.push('[h' + level + ']' + content + '[/h' + level + ']');
        } else {
          this.warn(it.n, 'Steam 仅支持一至三级标题，第 ' + level + ' 级标题已降级为粗体。', 'warning');
          out.push('[b]' + content + '[/b]');
        }
        i++;
        continue;
      }

      // 水平分割线
      if (/^(?:[*][ \t]*){3,}$|^(?:[-][ \t]*){3,}$|^(?:[_][ \t]*){3,}$/.test(line)) {
        out.push('[hr][/hr]');
        i++;
        continue;
      }

      // 引用块
      if (/^>/.test(line)) {
        const gathered = [];
        let j = i;
        while (j < items.length) {
          const t = items[j].t;
          if (/^[ \t]{0,3}>/.test(t)) {
            gathered.push({ t: t.replace(/^[ \t]{0,3}>[ \t]?/, ''), n: items[j].n });
            j++;
          } else if (isBlank(t)) {
            let k = j + 1;
            while (k < items.length && isBlank(items[k].t)) k++;
            if (k < items.length && /^[ \t]{0,3}>/.test(items[k].t)) {
              gathered.push({ t: '', n: items[j].n });
              j++;
            } else break;
          } else break;
        }

        // 作者检测：最后一个非空行形如 "— 作者" / "-- 作者"
        let author = null;
        let lastIdx = gathered.length - 1;
        while (lastIdx >= 0 && isBlank(gathered[lastIdx].t)) lastIdx--;
        if (lastIdx >= 0) {
          const am = /^(?:—|--|～)[ \t]+(.+)$/.exec(gathered[lastIdx].t.trim());
          if (am) {
            author = am[1].trim();
            gathered.splice(lastIdx, 1);
          }
        }

        const inner = this.blockParse(gathered)
          .filter(function (b) { return b && b.trim(); })
          .join('\n\n');
        out.push(author ? '[quote=' + author + ']' + inner + '[/quote]'
                        : '[quote]' + inner + '[/quote]');
        i = j;
        continue;
      }

      // 列表
      const listStart = this.matchListMarker(line);
      if (listStart && indent <= 3) {
        const res = this.parseList(items, i, indent, listStart);
        out.push(res.text);
        i = res.next;
        continue;
      }

      // 表格（当前行含 |，下一行是分隔行）
      if (line.indexOf('|') !== -1 && i + 1 < items.length &&
          this.isTableDelimiter(items[i + 1].t)) {
        const res = this.parseTable(items, i);
        out.push(res.text);
        i = res.next;
        continue;
      }

      // 缩进代码块
      if (indent >= 4) {
        const body = [];
        let j = i;
        while (j < items.length) {
          if (leadingSpaces(items[j].t) >= 4) {
            body.push(items[j].t.slice(4));
            j++;
          } else if (isBlank(items[j].t)) {
            let k = j + 1;
            while (k < items.length && isBlank(items[k].t)) k++;
            if (k < items.length && leadingSpaces(items[k].t) >= 4) {
              body.push('');
              j++;
            } else break;
          } else break;
        }
        out.push(this.codeBlock(body.join('\n')));
        i = j;
        continue;
      }

      // HTML 块
      if (this.isHtmlBlockStart(line)) {
        const tag = RegExp.$1;
        const body = [it.t];
        let j = i + 1;
        const singleLine = new RegExp('<' + tag + '[\\s\\S]*</' + tag + '\\s*>', 'i').test(it.t) ||
                           /\/>\s*$/.test(it.t);
        if (!singleLine) {
          while (j < items.length && !isBlank(items[j].t)) {
            body.push(items[j].t);
            if (new RegExp('</' + tag + '\\s*>', 'i').test(items[j].t)) { j++; break; }
            j++;
          }
        }
        const converted = this.convertHtml(body.join('\n'), it.n);
        if (converted.trim()) out.push(converted.trim());
        i = j;
        continue;
      }

      // 普通段落
      const para = [it.t];
      let j = i + 1;
      while (j < items.length && !isBlank(items[j].t)) {
        if (this.isBlockStart(items[j], items[j + 1])) break;
        // Setext 一级标题的 ==== 下划线只能修饰首行，需在吞入前停下
        if (para.length === 1 && /^[ \t]*=+[ \t]*$/.test(items[j].t)) break;
        para.push(items[j].t);
        j++;
      }

      // Setext 标题
      if (para.length === 1 && j < items.length &&
          /^[ \t]*(=+|-+)[ \t]*$/.test(items[j].t)) {
        const lvl = items[j].t.indexOf('=') !== -1 ? 1 : 2;
        out.push('[h' + lvl + ']' + this.parseInline(para[0], it.n) + '[/h' + lvl + ']');
        i = j + 1;
        continue;
      }

      const joined = this.buildParagraphText(para, it.n);
      out.push(this.parseInline(joined, it.n));
      i = j;
    }

    return out;
  };

  Converter.prototype.codeBlock = function (body) {
    let b = body.replace(/^\n+/, '').replace(/\s+$/, '');
    return '[code]\n' + b + '\n[/code]';
  };

  Converter.prototype.buildParagraphText = function (lines, firstLineNo) {
    let out = '';
    for (let k = 0; k < lines.length; k++) {
      let l = lines[k];
      let hard = false;
      if (/[ ]{2,}$/.test(l) || /\\$/.test(l)) {
        hard = true;
        l = l.replace(/[ ]{2,}$/, '').replace(/\\$/, '');
      }
      out += l;
      if (k < lines.length - 1) {
        out += (hard || this.options.keepLineBreaks) ? '\n' : ' ';
      }
    }
    return out;
  };

  Converter.prototype.isBlockStart = function (item, nextItem) {
    const indent = leadingSpaces(item.t);
    const line = item.t.slice(indent);
    if (indent <= 3 && /^(`{3,}|~{3,})/.test(line)) return true;
    if (indent <= 3 && /^#{1,6}(\s|$)/.test(line)) return true;
    if (indent <= 3 && /^>/.test(line)) return true;
    if (indent <= 3 && this.matchListMarker(line)) return true;
    if (/^(?:[*][ \t]*){3,}$|^(?:[-][ \t]*){3,}$|^(?:[_][ \t]*){3,}$/.test(line)) return true;
    if (this.isHtmlBlockStart(line)) return true;
    if (indent >= 4) return true;
    if (line.indexOf('|') !== -1 && nextItem && this.isTableDelimiter(nextItem.t)) return true;
    return false;
  };

  /* ---- 列表 ---- */

  Converter.prototype.matchListMarker = function (line) {
    let m = /^([-*+])([ \t]+)/.exec(line);
    if (m) return { ordered: false, marker: m[1], gap: m[2], head: m[0] };
    m = /^(\d{1,9}[.)])([ \t]+)/.exec(line);
    if (m) return { ordered: true, marker: m[1], gap: m[2], head: m[0] };
    return null;
  };

  Converter.prototype.parseList = function (items, start, baseIndent, markerInfo) {
    const contentIndent = baseIndent + markerInfo.head.length;
    const gathered = [];
    let j = start;
    let hasNested = false;
    let firstNumber = null;
    if (markerInfo.ordered) firstNumber = parseInt(markerInfo.marker, 10);

    while (j < items.length) {
      const t = items[j].t;
      if (isBlank(t)) {
        let k = j + 1;
        while (k < items.length && isBlank(items[k].t)) k++;
        if (k >= items.length) break;
        const ni = leadingSpaces(items[k].t);
        const nl = items[k].t.slice(ni);
        const nm = this.matchListMarker(nl);
        if (nm && ni >= baseIndent) { gathered.push(t); j++; continue; }
        if (ni >= contentIndent) { gathered.push(t); j++; continue; }
        break;
      }

      const ni = leadingSpaces(t);
      const nm = this.matchListMarker(t.slice(ni));

      if (nm) {
        if (ni === baseIndent) {
          if (nm.ordered !== markerInfo.ordered) break;
        } else if (ni > baseIndent) {
          hasNested = true;
        } else {
          break;
        }
        gathered.push(t);
        j++;
      } else if (ni >= contentIndent) {
        gathered.push(t);
        j++;
      } else {
        break;
      }
    }

    // 切分为条目
    const entries = [];
    let current = null;
    for (let k = 0; k < gathered.length; k++) {
      const t = gathered[k];
      const ni = leadingSpaces(t);
      const nm = this.matchListMarker(t.slice(ni));
      if (nm && ni === baseIndent && nm.ordered === markerInfo.ordered) {
        if (current) entries.push(current);
        const rest = t.slice(ni + nm.head.length);
        current = { lines: [rest], startLine: items[start + k] ? items[start + k].n : start + 1 };
      } else if (current) {
        current.lines.push(t);
      }
    }
    if (current) entries.push(current);

    if (hasNested) {
      this.warn(items[start].n, 'Steam 列表不支持嵌套，嵌套的子项已展平处理。', 'warning');
    }
    if (markerInfo.ordered && firstNumber !== 1) {
      this.warn(items[start].n, 'Steam 有序列表始终从 1 开始，起始序号 ' + firstNumber + ' 已忽略。', 'info');
    }

    const tag = markerInfo.ordered ? 'olist' : 'list';
    let out = '[' + tag + ']\n';
    const self = this;

    entries.forEach(function (entry, idx) {
      // 任务列表复选框
      const firstLine = entry.lines[0];
      const tm = /^\[([ xX])\][ \t]+(.*)$/.exec(firstLine);
      let entryLineItems = entry.lines.slice();
      if (tm) {
        self.warn(entry.startLine, 'Steam 不支持交互式复选框，任务项已转换为符号 ' +
          (tm[1].toLowerCase() === 'x' ? '☑' : '☐') + '。', 'info');
        entryLineItems[0] = (tm[1].toLowerCase() === 'x' ? '☑ ' : '☐ ') + tm[2];
      }

      // 去除统一缩进
      const dedented = entryLineItems.map(function (l) {
        if (isBlank(l)) return '';
        const ind = leadingSpaces(l);
        return l.slice(Math.min(ind, contentIndent));
      });

      const virtual = dedented.map(function (l, li2) {
        return { t: l, n: entry.startLine + Math.min(li2, 8) };
      });
      let blocks = self.blockParse(virtual)
        .filter(function (b) { return b && b.trim(); });

      // 将嵌套列表字符串展平为 ◦ 行
      blocks = blocks.map(self.flattenNestedList.bind(self));

      if (blocks.length === 0) blocks = [''];

      const head = blocks[0];
      out += '[*] ' + head;
      for (let b = 1; b < blocks.length; b++) {
        const subLines = String(blocks[b]).split('\n');
        for (let sl = 0; sl < subLines.length; sl++) {
          out += '\n    ' + subLines[sl];
        }
      }
      if (idx < entries.length - 1) out += '\n';
    });

    out += '\n[/' + tag + ']';
    return { text: out, next: j };
  };

  Converter.prototype.flattenNestedList = function (block) {
    const self = this;
    let s = String(block);
    const re = /^\[(list|olist)\]\n([\s\S]*?)\n\[\/\1\]$/;
    let guard = 0;
    while (re.test(s) && guard++ < 6) {
      s = s.replace(re, function (m, tag, body) {
        return body.split('\n').map(function (l) {
          return l.replace(/^[ \t]*\[\*\][ \t]?/, '◦ ');
        }).join('\n');
      });
    }
    return s;
  };

  /* ---- 表格 ---- */

  Converter.prototype.isTableDelimiter = function (raw) {
    if (raw.indexOf('|') === -1 && raw.indexOf('-') === -1) return false;
    const cells = splitTableRow(raw);
    if (cells.length === 0) return false;
    return cells.every(function (c) { return /^:?-+:?$/.test(c.trim()); });
  };

  Converter.prototype.parseTable = function (items, start) {
    const self = this;
    const headerCells = splitTableRow(items[start].t);
    const delimCells = splitTableRow(items[start + 1].t).map(function (c) { return c.trim(); });

    let alignmentUsed = false;
    delimCells.forEach(function (c) {
      if (c.charAt(0) === ':' || c.charAt(c.length - 1) === ':') alignmentUsed = true;
    });
    if (alignmentUsed) {
      this.warn(items[start + 1].n, 'Steam 表格不支持列对齐方式，对齐标记已忽略。', 'info');
    }

    const colCount = headerCells.length;
    let j = start + 2;
    const rows = [];
    while (j < items.length && !isBlank(items[j].t) && items[j].t.indexOf('|') !== -1) {
      rows.push(splitTableRow(items[j].t));
      j++;
    }

    function inlineCells(cells, isHeader) {
      const padded = [];
      for (let c = 0; c < colCount; c++) {
        padded.push(cells[c] != null ? cells[c] : '');
      }
      return padded.map(function (cell) {
        return '[' + (isHeader ? 'th' : 'td') + ']' +
          self.parseInline(cell, items[start].n) +
          '[/' + (isHeader ? 'th' : 'td') + ']';
      }).join('\n');
    }

    let out = '[table]\n[tr]\n' + inlineCells(headerCells, true) + '\n[/tr]';
    rows.forEach(function (rowCells) {
      out += '\n[tr]\n' + inlineCells(rowCells, false) + '\n[/tr]';
    });
    out += '\n[/table]';

    return { text: out, next: j };
  };

  /* ---- HTML ---- */

  const BLOCK_HTML_TAGS = {
    address: 1, article: 1, aside: 1, base: 1, basefont: 1, blockquote: 1, body: 1,
    caption: 1, center: 1, col: 1, colgroup: 1, dd: 1, details: 1, dialog: 1,
    dir: 1, div: 1, dl: 1, dt: 1, fieldset: 1, figcaption: 1, figure: 1, footer: 1,
    form: 1, frame: 1, frameset: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1,
    header: 1, hr: 1, iframe: 1, legend: 1, li: 1, link: 1, main: 1, menu: 1,
    menuitem: 1, nav: 1, noframes: 1, ol: 1, optgroup: 1, option: 1, p: 1,
    section: 1, summary: 1, table: 1, tbody: 1, td: 1, tfoot: 1, th: 1, thead: 1,
    title: 1, tr: 1, track: 1, ul: 1, pre: 1
  };

  Converter.prototype.isHtmlBlockStart = function (line) {
    const m = /^<([a-zA-Z][a-zA-Z0-9-]*)(?:\s|\/?>|$)/.exec(line);
    if (m && BLOCK_HTML_TAGS[m[1].toLowerCase()]) { return true; }
    if (/^<!--/.test(line)) return true;
    return false;
  };

  Converter.prototype.convertHtml = function (raw, lineNo) {
    const self = this;
    let out = raw;

    // HTML 注释
    out = out.replace(/<!--[\s\S]*?-->/g, function () {
      self.warn(lineNo, 'HTML 注释 &lt;!-- --&gt; 已移除。', 'info');
      return '';
    });

    // 危险 / 不支持的整块标签
    out = out.replace(
      /<(script|style|head|iframe|object|embed|template|noscript)[^>]*>[\s\S]*?<\/\1\s*>/gi,
      function (m, name) {
        self.warn(lineNo, '不支持的 HTML 标签 &lt;' + name.toLowerCase() + '&gt; 及其内容已移除。', 'warning');
        return '';
      }
    );
    out = out.replace(/<!DOCTYPE[^>]*>/gi, '');

    // 链接
    out = out.replace(
      /<a\b[^>]*?href\s*=\s*["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\/a\s*>/gi,
      function (m, href, inner) {
        const url = self.normalizeUrl(href, lineNo);
        if (url == null) return inner;
        return '[url=' + url + ']' + inner + '[/url]';
      }
    );

    // 图片
    out = out.replace(
      /<img\b[^>]*?src\s*=\s*["']?([^"'>\s]+)["']?[^>]*\/?>/gi,
      function (m, src) {
        const url = self.normalizeUrl(src, lineNo);
        if (url == null) return '';
        return '[img]' + url + '[/img]';
      }
    );

    // 通用标签映射
    out = out.replace(
      /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g,
      function (m, slash, name, attrs) {
        return self.mapHtmlTag(!!slash.length, name.toLowerCase(), attrs, lineNo);
      }
    );

    return decodeEntities(out);
  };

  Converter.prototype.mapHtmlTag = function (closing, name, attrs, lineNo) {
    const self = this;

    if (attrs && attrs.trim()) {
      const attrNames = [];
      const re = /([a-zA-Z-]+)\s*=/g;
      let am;
      while ((am = re.exec(attrs))) attrNames.push(am[1].toLowerCase());
      attrNames.forEach(function (a) {
        if (a !== 'href' && a !== 'src' && !self._htmlWarnedAttrs[a]) {
          self._htmlWarnedAttrs[a] = true;
          self.warn(lineNo, 'HTML 属性「' + a + '」Steam 不支持，已忽略。', 'info');
        }
      });
    }

    // 成对映射表
    const paired = {
      b: 'b', strong: 'b',
      i: 'i', em: 'i',
      u: 'u',
      s: 'strike', del: 'strike', strike: 'strike',
      blockquote: 'quote',
      ul: 'list', ol: 'olist',
      code: 'code', pre: 'code',
      table: 'table', tr: 'tr', th: 'th', td: 'td'
    };

    if (paired[name]) {
      return closing ? '[/' + paired[name] + ']' : '[' + paired[name] + ']';
    }

    if (/^h([1-6])$/.test(name)) {
      const lvl = parseInt(RegExp.$1, 10);
      if (lvl <= 3) return closing ? '[/h' + lvl + ']' : '[h' + lvl + ']';
      if (!closing) {
        this.warn(lineNo, 'Steam 仅支持一至三级标题，&lt;' + name + '&gt; 已降级为粗体。', 'warning');
      }
      return closing ? '[/b]' : '[b]';
    }

    if (name === 'br') return '\n';
    if (name === 'hr') return '[hr][/hr]';
    if (name === 'p') return closing ? '\n' : '';
    if (name === 'li') return closing ? '' : '[*] ';
    if (name === 'a' || name === 'img') return '';

    // 无意义容器 / 未知标签：剥除并提示一次
    if (!this._htmlWarnedTags[name]) {
      this._htmlWarnedTags[name] = true;
      this.warn(lineNo, '不支持的 HTML 标签 &lt;' + name + '&gt; 已移除（保留其中的文字）。', 'warning');
    }
    return '';
  };

  /* ============ 行内解析 ============ */

  const EMPHASIS_PATTERNS = [
    { re: /^\*\*\*([\s\S]+?)\*\*\*(?!\*)/, open: '[b][i]', mid: true, close: '[/i][/b]' },
    { re: /^___([\s\S]+?)___(?!_)/,        open: '[b][i]', mid: true, close: '[/i][/b]' },
    { re: /^\*\*([\s\S]+?)\*\*(?!\*)/,     open: '[b]',    mid: true, close: '[/b]' },
    { re: /^__([\s\S]+?)__(?!_)/,         open: '[b]',    mid: true, close: '[/b]' },
    { re: /^\*([^\s*][\s\S]*?)\*(?!\*)/,   open: '[i]',    mid: true, close: '[/i]' },
    { re: /^~~([\s\S]+?)~~(?!~)/,          open: '[strike]', mid: true, close: '[/strike]' },
    { re: /^\+\+([\s\S]+?)\+\+(?!\+)/,     open: '[u]',    mid: true, close: '[/u]' }
  ];

  const ESCAPABLE_CHARS = '!"#$%&\'()*+,./:;<=>?@[\\]^_`{|}~-';

  Converter.prototype.parseInline = function (raw, lineNo) {
    const s = String(raw);
    let out = '';
    let pos = 0;

    while (pos < s.length) {
      const ch = s[pos];
      const rest = s.slice(pos);
      let m;

      // 反斜杠转义
      if (ch === '\\' && s[pos + 1] && ESCAPABLE_CHARS.indexOf(s[pos + 1]) !== -1) {
        out += s[pos + 1];
        pos += 2;
        continue;
      }

      // 代码 span
      if (ch === '`') {
        const ticks = /^(`+)/.exec(rest)[1];
        const closeIdx = s.indexOf(ticks, pos + ticks.length);
        if (closeIdx !== -1) {
          let content = s.slice(pos + ticks.length, closeIdx)
            .replace(/\n/g, ' ');
          content = stripCodePadding(content);
          out += '[code]' + content + '[/code]';
          pos = closeIdx + ticks.length;
          continue;
        }
        out += ch;
        pos++;
        continue;
      }

      // 图片 / 剧透
      if (ch === '!') {
        // 剧透扩展语法 !!!内容!!!（Steamdown 风格）
        if ((m = /^!!!([\s\S]+?)!!!(?!!)/.exec(rest))) {
          out += '[spoiler]' + this.parseInline(m[1], lineNo) + '[/spoiler]';
          pos += m[0].length;
          continue;
        }
        if (s[pos + 1] === '[') {
          const r = this.tryImage(rest, lineNo);
          if (r) { out += r.text; pos += r.len; continue; }
        }
      }

      // 链接 / 引用链接 / 脚注
      if (ch === '[') {
        // 图片链接 [![alt](imgurl)](linkurl)
        if ((m = /^\[!\[([^\]]*)\]\(\s*([^()]*?)\s*\)\]\(\s*([^()]*?)\s*\)/.exec(rest))) {
          const r = this.buildLinkedImage(m[1], m[2], m[3], lineNo);
          out += r;
          pos += m[0].length;
          continue;
        }

        if (/^\[\^[^\]]*\]/.test(rest)) {
          const fm = /^\[\^[^\]]*\]/.exec(rest)[0];
          this.warn(lineNo, '脚注 ' + fm + ' Steam 不支持，已按普通文本保留。', 'warning');
          out += fm;
          pos += fm.length;
          continue;
        }
        const r = this.tryLink(rest, lineNo);
        if (r) { out += r.text; pos += r.len; continue; }
        out += ch;
        pos++;
        continue;
      }

      // 自动链接 / 行内 HTML
      if (ch === '<') {
        if ((m = /^<https?:\/\/[^\s>]+>/.exec(rest))) {
          const url = m[0].slice(1, -1);
          out += '[url=' + url + ']' + url + '[/url]';
          pos += m[0].length;
          continue;
        }
        // 完整的行内结构：<a>…</a>、<img>、<script/style>…</…>
        if ((m = /^<a\b[^>]*>[\s\S]*?<\/a\s*>/i.exec(rest)) ||
            (m = /^<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/i.exec(rest)) ||
            (m = /^<img\b[^>]*?\/?>/i.exec(rest))) {
          const converted = this.convertHtml(m[0], lineNo);
          out += converted;
          pos += m[0].length;
          continue;
        }
        // 单个 HTML 标签
        if ((m = /^<\/?[a-zA-Z][^<>]*?>/.exec(rest))) {
          const converted = this.convertHtml(m[0], lineNo);
          if (converted) { out += converted; pos += m[0].length; continue; }
          out += '';
          pos += m[0].length;
          continue;
        }
        out += ch;
        pos++;
        continue;
      }

      // 下划线强调：词内不触发
      if (ch === '_') {
        const prevIsWord = pos > 0 && /\w/.test(s[pos - 1]);
        if (!prevIsWord) {
          const em = this.matchEmphasis(rest);
          if (em) {
            out += em.open + this.parseInline(em.content, lineNo) + em.close;
            pos += em.len;
            continue;
          }
        }
        out += ch;
        pos++;
        continue;
      }

      // * 强调
      if (ch === '*') {
        const em = this.matchEmphasis(rest);
        if (em) {
          out += em.open + this.parseInline(em.content, lineNo) + em.close;
          pos += em.len;
          continue;
        }
        out += ch;
        pos++;
        continue;
      }

      // 删除线
      if (ch === '~' && s[pos + 1] === '~') {
        const em = this.matchEmphasis(rest);
        if (em) {
          out += em.open + this.parseInline(em.content, lineNo) + em.close;
          pos += em.len;
          continue;
        }
        out += ch;
        pos++;
        continue;
      }

      // 下划线扩展 ++
      if (ch === '+' && s[pos + 1] === '+') {
        const em = this.matchEmphasis(rest);
        if (em) {
          out += em.open + this.parseInline(em.content, lineNo) + em.close;
          pos += em.len;
          continue;
        }
        out += ch;
        pos++;
        continue;
      }

      // 高亮 ==（Steam 不支持）
      if (ch === '=' && s[pos + 1] === '=') {
        if ((m = /^==([\s\S]+?)==(?!=)/.exec(rest))) {
          this.warn(lineNo, '文字高亮 ==…== Steam 不支持，已还原为普通文字。', 'warning');
          out += this.parseInline(m[1], lineNo);
          pos += m[0].length;
          continue;
        }
        out += ch;
        pos++;
        continue;
      }

      // 行内数学公式（Steam 不支持）
      if (ch === '$' && (m = /^\$([^$\n]+?)\$/.exec(rest))) {
        this.warn(lineNo, '数学公式 $…$ Steam 不支持，已按普通文本保留。', 'warning');
        out += m[1];
        pos += m[0].length;
        continue;
      }

      out += ch;
      pos++;
    }

    return out;
  };

  Converter.prototype.matchEmphasis = function (rest) {
    for (let i = 0; i < EMPHASIS_PATTERNS.length; i++) {
      const p = EMPHASIS_PATTERNS[i];
      const m = p.re.exec(rest);
      if (m && m[1].trim()) {
        return { open: p.open, close: p.close, content: m[1], len: m[0].length };
      }
    }
    return null;
  };

  /* ---- 链接 / 图片目标解析 ---- */

  Converter.prototype.parseDestination = function (destRaw) {
    let d = destRaw.trim();
    if (d.charAt(0) === '<' && d.charAt(d.length - 1) === '>') d = d.slice(1, -1);
    let url = d;
    let title = '';
    const ws = /\s+/.exec(d);
    if (ws) {
      url = d.slice(0, ws.index);
      title = d.slice(ws.index + ws[0].length).trim().replace(/^["'(]|["')]$/g, '');
    }
    return { url: url.trim(), title: title };
  };

  Converter.prototype.normalizeUrl = function (url, lineNo) {
    let u = String(url).trim();
    if (!u) return null;
    const schemeM = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(u);
    if (schemeM) {
      const scheme = schemeM[1].toLowerCase();
      if (scheme === 'http' || scheme === 'https') return u;
      this.warn(lineNo, '链接协议「' + scheme + ':」Steam 不支持，链接已转为纯文本。', 'warning');
      return null;
    }
    if (u.charAt(0) === '/' && u.charAt(1) === '/') return 'https:' + u;
    if (u.charAt(0) === '#') return null;
    return 'https://' + u;
  };

  Converter.prototype.tryLink = function (rest, lineNo) {
    let m;

    // 行内链接 [label](dest)
    if ((m = /^\[([^\]]*)\]\(\s*([^()]*?)\s*\)/.exec(rest))) {
      const label = m[1];
      const dest = this.parseDestination(m[2]);
      if (dest.title) {
        this.warn(lineNo, '链接标题（title）Steam 不支持，已忽略。', 'info');
      }
      const url = this.normalizeUrl(dest.url, lineNo);
      if (url == null) {
        return { text: this.parseInline(label, lineNo), len: m[0].length };
      }
      return {
        text: '[url=' + url + ']' + this.parseInline(label, lineNo) + '[/url]',
        len: m[0].length
      };
    }

    // 完整 / 折叠引用链接 [label][ref]、[label][]
    if ((m = /^\[([^\]]+)\]\[([^\]]*)\]/.exec(rest))) {
      const label = m[1];
      const refKey = (m[2] || label).trim().toLowerCase();
      const ref = this.refs[refKey];
      if (!ref) {
        this.warn(lineNo, '引用链接「' + (m[2] || label) + '」的定义未找到，已按普通文本处理。', 'warning');
        return { text: this.parseInline(label, lineNo), len: label.length + 2 };
      }
      const url = this.normalizeUrl(ref.url, lineNo);
      if (url == null) return { text: this.parseInline(label, lineNo), len: m[0].length };
      return {
        text: '[url=' + url + ']' + this.parseInline(label, lineNo) + '[/url]',
        len: m[0].length
      };
    }

    // 快捷引用链接 [label]
    if ((m = /^\[([^\]]+)\]/.exec(rest))) {
      const label = m[1];
      const ref = this.refs[label.trim().toLowerCase()];
      if (ref) {
        const url = this.normalizeUrl(ref.url, lineNo);
        if (url == null) return { text: this.parseInline(label, lineNo), len: m[0].length };
        return {
          text: '[url=' + url + ']' + this.parseInline(label, lineNo) + '[/url]',
          len: m[0].length
        };
      }
    }

    return null;
  };

  Converter.prototype.buildLinkedImage = function (alt, imgDestRaw, linkDestRaw, lineNo) {
    const imgDest = this.parseDestination(imgDestRaw);
    const linkDest = this.parseDestination(linkDestRaw);
    if (imgDest.title || linkDest.title) {
      this.warn(lineNo, '链接 / 图片标题（title）Steam 不支持，已忽略。', 'info');
    }
    const imgUrl = this.normalizeUrl(imgDest.url, lineNo);
    const linkUrl = this.normalizeUrl(linkDest.url, lineNo);
    const altText = alt ? this.parseInline(alt, lineNo) : '';

    if (imgUrl == null && linkUrl == null) return altText;
    if (imgUrl == null) return '[url=' + linkUrl + ']' + altText + '[/url]';
    if (linkUrl == null) return '[img]' + imgUrl + '[/img]';
    return '[url=' + linkUrl + '][img]' + imgUrl + '[/img][/url]';
  };

  Converter.prototype.tryImage = function (rest, lineNo) {
    let m;

    // 行内图片 ![alt](dest)
    if ((m = /^!\[([^\]]*)\]\(\s*([^()]*?)\s*\)/.exec(rest))) {
      const alt = m[1];
      const dest = this.parseDestination(m[2]);
      if (dest.title) {
        this.warn(lineNo, '图片标题（title）Steam 不支持，已忽略。', 'info');
      }
      const url = this.normalizeUrl(dest.url, lineNo);
      if (url == null) {
        this.warn(lineNo, '图片地址「' + dest.url + '」无效，已移除该图片。', 'warning');
        return { text: alt ? this.parseInline(alt, lineNo) : '', len: m[0].length };
      }
      return { text: '[img]' + url + '[/img]', len: m[0].length };
    }

    // 引用图片
    if ((m = /^!\[([^\]]*)\]\[([^\]]*)\]/.exec(rest))) {
      const alt = m[1];
      const refKey = (m[2] || alt).trim().toLowerCase();
      const ref = this.refs[refKey];
      if (!ref) {
        this.warn(lineNo, '引用图片「' + (m[2] || alt) + '」的定义未找到，已按普通文本处理。', 'warning');
        return { text: this.parseInline(alt, lineNo), len: alt.length + 4 };
      }
      const url = this.normalizeUrl(ref.url, lineNo);
      if (url == null) return { text: this.parseInline(alt, lineNo), len: m[0].length };
      return { text: '[img]' + url + '[/img]', len: m[0].length };
    }

    return null;
  };

  /* ---------------- 对外接口 ---------------- */

  function convertMarkdown(source, options) {
    return new Converter().convert(source, options);
  }

  global.SteamMarkdown = {
    convert: convertMarkdown,
    Converter: Converter
  };

})(typeof window !== 'undefined' ? window : this);
