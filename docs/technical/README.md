# Tài liệu kỹ thuật System 3

Thư mục này chứa chi tiết dành cho người thiết kế và triển khai. Người chỉ muốn hiểu sản phẩm có thể đọc [Tổng quan hệ thống](../1.%20Tổng%20quan%20hệ%20thống.md) và [10 Lifecycle Activity](../lifecycle_activity/README.md).

## Danh sách tài liệu

| Tài liệu | Câu hỏi được trả lời |
|---|---|
| [01 — Ranh giới và contract](01-system-boundaries-and-contracts.md) | System 3 sở hữu gì, runtime sở hữu gì và các activity chuyển dữ liệu cho nhau thế nào? |
| [02 — Input, output và versioning](02-input-output-and-versioning.md) | Hệ thống nhận nguồn nào, tạo snapshot/version ra sao và đầu ra gồm những gì? |
| [03 — Artifact và chạy lại có phạm vi](03-artifacts-and-scoped-rerun.md) | Khi nguồn thay đổi, kết quả nào được giữ lại và kết quả nào phải tạo lại? |
| [04 — UI Hiểu dự án và API](04-understanding-ui-and-api.md) | UI cần hiển thị báo cáo nào và backend cần chuẩn bị read model/API nào? |
| [05 — Độ tin cậy, bảo mật và LLM](05-reliability-security-and-llm.md) | Lỗi, retry, bảo mật, theo dõi và LLM fallback được kiểm soát ra sao? |
| [06 — Kế hoạch triển khai và kiểm thử](06-implementation-and-testing.md) | Nên triển khai theo thứ tự nào và điều kiện hoàn thành là gì? |
| [07 — UI Project Lifecycle](07-system3-lifecycle-ui.md) | UI ánh xạ 6 phase/10 activity, trình bày OP-00, motion và accessibility như thế nào? |

## Ranh giới sử dụng

- Các tài liệu này là **thiết kế đích**, không phải cam kết rằng code hiện tại đã có đủ mọi hành vi.
- Tên identifier hiện có trong code được giữ nguyên cho đến khi có migration riêng.
- Không đưa logic Customer Churn, dataset, target hoặc experiment vào generic workflow engine.
- Khi tài liệu và code khác nhau, cần ghi rõ phần nào là hiện tại và phần nào là mục tiêu.

[← Mục lục docs](../README.md)
