function! markdown_kit#start() abort
  lua require("markdown_kit").start()
endfunction

function! markdown_kit#stop() abort
  lua require("markdown_kit").stop()
endfunction

function! markdown_kit#toggle() abort
  lua require("markdown_kit").toggle()
endfunction
