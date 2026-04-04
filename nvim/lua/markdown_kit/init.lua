local M = {}

-- ─── State ────────────────────────────────────────────────────────────────────

local state = {
  service_job    = nil,
  web_job        = nil,
  service_port   = nil,
  web_port       = nil,
  content_tick   = 0,
  content_timer  = nil,
  preview_opened = false,
}

-- ─── Config ───────────────────────────────────────────────────────────────────

local project_root = "E:/dev/tool/markdown-preview.nvim/markdown-kit"
local host         = "127.0.0.1"
local augroup      = vim.api.nvim_create_augroup("MarkdownKitSync", { clear = true })

-- ─── Helpers ──────────────────────────────────────────────────────────────────

local function notify(msg, level)
  vim.notify("[markdown-kit] " .. msg, level or vim.log.levels.INFO)
end

local function run_mise_task(task_name, extra_env)
  local env = vim.tbl_extend("force", vim.fn.environ(), extra_env or {})
  local result = vim.system({ "mise", "run", task_name }, {
    cwd = project_root,
    env = env,
    text = true,
  }):wait()
  if result.code ~= 0 then
    local stderr = result.stderr or ""
    local stdout = result.stdout or ""
    notify(("Task '%s' failed:\n%s%s"):format(task_name, stdout, stderr), vim.log.levels.ERROR)
    return false
  end
  return true
end

local function is_running(job)
  return job ~= nil and vim.fn.jobwait({ job }, 0)[1] == -1
end

local function get_theme()
  local theme = vim.g.markdown_kit_theme or vim.g.mkdp_theme or "dark"
  return (theme == "light") and "light" or "dark"
end

local function get_web_port()
  local p = tonumber(vim.g.markdown_kit_web_port)
  return (p and p > 0) and p or 5173
end

local function get_preferred_service_port()
  local p = tonumber(vim.g.markdown_kit_port or vim.g.mkdp_port)
  if p and p > 0 then return p end
  return 20000 + (vim.uv.hrtime() % 30000)
end

-- ─── IPC ──────────────────────────────────────────────────────────────────────

local function send(payload)
  if not is_running(state.service_job) then return end
  vim.fn.chansend(state.service_job, vim.fn.json_encode(payload) .. "\n")
end

-- ─── Sync helpers ─────────────────────────────────────────────────────────────

--- Send only cursor position — no markdown, very cheap.
local function sync_cursor()
  local cursor     = vim.api.nvim_win_get_cursor(0)
  local line_count = vim.api.nvim_buf_line_count(vim.api.nvim_get_current_buf())
  send({
    type    = "cursor:update",
    payload = { cursorLine = cursor[1], lineCount = line_count },
  })
end

--- Send full content + metadata.
local function sync_content()
  local bufnr = vim.api.nvim_get_current_buf()
  if not vim.api.nvim_buf_is_valid(bufnr) then return end
  local lines  = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
  local cursor = vim.api.nvim_win_get_cursor(0)
  state.content_tick = state.content_tick + 1
  send({
    type    = "preview:update",
    payload = {
      bufnr        = bufnr,
      fileName     = vim.api.nvim_buf_get_name(bufnr),
      markdown     = table.concat(lines, "\n"),
      cursorLine   = cursor[1],
      lineCount    = #lines,
      theme        = get_theme(),
      contentTick  = state.content_tick,
    },
  })
end

--- Debounced content sync.
local function schedule_content_sync(delay_ms)
  if state.content_timer then
    state.content_timer:stop()
    state.content_timer:close()
    state.content_timer = nil
  end
  if delay_ms == 0 then
    sync_content()
    return
  end
  local timer = vim.uv.new_timer()
  if not timer then sync_content(); return end
  state.content_timer = timer
  timer:start(delay_ms, 0, vim.schedule_wrap(function()
    if state.content_timer then
      state.content_timer:stop()
      state.content_timer:close()
      state.content_timer = nil
    end
    sync_content()
  end))
end

-- ─── Browser ──────────────────────────────────────────────────────────────────

--- Ask the service to handle browser opening. Falls back to Lua-side open only
--- when the service is not running yet (first launch race).
local function request_browser_open()
  if is_running(state.service_job) then
    send({ type = "browser:open" })
    return
  end
  -- Fallback: direct open (first-launch race condition)
  local sp = state.service_port or get_preferred_service_port()
  local wp = state.web_port    or get_web_port()
  local url = ("http://%s:%d/?ws=ws://%s:%d"):format(host, wp, host, sp)

  local browserfunc = vim.g.markdown_kit_browserfunc or vim.g.mkdp_browserfunc or ""
  if type(browserfunc) == "string" and browserfunc ~= ""
      and vim.fn.exists("*" .. browserfunc) == 1 then
    vim.fn[browserfunc](url); return
  end

  local browser = vim.g.markdown_kit_browser or vim.g.mkdp_browser or ""
  if type(browser) == "string" and browser ~= "" then
    vim.fn.jobstart({ browser, url }, { detach = true }); return
  end

  if vim.fn.has("win32") == 1 or vim.fn.has("win64") == 1 then
    vim.fn.jobstart({ "cmd", "/c", "start", "", url }, { detach = true })
  elseif vim.fn.has("mac") == 1 or vim.fn.has("macunix") == 1 then
    vim.fn.jobstart({ "open", url }, { detach = true })
  else
    vim.fn.jobstart({ "xdg-open", url }, { detach = true })
  end
