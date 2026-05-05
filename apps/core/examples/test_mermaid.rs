fn main() {
    let complex_mermaid = r#"
    graph TD
    Start([Start: $Schedule]) --> Val1{Start Date hoặc End Date \n bị trống?}
    Val1 -- Có --> Msg1[Show Message: Information] --> End1([End])
    Val1 -- Không --> Val2{Start Date <= End Date?}
    Val2 -- Sai --> Msg2[Show Message: Warning] --> End2([End])
    Val2 -- Đúng --> Val3{Kiểm tra Resource và\nResourceType hợp lệ?}
    Val3 -- Sai --> Msg3[Show Message: Warning] --> End3([End])
    
    %% BẮT ĐẦU PHẦN TÍCH HỢP MỚI
    Val3 -- Đúng --> RetDB[Retrieve:\nLấy $Schedule gốc từ DB]
    RetDB --> RetList[Retrieve List:\nCác sự kiện cùng Project & CAR_ID,\nkhác ID hiện tại]
    RetList --> CountList[Aggregate: \nĐếm số lượng sự kiện liên quan]
    CountList --> CheckCount{Số lượng > 0?}

    %% NHÁNH 1: KHÔNG CÓ LIÊN QUAN (Giữ nguyên luồng cũ - AT-02)
    CheckCount -- Sai (AT-02) --> CreateReason[Create Object:\nReasonChangeSchedule]
    CreateReason --> ShowPageOld[Show Page:\nSchedule_ConfirmEdit]
    ShowPageOld --> EndNormal([End])

    %% NHÁNH 2: CÓ SỰ KIỆN LIÊN QUAN (Mở luồng Bulk Update - AT-01)
    CheckCount -- Đúng (AT-01) --> CreateWizard[Create Object:\nScheduleBulkUpdateContext]
    CreateWizard --> AssignWizard[Gán RelatedCount = N \n CheckConflict = true]
    AssignWizard --> ShowPageNew[Show Page:\nPAGE_BulkUpdate_Confirm]
    ShowPageNew --> EndBulk([End])

    style Start fill:#2e9936,stroke:#1a6b23,color:#fff
    style End1 fill:#d92121,stroke:#a61212,color:#fff
    style End2 fill:#d92121,stroke:#a61212,color:#fff
    style End3 fill:#d92121,stroke:#a61212,color:#fff
    style EndNormal fill:#2e9936,stroke:#1a6b23,color:#fff
    style EndBulk fill:#f39c12,stroke:#d68910,color:#fff
    
    style RetDB fill:#f1c40f,stroke:#f39c12,color:#000
    style RetList fill:#f1c40f,stroke:#f39c12,color:#000
    style CountList fill:#f1c40f,stroke:#f39c12,color:#000
    style CheckCount fill:#f39c12,stroke:#d68910,color:#fff
    style CreateWizard fill:#f39c12,stroke:#d68910,color:#fff
    style ShowPageNew fill:#e67e22,stroke:#d35400,color:#fff
    "#;

    let res = mermaid_rs_renderer::render(complex_mermaid);

    // Lưu ý: Tùy vào version của crate, res có thể là struct hoặc String trực tiếp
    // Ở đây mình giả định res có trường .svg như bạn đã dùng
    std::fs::write("complex_output.svg", res.expect("failed to render mermaid")).unwrap();
    println!("🚀 Đã xuất file complex_output.svg thành công!");
}
