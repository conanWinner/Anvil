# Spec: Ghim Workflow Bundle vào Approval Manifest

**Mã:** T02  
**Tác giả:** Codex / Sol  
**Ngày:** 07/09/2026  
**Trạng thái:** Approved — chủ sở hữu Anvil duyệt Phương án A ngày 07/09/2026  
**Người duyệt:** Chủ sở hữu Anvil  
**Liên quan:** [Báo cáo hiện trạng](08-product-readiness-audit.md), [Execution Brief](09-product-readiness-execution-brief.md)

## 1. Bối cảnh

OP-04 hiện tạo `Execution Plan` và `definitionHash`, OP-05 ghi `Approval Manifest`. Tuy nhiên, hash hiện tại chỉ bao phủ bản mô tả plan. `compiler.ts` vẫn chứa danh sách phase/node viết tay đã lệch với `templates.ts`: TW-02 khác số node, experiment thiếu node lưu artifact và Verify/Delivery vẫn được mô tả như một workflow gộp.

Khi TW-06, TW-07 hoặc TW-09 bắt đầu, API gọi builder hiện hành để dựng lại DAG. Vì vậy, một thay đổi trong template sau thời điểm phê duyệt có thể làm runtime chạy graph khác mà capability-registry hash vẫn hợp lệ. Snapshot composition của Anvil Workflow Runtime chỉ chứng minh graph đã chạy sau khi bắt đầu; nó chưa chứng minh graph đó chính là graph người dùng đã duyệt.

T02 phải làm cho quan hệ `Compilation → Approval → Workflow Run` có thể kiểm chứng bằng hash và version bất biến, đồng thời giữ lịch sử cũ. Đây là thay đổi additive về dữ liệu; không xóa hoặc tự sửa manifest cũ.

## 2. Functional Requirements

- **FR-1:** OP-04 MUST tạo một Workflow Bundle Snapshot bất biến cho mỗi Technical Workflow thuộc phạm vi phê duyệt: TW-06, TW-07 và TW-09.
- **FR-2:** Mỗi snapshot MUST chứa root definition, child definitions, dependencies, action executors, input/output mappings, output schemas, timeout, capability/schema versions, permissions và runtime profile cần để tái tạo graph.
- **FR-3:** Bundle hash MUST được tính từ biểu diễn canonical của toàn bộ nội dung ở FR-2 cùng schema/compiler version.
- **FR-4:** `plan.phases` MUST là projection dễ đọc được sinh từ canonical bundles; compiler MUST NOT duy trì một danh sách node viết tay độc lập.
- **FR-5:** Approval Manifest MUST ghim ID và hash của từng bundle TW-06/TW-07/TW-09 cùng Execution Plan đã duyệt.
- **FR-6:** Execute, Verify và Deliver MUST tải bundle qua đúng lineage `Approval → Compilation → Bundle Snapshot` và MUST kiểm hash trước khi tạo operation hoặc Workflow Run.
- **FR-7:** Runtime MUST chỉ thay thế các runtime binding slot có tên và kiểu đã khai báo trong snapshot. Giá trị nghiệp vụ đã biết ở lúc compile, gồm target, input basis, execution mode và artifact reuse policy, MUST được ghim trước Approval.
- **FR-8:** Runtime bindings thực tế MUST được lưu cùng execution/verification/delivery record để đối chiếu với composition manifest.
- **FR-9:** Bundle, plan hoặc manifest bị sửa sai hash MUST fail closed trước side effect và yêu cầu compile/approve mới.
- **FR-10:** Compilation/Approval schema cũ không có bundle bindings MUST giữ khả năng đọc lịch sử nhưng MUST NOT chạy bằng template hiện hành; API MUST trả lỗi `recompile_required` có hành động tiếp theo rõ ràng.
- **FR-11:** Thay executor, dependency, mapping, schema, timeout, capability version, permission hoặc runtime profile MUST làm bundle hash thay đổi.
- **FR-12:** Persist compilation và toàn bộ bundle snapshots MUST atomic: hoặc tất cả được lưu, hoặc không bản compilation mới nào có thể được approve.
- **FR-13:** TW-06, TW-07 và TW-09 MUST kiểm cùng invariant. Verify/Deliver MUST NOT tự dựng graph ngoài bundle đã duyệt.
- **FR-14:** Runtime composition manifest hash MUST đối chiếu được với hash trong Approval Manifest sau khi binding các slot được phép.

