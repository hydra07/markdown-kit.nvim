# markdown-kit.nvim

Neovim Markdown preview plugin with:
- Rust core server (`apps/core`)
- Preact client UI (`apps/client`)
- Lua plugin entrypoint (`nvim/`)

## Install with lazy.nvim

```lua
{
  "hydra07/markdown-kit.nvim",
  ft = { "markdown" },
  build = "mise run setup && mise run build",
  config = function()
    -- Optional: custom root path if needed
    -- vim.g.markdown_kit_root = vim.fn.stdpath("data") .. "/lazy/markdown-kit.nvim/"
  end,
}
```

After install:
- `:MarkdownKitStart` (or `:MkStart`) to open preview
- `:MarkdownKitStop` (or `:MkStop`) to stop

## Local development

```bash
mise run setup
mise run check
mise run build
```

Useful tasks:
- `mise run client:dev`
- `mise run core:run`
- `mise run release`

## CI / Release

- CI workflow: `.github/workflows/ci.yml` (runs `mise run ci`)
- Release workflow: `.github/workflows/release.yml`
  - Triggered by pushing a tag like `v0.1.0`
  - Builds client + core on Linux/macOS/Windows
  - Publishes bundled release artifacts to GitHub Releases
