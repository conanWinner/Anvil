# 10 hoạt động trong Project Lifecycle

Thư mục này giải thích **10 Lifecycle Activity** — 10 hoạt động cụ thể mà hệ thống thực hiện từ lúc nhận tài liệu đến lúc giao sản phẩm.

Đây là mô tả về **trạng thái sản phẩm cần đạt**. Một số activity đã có luồng chạy thật nhưng báo cáo, UI hoặc kiểm tra chi tiết vẫn chưa hoàn chỉnh. Tài liệu không có nghĩa mọi hành vi bên dưới đã được triển khai đầy đủ.

[← Tổng quan hệ thống](../1.%20Tổng%20quan%20hệ%20thống.md) · [Mục lục docs](../README.md)

## Cách đọc nhanh

Project Lifecycle có **6 Lifecycle Phase** (6 giai đoạn lớn trên giao diện), nhưng bên trong có **10 Lifecycle Activity**:

| Lifecycle Phase                  | Lifecycle Activity                                   | Người dùng hiểu đơn giản là           |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| 1. Intake — Tiếp nhận            | [OP-00 Source Intake](00-source-intake.md)           | Nhận và lưu đầu vào                   |
| 1. Intake — Tiếp nhận            | [OP-01 Change Detection](01-change-detection.md)     | Xem đầu vào mới làm thay đổi những gì |
| 2. Understanding — Hiểu dự án    | [TW-02 Understand Project](02-understand-project.md) | Đọc tài liệu và tạo bản hiểu dự án    |
| 3. Readiness — Kiểm tra sẵn sàng | [TW-03 Readiness](03-readiness.md)                   | Kiểm tra đã đủ điều kiện để làm chưa  |
| 3. Readiness — Kiểm tra sẵn sàng | [OP-04 Compile](04-compile.md)                       | Chuẩn bị kế hoạch chạy chính xác      |
| 3. Readiness — Kiểm tra sẵn sàng | [OP-05 Approve](05-approve.md)                       | Người dùng duyệt kế hoạch đó          |
| 4. Build — Xây dựng              | [TW-06 Execute](06-execute.md)                       | Thực hiện kế hoạch đã duyệt           |
| 5. Verify — Xác minh             | [TW-07 Verify](07-verify.md)                         | Kiểm tra kết quả bằng bằng chứng      |
| 6. Delivery — Bàn giao           | [OP-08 Delivery Request](08-delivery-request.md)     | Người dùng yêu cầu đóng gói kết quả   |
| 6. Delivery — Bàn giao           | [TW-09 Deliver](09-deliver.md)                       | Tạo gói bàn giao cuối cùng            |

Luồng đầy đủ:

```text
Tiếp nhận đầu vào
  → Kiểm tra thay đổi
  → Hiểu dự án
  → Kiểm tra sẵn sàng
  → Chuẩn bị kế hoạch chạy
  → Người dùng phê duyệt
  → Thực thi
  → Xác minh
  → Yêu cầu bàn giao
  → Tạo gói bàn giao
```

## Vì sao có tên OP và TW?

- **OP — Control-plane Operation (thao tác điều khiển):** backend xử lý bằng quy tắc rõ ràng, ví dụ lưu file, so sánh phiên bản hoặc ghi nhận phê duyệt. OP không mặc định tạo một lần chạy workflow.
- **TW — Technical Workflow (quy trình kỹ thuật):** một chuỗi bước được Workflow Runtime thực thi và theo dõi. Mỗi lần chạy có trạng thái, log và kết quả riêng.

Người dùng không cần nhớ mã `OP-*` hay `TW-*`. Mã này chủ yếu giúp đội phát triển biết activity được thực thi theo cách nào.

## Một số từ xuất hiện thường xuyên

