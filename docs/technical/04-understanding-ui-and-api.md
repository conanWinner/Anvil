# 04 — Màn hình Hiểu dự án và API

Tài liệu này mô tả UI cần hiển thị gì trong phase Understanding và backend cần chuẩn bị dữ liệu nào.

## 1. Nguyên tắc UI

- Báo cáo dễ đọc là nội dung chính.
- JSON, hash, ID và log nằm trong phần Chi tiết kỹ thuật.
- Progress phải đến từ event thật của Workflow Node.
- Decision, data required và revision required không hiển thị thành lỗi chung.
- Artifact phải có preview, compare, download và version history.

## 2. Bố cục đề xuất

```text
┌───────────────────────────────────────────────────────────────┐
│ Hiểu dự án · Bản hiểu v2 · Đang sử dụng                     │
│ Nguồn 3/3 · Đã đọc 87% · Còn 2 câu hỏi                      │
├──────────────────┬──────────────────────────────┬─────────────┤
│ Tổng quan        │ Xem báo cáo                  │ Việc tiếp   │
│ Yêu cầu          │                              │ theo        │
│ Dataset          │ Báo cáo dễ đọc               │ Xem đổi gì  │
│ Vấn đề           │ Nguồn và phiên bản           │ Trả lời     │
│ Thay đổi         │                              │ Chấp nhận   │
│ Kết quả          │ Mở chi tiết kỹ thuật khi cần │             │
└──────────────────┴──────────────────────────────┴─────────────┘
```

## 3. Các tab

| Tab | Nội dung |
|---|---|
| Tổng quan | Mục tiêu, loại project, target, runtime và deliverable |
| Yêu cầu | FR/NFR/DSR, source pointer, acceptance và status |
| Dataset | Declaration, trạng thái liên kết, Profile, mismatch và drift |
| Vấn đề & câu hỏi | Blocker, warning và Decision cần trả lời |
| Thay đổi | Source diff, impact và rerun scope |
| Kết quả | Preview, download, compare và version history |
| Kỹ thuật | Workflow Run, Node, input/output, event, log và retry |

## 4. Thẻ artifact

Mỗi thẻ hiển thị:

- Tên thân thiện.
- Status hiện tại.
- Source Version basis.
- Parser/capability version.
- Thời điểm tạo.
- Preview.
- `So sánh với bản trước`.
- `Tải xuống`.
- Phần mở rộng chứa metadata kỹ thuật.

## 5. Progress theo event thật

```text
✓ Khóa phiên bản đầu vào
✓ Đọc blueprint
● Kiểm tra dataset
○ Ghép thành bản hiểu dự án
○ Kiểm tra chất lượng
○ Tạo báo cáo
```

UI không được suy đoán mọi node đã hoàn thành chỉ từ trạng thái phase.

## 6. Read model cho UI

UI không tự ghép raw artifact và run data từ nhiều API. Backend trả một read model đúng kiểu:

```typescript
interface UnderstandingView {
  projectId: string;
  activeSnapshot: KnowledgeSnapshotSummary | null;
  candidateSnapshot: KnowledgeSnapshotSummary | null;
  inputSnapshot: UnderstandingInputSnapshot | null;
  sourceVersions: SourceVersionSummary[];
  latestChange: SourceChangeSummary | null;
  qualityGate: UnderstandingQualityGate | null;
  decisions: DecisionSummary[];
  artifacts: System3ArtifactDescriptor[];
  latestRun: WorkflowRunSummary | null;
  actions: ProductAction[];
}
```

Read model phải cho UI biết người dùng có thể làm gì tiếp theo, ví dụ trả lời Decision, thay nguồn, chấp nhận snapshot hoặc chạy lại.

## 7. API tối thiểu

```http
GET  /api/system3/projects/:id/flow
GET  /api/system3/projects/:id/phases/understanding/view

POST /api/system3/projects/:id/sources
POST /api/system3/projects/:id/source-changes/:sourceVersionId/analyze

POST /api/system3/projects/:id/knowledge-snapshots
GET  /api/system3/projects/:id/knowledge-snapshots
GET  /api/system3/projects/:id/knowledge-snapshots/:snapshotId
POST /api/system3/projects/:id/knowledge-snapshots/:snapshotId/activate

GET  /api/system3/projects/:id/artifacts?phase=understanding
GET  /api/system3/projects/:id/artifacts/:artifactId
GET  /api/system3/projects/:id/artifacts/:artifactId/content
GET  /api/system3/projects/:id/artifacts/:artifactId/compare/:otherArtifactId
```

Mọi JSON route mới hoặc được sửa phải dùng `registerOpenApiRoute(createRoute(...), handler)`. Schema đặt trong `packages/server/src/routes/schemas/` và được tách theo domain khi file quá lớn.

## 8. Bộ báo cáo Understanding

- `project-overview.md/json`
- `requirements-report.md/json`
- `dataset-understanding.md/json`
- `dataset-profile.md/json` khi có dataset thật
- `open-issues-and-decisions.md/json`
- `source-change-report.md/json`
- `extraction-quality-report.md/json`
- `entity-index.json`
- `traceability-map.json`
- `understanding.json`

UI mở Markdown report trước. JSON phục vụ xử lý máy và gỡ lỗi.

[← Artifact và rerun](03-artifacts-and-scoped-rerun.md) · [Mục lục](README.md) · [Tiếp theo: Reliability, security và LLM →](05-reliability-security-and-llm.md)
