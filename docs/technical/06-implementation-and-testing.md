# 06 — Kế hoạch triển khai và kiểm thử

Tài liệu này đưa ra thứ tự triển khai, chiến lược kiểm thử và Definition of Done cho System 3 vertical slice.

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
nội dung cũ–mới, kết quả cần cập nhật và kết quả được giữ lại. System 2 canonical contract đầy đủ và
dataset profiler streaming vẫn là các hạng mục tiếp theo.

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

- [ ] Blueprint không phụ thuộc filename cố định.
- [ ] Có System 2 contract có phiên bản và Markdown fallback.
- [ ] Dataset target không hard-code.
- [ ] Raw dataset không đi vào LLM, log hoặc report UI.
- [ ] Input Snapshot pin source, hash, parser và policy version.
- [ ] Knowledge fact và requirement có provenance.
- [ ] Quality gate phân biệt passed, decision, revision và blocked.
- [ ] Candidate snapshot không phá active snapshot khi run lỗi.
- [x] Source change tạo canonical diff và Impact Manifest.
- [x] Artifact cũ được giữ và đánh dấu stale/superseded khi quan hệ chứng minh bị ảnh hưởng.
- [ ] UI hiển thị Overview, Requirements, Dataset, Issues, Changes và Quality report.
- [x] Artifact OP-01 có preview, version, source basis, compare và download.
- [x] Product UI OP-01 dùng typed read model.
- [ ] Retry/idempotency không tạo duplicate source, snapshot, run, artifact hoặc provider cost.

## 4. Definition of Done cho vertical slice

- [ ] Readiness Contract pin đúng Active Knowledge Snapshot.
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
