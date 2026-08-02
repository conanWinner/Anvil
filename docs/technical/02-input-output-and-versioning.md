# 02 — Input, output và quản lý phiên bản

Tài liệu này mô tả contract đầu vào, đầu ra và cách System 3 khóa đúng phiên bản đã sử dụng.

## 1. Project Intake Package

Đầu vào bên ngoài không chỉ là một file Markdown. Một gói đầu vào có thể gồm:

```text
Project identity
+ System 2 blueprint/export hoặc user brief
+ Dataset nếu có
+ Constraints
+ Data dictionary / supporting documents
+ Existing codebase nếu có
```

Mỗi nguồn được lưu riêng để giữ author, thời điểm và provenance. Không nối user brief vào blueprint rồi coi là cùng một source.

## 2. Ba cách bắt đầu project trong thiết kế hoàn chỉnh

### System 2 import

Bắt buộc có tên project và ít nhất một blueprint/export từ System 2. Dataset, constraints và user brief bổ sung là tùy chọn.

### Existing project

Bắt buộc có codebase và user brief mô tả mục tiêu. Tài liệu kiến trúc, requirement, dataset và constraints là tùy chọn.

### Brief only

Bắt buộc có tên project và user brief. Hệ thống chỉ tạo candidate blueprint; người dùng phải review trước khi nó trở thành nguồn chính.

## 3. Contract chấp nhận đầu vào

```typescript
interface ProjectIntakeInput {
  project: {
    name: string;
    description?: string;
    entryMode: 'system2_import' | 'existing_project' | 'brief_only';
    createManagedCodebase: boolean;
    existingCodebaseId?: string;
  };
  primaryIntent: {
    system2ExportSourceIds?: string[];
    userBriefSourceId?: string;
  };
  optionalSources: {
    datasetSourceIds: string[];
    constraintsSourceIds: string[];
    dataDictionarySourceIds: string[];
    supportingDocumentSourceIds: string[];
  };
}
```

Validation:

1. `system2_import` cần System 2 blueprint/export.
2. `existing_project` cần codebase và user brief.
3. `brief_only` cần user brief và chưa được đi thẳng tới execution.
4. Dataset có thể thiếu ở Understanding; Readiness trả `data_required` trước activity cần dữ liệu thật.
5. Constraints thiếu thì dùng default policy có phiên bản, không dùng default ẩn.
6. User supplemental input được lưu thành source riêng.

## 4. MVP hiện tại nhận gì?

| Đầu vào | Bắt buộc | Trạng thái hiện tại |
|---|---:|---|
| Project name | Có | UI nhận trực tiếp |
| Description | Không | Chưa phải canonical source đầy đủ |
| Product Workflow Template | Có | Hiện cố định `Customer Churn Reference` |
| Blueprint `.md`, `.json` hoặc `.pdf` | Có trong luồng tạo project hiện tại | OP-00 tiếp nhận; parser TW-02 hiện hoàn chỉnh nhất cho Markdown |
| Dataset `.csv` | Không ở Understanding | Cần trước baseline execution |
| Constraints, data dictionary, user brief, supporting document | Không | OP-00 lưu riêng theo nguồn logic và phiên bản bất biến |
| Runtime profile | Có | CPU, 8 GB RAM, POC |
| Managed codebase | Có | Tạo tự động khi không liên kết codebase có sẵn |

MVP chưa hỗ trợ đầy đủ folder System 2 export, brief-only flow hoặc chọn Product Workflow Template tự do.

## 5. Blueprint từ System 2

Định dạng ưu tiên:

```text
system2-export/
├── manifest.json
├── blueprint.json
├── blueprint.md
└── source-map.json
```

- `manifest.json`: schema version, producer version, file hash và thời điểm tạo.
- `blueprint.json`: contract dành cho máy đọc.
- `blueprint.md`: báo cáo dành cho người đọc.
- `source-map.json`: ánh xạ entity về vị trí nguồn.

Fallback có thể hỗ trợ một hoặc nhiều file Markdown. Tên `DESIGN_B_2.md` không phải contract bắt buộc.

Xem [blueprint ví dụ từ System 2](../system_2/DESIGN_B_2.md).

## 6. Dataset

System 3 tách hai loại thông tin:

| Khái niệm | Nguồn | Điều được phép khẳng định |
|---|---|---|
| Dataset Declaration | Blueprint, data dictionary hoặc docs System 2 | Entity, target, cột dự kiến, quy tắc thời gian và constraints |
| Dataset Profile | Dataset thật đã được đọc | Số dòng/cột, schema, target, missingness, duplicate và distribution |

