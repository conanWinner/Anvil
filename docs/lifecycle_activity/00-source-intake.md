# OP-00 — Tiếp nhận nguồn đầu vào

> Tên kỹ thuật: **Source Intake**. Thuộc Lifecycle Phase **Intake — Tiếp nhận**.

## 1. Nói ngắn gọn

OP-00 nhận một file, kiểm tra file đó có phù hợp với loại nguồn đã chọn hay không, lưu nguyên nội dung và tạo một phiên bản không bị ghi đè.

Người dùng có thể hiểu activity này là:

> “Anvil đã nhận đúng file nào, file có qua kiểm tra không, và phiên bản nào sẽ được dùng ở các bước sau?”

OP-00 là **Control-plane Operation (thao tác điều khiển ở backend)**. Activity này không tạo Workflow Run và không gọi AI theo mặc định.

## 2. Khi nào activity chạy?

- Khi người dùng thêm nguồn đầu tiên cho project.
- Khi người dùng thêm một tài liệu bổ sung.
- Khi người dùng thay file của một nguồn đã tồn tại.
- Khi System 2 gửi một bản export hoặc blueprint mới sang System 3.

Mỗi file được xử lý độc lập. Một file bị từ chối không làm mất các nguồn đã được tiếp nhận trước đó.

## 3. Những loại nguồn được tiếp nhận

| Loại nguồn | Cách hiểu | Định dạng hiện được chấp nhận | Giới hạn |
|---|---|---|---:|
| Blueprint | Bản mô tả mục tiêu, yêu cầu và thiết kế dự kiến | `.md`, `.json`, `.pdf` | 10 MB |
| Dataset | Dữ liệu thật của project | `.csv` | 25 MB |
| Constraints | Ràng buộc kỹ thuật, bảo mật hoặc bàn giao | `.json`, `.yaml`, `.yml`, `.md` | 2 MB |
| Data dictionary | Tài liệu giải thích ý nghĩa cột và giá trị | `.csv`, `.json`, `.yaml`, `.yml`, `.md`, `.pdf` | 10 MB |
| User brief | Yêu cầu do người dùng cung cấp | `.md`, `.txt`, `.pdf` | 10 MB |
| Supporting document | Tài liệu bổ sung | `.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.pdf` | 10 MB |

Dataset không bắt buộc phải có khi chạy **Hiểu dự án**. Khi chưa có dataset thật, System 3 chỉ được dùng phần mô tả dataset trong tài liệu và phải ghi rõ dữ liệu chưa được liên kết.

## 4. Nguồn chính và nguồn bổ sung

Mỗi nguồn có một vai trò:

- **Nguồn chính (`primary`)**: tài liệu đại diện chính cho một loại nguồn.
- **Nguồn bổ sung (`supplemental`)**: tài liệu cung cấp thêm thông tin.

Một project chỉ có tối đa một nguồn chính cho mỗi loại, nhưng có thể có nhiều nguồn bổ sung. User brief không được nối vào blueprint rồi lưu như cùng một file; chúng giữ lịch sử và nguồn gốc riêng.

## 5. “Nguồn” khác “phiên bản nguồn” như thế nào?

Ví dụ người dùng tải `requirements.md`, sau đó thay bằng bản mới:

```text
Nguồn logic: requirements.md
├── Phiên bản 1 — hash A — vẫn giữ để đối soát
└── Phiên bản 2 — hash B — phiên bản đang dùng
```

- **Nguồn logic** giúp Anvil biết hai lần tải lên là cùng một tài liệu qua thời gian.
- **Source Version (phiên bản nguồn)** là bản ghi bất biến của một nội dung cụ thể.
- Đổi tên file không được dùng làm cách duy nhất để xác định nguồn.
- Thay file không ghi đè hoặc xóa phiên bản cũ.

## 6. Đầu vào trực tiếp

| Dữ liệu | Ý nghĩa |
|---|---|
| Project ID | Project nhận nguồn |
| Loại nguồn | Một trong sáu loại ở trên |
| Vai trò | Nguồn chính hoặc nguồn bổ sung |
| Source ID | Có khi tạo phiên bản mới cho một nguồn đã tồn tại |
| Tên file | Tên hiển thị; không phải định danh duy nhất |
| Nội dung file | Các byte gốc của file |
| Project version dự kiến | Chặn ghi lên trạng thái project đã thay đổi |
| Idempotency-Key | Mã chống tạo trùng khi gửi lại cùng yêu cầu |
| Actor | Người hoặc hệ thống đã gửi nguồn, nếu xác định được |

Client không được gửi đường dẫn lưu file trên máy chủ. Backend tự tạo storage key an toàn.

## 7. Cách hoạt động từng bước

### Bước 1 — Kiểm tra yêu cầu

Anvil xác nhận project tồn tại, Project version còn khớp, vai trò hợp lệ và Idempotency-Key đã có.

Nếu cùng một Idempotency-Key được gửi lại với nội dung yêu cầu khác, Anvil trả conflict thay vì đoán yêu cầu nào đúng.

