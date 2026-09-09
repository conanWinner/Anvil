# Hướng dẫn đọc tài liệu System 3

Thư mục `docs/` được chia theo mục đích đọc để người dùng không phải đi qua chi tiết kỹ thuật quá sớm.

## Bắt đầu từ đâu?

1. Đọc [Tổng quan hệ thống](1.%20Tổng%20quan%20hệ%20thống.md) để hiểu System 3 nhận gì, tạo gì và vận hành qua những giai đoạn nào.
2. Mở [10 Lifecycle Activity](lifecycle_activity/README.md) khi muốn biết một hoạt động cụ thể đang làm gì.
3. Chỉ mở [Tài liệu kỹ thuật](technical/README.md) khi cần thiết kế API, cơ sở dữ liệu, UI, retry, bảo mật hoặc kiểm thử.

Để tiếp tục hoàn thiện sản phẩm từ checkout đã kiểm tra ngày 07/09/2026, đọc [Báo cáo hiện trạng](technical/08-product-readiness-audit.md) rồi [Execution Brief và task](technical/09-product-readiness-execution-brief.md). Đây là mốc kiểm chứng có ngày và baseline cụ thể, không thay thế tài liệu thiết kế.

## Cấu trúc thư mục

```text
docs/
├── README.md                         Mục lục tài liệu
├── 1. Tổng quan hệ thống.md          Tổng quan sản phẩm và Project Lifecycle
├── lifecycle_activity/               10 hoạt động trong Project Lifecycle
│   ├── README.md                     Mục lục và bảng thuật ngữ
│   ├── 00-source-intake.md
│   ├── 01-change-detection.md
│   ├── 02-understand-project.md
│   ├── 03-readiness.md
│   ├── 04-compile.md
│   ├── 05-approve.md
│   ├── 06-execute.md
│   ├── 07-verify.md
│   ├── 08-delivery-request.md
│   └── 09-deliver.md
├── technical/                        Tài liệu dành cho đội triển khai
│   ├── README.md
│   ├── 01-system-boundaries-and-contracts.md
│   ├── 02-input-output-and-versioning.md
│   ├── 03-artifacts-and-scoped-rerun.md
│   ├── 04-understanding-ui-and-api.md
│   ├── 05-reliability-security-and-llm.md
│   ├── 06-implementation-and-testing.md
│   ├── 07-system3-lifecycle-ui.md
│   ├── 08-product-readiness-audit.md
│   ├── 09-product-readiness-execution-brief.md
│   └── 10-approved-workflow-bundle-binding-spec.md
└── system_2/
    └── DESIGN_B_2.md                 Blueprint ví dụ đến từ System 2
```

## Quy ước tài liệu

- **Project Lifecycle** là toàn bộ hành trình từ tiếp nhận đến bàn giao.
- **Lifecycle Phase** là 6 giai đoạn lớn hiển thị trên UI.
- **Lifecycle Activity** là 10 hoạt động cụ thể nằm trong các phase.
- Tài liệu hướng người dùng giải thích tiếng Việt trước, tên kỹ thuật đặt sau.
- JSON, TypeScript, ID và hash nằm trong tài liệu kỹ thuật hoặc phần mở rộng trên UI.
- Tài liệu phải phân biệt rõ **đã có trong hệ thống** và **thiết kế cần đạt**.

## Chữ viết tắt thường gặp

| Từ viết tắt | Nghĩa |
|---|---|
| **UI** | User Interface — giao diện người dùng |
| **API** | Giao diện để các phần mềm trao đổi dữ liệu |
| **ID** | Mã định danh của một bản ghi |
| **JSON** | Định dạng dữ liệu có cấu trúc để máy đọc |
| **LLM** | Mô hình ngôn ngữ lớn dùng cho chức năng AI |
| **CSV** | File dữ liệu dạng bảng, các giá trị phân cách bằng dấu phẩy |
| **CPU** | Bộ xử lý của máy |
| **RAM** | Bộ nhớ tạm dùng trong lúc chương trình chạy |

## Nguồn tham khảo và tài liệu thiết kế

`system_2/DESIGN_B_2.md` là một ví dụ đầu vào từ System 2. Nó không phải tên file bắt buộc và không phải toàn bộ contract giữa System 2 với System 3.

Các tài liệu trong `technical/` mô tả trạng thái cần đạt. Khi triển khai, cần đối chiếu với code hiện tại trong `packages/system3`, `packages/server` và `packages/web`.
