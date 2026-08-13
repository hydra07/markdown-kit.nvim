if vim.g.loaded_markdown_kit == 1 then
  return
end
vim.g.loaded_markdown_kit = 1

local function start() require("markdown_kit").start() end
local function stop() require("markdown_kit").stop() end
local function toggle() require("markdown_kit").toggle() end

-- Full commands
vim.api.nvim_create_user_command("MarkdownKitStart", start, { desc = "Start markdown-kit service" })
vim.api.nvim_create_user_command("MarkdownKitStop", stop, { desc = "Stop markdown-kit service" })
vim.api.nvim_create_user_command("MarkdownKitToggle", toggle, { desc = "Toggle markdown-kit preview" })

-- Short aliases
vim.api.nvim_create_user_command("MkStart", start, { desc = "Start markdown-kit service" })
vim.api.nvim_create_user_command("MkStop", stop, { desc = "Stop markdown-kit service" })
vim.api.nvim_create_user_command("MkToggle", toggle, { desc = "Toggle markdown-kit preview" })
