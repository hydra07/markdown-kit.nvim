local M = {}

-- ─── State ────────────────────────────────────────────────────────────────────

local state = {
  job   = nil,
  port  = nil,
  ready = false, -- true once "mk-core:ready" is read from stdout
  bufnr = nil,
  bin   = nil,
}

-- User config set via setup(); resolution priority is:
--   setup() opts  >  vim.g.*  >  built-in default
local user_opts = {}

-- ─── Path detection ───────────────────────────────────────────────────────────

local current_file = debug.getinfo(1, "S").source:sub(2)

local function normalize_slashes(path)
  return (path:gsub("\\", "/"))
end

local function detect_project_root()
  local abs_file = normalize_slashes(vim.fn.fnamemodify(current_file, ":p"))
  local file_dir = normalize_slashes(vim.fn.fnamemodify(abs_file, ":p:h"))

  -- Source layout: <root>/nvim/lua/markdown_kit/init.lua
  if abs_file:match("/nvim/lua/markdown_kit/init%.lua$") then
    return normalize_slashes(vim.fn.fnamemodify(file_dir, ":h:h:h"))
  end

  -- Runtime layout: <root>/lua/markdown_kit/init.lua
  if abs_file:match("/lua/markdown_kit/init%.lua$") then
    return normalize_slashes(vim.fn.fnamemodify(file_dir, ":h:h"))
  end

  return normalize_slashes(vim.fn.fnamemodify(file_dir, ":h:h:h"))
end

local host = "127.0.0.1"
local augroup = vim.api.nvim_create_augroup("MarkdownKitSync", { clear = true })

-- ─── Config ───────────────────────────────────────────────────────────────────

-- Resolve a single option: setup() opts > vim.g override(s) > default.
local function opt(key, g_keys, default)
  if user_opts[key] ~= nil then return user_opts[key] end
  for _, g in ipairs(g_keys) do
    local v = vim.g[g]
    if v ~= nil and v ~= "" then return v end
  end
  return default
end

local function project_root()
  local root = opt("root", { "markdown_kit_root" }, nil)
  if not root or root == "" then root = detect_project_root() end
  if not root:match("/$") then root = root .. "/" end
  return root
end

local function get_port()
  local p = tonumber(opt("port", { "markdown_kit_port", "mkdp_port" }, 35831))
  if p and p > 0 then return math.floor(p) end
  return 35831
end

local function get_theme()
  local t = opt("theme", { "markdown_kit_theme", "mkdp_theme" }, "dark")
  return (t == "light") and "light" or "dark"
end

local function auto_close_enabled()
  -- Back-compat: vim.g.markdown_kit_auto_close == 0 disables.
  if user_opts.auto_close ~= nil then return user_opts.auto_close ~= false end
  return vim.g.markdown_kit_auto_close ~= 0
end

local function auto_build_enabled()
  -- Defaults on (dev convenience); runtime branches ship a prebuilt binary so
  -- this never triggers there.
  return opt("auto_build", { "markdown_kit_auto_build" }, true) ~= false
end

-- ─── Helpers ──────────────────────────────────────────────────────────────────

local function notify(msg, level)
  vim.notify("[markdown-kit] " .. msg, level or vim.log.levels.INFO)
end

local function is_running()
  return state.job ~= nil and vim.fn.jobwait({ state.job }, 0)[1] == -1
end

local function file_exists(path)
  return vim.uv.fs_stat(path) ~= nil
end

local function is_windows()
  return vim.fn.has("win32") == 1 or vim.fn.has("win64") == 1
end

local function binary_name()
  return is_windows() and "mk-core.exe" or "mk-core"
end

local function mtime_ns(path)
  local stat = vim.uv.fs_stat(path)
  if not stat or not stat.mtime then return nil end
  return (stat.mtime.sec or 0) * 1000000000 + (stat.mtime.nsec or 0)
end

-- ─── Binary resolution ────────────────────────────────────────────────────────

local function dev_target_binary(root)
  return root .. "apps/core/target/release/" .. binary_name()
end

local function binary_candidates(root)
  local name = binary_name()
  local out = {}

  -- Highest priority: explicit override.
  local override = opt("binary", { "markdown_kit_binary" }, nil)
  if override and override ~= "" then table.insert(out, override) end

  -- Release/runtime layout: binary shipped alongside the plugin.
  table.insert(out, root .. "bin/" .. name)
  table.insert(out, root .. "nvim/bin/" .. name)

  -- Optional user cache location.
  table.insert(out, vim.fn.stdpath("data") .. "/markdown-kit.nvim/bin/" .. name)

  -- Dev fallback (contributors building from source).
  table.insert(out, dev_target_binary(root))

  return out
end

local function resolve_prebuilt(root)
  for _, path in ipairs(binary_candidates(root)) do
    if file_exists(path) then return path end
  end
  return nil
end

-- The dev binary embeds client assets at compile time (rust-embed). Rebuild when
-- web assets or core sources are newer than the binary.
local function is_dev_binary_stale(root, bin)
  local bin_mtime = mtime_ns(bin)
  if not bin_mtime then return true end

  local watch_files = {
    root .. "apps/client/dist/index.html",
    root .. "apps/core/src/server.rs",
    root .. "apps/core/src/markdown/mod.rs",
  }
  for _, path in ipairs(watch_files) do
    local changed_at = mtime_ns(path)
    if changed_at and changed_at > bin_mtime then return true end
  end
  return false
end