## 3. Non-Functional Requirements

- **NFR-R1 — Bất biến:** Bundle snapshot và Approval Manifest đã tạo MUST NOT được update hoặc overwrite. Thay đổi tạo compilation/approval mới.
- **NFR-R2 — Bảo toàn:** Migration MUST additive và MUST giữ nguyên mọi compilation, approval, run, artifact và history hiện có.
- **NFR-R3 — Determinism:** Hai lần compile cùng canonical input, compiler version và template version MUST tạo cùng bundle hash; ID/timestamp runtime không được nằm trong canonical hash.
- **NFR-R4 — Transaction:** Mất kết nối hoặc constraint failure trong lúc lưu snapshot MUST không để lại compilation có thể approve nhưng thiếu bundle.
- **NFR-S1 — Quyền:** Runtime binding MUST NOT thêm capability, permission, tool, credential hoặc executable node không có trong snapshot đã duyệt.
- **NFR-S2 — Dữ liệu:** Lỗi hash/schema MUST trả thông báo phân loại, không trả raw manifest, đường dẫn lưu trữ hoặc secret.
- **NFR-C1 — Tương thích:** Existing success response fields của compile/approve/execute/verify/deliver MUST được giữ; field bundle mới chỉ được thêm theo hướng backward-compatible.
- **NFR-P1 — Hiệu năng:** N/A — task không đặt SLA mới. Bundle nhỏ và được hash trước khi bắt đầu operation; benchmark riêng chỉ cần nếu implementation làm thay đổi đáng kể latency hiện có.

## 4. Acceptance Criteria

### AC-1 — Một nguồn định nghĩa (FR-1, FR-2, FR-4)

Given cùng một execution mode và template version  
When OP-04 compile project  
Then node/dependency/executor/mapping/timeout/schema projection trong plan phải được sinh từ đúng bundle snapshot  
And không tồn tại phase-node catalog thứ hai trong compiler.

### AC-2 — Hash bao phủ thay đổi executable (FR-3, FR-11; NFR-R3)

Given một canonical bundle hợp lệ  
When từng thuộc tính executor, dependency, input mapping, output schema, timeout, capability version, permission hoặc runtime profile bị thay đổi độc lập  
Then bundle hash phải thay đổi  
And compile lặp lại không đổi nội dung phải cho cùng hash.

### AC-3 — Approval ghim ba activity (FR-5)

Given compilation v3 hợp lệ  
When người dùng approve  
Then manifest phải chứa đúng một binding cho TW-06, TW-07 và TW-09  
And mỗi binding tham chiếu snapshot ID/hash thuộc compilation đó.

### AC-4 — Template drift không đổi graph đã duyệt (FR-6, FR-9, FR-13)

Given project đã compile/approve bằng bundle A  
When template catalog hiện hành thay đổi thành B  
Then Execute/Verify/Deliver phải chạy A đã lưu nếu schema/runtime vẫn hỗ trợ  
Or trả `recompile_required` trước khi tạo operation/run  
And MUST NOT chạy B dưới approval của A.

### AC-5 — Tamper fail closed (FR-6, FR-9)

Given plan, bundle và Approval Manifest đã lưu  
When từng record bị tamper độc lập trong fixture DB  
Then request phải bị từ chối trước khi tạo execution/verification/delivery operation hoặc Workflow Run  
And history cũ vẫn còn nguyên.

