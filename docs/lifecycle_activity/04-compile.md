# OP-04 — Chuẩn bị kế hoạch thực thi

> Tên kỹ thuật: **Compile Preview**. Thuộc phase **Readiness — Kiểm tra sẵn sàng**.

## Nói ngắn gọn

Activity này chuyển những gì đã được hiểu và kiểm tra thành một **Execution Plan — kế hoạch chạy cụ thể** để người dùng xem trước.

Từ `Compile` ở đây không có nghĩa là biên dịch mã nguồn. Nó có nghĩa là “tổng hợp các phiên bản và quy tắc đã chốt thành một kế hoạch kỹ thuật chính xác”.

## Khi nào chạy?

Sau khi TW-03 trả trạng thái `passed`.

## Đầu vào

| Dữ liệu | Ý nghĩa |
|---|---|
| Knowledge Snapshot | Bản hiểu dự án sẽ được dùng |
| Readiness Contract | Bằng chứng project đã đủ điều kiện |
| Input Snapshot | Các phiên bản nguồn đã được khóa |
| Project Workflow Version | Phiên bản quy trình chuyên môn áp dụng cho project này |
| Runtime Profile | Cấu hình môi trường chạy |
| Capability Registry Snapshot | Bản cố định của danh sách khả năng kỹ thuật được phép dùng |
| Phạm vi chạy lại | Phần cần chạy lại, nếu đây không phải lần chạy đầy đủ |

## Hệ thống xử lý như thế nào?

1. Kiểm tra Knowledge, Readiness và nguồn đầu vào còn khớp nhau.
2. Lấy đúng Project Workflow Version.
3. Xác định các khả năng kỹ thuật cần sử dụng.
4. Từ chối khả năng chưa được hỗ trợ hoặc chưa rõ quyền.
5. Tạo danh sách Technical Workflow và Workflow Node sẽ chạy.
6. Chốt quyền truy cập, giới hạn thời gian và tài nguyên.
7. Tính hash cho kế hoạch và các cấu hình liên quan.
8. So sánh với kế hoạch trước, nếu có.

## Kết quả

Activity tạo một bản Compile Preview gồm:

- ID của lần Compile.
- Project Workflow Version chính xác.
- Execution Plan Snapshot.
- Các mã nhận diện giúp phát hiện thay đổi sau khi duyệt.
- Quyền mà quá trình thực thi cần.
- Tóm tắt tài nguyên.
- Danh sách phần chưa được hỗ trợ, nếu có.
- Báo cáo khác biệt với kế hoạch trước.

## Người dùng cần nhìn thấy gì trước khi duyệt?

- Những activity và bước kỹ thuật sẽ chạy.
- Quyền truy cập nào sẽ được dùng.
- Giới hạn thời gian và tài nguyên.
- Artifact nào sẽ được tái sử dụng.
- Điểm khác với kế hoạch lần trước.
- Cảnh báo hoặc khả năng kỹ thuật chưa được hỗ trợ.

Hash và ID nên nằm trong **Chi tiết kỹ thuật**. Màn hình chính cần giải thích thay đổi bằng ngôn ngữ người dùng.

## Khi có thay đổi sau Compile

Nếu nguồn, Knowledge Snapshot, Readiness, môi trường chạy hoặc khả năng kỹ thuật thay đổi, bản Compile cũ trở thành **stale — cần tạo lại**. Người dùng không được phê duyệt một kế hoạch đã cũ.

## Điều activity này không làm

- Không thực thi kế hoạch.
- Không tự phê duyệt thay người dùng.
- Không đọc user text tự do để lén thay đổi kế hoạch.

[← TW-03 Readiness](03-readiness.md) · [Danh sách](README.md) · [Tiếp theo: OP-05 Approve →](05-approve.md)
