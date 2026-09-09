# 06 — Kế hoạch triển khai và kiểm thử

Tài liệu này đưa ra thứ tự triển khai, chiến lược kiểm thử và Definition of Done cho System 3 vertical slice.

## Lifecycle Attempt và worktree kiểm thử

Kiểm thử chạy lại System 3 phải chứng minh:

1. Mỗi attempt tạo branch/worktree riêng; các Technical Workflow cùng attempt dùng chung worktree đó.
2. Attempt khác không dùng lại branch hoặc artifact namespace của attempt trước.
3. Preview bị từ chối nếu project version hoặc basis thay đổi trước khi tạo attempt.
4. Preview ghim commit Git và worktree bắt đầu đúng từ commit đó.
5. Cleanup không xóa Source Version, không xóa remote branch mặc định, không xóa payload `current` và từ chối attempt active/unknown.
6. Worktree có thay đổi chưa commit phải yêu cầu force cleanup riêng.
7. UI vẫn đúng 6 Lifecycle Phase và 10 Lifecycle Activity; lịch sử attempt chỉ đọc và resource mở inline.

## 1. Thứ tự triển khai

### Trạng thái vertical slice hiện tại

Phần nền đã triển khai cho toàn bộ 10 activity:

- `Understanding Input Snapshot` được persist trước khi TW-02 bắt đầu và được hoàn tất bằng
  Knowledge Snapshot/Workflow Run đã tạo.
- Artifact metadata ghi activity, producer, định dạng, schema, provenance và trạng thái phiên bản.
- Activity read model trả riêng Đầu vào, Kết quả, Bằng chứng và Lịch sử.
- Resource Presentation API tạo giao diện thân thiện theo `resourceType`; dữ liệu gốc được tải riêng.
- Project Lifecycle UI có Inline Resource Viewer, disclosure kỹ thuật, focus trap, Escape và trả focus
  về resource đã mở.

OP-01 hiện đã có so sánh nội dung chuẩn hóa, Impact Manifest V3, đánh dấu kết quả theo quan hệ
nguồn–kết quả, hỗ trợ phân loại có giới hạn và Compile gộp nhiều báo cáo ảnh hưởng. Giao diện hiển thị
nội dung cũ–mới, kết quả cần cập nhật và kết quả được giữ lại.

TW-02 hiện đã có bộ đọc System 2 JSON có phiên bản, cây Markdown, bộ đọc bố cục PDF có lớp chữ,
sáu bộ trích xuất, bộ kiểm tra CSV theo dòng, ghép nguồn ràng buộc/từ điển dữ liệu, báo cáo chất lượng,
bản hiểu nháp và thao tác kích hoạt riêng. Bảng Markdown lớn được chia theo hàng và lặp lại hàng tiêu
đề. Câu trả lời về cột mục tiêu phải chọn từ Dataset Profile và được dùng cho Readiness, Compile và
Execute mà không sửa Bản hiểu gốc. Giao diện vòng đời hiển thị bản đang hoạt động, bản nháp, lý do
chặn, quyết định và tài nguyên ngay tại hoạt động TW-02. Nhận dạng chữ trong PDF dạng ảnh vẫn nằm ngoài phạm vi hiện tại.

### Mốc kiểm chứng T07 — 09/09/2026

- Định dạng chưa hỗ trợ không còn được ngầm đọc như Markdown; báo cáo yêu cầu sửa nguồn và giữ vị trí nguồn.
- Sau Decision đổi cột mục tiêu, Activation, Readiness, Compile và Execute đọc lại đúng Dataset Source Version
  trong Input Snapshot, kiểm tra hash của byte thực và tính lại phân phối target. Knowledge Snapshot gốc
  không bị sửa. Kiểm thử server bao gồm nguồn mới hơn, metadata sai và blob không khớp hash.
