# 03 — Artifact, thay đổi nguồn và chạy lại có phạm vi

Tài liệu này mô tả cách giữ lịch sử kết quả, đánh dấu kết quả cũ và chỉ chạy lại phần thật sự bị ảnh hưởng.

## 1. Nguyên tắc

- Artifact cũ không bị ghi đè hoặc xóa khi có phiên bản mới.
- Khi nguồn liên quan thay đổi, artifact được đánh dấu `stale — cần cập nhật`.
- Hệ thống phải giải thích vì sao artifact bị stale.
- Artifact chỉ được tái sử dụng khi mọi dependency và hash liên quan còn khớp.
- Nếu không chứng minh được độ an toàn, hệ thống đề xuất chạy lại phạm vi rộng hơn.

## 2. Change Detection và Impact Manifest

Sau khi có Source Version mới, OP-01 so sánh với phiên bản trước và tạo Impact Manifest.

Impact Manifest cần chứa:

- Entity hoặc requirement đã đổi.
- Artifact bị ảnh hưởng.
- Lifecycle Phase bị ảnh hưởng.
- Artifact vẫn dùng lại được.
- Phạm vi chạy lại được đề xuất.
- Lý do của từng kết luận.

Ví dụ:

| Thay đổi | Cần cập nhật | Có thể giữ lại |
|---|---|---|
| Chỉ sửa định dạng Markdown | Source diff report | Knowledge và execution nếu canonical content không đổi |
| Sửa requirement | Knowledge, readiness, plan và evidence liên quan | Source không liên quan |
| Dataset thêm dòng, không đổi schema/target | Dataset Profile, experiment và verification | Blueprint requirements |
| Dataset đổi target | Understanding, readiness, plan, experiment và verification | Raw blueprint |
| Chỉ đổi delivery constraint | Delivery plan/package | Build artifact đã verify nếu policy cho phép |

## 3. Contract chạy lại có phạm vi

```typescript
interface ScopedRerunInput {
  projectId: string;
  impactManifestIds: string[];
  approvedCompilationId: string;
  reusableArtifactIds: string[];
}
```

Compile phải gộp tất cả Impact Manifest đang chờ theo thứ tự Lifecycle Activity chuẩn. Không được chỉ
lấy manifest mới nhất rồi bỏ sót ảnh hưởng từ những Source Version khác.

Artifact chỉ được dùng lại khi:

1. Content hash khớp.
2. Source dependency version khớp.
3. Knowledge và Decision dependency không stale.
4. Validator version còn được policy cho phép.
5. Capability version khớp.
6. Artifact type hỗ trợ scoped reuse.

Nếu một điều kiện không đạt, hệ thống loại artifact khỏi danh sách tái sử dụng hoặc đề xuất full rerun.

## 4. Kết quả của rerun preview

- Phạm vi sẽ chạy lại.
- Artifact được tái sử dụng.
- Artifact mới sẽ được tạo.
- Execution, Verification hoặc Delivery version mới.
- Provenance edge từ kết quả mới về artifact cũ được dùng lại.

Người dùng phải xem preview trước khi phê duyệt kế hoạch chạy lại.

## 5. Artifact descriptor

```typescript
interface System3ArtifactDescriptor {
  id: string;
  projectId: string;
  phaseId: string;
  artifactKind: string;
  displayName: string;
  mediaType: string;
  schemaId: string | null;
  version: number;
  contentHash: string;
  sizeBytes: number;
  status: 'draft' | 'current' | 'stale' | 'superseded' | 'failed';
  sourceVersionIds: string[];
  inputSnapshotId: string;
  workflowRunId: string | null;
  producerVersion: string;
  previewKind: 'markdown' | 'table' | 'json' | 'download';
  createdAt: string;
}
```

Quy tắc:

1. Không suy ra ý nghĩa sản phẩm chỉ từ filename.
2. Status nằm trong metadata và read model.
3. Download resolve theo Artifact ID, không nhận storage path tùy ý từ client.
4. Markdown/table report là giao diện chính; JSON kỹ thuật nằm trong phần mở rộng.
5. Mọi artifact truy ngược được về source, Input Snapshot, Workflow Run và producer version.

## 6. UI cần hiển thị gì?

- Trạng thái: Bản nháp, Đang dùng, Cần cập nhật, Đã được thay thế hoặc Lỗi.
- Phiên bản nguồn đã dùng.
- Thời điểm và producer version.
- Lý do stale.
- Preview, compare previous và download.
- Artifact nào sẽ được giữ hoặc tạo lại trước một rerun.

[← Input, output và versioning](02-input-output-and-versioning.md) · [Mục lục](README.md) · [Tiếp theo: UI và API →](04-understanding-ui-and-api.md)
