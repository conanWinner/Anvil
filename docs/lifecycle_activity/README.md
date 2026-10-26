# 6 Lifecycle Phase và 10 Lifecycle Activity

Đây là mapping chính thức của Project Lifecycle trong Anvil. Các trang activity mô tả contract/thiết kế cần đạt; tiến độ đã kiểm chứng xem [kế hoạch 11](../technical/11-simplification-and-core-flow-plan.md).

| Lifecycle Phase               | Lifecycle Activity                                      | Mục đích                                |
| ----------------------------- | ------------------------------------------------------- | --------------------------------------- |
| Intake — Tiếp nhận            | [OP-00 Source Intake](00-source-intake.md)              | Nhận, kiểm tra và lưu nguồn             |
| Intake — Tiếp nhận            | [OP-01 Change Detection](01-change-detection.md)        | Xác định ảnh hưởng của nguồn thay đổi   |
| Understanding — Hiểu dự án    | [TW-02 Understand Project](02-understand-project.md)    | Tạo Bản hiểu có tham chiếu nguồn        |
| Readiness — Kiểm tra sẵn sàng | [TW-03 Readiness](03-readiness.md)                      | Kiểm tra điều kiện và đầu vào còn thiếu |
| Readiness — Kiểm tra sẵn sàng | [OP-04 Compile](04-compile.md)                          | Tạo Execution Plan                      |
| Readiness — Kiểm tra sẵn sàng | [OP-05 Approve](05-approve.md)                          | Ghi Approval Manifest cho đúng kế hoạch |
| Build — Xây dựng              | [TW-06 Execute Project Workflow Version](06-execute.md) | Thực thi kế hoạch đã duyệt              |
| Verify — Xác minh             | [TW-07 Verify](07-verify.md)                            | Kiểm tra độc lập và tạo Evidence        |
| Delivery — Bàn giao           | [OP-08 Delivery Request](08-delivery-request.md)        | Nhận yêu cầu, kiểm tra gate bàn giao    |
| Delivery — Bàn giao           | [TW-09 Deliver](09-deliver.md)                          | Tạo gói bàn giao                        |

**OP** là Control-plane Operation, không mặc định tạo Workflow Run. **TW** là Technical Workflow do Anvil Workflow Runtime thực thi; mỗi lần chạy có Workflow Run và các Workflow Node.

TW-06A Build và TW-06B Data & Experiment là Technical Workflow con của TW-06. Chạy nhiều LLM cũng nằm trong TW-06; không tạo thêm Lifecycle Phase hoặc Lifecycle Activity.

## Tra cứu theo nhu cầu

- [Tổng quan](../1.%20Tổng%20quan%20hệ%20thống.md): đầu vào, đầu ra, thuật ngữ chính và ranh giới.
- [UI Project Lifecycle — 07](../technical/07-system3-lifecycle-ui.md): một trục điều hướng, workspace activity, resource inline, lịch sử, accessibility và responsive.
- [Input/output và versioning — 02](../technical/02-input-output-and-versioning.md): nguồn, snapshot và provenance.
- [Trao đổi TW-02 cũ](02.1.md): ghi chú tham khảo về trích xuất nội dung; không phải activity bổ sung. File `02.2.md` đang trống.

[← Mục lục docs](../README.md) · [Tài liệu kỹ thuật](../technical/README.md)
