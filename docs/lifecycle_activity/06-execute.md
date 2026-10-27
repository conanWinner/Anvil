# TW-06 — Thực thi kế hoạch đã duyệt

> Tên kỹ thuật: **Execute Project Workflow Version**. Thuộc phase **Build — Xây dựng**.

## Nói ngắn gọn

Activity này thực hiện đúng Execution Plan mà người dùng đã phê duyệt. Ở chế độ thí nghiệm (mặc định), TW-06 gồm hai bước có điểm dừng ở giữa: agent viết và kiểm thử code (TW-06A), rồi người dùng chọn cách chạy các phương án (TW-06B).

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

## Chế độ thí nghiệm (mặc định)

Code: `packages/system3/src/experiment-capabilities.ts`. Lựa chọn của người dùng đi vào bundle đã duyệt qua runtime binding `experimentRun`; binding này không đổi được kế hoạch, dữ liệu hay agent.

### TW-06A — Build: viết code và kiểm thử

1. Ghim blueprint và các CSV đúng phiên bản đã duyệt.
2. Agent thi công viết `prepare_data.py`; sandbox chạy thử, lỗi được gửi lại cho agent sửa.
3. Anvil chia bảng dữ liệu: `train.csv`, `test_features.csv` cho code; nhãn kiểm tra Anvil giữ riêng. Chặn nếu lớp thiểu số quá ít.
4. Agent viết `train_variant.py --variant <id>`; sandbox chạy thử từng phương án trên mẫu nhỏ.
5. Agent review đọc code cùng thống kê dữ liệu; lỗi chặn được trả về đúng file để sửa trong số vòng giới hạn.
6. Agent thấy blueprint mâu thuẫn thì dừng và đặt câu hỏi; không tự đổi target, tập dữ liệu hay metric.

Kết quả: artifact `experiment_build` (code, dữ liệu cho code, nhãn kiểm tra, review, thống kê chia dữ liệu). Dự án quay về trạng thái đã duyệt và chờ người dùng chọn cách chạy; chưa chạy Verify. Lỗi review còn lại sau các vòng sửa được hiện cho người dùng thay vì làm hỏng build.

### TW-06B — Run: chạy các phương án

1. Người dùng chọn tập con của các phương án đã duyệt và số phương án chạy cùng lúc (giới hạn theo RAM/CPU của máy).
2. Mỗi phương án chạy offline trong sandbox: không mạng, user không đặc quyền, 2 GB RAM, 2 CPU, tối đa 30 phút; chỉ thấy code và dữ liệu không nhãn. Vượt giới hạn được ghi là giới hạn tài nguyên, không phải phương án kém.
3. Anvil tính metric trên nhãn giữ riêng và xếp hạng theo metric chính của blueprint.
4. Chạy lại một phần: các phương án không chạy lại được mang kết quả từ lần chạy trước của cùng gói build (cùng code, cùng cách chia).
5. Đóng gói kết quả bất biến cho TW-07.

## Chế độ baseline tham chiếu (Customer Churn)

Các phần dưới mô tả pipeline baseline cố định dùng cho fixture Customer Churn và chế độ so sánh nhiều LLM cũ.


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

- Chế độ thí nghiệm: sau build là thẻ **Code đã sẵn sàng** (review, thống kê dữ liệu, chọn phương án, số phương án chạy cùng lúc, nút chạy hoặc viết lại code); sau khi chạy là phần **Chạy lại một phần** trong màn hình kết quả.

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
