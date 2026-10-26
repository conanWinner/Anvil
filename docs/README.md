# Tài liệu Anvil

Mục tiêu hiện tại: một bài toán, một bộ dữ liệu, nhiều LLM qua 9router; kết quả riêng được kiểm tra chung và có thể tải về chạy lại.

## Đọc để sử dụng và phát triển

| Nhu cầu                              | Tài liệu chính                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| Khởi động Web/API                    | [README dự án](../README.md)                                                 |
| Hiểu luồng, đầu vào và đầu ra        | [Tổng quan](1.%20Tổng%20quan%20hệ%20thống.md)                                |
| Cấu hình model/gateway               | [9router qua Pi](technical/12-9router-setup.md)                              |
| Cải thiện UI, biết đã làm gì/làm gì tiếp | [Kế hoạch hiện hành — 11](technical/11-simplification-and-core-flow-plan.md) |
| Tra một hoạt động cụ thể             | [6 Lifecycle Phase / 10 Lifecycle Activity](lifecycle_activity/README.md)    |
| Sửa domain, API, UI hoặc persistence | [Mục lục kỹ thuật](technical/README.md)                                      |

**11 là kế hoạch hiện hành và nơi ghi tiến độ/kiểm chứng.** Tổng quan giải thích sản phẩm; các spec mô tả thiết kế cần đạt. Chỉ code, test và kết quả chạy thật chứng minh một tính năng đã có.

## Tài liệu tham khảo

- [Bộ mẫu Olist](../packages/web/public/samples/olist/README.md): nguồn Kaggle, CSV mẫu có sẵn trên form tạo dự án và cách tái tạo.
- [CLI, workflow, provider và adapter](../packages/docs-web/src/content/docs/reference/index.md): tài liệu nền tảng trong `packages/docs-web`; không phải các bước bắt buộc của luồng nhiều LLM.
- [Blueprint System 2 mẫu](system_2/DESIGN_B_2.md): fixture Customer Churn, không phải yêu cầu chung cho mọi dự án.
- [Audit 08](technical/08-product-readiness-audit.md) và [Execution Brief 09](technical/09-product-readiness-execution-brief.md): lịch sử ngày 07/09/2026, giữ để đối chiếu; không dùng làm backlog hiện tại.
- [Trao đổi TW-02 cũ](lifecycle_activity/02.1.md): ghi chú thiết kế, không phải contract đã nghiệm thu. `lifecycle_activity/02.2.md` đang trống.

Giữ mỗi nội dung ở một nơi: cách chạy trong README/12, tiến độ trong 11, mapping hoạt động trong `lifecycle_activity/README.md`, contract chi tiết trong `technical/`. Khi thay đổi cấu trúc tài liệu, cập nhật mục lục và liên kết liên quan.