- Kiểm thử SQLite chứng minh hai thứ tự: nguồn mới đã sẵn sàng thì từ chối kích hoạt và giữ nhãn stale;
  kích hoạt trước thì OP-01 sau thay nguồn đánh dấu artifact stale, vẫn giữ bản hiểu lịch sử.
- E2E hai luồng Customer Churn và thiếu Dataset đã qua; kiểm tra cột mục tiêu được chọn rõ ràng,
  Readiness ghim đúng nguồn và bản hiểu gốc bất biến. Đã xem ảnh desktop và compact 390px.
- `NODE_OPTIONS=--max-old-space-size=4096 bun run validate` đã qua; bộ System 3 có 119 test,
  bộ hồi quy server mới có 3 test đọc nguồn và 2 test SQLite kích hoạt. Chưa kiểm chứng PostgreSQL live.
- Chưa coi toàn bộ T07 hoàn tất: còn kiểm chứng chất lượng trích xuất PDF, bao phủ yêu cầu tới thiết kế,
  và mở đúng đoạn nguồn trích dẫn tại chỗ. UI Readiness còn danh sách Decision lặp nhãn cần cải thiện.

Phần kiểm chứng PDF tiếp theo xác nhận: bộ đọc giữ trang, vùng chữ và đường dẫn mục cha của đoạn văn
(`system3-pdf-layout-reader@2`). PDF có lớp chữ và đủ tên chương không đồng nghĩa đã trích xuất được
yêu cầu; fixture có yêu cầu dạng đoạn văn vẫn trả `revision_required`, không đánh dấu nội dung đó đã
trích xuất. Đây là kiểm chứng giới hạn hiện tại, chưa phải hỗ trợ đầy đủ bảng PDF hoặc OCR.

Policy `system3-understanding-policy@3` kiểm tra thêm tham chiếu yêu cầu trong pipeline, công nghệ,
thiết kế triển khai và tham chiếu mô-đun từ thiết kế triển khai. Mã không tồn tại trả `revision_required`;
yêu cầu không có liên kết thiết kế rõ ràng nhận warning, không tự tạo ánh xạ hoặc coi đó là bằng chứng
đã triển khai. Blueprint mẫu có 0 warning liên kết mới. Sau thay đổi: 123 test System 3, 2 E2E và
`bun run validate` đều qua; đã xem lại ảnh Readiness desktop/compact. Mở đoạn trích dẫn tại chỗ và
hỗ trợ trích xuất yêu cầu PDF đầy đủ vẫn chưa hoàn tất.

### Giai đoạn 1 — Khóa input và provenance

- Persist `UnderstandingInputSnapshot` trước Workflow Run.
- Liên kết Knowledge Snapshot với Input Snapshot.
- Thêm Artifact Descriptor có phase, status và provenance.
- Test same-hash retry và Source Version mới.

Hoàn tất khi hệ thống chứng minh được chính xác source, hash và parser version đã dùng. Source đổi trong lúc chạy phải tạo conflict và không publish snapshot sai basis.

### Giai đoạn 2 — Báo cáo Understanding và read model

- Sinh bộ report artifact của TW-02.
- Thêm artifact list/content API.
- Thêm `UnderstandingView`.

Hoàn tất khi API trả report current/draft/stale với metadata đầy đủ và UI không cần suy nghĩa artifact từ filename.

### Giai đoạn 3 — Understanding Workspace

- Tạo các tab Tổng quan, Yêu cầu, Dataset, Vấn đề, Thay đổi và Kết quả.
- Thêm preview, download và compare.
- Hiển thị progress từ event thật.

Hoàn tất khi người dùng xem được báo cáo ngay trong phase.

### Giai đoạn 4 — System 2 contract và importer linh hoạt

- Định nghĩa versioned System 2 export contract.
- Canonical JSON importer.
- Structural Markdown fallback.
- Constraints và data dictionary parser.

Hoàn tất khi đổi filename hoặc bố cục Markdown không làm mất tri thức nếu nội dung vẫn tương đương.

### Giai đoạn 5 — Dataset profiler và schema drift

