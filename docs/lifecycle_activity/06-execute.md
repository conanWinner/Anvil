# TW-06 — Thực thi kế hoạch đã duyệt

> Tên kỹ thuật: **Execute Project Workflow Version**. Thuộc phase **Build — Xây dựng**.

## Nói ngắn gọn

Activity này thực hiện đúng Execution Plan mà người dùng đã phê duyệt. Đây là lúc hệ thống tạo project, chạy kiểm tra dữ liệu và thực hiện baseline experiment nếu kế hoạch yêu cầu.

## Khi nào chạy?

Sau khi có Approval Manifest còn hiệu lực.

## Đầu vào

| Dữ liệu | Ý nghĩa |
|---|---|
| Execution ID | Định danh lần thực thi ở tầng System 3 |
| Approval ID | Bản phê duyệt cho lần chạy này |
| Compilation ID | Kế hoạch đã được phê duyệt |
| Mã nhận diện Execution Plan | Dùng để xác nhận kế hoạch chưa bị đổi |
| Phạm vi chạy lại | Chạy đầy đủ hay chỉ chạy lại một phần |
| Danh sách kết quả được dùng lại | Những kết quả cũ đã được kiểm tra và được phép dùng lại |

## Kiểm tra trước khi chạy

Hệ thống phải:

1. Kiểm tra lại mã nhận diện của nguồn, kế hoạch, khả năng kỹ thuật và phê duyệt.
2. Từ chối nếu bản phê duyệt đã cũ.
3. Kiểm tra từng kết quả định tái sử dụng vẫn đúng phiên bản và còn hợp lệ.
4. Lấy đúng phiên bản của các Technical Workflow con.
5. Tạo Workflow Run để theo dõi trạng thái, log và kết quả.

## Các phần thực thi bên trong

### Phần A — Build

Technical Workflow hiện tại: `system3-baseline-build`.

Nó thực hiện:

1. Ghi kế hoạch đã duyệt vào workspace tách biệt.
2. Tạo cấu trúc và mã nguồn project theo khả năng kỹ thuật đã duyệt.
3. Kiểm tra file bắt buộc, cấu hình và độ an toàn của đường dẫn.

Kết quả chính:

- Project đã được tạo.
- Bản kế hoạch đã duyệt.
- Báo cáo kiểm tra project.

Build không tự push, deploy hoặc sửa live checkout nếu quyền được duyệt không cho phép.

### Phần B — Data & Baseline Experiment

Technical Workflow hiện tại: `system3-baseline-experiment`.

Nó thực hiện:

1. Kiểm tra dataset đúng hash, cấu trúc và target.
2. Chạy test của project vừa tạo.
3. Chạy data pipeline.
4. Chạy baseline với số khởi tạo cố định và quy tắc đánh giá đã được khóa để kết quả có thể lặp lại.
5. Đóng gói kết quả thực thi thành artifact không bị sửa đổi.

Kết quả chính:

- Kết quả test.
- Kết quả xử lý dữ liệu.
- Kết quả baseline experiment.
- Gói kết quả baseline và mã nhận diện nội dung.

Baseline chạy thành công không có nghĩa là mọi yêu cầu trong blueprint đã được chứng minh. Việc đó thuộc TW-07 Verify.

## Chạy đầy đủ và chạy lại một phần

- **Chạy đầy đủ:** chạy Build rồi chạy Data & Baseline Experiment.
- **Chỉ chạy lại thử nghiệm:** dùng lại kết quả Build đã được xác nhận, chỉ chạy lại phần dữ liệu và thử nghiệm.
- **Chỉ chuẩn bị cho bàn giao:** lấy lại đúng kết quả đã duyệt cho activity tiếp theo.

Dù chạy theo đường nào, kết quả phải có cùng cấu trúc để các activity sau không cần đoán.

## Kết quả và file được tạo

- `planning/approved-plan.json`
- `workspace/generated_project/`
- `build/project-validation.json`
- `execution/test-results.json`
- `execution/data-pipeline.json`
- `execution/baseline-experiment.json`
- `execution/baseline-artifact.tar.gz`

## Người dùng nhìn thấy gì trên UI?

- Bước nào đang chạy, đã xong hoặc thất bại.
- Đang chạy đầy đủ hay chỉ một phần.
- Kết quả nào được tái sử dụng.
- Báo cáo test, dữ liệu và baseline ở dạng dễ đọc.
- Nút xem log kỹ thuật khi cần.

## Điều activity này không làm

- Không tự thay đổi kế hoạch đã duyệt.
- Không coi baseline chạy thành công là đã xác minh toàn bộ yêu cầu.
- Không tự bàn giao sản phẩm.

[← OP-05 Approve](05-approve.md) · [Danh sách](README.md) · [Tiếp theo: TW-07 Verify →](07-verify.md)