### Bước 2 — Kiểm tra file

Anvil kiểm tra:

1. File không rỗng và không vượt giới hạn.
2. Phần mở rộng phù hợp với loại nguồn.
3. File văn bản là UTF-8 hợp lệ và không chứa byte NUL.
4. JSON/YAML đọc được theo cấu trúc tương ứng.
5. CSV có hàng tiêu đề với nhiều cột.
6. PDF có cấu trúc cơ bản và không chứa JavaScript, file đính kèm hoặc mã hóa không được hỗ trợ.

Đây là kiểm tra tiếp nhận, không phải phân tích nghiệp vụ. Ví dụ OP-00 kiểm tra CSV có thể đọc, nhưng chưa đếm dòng hoặc kết luận target.

### Bước 3 — Tính mã nhận diện nội dung

Anvil tính SHA-256 và ghi theo dạng `sha256:...`. Mã này được gọi là **content hash (mã nhận diện nội dung)**.

- Cùng byte đầu vào tạo cùng hash.
- Chỉ cần một byte thay đổi thì hash thay đổi.
- Hash dùng để phát hiện nội dung trùng và kiểm tra file sau khi lưu.

### Bước 4 — Lưu nguyên nội dung theo hai chặng

Anvil không ghi file thẳng vào vị trí chính thức. Nó dùng hai chặng để một lần mất điện hoặc dừng
process không tạo ra Source Version “sẵn sàng” nhưng thiếu nội dung:

```text
1. staged: `~/.anvil/workspaces/<owner>/<project>/artifacts/sources/.pending/<operation-id>/content`
2. ready: `~/.anvil/workspaces/<owner>/<project>/artifacts/sources/<kind>/<source-id>/v<lineage-version>_<full-hash>/<filename>`
```

Trình tự là:

1. Ghi bytes vào vùng tạm thuộc riêng OP-00.
2. Đọc lại để kiểm tra hash và dung lượng.
3. Tạo Source Version với trạng thái `pending` — đang chờ hoàn tất lưu trữ.
4. Đưa blob sang vị trí chính thức bằng thao tác không ghi đè.
5. Kiểm tra lại blob chính thức.
6. Chỉ sau đó mới đổi Source Version thành `ready` — sẵn sàng dùng — và cập nhật project.

Tên file gốc chỉ là metadata hiển thị; nó không nằm trong khóa lưu blob. Vì vậy cùng bytes nhưng đổi
tên file vẫn trỏ tới cùng nội dung bất biến. Tên file chỉ giúp người dùng nhận diện bản lưu; `source-id`,
lineage version và content hash mới là basis của đường dẫn. Đường dẫn do client gửi không được dùng làm
storage key.

### Bước 5 — Tạo hoặc dùng lại phiên bản

- Nguồn mới và nội dung mới: tạo nguồn logic cùng Source Version 1.
- Nguồn đã có và nội dung mới: tạo Source Version tiếp theo.
- Nội dung giống hệt phiên bản hiện tại của nguồn đó: trả `Không thay đổi`, không tạo bản ghi trùng và không tăng Project version.

Mỗi Source Version lưu loại nguồn, vai trò, tên gốc, định dạng, dung lượng, hash, storage key, báo cáo kiểm tra, actor, nguồn gửi, operation ID và thời điểm.

### Bước 6 — Chuyển sang OP-01

Khi có nội dung mới, Anvil tự tạo một operation riêng cho **OP-01 Change Detection — Phát hiện thay đổi**. OP-01 tạo Impact Manifest để nói phần nào của project cần cập nhật.

Hai operation được tách riêng:

- OP-00 thành công nghĩa là nguồn đã được tiếp nhận an toàn.
- Nếu OP-01 lỗi, Source Version vẫn còn và lỗi Change Detection được theo dõi riêng.

Nội dung trùng không cần chạy OP-01.

## 8. Kết quả trả về

| Kết quả | Ý nghĩa |
|---|---|
| `created_source` | Đã tạo một nguồn logic mới và phiên bản đầu tiên |
| `created_version` | Đã tạo phiên bản mới cho nguồn đã có |
| `unchanged` | Nội dung giống phiên bản hiện tại; không tạo bản sao |

Response còn có nguồn logic, Source Version, phiên bản trước nếu có, Project version mới, operation
ID của OP-00, operation ID của OP-01 nếu được tạo và báo cáo tiếp nhận đã lưu. Read model công khai
không trả `storageKey` nội bộ.

## 9. Báo cáo tiếp nhận trên UI

Màn hình **Nguồn dự án** hiển thị trước:

- Tên dễ nhận biết và loại nguồn.
- Nguồn chính hay nguồn bổ sung.
- Phiên bản đang dùng hoặc phiên bản lịch sử.
- Kết quả: đã thêm nguồn, đã thêm phiên bản hoặc không thay đổi.
- Từng kiểm tra đã đạt và cảnh báo dễ hiểu.
- OP-01 đã được bắt đầu hay không.
- Hành động tiếp theo: sửa file, thử lại OP-01 hoặc xem lại rồi tiếp tục.

