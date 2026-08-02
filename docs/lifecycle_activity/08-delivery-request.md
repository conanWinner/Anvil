# OP-08 — Yêu cầu bàn giao

> Tên kỹ thuật: **Delivery Request**. Thuộc phase **Delivery — Bàn giao**.

## Nói ngắn gọn

Activity này ghi nhận yêu cầu rõ ràng của người dùng muốn tạo gói bàn giao từ một kết quả đã được xác minh.

Việc xác minh thành công không tự động tạo gói giao hàng. Người dùng vẫn phải chủ động yêu cầu bàn giao.

## Khi nào được phép yêu cầu?

- Project đang ở trạng thái hiện tại, không có nguồn mới chưa xử lý.
- Verification thuộc đúng lần thực thi được chọn.
- Verification đã `passed`.
- Hash của đầu vào, kế hoạch và artifact vẫn khớp.
- Chưa có yêu cầu giống hệt với cùng idempotency key.

## Đầu vào

| Dữ liệu | Ý nghĩa |
|---|---|
| Project ID | Project cần bàn giao |
| Execution ID | Lần thực thi tạo ra kết quả |
| Verification ID | Lần xác minh đã đạt |
| Project version dự kiến | Chặn yêu cầu khi project vừa thay đổi |
| Idempotency key | Chống tạo hai yêu cầu bàn giao giống nhau |

## Hệ thống xử lý như thế nào?

1. Kiểm tra các điều kiện bàn giao.
2. Khóa chính xác execution và verification sẽ được dùng.
3. Tạo Delivery Request có lịch sử người yêu cầu và thời điểm.
4. Chuyển yêu cầu hợp lệ cho TW-09 Deliver.

## Người dùng nhìn thấy gì trên UI?

Trước khi xác nhận:

- Phiên bản sản phẩm sắp được đóng gói.
- Kết quả Verification liên quan.
- Nội dung dự kiến có trong gói.
- Hạn chế hoặc cảnh báo còn tồn tại.

Sau khi xác nhận:

- Trạng thái `Đang tạo gói bàn giao`.
- ID yêu cầu và thời điểm tạo trong phần chi tiết.

## Khi project đã thay đổi

Yêu cầu bị từ chối với thông báo rõ ràng rằng kết quả đã cũ. Người dùng cần xử lý thay đổi, chạy lại phần liên quan và xác minh lại trước khi bàn giao.

## Điều activity này không làm

- Không đóng gói file; TW-09 thực hiện việc đó.
- Không bỏ qua Verification.
- Không tự tạo yêu cầu sau khi Verify pass.

[← TW-07 Verify](07-verify.md) · [Danh sách](README.md) · [Tiếp theo: TW-09 Deliver →](09-deliver.md)