local function build_dev_binary(root)
  if vim.fn.executable("cargo") ~= 1 then
    notify("cargo not found — cannot auto-build mk-core", vim.log.levels.ERROR)
    return nil
  end

  notify("Building mk-core (binary missing or stale)…")
  local result = vim.system(
    { "cargo", "build", "--release", "--manifest-path", root .. "apps/core/Cargo.toml" },
    { cwd = root, text = true }
  ):wait()

  if result.code ~= 0 then
    notify("Build failed:\n" .. (result.stderr or ""), vim.log.levels.ERROR)
    return nil
  end
  return dev_target_binary(root)
end

local function ensure_binary(root)
  -- A fresh prebuilt binary wins outright.
  local prebuilt = resolve_prebuilt(root)
  local dev_bin = dev_target_binary(root)

  -- When auto-build is on and we're in a source checkout, prefer a fresh dev
  -- build over a possibly-stale prebuilt dev target.
  if auto_build_enabled() and file_exists(root .. "apps/core/Cargo.toml") then
    if prebuilt and prebuilt ~= dev_bin then
      return prebuilt
    end
    if file_exists(dev_bin) and not is_dev_binary_stale(root, dev_bin) then
      return dev_bin
    end
    return build_dev_binary(root)
  end

  if prebuilt then return prebuilt end

  notify(
    "mk-core binary not found. Place it at bin/" .. binary_name()
      .. " (or nvim/bin/" .. binary_name() .. ") or set vim.g.markdown_kit_binary",
    vim.log.levels.ERROR
  )
  return nil
end

-- ─── Port ─────────────────────────────────────────────────────────────────────

local function is_port_free(port)
  local tcp = vim.uv.new_tcp()
  if not tcp then return false end
  local ok = pcall(function() tcp:bind(host, port) end)
  tcp:close()
  return ok
end

-- ─── IPC — raw send, Rust owns debounce/throttle ──────────────────────────────

local function send(payload)
  if not is_running() then return end
  vim.fn.chansend(state.job, vim.fn.json_encode(payload) .. "\n")
end

local function sync_content()
  local bufnr = state.bufnr or vim.api.nvim_get_current_buf()
  if not vim.api.nvim_buf_is_valid(bufnr) then return end
  local lines  = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
  local cursor = vim.api.nvim_win_get_cursor(0)
  send({
    type = "preview:update",
    payload = {
      fileName   = vim.api.nvim_buf_get_name(bufnr),
      markdown   = table.concat(lines, "\n"),
      cursorLine = cursor[1],
      lineCount  = #lines,
      theme      = get_theme(),
    },
  })
end

local function sync_cursor()
  local cursor = vim.api.nvim_win_get_cursor(0)
  local bufnr  = state.bufnr or vim.api.nvim_get_current_buf()
  send({
    type = "cursor:update",
    payload = {
      cursorLine = cursor[1],
      lineCount  = vim.api.nvim_buf_line_count(bufnr),
    },
  })
end

-- ─── Autocmds ─────────────────────────────────────────────────────────────────

local function attach_autocmds(bufnr)
  vim.api.nvim_clear_autocmds({ group = augroup, buffer = bufnr })

  vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI", "InsertLeave", "BufWritePost" }, {
    group = augroup, buffer = bufnr,
    callback = sync_content,
  })
  vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
    group = augroup, buffer = bufnr,
    callback = sync_cursor,
  })
  vim.api.nvim_create_autocmd("BufHidden", {
    group = augroup, buffer = bufnr,
    callback = function()
      if auto_close_enabled() then M.stop() end
    end,
  })
  vim.api.nvim_create_autocmd("VimLeavePre", {
    group = augroup,
    callback = function() M.stop() end,
  })
end

-- ─── Public API ───────────────────────────────────────────────────────────────

function M.setup(opts)
  user_opts = vim.tbl_extend("force", user_opts, opts or {})
end

function M.start()
  if is_running() then
    notify("Already running")
    return
  end

  local port = get_port()
  if not is_port_free(port) then
    notify(("Port %d already in use"):format(port), vim.log.levels.ERROR)
    return
  end

  local root = project_root()
  local bin = ensure_binary(root)
  if not bin then return end

  state.bin   = bin
  state.port  = port
  state.bufnr = vim.api.nvim_get_current_buf()

  state.job = vim.fn.jobstart({ bin }, {
    cwd    = root,
    detach = false,

    env = {
      MK_PORT         = tostring(port),
      MK_OPEN_BROWSER = "1",
      MK_BROWSER_URL  = ("http://" .. host .. ":" .. tostring(port) .. "/"),
    },

    -- Read stdout to learn when the server has bound before sending content.
    on_stdout = function(_, data)
      for _, line in ipairs(data) do
        if line:match("^mk%-core:ready:") then
          state.ready = true
          vim.schedule(sync_content)
        end
      end
    end,

    on_exit = function(_, code)
      state.ready = false
      if code ~= 0 then
        vim.schedule(function()
          notify("Core exited with code " .. code, vim.log.levels.ERROR)
        end)
      end
    end,
  })

  if not state.job or state.job <= 0 then
    notify("Failed to spawn binary", vim.log.levels.ERROR)
    state.job = nil
    return
  end

  attach_autocmds(state.bufnr)
  notify(("Preview started on port :%d"):format(port))
end

function M.stop()
  send({ type = "preview:close" })
  if is_running() then
    vim.fn.jobstop(state.job)
  end
  state.job   = nil
  state.port  = nil
  state.ready = false
  state.bufnr = nil
  state.bin   = nil
  vim.api.nvim_clear_autocmds({ group = augroup })
  notify("Preview stopped")
end

function M.toggle()
  if is_running() then M.stop() else M.start() end
end

return M
