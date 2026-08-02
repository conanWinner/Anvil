# TW-09 — Tạo gói bàn giao

> Tên kỹ thuật: **Deliver**. Thuộc phase **Delivery — Bàn giao**.

## Nói ngắn gọn

Activity này lấy đúng kết quả đã được xác minh, đóng gói nó và tạo tài liệu giúp người nhận biết gói này được tạo từ đâu và cách chạy lại.

## Khi nào chạy?

Sau khi OP-08 tạo một Delivery Request hợp lệ.

## Đầu vào

- Delivery Request đã được kiểm tra.
- Execution và Verification chính xác được ghi trong yêu cầu.
- Gói baseline đã được xác minh.
- Các phiên bản nguồn, Knowledge Snapshot, Approval Manifest và Execution Plan liên quan.

## Hệ thống xử lý như thế nào?

1. Lấy đúng kết quả đã được xác minh vào thư mục làm việc tách biệt.
2. Kiểm tra lại mã nhận diện nội dung.
3. Tạo file nén bàn giao không bị thay đổi sau khi tạo.
4. Tạo **Delivery Manifest — bản kê bàn giao**.
5. Tạo hướng dẫn để người nhận có thể tái tạo hoặc chạy lại kết quả.
6. Lưu thông tin gói và liên kết nó với toàn bộ lịch sử đầu vào, thực thi và xác minh.

## Delivery Manifest cần chứa gì?

- Các Source Version đã dùng.
- Input Snapshot và Knowledge Snapshot.
- Project Workflow Version và Execution Plan.
- Approval Manifest.
- Lần thực thi và lần xác minh.
- Phiên bản Technical Workflow liên quan.
- Mã nhận diện nội dung và dung lượng gói bàn giao.
- Các hạn chế hoặc điều chưa được chứng minh.

## Kết quả và file được tạo

- `delivery/generated_project.tar.gz`: gói sản phẩm.
- `delivery/delivery-manifest.json`: bản kê nguồn gốc và phiên bản.
- `delivery/reproduction-instructions.md`: hướng dẫn chạy lại.

Kết quả trả về gồm Delivery ID, tên file, vị trí lưu trữ nội bộ, mã nhận diện nội dung, dung lượng và các báo cáo liên quan.

## Người dùng nhìn thấy gì trên UI?

- Trạng thái tạo gói.
- Nút tải gói sản phẩm.
- Bản tóm tắt nguồn, kế hoạch, người duyệt và kết quả xác minh.
- Hướng dẫn chạy lại.
- Mã nhận diện nội dung trong phần chi tiết để người nhận kiểm tra file không bị thay đổi.

## Khi có lỗi

- Không xuất bản gói chưa tạo xong.
- Khi gửi lại cùng một yêu cầu, hệ thống phải trả lại cùng kết quả nếu gói đã được tạo thành công.
- Nếu kết quả hoặc lần xác minh không còn là bản hiện tại, hệ thống dừng và yêu cầu người dùng xử lý thay đổi trước.

## Điều activity này không làm

- Không sửa nội dung sản phẩm trong lúc đóng gói.
- Không tự triển khai hoặc phát hành ra bên ngoài nếu chưa có khả năng kỹ thuật và phê duyệt riêng.
- Không che giấu hạn chế còn tồn tại.

[← OP-08 Delivery Request](08-delivery-request.md) · [Danh sách 10 Lifecycle Activity](README.md)