| Thuật ngữ | Cách hiểu đơn giản |
|---|---|
| **Blueprint** | Tài liệu mô tả mục tiêu, yêu cầu và thiết kế dự kiến của project |
| **Dataset** | File hoặc tập dữ liệu thực tế mà project sẽ sử dụng |
| **Target** | Giá trị project cần dự đoán hoặc xác định, ví dụ khách hàng có rời bỏ hay không |
| **Schema** | Mô tả cấu trúc dữ liệu, ví dụ tên cột và kiểu dữ liệu |
| **Constraints** | Các giới hạn phải tuân theo, ví dụ chỉ dùng CPU hoặc không được truy cập mạng |
| **Runtime** | Môi trường dùng để chạy, gồm CPU, RAM, quyền mạng và công cụ có sẵn |
| **Baseline** | Phiên bản giải pháp ban đầu dùng làm mốc để kiểm tra và so sánh |
| **Source** | Nguồn đầu vào, ví dụ blueprint, dataset hoặc file ràng buộc |
| **Version** | Một phiên bản được lưu lại; phiên bản cũ không bị ghi đè |
| **Snapshot** | “Ảnh chụp” cố định danh sách phiên bản được dùng tại một thời điểm |
| **Hash** | Mã nhận diện nội dung file; nội dung đổi thì mã đổi |
| **Artifact** | File hoặc kết quả do hệ thống tạo ra, ví dụ báo cáo hoặc gói sản phẩm |
| **Evidence** | Bằng chứng dùng để xác minh một kết luận, ví dụ kết quả test |
| **Stale** | Kết quả cũ không còn chắc chắn đúng vì đầu vào liên quan đã thay đổi |
| **Decision** | Câu hỏi hệ thống cần người dùng trả lời vì không được tự đoán |
| **Readiness** | Mức độ sẵn sàng trước khi cho phép thực thi |
| **Compile** | Chuyển thông tin đã duyệt thành kế hoạch chạy cụ thể; không phải biên dịch mã nguồn |
| **Manifest** | Bản kê khai chính xác những gì được duyệt hoặc bàn giao |
| **Deterministic** | Cùng đầu vào và cùng phiên bản quy tắc thì cho cùng kết quả |
| **Idempotency key** | Mã chống tạo trùng khi người dùng bấm lại hoặc gửi lại cùng yêu cầu |
| **Provenance** | Dấu vết cho biết thông tin hoặc kết quả đến từ nguồn nào |
| **Source pointer** | Vị trí cụ thể trong nguồn, ví dụ file, heading hoặc dòng chứa thông tin |

## Nguyên tắc hiển thị trên UI

UI nên hiển thị **6 Lifecycle Phase** ở thanh tiến trình chính. Khi mở một phase, người dùng mới thấy các Lifecycle Activity bên trong.

Mỗi activity cần cho biết:

1. Hệ thống đang làm gì.
2. Đang dùng phiên bản đầu vào nào.
3. Đã tạo ra báo cáo hoặc kết quả gì.
4. Có vấn đề nào cần người dùng xử lý không.
5. Người dùng có thể làm gì tiếp theo.

Mọi đầu vào và kết quả liên quan phải mở xem được ngay tại activity đang chọn. Thao tác xem mặc định
không được chuyển sang route khác hoặc mở tab trình duyệt mới. UI hiển thị báo cáo dễ đọc trước; thông
tin kỹ thuật như hash, ID, log và dữ liệu JSON chỉ nằm trong phần **Chi tiết kỹ thuật**, không phải nội
dung chính.

Khi chọn một activity, UI không bắt người dùng mở lần lượt nhiều tab. Nội dung chính xuất hiện trong
một workspace duy nhất:

- Trạng thái hiện tại và việc cần làm tiếp theo nằm gần tên activity.
- Đầu vào, kết quả và bằng chứng là ba nhóm có thể quét và mở trực tiếp.
- Lịch sử, Workflow Node, log và dữ liệu thô nằm trong phần mở rộng khi người dùng cần đối soát.

Trên desktop, 6 phase và 10 activity dùng chung một thanh điều hướng dọc. Trên màn hình nhỏ, thanh
này cuộn ngang để người dùng tới activity mà không phải cuộn qua một trang mục lục dài.

Resource cũ không bị ẩn hoặc ghi đè. UI gắn nhãn **Phiên bản cũ** khi đã được thay thế và **Cần cập
nhật** khi nguồn liên quan thay đổi; người dùng vẫn có thể mở để audit.

[← Tổng quan hệ thống](../1.%20Tổng%20quan%20hệ%20thống.md) · [Tài liệu kỹ thuật](../technical/README.md)
