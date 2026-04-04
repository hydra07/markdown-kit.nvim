if vim.g.loaded_markdown_kit == 1 then
  return
end
vim.g.loaded_markdown_kit = 1

vim.api.nvim_create_user_command("MarkdownKitStart", function()
  vim.fn["markdown_kit#start"]()
end, { desc = "Start markdown-kit service" })

vim.api.nvim_create_user_command("MarkdownKitStop", function()
  vim.fn["markdown_kit#stop"]()
end, { desc = "Stop markdown-kit service" })

vim.api.nvim_create_user_command("MarkdownKitToggle", function()
  vim.fn["markdown_kit#toggle"]()
end, { desc = "Toggle markdown-kit preview" })