Hash, media type, origin và metadata kỹ thuật nằm trong phần **Chi tiết kỹ thuật và báo cáo kiểm tra**. Người dùng không cần đọc JSON để biết file có được chấp nhận hay không.

## 10. Lỗi và khôi phục

| Tình huống | Hành vi |
|---|---|
| File rỗng hoặc yêu cầu thiếu | Trả 400, không tạo Source Version |
| File quá lớn | Trả 413, không tạo Source Version |
| Sai loại file | Trả 415, không tạo Source Version |
| Nội dung JSON/YAML/CSV/PDF không hợp lệ | Trả 422, kèm lý do kiểm tra |
| Project đã thay đổi | Trả 409 và yêu cầu tải lại trạng thái |
| Gửi lại cùng yêu cầu | Trả lại kết quả cũ hoặc không tạo phiên bản trùng |
| File lưu xong nhưng bước sau lỗi | Blob content-addressed được giữ để lần thử an toàn có thể đối soát và dùng lại |

Anvil không tự đánh dấu một operation đang chạy ở process khác là thất bại chỉ dựa vào thời gian.
Trạng thái sở hữu không rõ được hiển thị tại cổng Intake. Nếu bytes tạm đã được kiểm tra và ghim,
người dùng có thể bấm **Tiếp tục lại yêu cầu này**. Nếu operation cũ có thể vẫn chạy ở process khác,
UI phải cảnh báo trước khi người dùng chủ động nhận quyền xử lý.

Khi khôi phục, Anvil dùng lại đúng operation ID, hash, dung lượng và storage pointer đã ghi trong
progress; không đọc một file “mới nhất” khác. Trường hợp process đã promote blob nhưng chưa cập nhật
database cũng được đối soát từ blob chính thức và hoàn tất an toàn.

## 11. Cổng từ Intake sang Hiểu dự án

Người dùng chỉ có thể bấm **Tiếp tục Hiểu dự án** khi:

1. Có Blueprint nguồn chính đang dùng.
2. Source Registry có ít nhất một Source Version `ready`.
3. Không còn OP-00 kỹ thuật bị gián đoạn cần xử lý.
4. OP-01 đã thành công cho mọi Source Version đang dùng.

Một lần upload bị từ chối vẫn xuất hiện trong lịch sử báo cáo, nhưng không tự chặn project nếu các
nguồn đang dùng đều hợp lệ. Việc bắt đầu TW-02 luôn cần hành động xác nhận của người dùng; OP-00
không tự chạy “Hiểu dự án”.

## 12. API chính

| API | Mục đích |
|---|---|
| `POST /api/system3/projects/{id}/sources` | Tiếp nhận một file; bắt buộc `Idempotency-Key` |
| `GET /api/system3/projects/{id}/sources` | Đọc các Source Version `ready` mà không lộ storage key |
| `GET /api/system3/projects/{id}/source-intake-reports` | Đọc lịch sử báo cáo, kể cả lần bị từ chối |
| `GET /api/system3/projects/{id}/source-intake-reports/{reportId}/content` | Tải đúng artifact báo cáo JSON bất biến |
| `GET /api/system3/projects/{id}/intake-gate` | Đọc checklist, OP-01 và operation cần khôi phục |
| `POST /api/system3/projects/{id}/source-intake-operations/{operationId}/retry` | Người dùng chủ động tiếp tục OP-00 bị gián đoạn |
| `POST /api/system3/projects/{id}/source-versions/{sourceVersionId}/change-detection/retry` | Thử lại riêng OP-01 |
| `GET /api/system3/projects/{id}/source-versions/{sourceVersionId}/content` | Tải đúng bytes bất biến; ETag bằng content hash |

## 13. Giới hạn hiện tại cần nói rõ

- OP-00 tiếp nhận PDF, nhưng việc trích nội dung PDF ở TW-02 phụ thuộc parser của activity Hiểu dự án; “đã nhận PDF” không đồng nghĩa “đã hiểu PDF”.
- CSV mới được kiểm tra hàng tiêu đề tại OP-00. Dataset Profile đầy đủ thuộc TW-02 và các bước dữ liệu sau đó.
- Việc phát hiện thay đổi hiện chủ yếu xác định phạm vi theo loại nguồn; canonical diff theo từng entity vẫn cần được hoàn thiện.
- Source Registry cho phép tải lại một phiên bản qua Source Version ID; client không được gửi storage path tùy ý.

## 14. Activity này không làm gì?

- Không kết luận mục tiêu hoặc yêu cầu của project.
- Không tạo Knowledge Snapshot.
- Không tự trả lời Decision.
- Không kiểm tra Readiness.
- Không Compile, Approve, Build, Verify hoặc Deliver.

[← Danh sách 10 Lifecycle Activity](README.md) · [Tiếp theo: OP-01 Change Detection →](01-change-detection.md)