### AC-6 — Runtime binding bị giới hạn (FR-7, FR-8; NFR-S1)

Given bundle khai báo một tập slot có kiểu  
When runtime truyền thiếu slot, sai kiểu hoặc thêm slot làm thay đổi graph/quyền  
Then binding phải thất bại trước workflow start  
And không có permission/capability/node mới được thêm.

### AC-7 — Composition có thể đối chiếu (FR-8, FR-14)

Given một Workflow Run hoàn tất  
When đọc runtime composition manifest và runtime bindings  
Then hệ thống tính được hash/lineage khớp với bundle đã được Approval Manifest ghim.

### AC-8 — Legacy không chạy âm thầm (FR-10; NFR-R2, NFR-C1)

Given compilation hoặc approval v1/v2 không có bundle bindings  
When người dùng mở lịch sử  
Then dữ liệu vẫn đọc được  
When người dùng Execute/Verify/Deliver  
Then API trả conflict `recompile_required` cùng next action  
And không tự nâng cấp record cũ hoặc tạo operation/run.

### AC-9 — Atomic persistence (FR-12; NFR-R4)

Given fault injection tại từng bước lưu bundle  
When transaction thất bại  
Then không có compilation mới ở trạng thái có thể approve  
And retry an toàn không sinh snapshot trùng ngoài unique constraints đã khai báo.

### AC-10 — Ba execution mode (FR-1, FR-13)

Given mode `full`, `experiment` và `delivery`  
When compile rồi chạy lifecycle tương ứng  
Then bundle root/children, reuse path và lineage đúng mode đã approve  
And mọi mode đều qua cùng preflight hash.

## 5. Edge Cases và lỗi

- **EC-1:** Thiếu một trong TW-06/TW-07/TW-09 snapshot → compilation không thể approve; không tự dựng snapshot thiếu.
- **EC-2:** Snapshot ID tồn tại nhưng thuộc project/compilation khác → 409 conflict; không tạo operation.
- **EC-3:** Bundle schema/compiler version không còn được runtime hỗ trợ → `recompile_required`; giữ lịch sử.
- **EC-4:** DB lỗi giữa compilation và insert bundle thứ ba → rollback toàn transaction.
- **EC-5:** Hai request compile cùng idempotency key → một compilation/bộ snapshot; key giống payload khác → conflict theo idempotency contract.
- **EC-6:** Hai request execute đồng thời cùng approval → invariant bundle được kiểm trước cơ chế single-operation hiện có; không duplicate run.
- **EC-7:** Runtime composition artifact thiếu hoặc hỏng sau run → run/history không bị tự sửa trạng thái; Evidence báo không thể đối chiếu.
- **EC-8:** Binding chứa path, ID hoặc artifact lineage không thuộc project/attempt → fail closed trước workflow start.
- **EC-9:** Capability descriptor hiện hành khác snapshot → dùng policy tương thích đã ghim hoặc yêu cầu recompile; không silently broaden permission.
- **EC-10:** GET lịch sử với record legacy/tampered → trả trạng thái kiểm chứng/legacy thân thiện; không crash hoặc che giấu record.

## 6. API Contracts

Không thêm endpoint mới. Các route hiện có tiếp tục dùng OpenAPI wrapper:

```text
POST /api/system3/projects/{id}/compilations
POST /api/system3/projects/{id}/approval-manifests
POST /api/system3/projects/{id}/executions
POST /api/system3/projects/{id}/executions/{executionId}/verifications
POST /api/system3/projects/{id}/verifications/{verificationId}/deliveries
```

Các response hiện có giữ nguyên field. Response compilation/approval MAY thêm projection sau:

```typescript
interface System3ApprovedBundleBinding {
  activityId: 'TW-06' | 'TW-07' | 'TW-09';
  bundleSnapshotId: string;
  bundleHash: `sha256:${string}`;
  schemaVersion: 3;
}

interface RecompileRequiredError {
  error: string;
  message: string; // Không chứa raw manifest hoặc storage path
  code: 'recompile_required';
  nextAction: 'compile_and_approve';
}
```