- Streaming profiler.
- Type, missingness, cardinality và duplicate check.
- Target candidate và user Decision.
- Schema/content/target fingerprint.
- Intake, Understanding, Change Detection và Build dùng chung hợp đồng CSV: UTF-8/BOM, quoted
  field, newline trong quoted field, header chính xác và số cột nghiêm ngặt. Header trống/trùng và
  row malformed bị từ chối; hệ thống không tự đổi tên cột.
- Profiler chặn rõ ràng tại 250.000 dòng, 512 cột, record 1 MiB, 50.000 giá trị phân biệt mỗi cột
  hoặc 250.000 giá trị được theo dõi toàn file. Kết quả luôn ghi row fingerprint và limits; không
  trả thống kê ước lượng không gắn nhãn.
- Dataset được materialize byte-for-byte từ Source Version đã ghim. Validator TypeScript và runner
  Python cùng giữ nguyên whitespace, hỗ trợ BOM/quoted multiline và stream row thay vì nạp toàn bộ
  `DictReader` vào RAM.

Hoàn tất khi phân biệt được row-only change và schema-breaking change; target không còn hard-code là `target`.

### Giai đoạn 6 — Impact analysis chính xác

- Typed edge giữa source, entity, artifact và evidence.
- Canonical diff.
- Impact Manifest chi tiết.
- Scoped rerun preview.

Hoàn tất khi formatting-only change không stale toàn project và schema change chỉ stale đúng dependency.

### Giai đoạn 7 — LLM fallback có kiểm soát

- Bounded LLM fallback.
- Output có source pointer.
- Deterministic evaluator.
- Cost/context telemetry.

Hoàn tất khi LLM failure không phá deterministic path và fact không được confirmed nếu thiếu source/validation.

### Giai đoạn 8 — Full lifecycle regression

Kiểm thử hai luồng:

1. Create → Understand → Decide → Readiness → Compile → Approve → Execute → Verify → Deliver.
2. Source v2 → Impact → Scoped rerun → Reverify → Explicit redelivery.

## 2. Chiến lược kiểm thử

### Unit

- System 2 canonical importer.
- Markdown fallback với nhiều heading/table format.
- Constraints parser.
- CSV streaming parser và quoted field.
- Target candidate detection.
- Ghép data dictionary/constraints, so sánh với Bản hiểu trước và chia bảng lớn theo hàng.
- Kiểm tra câu trả lời cột mục tiêu chỉ nhận cột có thật và được áp dụng cho bước sau.
- Canonical diff và dependency closure.
- Artifact status transition.
- LLM output validator không dùng network.

### Store và database

- Same hash không tạo Source Version mới.
- Source Version ở `pending` trước promotion và chỉ thành `ready` sau khi kiểm tra blob.
- Khôi phục được trường hợp process dừng sau stage, sau pending và sau promotion.
- Không tự lấy quyền một operation `running`; takeover chỉ từ hành động người dùng.
- Báo cáo tiếp nhận bị từ chối vẫn được persist nhưng không tạo Source Version.
- New hash tạo Source Version và Impact Manifest.
- Knowledge Snapshot pin đúng Input Snapshot.
- Optimistic concurrency chặn stale write.
- Artifact version không overwrite.
- Candidate activation là atomic transaction.
- SQLite và PostgreSQL có cùng lifecycle semantics.

### Technical Workflow

- TW-02 canonical JSON happy path.
- TW-02 Markdown fallback.
- Decision/revision required.
- Dataset absent nhưng Understanding vẫn có report phù hợp.
- Readiness bị chặn bởi dataset hoặc Decision.
- Full execution và scoped reuse trả cùng output schema.
- Verification retry độc lập.
- Delivery chỉ chạy sau current passed verification.

### API

