# OP-05 — Phê duyệt kế hoạch

> Tên kỹ thuật: **Approve Manifest**. Thuộc phase **Readiness — Kiểm tra sẵn sàng**.

## Nói ngắn gọn

Đây là điểm người dùng xác nhận: “Tôi đồng ý cho hệ thống chạy đúng kế hoạch này với đúng đầu vào và quyền này.”

Hệ thống tạo **Approval Manifest — bản kê phê duyệt**. Nó khóa chính xác kế hoạch, phiên bản đầu vào, cấu hình và quyền đã được duyệt.

## Khi nào chạy?

Chỉ chạy khi người dùng chủ động nhấn phê duyệt trên một Compile Preview còn hiệu lực.

## Trước khi cho phép phê duyệt

Hệ thống kiểm tra:

- Compile Preview vẫn là bản hiện tại.
- Nguồn đầu vào chưa đổi.
- Knowledge Snapshot và Readiness Contract chưa đổi.
- Môi trường chạy và danh sách khả năng kỹ thuật chưa đổi.
- Không còn khả năng kỹ thuật chưa được hỗ trợ.
- Không còn Decision đang chặn.

## Đầu vào

| Dữ liệu | Ý nghĩa |
|---|---|
| Compilation ID | Bản kế hoạch chính xác được duyệt |
| Project version dự kiến | Chặn phê duyệt khi project vừa thay đổi ở nơi khác |
| Actor ID | Ai đã phê duyệt |
| Idempotency key | Chống tạo hai phê duyệt khi bấm hoặc gửi lại yêu cầu |

## Kết quả

Approval Manifest lưu:

- Kế hoạch nào đã được duyệt.
- Input Snapshot nào được dùng.
- Mã nhận diện của Execution Plan, danh sách khả năng và môi trường chạy.
- Những quyền đã được chấp nhận.
- Ai duyệt và duyệt lúc nào.

## Người dùng nhìn thấy gì trên UI?

Trước nút `Phê duyệt và tiếp tục`, UI nên tóm tắt:

- Việc hệ thống sắp làm.
- Dữ liệu và kết quả sẵn có sẽ dùng.
- Quyền cần cấp.
- Phần nào được chạy lại hoặc tái sử dụng.
- Cảnh báo có ảnh hưởng đáng kể.

Sau khi duyệt, UI hiển thị người duyệt, thời gian và trạng thái `Đã phê duyệt`.

## Khi kế hoạch thay đổi sau phê duyệt

Approval Manifest cũ trở thành **stale** và không còn dùng để chạy. Hệ thống phải Compile và xin phê duyệt lại. Phê duyệt cũ không được tự mở rộng sang quyền hoặc kế hoạch mới.

## Điều activity này không làm

- Không tự chạy nếu người dùng chưa phê duyệt.
- Không tự thêm quyền.
- Không dùng phê duyệt của một kế hoạch cho kế hoạch khác.

[← OP-04 Compile](04-compile.md) · [Danh sách](README.md) · [Tiếp theo: TW-06 Execute →](06-execute.md)
