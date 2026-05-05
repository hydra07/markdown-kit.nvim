use mk_core::markdown::render;
use std::fs;

fn main() {
    let input_path = "D:\\dev\\markdown-kit.nvim\\test.md";
    let output_path = "output.html";

    // 1. Đọc file test.md (nếu chưa có thì tự tạo nội dung mẫu)
    let markdown_content = match fs::read_to_string(input_path) {
        Ok(content) => content,
        Err(_) => {
            let sample = r#"
# Demo Render
Test code block:
```rust
fn main() { println!("Hello!"); }
```

Test hình ảnh có size:
![Ảnh](https://via.placeholder.com/150 =150x150)
"#;
            fs::write(input_path, sample.trim()).expect("Lỗi khi tạo file mẫu");
            sample.trim().to_string()
        }
    };

    println!("⏳ Đang parse Markdown...");

    // 2. Chạy qua engine render của bạn
    let html_body = render(&markdown_content, "base16-ocean.dark");

    // 3. Đóng gói thành file HTML hoàn chỉnh
    let full_html = format!(
        r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Markdown Render Test</title>
    <style>
        body {{ 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; 
            max-width: 800px; 
            margin: 40px auto; 
            padding: 20px; 
            line-height: 1.6; 
            background: #0d1117; 
            color: #c9d1d9; 
        }}
        pre {{ background: #161b22; padding: 16px; border-radius: 6px; overflow: auto; }}
        code {{ font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace; }}
        img {{ max-width: 100%; }}
        .mermaid-rendered {{ background: white; padding: 10px; border-radius: 4px; color: black; }}
    </style>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css">
    <script defer src="https://cdn.jsdelivr.net/npm/katex/dist/katex.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex/dist/contrib/auto-render.min.js"
        onload="renderMathInElement(document.body,{{delimiters:[
            {{left:'<div class=\"math-block\">',right:'</div>',display:true}},
            {{left:'<span class=\"math-inline\">',right:'</span>',display:false}}
        ]}});"></script>
</head>
<body>
    {}
</body>
</html>"#,
        html_body
    );

    fs::write(output_path, full_html).expect("Lỗi ghi file HTML");

    println!("✅ Xong! Hãy mở file '{}' để xem kết quả.", output_path);
}