- Multipart size/type validation.
- Idempotency-Key.
- Cùng key trả cùng operation/version/report dù Project version đã tăng sau lần đầu.
- `expectedVersion` conflict.
- Source read model không lộ storage key; download trả ETag bằng content hash.
- Intake gate chặn TW-02 khi OP-00/OP-01 chưa hoàn tất và mở sau khi đủ điều kiện.
- OP-00 recovery và OP-01 retry kiểm tra đúng project/source scope.
- Artifact content authorization và safe content type.
- Candidate/current/stale read model.
- Operation SSE terminal state.
- Cả 10 activity đều có typed activity-resource read model.
- Resource presentation không chứa raw payload; content endpoint kiểm tra đúng project/resource.

### UI/E2E

1. Tạo project và upload blueprint/dataset; xem báo cáo OP-00 thân thiện.
2. Thử same-key, same-bytes, Source Version mới và file bị từ chối.
3. Xử lý OP-00 bị gián đoạn hoặc OP-01 lỗi tại cổng Intake.
4. Chủ động bấm “Tiếp tục Hiểu dự án” sau khi checklist đạt.
5. Xem TW-02 progress theo Workflow Node thật.
6. Preview Understanding report.
7. Resolve Decision.
8. Activate Knowledge Snapshot.
9. Compile và approve exact plan.
10. Execute, verify và deliver.
11. Upload blueprint/dataset v2 và xem diff.
12. Chạy scoped rerun.
13. Xác minh artifact cũ còn audit được nhưng được đánh dấu stale/superseded.
14. Mở resource trong Inline Resource Viewer mà URL, phase và activity hiện tại không đổi.
15. Xác minh raw JSON chỉ tải sau khi người dùng mở “Thông tin kỹ thuật”.

## 3. Definition of Done cho Understanding

- [x] Blueprint không phụ thuộc filename cố định.
- [x] Có System 2 contract có phiên bản và Markdown fallback.
- [x] Dataset target không hard-code.
- [x] Raw dataset không đi vào LLM, log hoặc report UI.
- [x] Input Snapshot pin source, hash, parser và policy version.
- [x] Knowledge fact và requirement có provenance.
- [x] Quality gate phân biệt passed, decision, revision và blocked.
- [x] Candidate snapshot không phá active snapshot khi run lỗi.
- [x] Source change tạo canonical diff và Impact Manifest.
- [x] Artifact cũ được giữ và đánh dấu stale/superseded khi quan hệ chứng minh bị ảnh hưởng.
- [x] UI hiển thị Tổng quan, Yêu cầu, Dữ liệu, Vấn đề, Thay đổi và báo cáo Chất lượng.
- [x] Artifact OP-01 có preview, version, source basis, compare và download.
- [x] Product UI OP-01 dùng typed read model.
- [x] Retry/idempotency không tạo duplicate source, snapshot, run, artifact hoặc provider cost.

## 4. Definition of Done cho vertical slice

- [x] Readiness Contract pin đúng Active Knowledge Snapshot.
- [ ] Compile Preview hiển thị exact plan, permission, resource và hash.
- [ ] Approval chỉ hợp lệ cho exact compilation basis.
- [ ] Source change sau Approval làm Approval stale.
- [ ] Full và scoped execution dùng cùng output contract.
- [ ] Verification độc lập trên immutable execution artifact.
- [ ] Evidence không tuyên bố full coverage nếu chưa chứng minh.
- [ ] Delivery là explicit action sau current passed Verification.
- [ ] Delivery Manifest chứa source, snapshot, workflow/plan hash, execution, verification và package checksum.
- [ ] SQLite test suite pass.
- [ ] PostgreSQL lifecycle matrix được kiểm tra trong môi trường có PostgreSQL.
- [ ] Web E2E chứng minh full lifecycle và Source v2 scoped rerun.
- [ ] `bun run validate` pass đầy đủ.

Không chạy `bun test` từ repo root; dùng `bun run test` hoặc `bun run validate`.

[← Reliability, security và LLM](05-reliability-security-and-llm.md) · [Mục lục kỹ thuật](README.md)
