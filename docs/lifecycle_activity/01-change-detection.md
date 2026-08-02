# OP-01 — Phát hiện thay đổi và vùng bị ảnh hưởng

> Tên kỹ thuật: **Change Detection & Impact Preview**. Thuộc phase **Intake — Tiếp nhận**.

## Nói ngắn gọn

Activity này so sánh nguồn mới với nguồn trước đó để trả lời hai câu hỏi:

1. Nội dung đã thay đổi điều gì?
2. Báo cáo hoặc kết quả nào cần làm lại?

Hệ thống không xóa kết quả cũ. Kết quả không còn chắc chắn đúng sẽ được đánh dấu **stale — cần cập nhật**.

## Trạng thái triển khai hiện tại

OP-01 đã có đường chạy control-plane độc lập, không tạo Workflow Run. Bản triển khai hiện tại:

- pin chính xác Source Version mới, Source Version trước và basis dùng để so sánh;
- tạo `Impact Manifest` phiên bản 3 có dấu vân tay, mức chắc chắn, nội dung cũ–mới, hoạt động bị ảnh hưởng,
  resource cần cập nhật hoặc có thể tái sử dụng và phạm vi chạy lại đề xuất;
- phân biệt nguồn đầu tiên, thay đổi chỉ định dạng, requirement, schema/row/target của CSV và các
  ràng buộc runtime, policy hoặc delivery;
- dùng hỗ trợ phân loại có giới hạn chỉ khi cách kiểm tra theo quy tắc còn mơ hồ; kết quả hỗ trợ phải
  có source pointer hợp lệ và chỉ được mở rộng, không được thu hẹp phạm vi an toàn;
- giữ lịch sử manifest, hỗ trợ retry/idempotency và gộp nhiều manifest đang chờ khi Compile.
- dùng bản quan hệ theo từng dự án để giải thích đường đi từ nguồn đến kết quả; nếu dữ liệu lịch sử
  thiếu nguồn gốc thì mở rộng phạm vi an toàn và nói rõ lý do.
- giao diện chỉ đặt báo cáo của lần kiểm tra hiện tại trong **Kết quả đã tạo**; báo cáo cũ nằm trong
  **Lịch sử hoạt động**, còn bản quan hệ nằm trong **Thông tin kỹ thuật dùng khi kiểm tra** thay vì
  xuất hiện như một tệp đầu vào của người dùng.

Các nguồn không hỗ trợ hoặc trường hợp chưa đủ bằng chứng được phân loại bảo thủ và đề xuất phạm vi
rộng hơn. Đây là lựa chọn an toàn có giải thích, không phải kết luận giả rằng nguồn không ảnh hưởng.

## Khi nào chạy?

Chạy sau OP-00 khi một Source Version mới có nội dung khác phiên bản trước.

## Đầu vào

| Dữ liệu | Ý nghĩa |
|---|---|
| Source Version mới | Phiên bản vừa được tiếp nhận |
| Source Version trước | Bản dùng để so sánh; có thể chưa có nếu đây là lần đầu |
| Knowledge Snapshot đang dùng | Bản hiểu dự án hiện tại |
| Dependency graph | Sơ đồ cho biết nguồn nào ảnh hưởng đến kết quả nào |

**Dependency graph** có thể hiểu là bản đồ quan hệ. Ví dụ: cột target ảnh hưởng đến kiểm tra sẵn sàng, thử nghiệm và xác minh.

## Hệ thống xử lý như thế nào?

### Nếu đây là nguồn đầu tiên

Hệ thống đề xuất chạy đầy đủ activity Hiểu dự án.

### Nếu blueprint thay đổi

Hệ thống so sánh mục tiêu, yêu cầu, target, giới hạn runtime và các câu hỏi cần người dùng xác nhận.

### Nếu dataset thay đổi

Hệ thống phân biệt:

- Chỉ thay đổi các dòng dữ liệu.
- Thay đổi cấu trúc cột.
- Thay đổi cột target.
- Thay đổi toàn bộ nội dung.

### Nếu constraints thay đổi

Hệ thống kiểm tra phần nào liên quan đến runtime, chính sách hoặc cách bàn giao.

Sau đó hệ thống đi theo bản đồ quan hệ để lập danh sách kết quả bị ảnh hưởng và đề xuất phạm vi chạy lại.

## Kết quả

Activity tạo **Impact Manifest — bản kê vùng ảnh hưởng**, gồm:

- Những mục tiêu, yêu cầu hoặc dữ liệu đã đổi.
- Những artifact cần cập nhật.
- Những phase có thể bị ảnh hưởng.
- Những artifact vẫn được phép dùng lại.
- Phạm vi đề xuất chạy lại.
- Lý do của từng kết luận.

Ví dụ:

| Thay đổi | Cần cập nhật | Có thể giữ lại |
|---|---|---|
| Chỉ sửa định dạng Markdown | Báo cáo so sánh nguồn | Bản hiểu dự án nếu nội dung chuẩn hóa không đổi |
| Sửa một yêu cầu | Knowledge, readiness, kế hoạch và evidence liên quan | Các nguồn không liên quan |
| Dataset thêm dòng, không đổi cột/target | Dataset profile, thử nghiệm và xác minh | Yêu cầu trong blueprint |
| Đổi cột target | Hiểu dự án, readiness, kế hoạch, thử nghiệm và xác minh | File blueprint gốc |
| Chỉ đổi yêu cầu đóng gói | Kế hoạch và gói bàn giao | Kết quả build đã được xác minh nếu chính sách cho phép |

## Người dùng nhìn thấy gì trên UI?

- “Phiên bản mới thay đổi 3 yêu cầu”.
- Danh sách kết quả cần cập nhật.
- Danh sách kết quả vẫn dùng lại được.
- Nút xem chi tiết thay đổi.
- Nội dung cũ và nội dung mới của từng mục khi báo cáo có đủ dữ liệu.
- Phạm vi chạy lại được đề xuất trước khi người dùng xác nhận.

## Khi không xác định chắc chắn được ảnh hưởng

Hệ thống chọn phạm vi an toàn rộng hơn và nói rõ lý do. Nó không được kết luận “không ảnh hưởng” nếu còn thiếu thông tin về quan hệ phụ thuộc.

## Điều activity này không làm

- Không tự chạy lại toàn bộ project.
- Không xóa artifact cũ.
- Không tự phê duyệt phạm vi chạy lại.

[← OP-00 Source Intake](00-source-intake.md) · [Danh sách](README.md) · [Tiếp theo: TW-02 Understand Project →](02-understand-project.md)
