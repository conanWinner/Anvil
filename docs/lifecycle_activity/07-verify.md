# TW-07 — Xác minh kết quả độc lập

> Tên kỹ thuật: **Independent Verification**. Thuộc phase **Verify — Xác minh**.

## Nói ngắn gọn

Activity này kiểm tra gói kết quả do TW-06 tạo ra và đối chiếu nó với yêu cầu của project.

Từ “độc lập” có nghĩa là quá trình xác minh không sửa kết quả thực thi để làm cho nó vượt kiểm tra. Nó đọc một gói kết quả cố định và đưa ra kết luận kèm bằng chứng.

## Khi nào chạy?

Sau khi TW-06 tạo được gói kết quả baseline hoàn chỉnh.

## Đầu vào

| Dữ liệu | Ý nghĩa |
|---|---|
| Execution ID | Lần thực thi cần xác minh |
| ID và mã nhận diện của gói baseline | Gói kết quả chính xác cần kiểm tra |
| Knowledge Snapshot ID | Bộ yêu cầu dùng để đối chiếu |
| Validator version | Phiên bản quy tắc xác minh |

## Hệ thống xử lý như thế nào?

1. Mở đúng gói baseline đã được khóa.
2. Kiểm tra mã nhận diện nội dung và độ an toàn của gói nén.
3. Kiểm tra cấu trúc các file kết quả.
4. Ghép từng yêu cầu với test, chỉ số đánh giá hoặc kết quả chứng minh cho yêu cầu đó.
5. Đánh giá cổng xác minh.

## Kết quả

- **Evidence Map — bản đồ bằng chứng:** yêu cầu nào được chứng minh bằng kết quả nào.
- **Verification Gate — kết luận xác minh:** `passed` hoặc `failed`, kèm lý do.
- Mã xác nhận tập đầu vào đã dùng để xác minh.

Artifact:

- `verification/artifact-validation.json`
- `verification/requirement-evidence-map.json`
- `verification/final-gate.json`

## Người dùng nhìn thấy gì trên UI?

- Tổng số yêu cầu đã đạt, chưa đạt và chưa có đủ bằng chứng.
- Bằng chứng gắn với từng yêu cầu.
- Lý do cụ thể nếu verification thất bại.
- Phiên bản gói kết quả và bộ kiểm tra đã dùng.
- Nút chạy lại Verification mà không phải chạy lại Build nếu đầu vào không đổi.

## Khi verification thất bại

- Không cho phép Delivery.
- Giữ nguyên gói kết quả thực thi để điều tra.
- Có thể chạy lại Verification độc lập nếu lỗi thuộc bộ kiểm tra.
- Nếu lỗi nằm trong sản phẩm, tạo phạm vi chạy lại phù hợp cho Build/Experiment.

## Điều activity này không làm

- Không sửa gói kết quả đang xác minh.
- Không tự coi một test thành công là bằng chứng cho mọi yêu cầu.
- Không tự chuyển sang Delivery khi chưa có hành động của người dùng.

[← TW-06 Execute](06-execute.md) · [Danh sách](README.md) · [Tiếp theo: OP-08 Delivery Request →](08-delivery-request.md)
