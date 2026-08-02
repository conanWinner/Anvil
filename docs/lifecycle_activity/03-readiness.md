# TW-03 — Kiểm tra mức độ sẵn sàng

> Tên kỹ thuật: **Readiness Contract**. Thuộc phase **Readiness — Kiểm tra sẵn sàng**.

## Nói ngắn gọn

Activity này kiểm tra project đã đủ điều kiện để chuẩn bị kế hoạch thực thi hay chưa.

Nó không chỉ hỏi “quy trình kỹ thuật có chạy được không?”. Nó còn kiểm tra mục tiêu, yêu cầu, câu trả lời của người dùng, dataset và môi trường chạy đã đủ rõ chưa.

## Khi nào chạy?

Sau khi có một Knowledge Snapshot đang hoạt động và người dùng đã trả lời các Decision liên quan.

## Đầu vào

| Dữ liệu | Ý nghĩa |
|---|---|
| Active Knowledge Snapshot | Bản hiểu dự án đã được chấp nhận |
| Decision đã trả lời | Các lựa chọn chính thức của người dùng |
| Dataset Profile | Kết quả kiểm tra dataset thật; có thể chưa có |
| Runtime Profile | Môi trường dự kiến để chạy, ví dụ CPU/RAM và giới hạn tài nguyên |

Activity này không đọc lại blueprint thô. Nó dùng bản hiểu dự án đã được chuẩn hóa.

## Hệ thống xử lý như thế nào?

1. Kiểm tra mục tiêu và yêu cầu bắt buộc.
2. Kiểm tra các Decision đang chặn đã được trả lời chưa.
3. Kiểm tra dataset có cần cho bước tiếp theo không.
4. Kiểm tra target và cấu trúc dữ liệu có đủ rõ không.
5. Kiểm tra runtime có đáp ứng yêu cầu không.
6. Nếu đạt, tạo **Readiness Contract** — bản ghi cố định về các điều kiện đã vượt qua.
7. Tạo báo cáo dễ đọc cho UI.

## Các trạng thái kết quả

| Trạng thái | Ý nghĩa | Người dùng cần làm gì? |
|---|---|---|
| `passed` | Đủ điều kiện | Xem bước Compile |
| `decision_required` | Còn câu hỏi cần trả lời | Trả lời Decision |
| `data_required` | Chưa có dataset thật cho bước cần dữ liệu | Liên kết dataset |
| `blocked` | Có vấn đề khác đang chặn | Xem lý do và sửa nguồn/cấu hình |

`data_required` và `decision_required` là trạng thái nghiệp vụ bình thường, không nên hiển thị thành lỗi chung “Workflow failed”.

## Kết quả và báo cáo

- `readiness-report.md`: người dùng đã đủ và còn thiếu điều gì.
- `readiness-contract.json`: contract cố định cho Compile.
- `decision-log.json`: các Decision và câu trả lời đã được sử dụng.

## Người dùng nhìn thấy gì trên UI?

- Danh sách điều kiện với trạng thái đạt/chưa đạt.
- Lý do cụ thể của từng blocker.
- Nút hành động phù hợp, ví dụ `Liên kết Dataset` hoặc `Trả lời câu hỏi`.
- Thời điểm và phiên bản Knowledge Snapshot được kiểm tra.

## Điều activity này không làm

- Không tự trả lời Decision.
- Không tự tạo dataset giả khi còn thiếu.
- Không chuẩn bị Execution Plan; đó là trách nhiệm của OP-04.
- Không thực thi project.

[← TW-02 Understand Project](02-understand-project.md) · [Danh sách](README.md) · [Tiếp theo: OP-04 Compile →](04-compile.md)
