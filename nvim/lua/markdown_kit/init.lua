local M = {}

-- ─── State ────────────────────────────────────────────────────────────────────

local state = {
	service_job = nil,
	web_job = nil,
	service_port = nil,
	web_port = nil,
	content_tick = 0,
	content_timer = nil,
	line_count = nil,
	cursor_timer = nil,
	pending_cursor = nil,
	last_sent_cursor = nil,
	preview_opened = false,
}

-- ─── Config ───────────────────────────────────────────────────────────────────

local project_root = "D:/dev/markdown-kit.nvim/"
local host = "127.0.0.1"
local ports = {
	service = 35831,
	web = 35832,
}
local augroup = vim.api.nvim_create_augroup("MarkdownKitSync", { clear = true })

-- ─── Helpers ──────────────────────────────────────────────────────────────────

local function notify(msg, level)
	vim.notify("[markdown-kit] " .. msg, level or vim.log.levels.INFO)
end

local function run_bun_task(args, extra_env)
	local env = vim.tbl_extend("force", vim.fn.environ(), extra_env or {})
	local result = vim.system(args, {
		cwd = project_root,
		env = env,
		text = true,
	}):wait()
	if result.code ~= 0 then
		local stderr = result.stderr or ""
		local stdout = result.stdout or ""
		notify(("Command failed:\n%s%s"):format(stdout, stderr), vim.log.levels.ERROR)
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

local function get_cursor_throttle_ms()
	local v = tonumber(vim.g.markdown_kit_cursor_throttle_ms)
	if v and v >= 0 then
		return math.floor(v)
	end
	return 16
end

local function get_content_debounce_ms()
	local v = tonumber(vim.g.markdown_kit_content_debounce_ms)
	if v and v >= 0 then
		return math.floor(v)
	end
	return 80
end

local function get_insert_content_debounce_ms()
	local v = tonumber(vim.g.markdown_kit_insert_content_debounce_ms)
	if v and v >= 0 then
		return math.floor(v)
	end
	return 35
end

local function get_web_port()
	local p = tonumber(vim.g.markdown_kit_web_port)
	return (p and p > 0) and p or ports.web
end

local function is_valid_port(p)
	return p and p >= 1 and p <= 65535
end

local function file_exists(path)
	return vim.uv.fs_stat(path) ~= nil
end

local function is_port_available(port)
	local tcp = vim.uv.new_tcp()
	if not tcp then
		return false
	end
	local ok = pcall(function()
		tcp:bind(host, port)
	end)
	tcp:close()
	return ok
end

local function get_preferred_service_port()
	local p = tonumber(vim.g.markdown_kit_port or vim.g.mkdp_port)
	if p and p > 0 then
		return math.floor(p)
	end
	return ports.service
end

-- ─── IPC ──────────────────────────────────────────────────────────────────────

local function send(payload)
	if not is_running(state.service_job) then
		return
	end
	vim.fn.chansend(state.service_job, vim.fn.json_encode(payload) .. "\n")
end

-- ─── Sync helpers ─────────────────────────────────────────────────────────────

--- Send only cursor position — no markdown, very cheap.
local function sync_cursor()
	local cursor = vim.api.nvim_win_get_cursor(0)
	state.pending_cursor = { cursor[1], cursor[2] }

	-- Coalesce bursts of CursorMoved events into ~1 update per frame.
	if state.cursor_timer then
		return
	end

	local timer = vim.uv.new_timer()
	if not timer then
		local lc = state.line_count or vim.api.nvim_buf_line_count(vim.api.nvim_get_current_buf())
		send({
			type = "cursor:update",
			payload = { cursorLine = cursor[1], lineCount = lc },
		})
		return
	end

	state.cursor_timer = timer
	timer:start(
		get_cursor_throttle_ms(),
		0,
		vim.schedule_wrap(function()
			if state.cursor_timer then
				state.cursor_timer:stop()
				state.cursor_timer:close()
				state.cursor_timer = nil
			end

			local pending = state.pending_cursor
			if not pending then
				return
			end
			local last = state.last_sent_cursor
			if last and last[1] == pending[1] and last[2] == pending[2] then
				return
			end

			state.last_sent_cursor = { pending[1], pending[2] }
			send({
				type = "cursor:update",
				payload = {
					cursorLine = pending[1],
					lineCount = state.line_count or vim.api.nvim_buf_line_count(vim.api.nvim_get_current_buf()),
				},
			})
		end)
	)