Lỗi preflight legacy/tamper/cross-project trả HTTP 409 trước khi tạo operation. Malformed request tiếp tục 400; project/resource không tồn tại tiếp tục 404. Không đổi auth boundary hoặc Idempotency-Key contract trong T02.

## 7. Data Models

### Workflow Bundle Snapshot

| Field | Type | Constraints |
| --- | --- | --- |
| `id` | UUID | PK, immutable |
| `project_id` | UUID | Not null, FK project |
| `compilation_id` | UUID | Not null, FK compilation |
| `activity_id` | enum text | TW-06, TW-07 hoặc TW-09 |
| `schema_version` | integer | `3` cho spec này |
| `compiler_version` | text | Not null, version có hỗ trợ runtime |
| `template_id` | text | Not null |
| `execution_mode` | text | `full`, `experiment` hoặc `delivery` khi áp dụng |
| `definition` | JSON/text | Canonical executable bundle + typed slot declarations |
| `definition_hash` | sha256 text | Not null; kiểm lại khi đọc |
| `created_at` | timestamp | UTC, immutable |

Unique `(compilation_id, activity_id)`. Index theo `project_id`, `compilation_id`. Không hard-delete trong T02.

### Approval Manifest v3 additions

| Field | Type | Constraints |
| --- | --- | --- |
| `workflowBundleBindings` | array | Đúng ba item TW-06/TW-07/TW-09, unique activity |
| `workflowBundleBindings[].bundleSnapshotId` | UUID | Thuộc cùng compilation/project |
| `workflowBundleBindings[].bundleHash` | sha256 text | Khớp snapshot khi approve và khi chạy |

### Runtime record additions

Execution, Verification và Delivery lưu `bundle_snapshot_id`, `bundle_hash` và `runtime_bindings` bằng nullable/additive fields hoặc immutable JSON metadata có schema. Record mới MUST có đủ; record legacy MAY null và được đánh dấu legacy. Không đổi/xóa cột hiện có.

## 8. Out of Scope

- **OS-1:** Sửa cách chọn/ghim dataset Source Version — thuộc T03.
- **OS-2:** Hoàn thiện readiness/data gates — thuộc T04.
- **OS-3:** Thiết kế lại idempotency toàn lifecycle — thuộc T05; T02 chỉ giữ invariant trước khi tạo operation.
- **OS-4:** Thay majority baseline bằng model thực — thuộc T10/T11.
- **OS-5:** Thay đổi UI ngoài projection/next action bắt buộc để giải thích `recompile_required` — UX tổng thể thuộc T14.
- **OS-6:** Tự migrate approval v1/v2 thành v3, xóa record cũ hoặc tự re-approve.
- **OS-7:** Đổi auth, quyền người dùng, provider policy hoặc generic Anvil Workflow Runtime architecture.
- **OS-8:** Tự commit, push, mở PR hoặc deploy.

## 9. Lựa chọn cần phê duyệt

**Phương án A — lưu immutable bundle snapshot và bắt legacy recompile (đề xuất):** rõ provenance, fail closed, migration additive; các approval cũ không thể chạy tiếp nếu chưa compile/approve lại.

**Phương án B — chỉ lưu bundle hash và dựng lại từ template catalog theo version:** ít dữ liệu hơn nhưng phải bảo đảm catalog cũ tồn tại vĩnh viễn; hiện repository chưa có cơ chế đó và dễ lặp lại drift.

Đã chọn **Phương án A**. Triển khai theo thứ tự: schema/test contract → migration/persistence → compiler projection → approval binding → Execute/Verify/Deliver preflight/runtime binding → integration/legacy/tamper tests → full validate.

[← Execution Brief](09-product-readiness-execution-brief.md) · [Mục lục kỹ thuật](README.md)
