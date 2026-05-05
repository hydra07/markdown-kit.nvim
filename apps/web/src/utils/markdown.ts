// @ts-nocheck
import MarkdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import markdownItDeflist from "markdown-it-deflist";
import { full as markdownItEmoji } from "markdown-it-emoji";
import markdownItFootnote from "markdown-it-footnote";
import markdownItTaskLists from "markdown-it-task-lists";
import markdownItToc from "markdown-it-toc-done-right";
import markdownItKatex from "@traptitech/markdown-it-katex";

import hljs from "highlight.js/lib/core";
import langBash from "highlight.js/lib/languages/bash";
import langC from "highlight.js/lib/languages/c";
import langCpp from "highlight.js/lib/languages/cpp";
import langCss from "highlight.js/lib/languages/css";
import langDiff from "highlight.js/lib/languages/diff";
import langGo from "highlight.js/lib/languages/go";
import langHtml from "highlight.js/lib/languages/xml";
import langJson from "highlight.js/lib/languages/json";
import langLua from "highlight.js/lib/languages/lua";
import langMd from "highlight.js/lib/languages/markdown";
import langPython from "highlight.js/lib/languages/python";
import langRust from "highlight.js/lib/languages/rust";
import langShell from "highlight.js/lib/languages/shell";
import langSql from "highlight.js/lib/languages/sql";
import langToml from "highlight.js/lib/languages/ini";
import langTs from "highlight.js/lib/languages/typescript";
import langYaml from "highlight.js/lib/languages/yaml";

function escapeHtml(source: string): string {
  return source
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderHighlightedCode(code: string, lang?: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang }).value;
    } catch {
      // fallthrough to escaped output
    }
  }
  return escapeHtml(code);
}

hljs.registerLanguage("bash", langBash);
hljs.registerLanguage("c", langC);
hljs.registerLanguage("cpp", langCpp);
hljs.registerLanguage("css", langCss);
hljs.registerLanguage("diff", langDiff);
hljs.registerLanguage("go", langGo);
hljs.registerLanguage("html", langHtml);
hljs.registerLanguage("xml", langHtml);
hljs.registerLanguage("json", langJson);
hljs.registerLanguage("lua", langLua);
hljs.registerLanguage("markdown", langMd);
hljs.registerLanguage("python", langPython);
hljs.registerLanguage("rust", langRust);
hljs.registerLanguage("sh", langShell);
hljs.registerLanguage("shell", langShell);
hljs.registerLanguage("sql", langSql);
hljs.registerLanguage("toml", langToml);
hljs.registerLanguage("ini", langToml);
hljs.registerLanguage("typescript", langTs);
hljs.registerLanguage("ts", langTs);
hljs.registerLanguage("yaml", langYaml);

const markdownEngine = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(str, lang) {
    return `<pre class="hljs"><code>${renderHighlightedCode(str, lang)}</code></pre>`;
  },
});

markdownEngine
  .use(markdownItEmoji)
  .use(markdownItTaskLists)
  .use(markdownItFootnote)
  .use(markdownItDeflist)
  .use(markdownItAnchor)
  .use(markdownItToc)
  .use(markdownItKatex);

markdownEngine.core.ruler.push("source_line_meta", (state) => {
  for (const token of state.tokens) {
    if (!token.block || token.nesting !== 1 || !token.map) continue;
    const start = token.map[0] + 1;
    const end = Math.max(start, token.map[1]);
    token.attrSet("data-src-start", String(start));
    token.attrSet("data-src-end", String(end));
  }
});

markdownEngine.renderer.rules.fence = (tokens, idx, options) => {
  const token = tokens[idx];
  if (!token) return "";
  const info = (token.info ?? "").trim();
  const lang = info.split(/\s+/g)[0] || "";
  const attrs = options?.xhtmlOut ? " /" : "";
  const dataStart = token.attrGet("data-src-start");
  const dataEnd = token.attrGet("data-src-end");
  const dataAttrs =
    dataStart && dataEnd
      ? ` data-src-start="${dataStart}" data-src-end="${dataEnd}"`
      : "";

  if (lang === "mermaid") {
    return `<pre class="mermaid"${dataAttrs}>${escapeHtml(token.content)}</pre>`;
  }

  return `<pre class="hljs"${dataAttrs}><code class="language-${lang}">${renderHighlightedCode(token.content, lang)}</code></pre>${attrs}\n`;
};

export function renderMarkdown(markdown: string): string {
  // Pre-process images with size syntax ![alt](url =WxH)
  // This avoids needing heavy node-only plugins like markdown-it-imsize
  const processed = markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\s+=(\d*)x(\d*)\)/g,
    (match, alt, src, w, h) => {
      const width = w ? ` width="${w}"` : "";
      const height = h ? ` height="${h}"` : "";
      return `<img src="${src}" alt="${alt}"${width}${height} />`;
    },
  );
  return markdownEngine.render(processed);
}