end

--- Poll until the web dev server is accepting TCP connections, then open.
local function open_preview_when_ready()
  local retries  = 40
  local interval = 200

  local timer = vim.uv.new_timer()
  if not timer then request_browser_open(); return end

  local function try_open()
    local tcp = vim.uv.new_tcp()
    if not tcp then return end
    local wp = state.web_port or get_web_port()
    tcp:connect(host, wp, function(err)
      tcp:close()
      if not err then
        timer:stop(); timer:close()
        vim.schedule(request_browser_open)
        return
      end
      retries = retries - 1
      if retries <= 0 then
        timer:stop(); timer:close()
        vim.schedule(function()
          notify(("Web app unreachable on http://%s:%d"):format(host, wp), vim.log.levels.ERROR)
        end)
      end
    end)
  end

  timer:start(0, interval, vim.schedule_wrap(try_open))
end

-- ─── Autocmds ─────────────────────────────────────────────────────────────────

local function attach_buffer_autocmd(bufnr)
  vim.api.nvim_clear_autocmds({ group = augroup, buffer = bufnr })

  -- Content changed: debounce 150 ms
  vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI" }, {
    group    = augroup,
    buffer   = bufnr,
    callback = function() schedule_content_sync(150) end,
  })

  -- Save: immediate sync
  vim.api.nvim_create_autocmd("BufWritePost", {
    group    = augroup,
    buffer   = bufnr,
    callback = function() schedule_content_sync(0) end,
  })

  -- Cursor moved: cursor-only update (no markdown payload)
  vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
    group    = augroup,
    buffer   = bufnr,
    callback = sync_cursor,
  })

  -- Buffer hidden: optionally auto-stop
  vim.api.nvim_create_autocmd("BufHidden", {
    group    = augroup,
    buffer   = bufnr,
    callback = function()
      if vim.g.markdown_kit_auto_close ~= 0 then M.stop() end
    end,
  })

  -- Neovim exit: always stop cleanly
  vim.api.nvim_create_autocmd("VimLeavePre", {
    group    = augroup,
    callback = M.stop,
  })
end

-- ─── Public API ───────────────────────────────────────────────────────────────

function M.start()
  local bufnr = vim.api.nvim_get_current_buf()
  state.web_port = get_web_port()
  state.service_port = get_preferred_service_port()

  if not run_mise_task("build") then
    return
  end

  -- Start service process (built)
  if not is_running(state.service_job) then
    state.service_job  = vim.fn.jobstart(
      { "mise", "run", "start:service" },
      {
        cwd     = project_root,
        detach  = false,
        env     = { MK_PORT = tostring(state.service_port) },
        on_exit = function(_, code)
          if code ~= 0 then
            vim.schedule(function()
              notify("Service exited with code " .. code, vim.log.levels.ERROR)
            end)
          end
        end,
      }
    )
  end

  -- Start built web server (vite preview)
  if not is_running(state.web_job) then
    state.web_job = vim.fn.jobstart(
      { "mise", "run", "start:web" },
      {
        cwd     = project_root,
        detach  = false,
        env     = {
          MK_WEB_PORT = tostring(state.web_port),
          VITE_MK_PORT = tostring(state.service_port),
        },
        on_exit = function(_, code)
          if code ~= 0 then
            vim.schedule(function()
              notify("Web process exited with code " .. code, vim.log.levels.ERROR)
            end)
          end
        end,
      }
    )
  end

  if not state.service_job or state.service_job <= 0
      or not state.web_job or state.web_job <= 0 then
    notify("Failed to start preview processes", vim.log.levels.ERROR)
    state.service_job = nil
    state.web_job     = nil
    return
  end

  attach_buffer_autocmd(bufnr)
  schedule_content_sync(0)

  if not state.preview_opened then
    open_preview_when_ready()
    state.preview_opened = true
  end

  notify(("Preview started (service :%d, web :%d)"):format(state.service_port, state.web_port))
end

function M.stop()
  send({ type = "preview:close" })
  if is_running(state.service_job) then vim.fn.jobstop(state.service_job) end
  if is_running(state.web_job)     then vim.fn.jobstop(state.web_job) end

  state.service_job    = nil
  state.web_job        = nil
  state.service_port   = nil
  state.preview_opened = false

  if state.content_timer then
    state.content_timer:stop()
    state.content_timer:close()
    state.content_timer = nil
  end

  vim.api.nvim_clear_autocmds({ group = augroup })
  notify("Preview stopped")
end

function M.toggle()
  if is_running(state.service_job) or is_running(state.web_job) then
    M.stop()
  else
    M.start()
  end
end

return M