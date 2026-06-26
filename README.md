# markdown-kit.nvim

Neovim Markdown preview plugin with:
- Rust core server (`apps/core`)
- Preact client UI (`apps/client`)
- Lua plugin entrypoint (`nvim/`)

## Install with lazy.nvim

Use the runtime branch for your platform (lightweight, prebuilt binary included):

```lua
{
  "hydra07/markdown-kit.nvim",
  branch = "runtime-windows-x64", -- or runtime-linux-x64 / runtime-macos-x64
  ft = { "markdown" },
  opts = {
    -- All fields optional; defaults shown:
    -- port       = 35831,
    -- theme      = "dark",       -- "dark" | "light"
    -- auto_close = true,         -- close preview when the buffer is hidden
    -- auto_build = true,         -- build from source if no prebuilt binary (dev)
    -- binary     = nil,          -- explicit path to mk-core(.exe)
    -- root       = nil,          -- override plugin root
  },
}
```

`opts` is passed to `require("markdown_kit").setup()`. For back-compat the
matching `vim.g.markdown_kit_*` globals (and `vim.g.mkdp_port` / `vim.g.mkdp_theme`)
are still honoured; `setup()` values take precedence.

After install:
- `:MarkdownKitStart` (or `:MkStart`) to open preview
- `:MarkdownKitStop` (or `:MkStop`) to stop
- `:MarkdownKitToggle` (or `:MkToggle`) to toggle

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

## Pre-commit hook

```bash
mise run hooks:install
```

This configures Git to use the tracked hook in `.githooks/pre-commit`.

## CI / Release

- CI workflow: `.github/workflows/ci.yml` (runs `mise run ci`)
- Release workflow: `.github/workflows/release.yml`
  - Triggered by pushing a tag like `v0.1.0`
  - Builds client + core on Linux/macOS/Windows
  - Publishes runtime branches:
    - `runtime-windows-x64`
    - `runtime-linux-x64`
    - `runtime-macos-x64`
  - Packages runtime artifact with prebuilt binary at `nvim/bin/mk-core(.exe)`
  - Publishes bundled release artifacts to GitHub Releases
