import MarkdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import markdownItDeflist from "markdown-it-deflist";
import { full as markdownItEmoji } from "markdown-it-emoji";
import markdownItFootnote from "markdown-it-footnote";
import markdownItTaskLists from "markdown-it-task-lists";
import markdownItToc from "markdown-it-toc-done-right";

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
  html: true, linkify: true, typographer: true,
  highlight(str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`;
      } catch {
        // fallthrough to escaped output
      }
    }
    return `<pre class="hljs"><code>${escapeHtml(str)}</code></pre>`;
  },
});

markdownEngine
  .use(markdownItEmoji)
  .use(markdownItTaskLists)
  .use(markdownItFootnote)
  .use(markdownItDeflist)
  .use(markdownItAnchor)
  .use(markdownItToc);

markdownEngine.core.ruler.push("source_line_meta", (state) => {
  for (const token of state.tokens) {
    if (!token.block || token.nesting !== 1 || !token.map) continue;
    const start = token.map[0] + 1;
    const end = Math.max(start, token.map[1]);
    token.attrSet("data-src-start", String(start));
    token.attrSet("data-src-end", String(end));
  }
});

export function renderMarkdown(markdown: string): string {
  return markdownEngine.render(markdown);
}