end

--- Send full content + metadata.
local function sync_content()
	local bufnr = vim.api.nvim_get_current_buf()
	if not vim.api.nvim_buf_is_valid(bufnr) then
		return
	end
	local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
	local cursor = vim.api.nvim_win_get_cursor(0)
	state.line_count = #lines
	state.content_tick = state.content_tick + 1
	send({
		type = "preview:update",
		payload = {
			bufnr = bufnr,
			fileName = vim.api.nvim_buf_get_name(bufnr),
			markdown = table.concat(lines, "\n"),
			cursorLine = cursor[1],
			lineCount = state.line_count,
			theme = get_theme(),
			contentTick = state.content_tick,
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
	if not timer then
		sync_content()
		return
	end
	state.content_timer = timer
	timer:start(
		delay_ms,
		0,
		vim.schedule_wrap(function()
			if state.content_timer then
				state.content_timer:stop()
				state.content_timer:close()
				state.content_timer = nil
			end
			sync_content()
		end)
	)
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
	local wp = state.web_port or get_web_port()
	local url = ("http://%s:%d/?ws=ws://%s:%d"):format(host, wp, host, sp)

	local browserfunc = vim.g.markdown_kit_browserfunc or vim.g.mkdp_browserfunc or ""
	if type(browserfunc) == "string" and browserfunc ~= "" and vim.fn.exists("*" .. browserfunc) == 1 then
		vim.fn[browserfunc](url)
		return
	end

	local browser = vim.g.markdown_kit_browser or vim.g.mkdp_browser or ""
	if type(browser) == "string" and browser ~= "" then
		vim.fn.jobstart({ browser, url }, { detach = true })
		return
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
	local retries = 40
	local interval = 200

	local timer = vim.uv.new_timer()
	if not timer then
		request_browser_open()
		return
	end

	local function try_open()
		local tcp = vim.uv.new_tcp()
		if not tcp then
			return
		end
		local wp = state.web_port or get_web_port()
		tcp:connect(host, wp, function(err)
			tcp:close()
			if not err then
				timer:stop()
				timer:close()
				vim.schedule(request_browser_open)
				return
			end
			retries = retries - 1
			if retries <= 0 then
				timer:stop()
				timer:close()
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

	-- Content changed (normal mode): light debounce
	vim.api.nvim_create_autocmd("TextChanged", {
		group = augroup,
		buffer = bufnr,
		callback = function()
			schedule_content_sync(get_content_debounce_ms())
		end,
	})

	-- Content changed (insert mode): lower debounce for "near realtime" typing
	vim.api.nvim_create_autocmd("TextChangedI", {
		group = augroup,
		buffer = bufnr,
		callback = function()
			schedule_content_sync(get_insert_content_debounce_ms())
		end,
	})

	-- Leaving insert: flush immediately so preview catches up
	vim.api.nvim_create_autocmd("InsertLeave", {
		group = augroup,
		buffer = bufnr,
		callback = function()
			schedule_content_sync(0)
		end,
	})

	-- Save: immediate sync
	vim.api.nvim_create_autocmd("BufWritePost", {
		group = augroup,
		buffer = bufnr,
		callback = function()
			schedule_content_sync(0)
		end,
	})

	-- Cursor moved: cursor-only update (no markdown payload)
	vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
		group = augroup,
		buffer = bufnr,
		callback = sync_cursor,
	})

	-- Buffer hidden: optionally auto-stop
	vim.api.nvim_create_autocmd("BufHidden", {
		group = augroup,
		buffer = bufnr,
		callback = function()
			if vim.g.markdown_kit_auto_close ~= 0 then
				M.stop()
			end
		end,
	})

	-- Neovim exit: always stop cleanly
	vim.api.nvim_create_autocmd("VimLeavePre", {
		group = augroup,
		callback = M.stop,
	})
end

-- ─── Public API ───────────────────────────────────────────────────────────────

function M.start()
	local bufnr = vim.api.nvim_get_current_buf()
	state.line_count = vim.api.nvim_buf_line_count(bufnr)
	local preferred_web_port = get_web_port()
	local preferred_service_port = get_preferred_service_port()
	if not is_valid_port(preferred_service_port) then
		notify(("Invalid service port: %s"):format(tostring(preferred_service_port)), vim.log.levels.ERROR)
		return
	end
	if not is_valid_port(preferred_web_port) then
		notify(("Invalid web port: %s"):format(tostring(preferred_web_port)), vim.log.levels.ERROR)
		return
	end
	state.service_port = preferred_service_port
	state.web_port = preferred_web_port
	if state.service_port == state.web_port then
		notify("Service port and web port must be different", vim.log.levels.ERROR)
		return
	end

	if not is_running(state.service_job) and not is_port_available(state.service_port) then
		notify(
			("Service port %d is already in use (set g:markdown_kit_port to change)"):format(state.service_port),
			vim.log.levels.ERROR
		)
		return
	end
	if not is_running(state.web_job) and not is_port_available(state.web_port) then
		notify(
			("Web port %d is already in use (set g:markdown_kit_web_port to change)"):format(state.web_port),
			vim.log.levels.ERROR
		)
		return
	end

	local service_build = project_root .. "apps/service/dist/index.js"
	local web_build = project_root .. "apps/web/dist/index.html"
	local need_service_build = not file_exists(service_build)
	local need_web_build = not file_exists(web_build)

	if need_service_build then
		if not run_bun_task({ "bun", "run", "--cwd", "apps/service", "build" }) then
			return
		end
	end
	if need_web_build then
		if not run_bun_task({ "bun", "run", "--cwd", "apps/web", "build" }) then
			return
		end
	end

	-- Start service process (built)
	if not is_running(state.service_job) then
		state.service_job = vim.fn.jobstart({ "bun", "run", "--cwd", "apps/service", "start" }, {
			cwd = project_root,
			detach = false,
			env = { MK_PORT = tostring(state.service_port) },
			on_exit = function(_, code)
				if code ~= 0 then
					vim.schedule(function()
						notify("Service exited with code " .. code, vim.log.levels.ERROR)
					end)
				end
			end,
		})
	end

	-- Start built web server (vite preview)
	if not is_running(state.web_job) then
		state.web_job = vim.fn.jobstart({
			"bun",
			"run",
			"--cwd",
			"apps/web",
			"preview",
			"--host",
			host,
			"--port",
			tostring(state.web_port),
			"--strictPort",
		}, {
			cwd = project_root,
			detach = false,
			env = {
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
		})
	end

	if not state.service_job or state.service_job <= 0 or not state.web_job or state.web_job <= 0 then
		notify("Failed to start preview processes", vim.log.levels.ERROR)
		state.service_job = nil
		state.web_job = nil
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
	if is_running(state.service_job) then
		vim.fn.jobstop(state.service_job)
	end
	if is_running(state.web_job) then
		vim.fn.jobstop(state.web_job)
	end

	state.service_job = nil
	state.web_job = nil
	state.service_port = nil
	state.line_count = nil
	state.pending_cursor = nil
	state.last_sent_cursor = nil
	state.preview_opened = false

	if state.content_timer then
		state.content_timer:stop()
		state.content_timer:close()
		state.content_timer = nil
	end

	if state.cursor_timer then
		state.cursor_timer:stop()
		state.cursor_timer:close()
		state.cursor_timer = nil
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
