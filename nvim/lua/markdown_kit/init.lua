local M = {}

-- ─── State ────────────────────────────────────────────────────────────────────

local state = {
  job     = nil,
  port    = nil,
  ready   = false,   -- true sau khi đọc được "mk-core:ready" từ stdout
  bufnr   = nil,
  bin     = nil,
}

-- ─── Config ───────────────────────────────────────────────────────────────────

local current_file = debug.getinfo(1, "S").source:sub(2)
local project_root = vim.fn.fnamemodify(current_file, ":p:h:h:h:h") .. "/"

if vim.g.markdown_kit_root and vim.g.markdown_kit_root ~= "" then
  project_root = vim.g.markdown_kit_root
end

local host   = "127.0.0.1"
local augroup = vim.api.nvim_create_augroup("MarkdownKitSync", { clear = true })

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

local function binary_candidates()
  local name = binary_name()
  local out = {}

  -- Highest priority: explicit override
  if vim.g.markdown_kit_binary and vim.g.markdown_kit_binary ~= "" then
    table.insert(out, vim.g.markdown_kit_binary)
  end

  -- Release/runtime layout: ship binary with plugin.
  table.insert(out, project_root .. "nvim/bin/" .. name)

  -- Optional user cache location.
  table.insert(out, vim.fn.stdpath("data") .. "/markdown-kit.nvim/bin/" .. name)

  -- Dev fallback (for contributors using source repo).
  table.insert(out, project_root .. "apps/core/target/release/" .. name)

  return out
end

local function resolve_binary()
  for _, path in ipairs(binary_candidates()) do
    if file_exists(path) then return path end
  end
  return nil
end

local function is_port_free(port)
  local tcp = vim.uv.new_tcp()
  if not tcp then return false end
  local ok = pcall(function() tcp:bind(host, port) end)
  tcp:close()
  return ok
end

local function get_port()
  local p = tonumber(vim.g.markdown_kit_port or vim.g.mkdp_port)
  if p and p > 0 then return math.floor(p) end
  return 35831
end

local function get_theme()
  local t = vim.g.markdown_kit_theme or vim.g.mkdp_theme or "dark"
  return (t == "light") and "light" or "dark"
end

-- ─── IPC — raw send, no debounce (Rust handles that) ─────────────────────────

local function send(payload)
  if not is_running() then return end
  vim.fn.chansend(state.job, vim.fn.json_encode(payload) .. "\n")
end

-- ─── Sync ─────────────────────────────────────────────────────────────────────

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

  -- Gửi raw — Rust debounce
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
      if vim.g.markdown_kit_auto_close ~= 0 then M.stop() end
    end,
  })
  vim.api.nvim_create_autocmd("VimLeavePre", {
    group = augroup,
    callback = M.stop,
  })
end

-- ─── Binary launcher ──────────────────────────────────────────────────────────

local function ensure_binary()
  local bin = resolve_binary()
  if bin then
    state.bin = bin
    return bin
  end

  notify(
    "mk-core binary not found. Place binary at nvim/bin/" .. binary_name()
      .. " or set vim.g.markdown_kit_binary",
    vim.log.levels.ERROR
  )
  return nil
end

-- ─── Public API ───────────────────────────────────────────────────────────────

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

  local bin = ensure_binary()
  if not bin then return end

  state.port  = port
  state.bufnr = vim.api.nvim_get_current_buf()

  state.job = vim.fn.jobstart({ bin }, {
    cwd    = project_root,
    detach = false,

    -- Rust tự mở browser và debounce — Lua chỉ cần env vars
    env = {
      MK_PORT         = tostring(port),
      MK_OPEN_BROWSER = "1",
      MK_BROWSER_URL  = ("http://" .. host .. ":" .. tostring(port) .. "/"),
      -- tuning (optional, Rust has defaults)
      -- MK_DEBOUNCE_MS        = "80",
      -- MK_INSERT_DEBOUNCE_MS = "35",
      -- MK_CURSOR_THROTTLE_MS = "16",
    },

    -- Đọc stdout để biết server đã ready trước khi gửi content
    on_stdout = function(_, data)
      for _, line in ipairs(data) do
        if line:match("^mk%-core:ready:") then
          state.ready = true
          -- Server đã bind — gửi content lần đầu
          vim.schedule(sync_content)
        end
      end
    end,

    on_stderr = function(_, data)
      for _, line in ipairs(data) do
        if line and line ~= "" then
          -- chỉ log khi debug cần thiết
          -- vim.schedule(function() notify("[stderr] " .. line) end)
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