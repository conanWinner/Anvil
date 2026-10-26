# Tài liệu kỹ thuật Anvil / System 3

## Công việc hiện hành

- [11 — Tinh giản và luồng cốt lõi](11-simplification-and-core-flow-plan.md): kế hoạch UI-0–UI-7 ngày 26/10, mẫu chạy nhiều LLM, nghiệm thu; task S0–S7 và bằng chứng cũ để đối chiếu. Đây là kế hoạch ưu tiên hiện tại.
- [12 — Cấu hình 9router qua Pi](12-9router-setup.md): gateway, model, credential và kiểm tra kết nối.

## Contract và thiết kế để tra cứu

| Tài liệu                                                                     | Mở khi sửa                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [01 — Ranh giới và contract](01-system-boundaries-and-contracts.md)          | Domain, runtime và giao tiếp giữa các phần                     |
| [02 — Input/output và versioning](02-input-output-and-versioning.md)         | Source Version, Input Snapshot và đầu ra                       |
| [03 — Artifact và scoped rerun](03-artifacts-and-scoped-rerun.md)            | Invalidation, reuse và chạy lại                                |
| [04 — Understanding UI/API](04-understanding-ui-and-api.md)                  | Báo cáo và API Hiểu dự án                                      |
| [05 — Reliability, security và LLM](05-reliability-security-and-llm.md)      | Lỗi, retry, quyền và hỗ trợ LLM                                |
| [07 — Lifecycle UI](07-system3-lifecycle-ui.md)                              | Điều hướng 6 phase/10 activity, inline viewer và accessibility |
| [10 — Approved Workflow Bundle](10-approved-workflow-bundle-binding-spec.md) | Binding DAG và chính xác nội dung approval                     |

Spec là thiết kế cần đạt; không chứng minh code đã triển khai đủ. Khi khác nhau, ghi rõ hiện trạng dựa trên code/test. Giữ logic theo bài toán trong System 3, runtime chỉ chứa cơ chế thực thi chung.

## Kế hoạch và kiểm chứng cũ

- [06 — Kế hoạch vertical slice](06-implementation-and-testing.md): tiêu chí/test thiết kế ban đầu; thứ tự triển khai đã được thay bằng 11.
- [08 — Audit ngày 07/09/2026](08-product-readiness-audit.md): bằng chứng của checkout cũ, không phải hiện trạng mới nhất.
- [09 — Execution Brief ngày 07/09/2026](09-product-readiness-execution-brief.md): backlog cũ đã được thay bằng 11; đối chiếu code trước khi dùng lại task.

[← Mục lục docs](../README.md) · [Tổng quan](../1.%20Tổng%20quan%20hệ%20thống.md) · [Lifecycle Activity](../lifecycle_activity/README.md)