Nếu chưa liên kết dataset, TW-02 vẫn tạo Dataset Declaration và trạng thái `not_linked`. Hệ thống không được suy diễn thống kê dữ liệu thật từ tài liệu mô tả.

## 7. Input Snapshot và version bất biến

Input Snapshot là bản ghi khóa:

- Source Version ID.
- Content hash của từng nguồn.
- Parser version.
- Extraction policy version.
- Runtime/capability snapshot khi activity yêu cầu.

Activity phải đọc theo Input Snapshot, không đọc “latest file” trong lúc đang chạy. Source Version cũ không bị ghi đè khi có phiên bản mới.

### 7.1 Trạng thái lưu của OP-00

Việc tạo Source Version dùng protocol hai chặng:

```text
bytes tạm đã kiểm tra
→ Source Version pending
→ promote blob content-addressed
→ kiểm tra blob chính thức
→ Source Version ready
→ cập nhật Project version
```

Source Registry công khai chỉ trả phiên bản `ready`. Operation progress giữ con trỏ tạm, con trỏ
chính thức, hash và dung lượng để một hành động retry rõ ràng của người dùng có thể tiếp tục đúng
bytes. Một operation `running` nhưng không rõ process sở hữu không bị timer tự đổi thành `failed`.

Mọi bytes thuộc project nằm dưới `~/.anvil/workspaces/<owner>/<project>/artifacts`, tách khỏi Git repo
ở thư mục `source/`. Source Version chính thức dùng khóa
`sources/<kind>/<source-id>/v<lineage-version>_<full-hash>/<filename>`. Filename đã sanitize chỉ giúp
người dùng nhận diện file; content hash vẫn là định danh nội dung và được kiểm tra lại sau khi ghi.
Public API không trả storage key này.

Technical Workflow Run của cùng project dùng `artifacts/runs/<workflow-run-id>`. Không tạo thêm kho
`~/.anvil/system3/projects`; một workspace là đơn vị lưu trữ và backup hoàn chỉnh của project.

## 8. Input phát sinh trong lifecycle

| Input mới | Activity sử dụng |
|---|---|
| Decision answer | Readiness và các activity sau đó |
| Source Version mới | Change Detection và Understanding rerun |
| Plan customization | Compile Preview mới |
| Approval action | Approval Manifest |
| Manual rerun scope | Execute hoặc Verify |
| Delivery Request | Deliver |

Mọi input phát sinh phải gắn actor, thời điểm và version/snapshot liên quan.

## 9. Đầu ra toàn hệ thống

```text
Source Versions
    ↓
Input Snapshot
    ↓
Knowledge Snapshot + Understanding Reports
    ↓
Decision Log + Readiness Contract
    ↓
Project Workflow Version + Execution Plan
    ↓
Approval Manifest
    ↓
Execution Artifact
    ↓
Verification Evidence
    ↓
Delivery Package + Delivery Manifest
```

| Output | Ý nghĩa |
|---|---|
| `SourceVersion[]` | Các phiên bản nguồn không bị ghi đè |
| `UnderstandingInputSnapshot` | Nguồn và bộ đọc chính xác đã dùng |
| `KnowledgeSnapshot` | Bản hiểu project tại một thời điểm |
| `Decision[]` | Câu hỏi bắt buộc người dùng xác nhận |
| `ReadinessContract` | Điều kiện đã được kiểm tra và khóa |
| `ProjectWorkflowVersion` | Phiên bản quy trình áp dụng riêng cho project |
| `ExecutionPlanSnapshot` | Kế hoạch kỹ thuật chính xác sẽ chạy |
| `ApprovalManifest` | Kế hoạch, input và permission đã được duyệt |
| `ExecutionArtifact` | Project và kết quả test/data/experiment |
| `EvidenceMap` | Requirement nối với bằng chứng |
| `VerificationGate` | Kết luận xác minh đạt hoặc không đạt |
| `DeliveryPackage` | Gói bàn giao bất biến |
| `DeliveryManifest` | Bản kê nguồn, plan, execution, verification và limitation |

[← Ranh giới hệ thống](01-system-boundaries-and-contracts.md) · [Mục lục](README.md) · [Tiếp theo: Artifact và chạy lại →](03-artifacts-and-scoped-rerun.md)
