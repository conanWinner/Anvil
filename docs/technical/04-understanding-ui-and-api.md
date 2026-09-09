# 04 — Màn hình Hiểu dự án và API

Tài liệu này mô tả UI cần hiển thị gì trong phase Understanding và backend cần chuẩn bị dữ liệu nào.

## 1. Nguyên tắc UI

- Báo cáo dễ đọc là nội dung chính.
- JSON, hash, ID và log nằm trong phần Chi tiết kỹ thuật.
- Progress phải đến từ event thật của Workflow Node.
- Decision, data required và revision required không hiển thị thành lỗi chung.
- Decision có dữ liệu ràng buộc riêng. Ví dụ cột mục tiêu chỉ được chọn từ danh sách cột của Dataset Profile; câu trả lời được kiểm tra ở backend trước khi dùng cho Readiness, Compile và Execute.
- Tài nguyên phải mở được ngay trong hoạt động hiện tại; lịch sử và dữ liệu kỹ thuật được thu gọn.

## 2. Bố cục đã triển khai

```text
┌───────────────────────────────────────────────────────────────┐
│ Hiểu dự án · trạng thái và việc cần làm                      │
├───────────────────────────────────────────────────────────────┤
│ Bản đang hoạt động │ Đầu vào bản nháp │ Chất lượng trích xuất │
│ Lý do chưa thể kích hoạt · Quyết định cần xác nhận           │
│                                      [Kích hoạt Bản hiểu]     │
├──────────────────┬──────────────────┬─────────────────────────┤
│ Đầu vào đã dùng  │ Kết quả đã tạo   │ Bằng chứng              │
├──────────────────┴──────────────────┴─────────────────────────┤
│ Lịch sử · Nút kỹ thuật · Dữ liệu kỹ thuật (thu gọn)           │
└───────────────────────────────────────────────────────────────┘
```

## 3. Các khu vực nội dung

Không tạo thêm một hàng thẻ điều hướng lồng bên trong màn hình Vòng đời dự án. Ba khu vực Đầu vào,
Kết quả và Bằng chứng luôn xuất hiện cùng nhau. Các báo cáo sau được mở tại chỗ bằng bộ xem tài
nguyên:

| Báo cáo | Nội dung |
|---|---|
| Tổng quan | Mục tiêu, loại project, target, runtime và deliverable |
| Yêu cầu | FR/NFR/DSR, source pointer, acceptance và status |
| Dataset | Declaration, trạng thái liên kết, Profile, mismatch và drift |
| Vấn đề & câu hỏi | Blocker, warning và Decision cần trả lời |
| Thay đổi | Source diff, impact và rerun scope |
| Chất lượng | Độ bao phủ, phần chưa hỗ trợ, phần chưa phân loại và lý do |

Lịch sử, các nút kỹ thuật, dữ liệu gốc và nhật ký chỉ mở khi người dùng cần kiểm tra sâu.

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
  projectVersion: number;
  activeSnapshot: KnowledgeSnapshotSummary | null;
  candidateSnapshot: KnowledgeSnapshotSummary | null;
  inputSnapshot: UnderstandingInputSnapshot | null;
  decisions: DecisionSummary[];
  canActivate: boolean;
  blockingReasons: string[];
}
```

Bản hiểu gốc là bất biến. Khi một Decision có tác động tới dữ liệu, backend tạo một góc nhìn đã áp dụng câu trả lời cho Readiness, Execution Plan và lần thực thi; bản gốc cùng vị trí nguồn vẫn được giữ để kiểm tra lại.

Đầu vào, kết quả, bằng chứng, lịch sử và tài nguyên kỹ thuật được lấy từ giao diện lập trình tài nguyên
của hoạt động. Cách tách này giữ phần trạng thái nghiệp vụ nhỏ, đồng thời dùng chung bộ xem tài nguyên
cho cả 10 hoạt động.

## 7. API tối thiểu

```http
GET  /api/system3/projects/:id/flow
GET  /api/system3/projects/:id/phases/understanding/view

POST /api/system3/projects/:id/sources
POST /api/system3/projects/:id/knowledge-snapshots
GET  /api/system3/projects/:id/knowledge-snapshots
GET  /api/system3/projects/:id/knowledge-snapshots/:snapshotId
POST /api/system3/projects/:id/knowledge-snapshots/:snapshotId/activate

GET  /api/system3/projects/:id/activities/TW-02
GET  /api/system3/projects/:id/resources/:resourceType/:resourceId
GET  /api/system3/projects/:id/resources/:resourceType/:resourceId/content
```

Mọi JSON route mới hoặc được sửa phải dùng `registerOpenApiRoute(createRoute(...), handler)`. Schema đặt trong `packages/server/src/routes/schemas/` và được tách theo domain khi file quá lớn.

## 8. Bộ báo cáo Understanding

### Trích dẫn Markdown tại chỗ

Phiên bản hiện tại ưu tiên nguồn Markdown theo phạm vi người dùng xác nhận; PDF không phải điều kiện
hoàn tất phiên bản này. Không xóa phần hỗ trợ PDF đã có.

Bản hiểu và báo cáo Understanding có nhóm **Nguồn của các yêu cầu**, mở bằng disclosure ngay trong
Inline Resource Viewer. Backend chọn đúng Source Version trong project, đối chiếu hash toàn file và
hash khối trích đã lưu trước khi gửi nội dung. Với bảng có đúng một hàng mang mã yêu cầu ở ô đầu,
preview thu hẹp tới hàng đó và hiển thị số dòng tương ứng; không tự đoán từ nội dung gần giống.

Giới hạn preview: 24 vị trí, 1.200 ký tự mỗi đoạn, nguồn tối đa 512 KiB. Phần bị giới hạn được ghi rõ.
Nguồn lịch sử thiếu vị trí, sai hash hoặc không hỗ trợ trả trạng thái thân thiện, không lấy bản mới nhất
để thay thế. UI hiển thị đoạn Markdown nguyên văn dưới dạng văn bản, không chạy HTML hay tải ảnh từ
nội dung trích. Escape đóng viewer và trả focus về báo cáo; URL và activity không đổi.

- `project-overview.md/json`
- `requirements-report.md/json`
- `dataset-understanding.md/json`
- `dataset-profile.md/json` khi có dataset thật
- `open-issues-and-decisions.md/json`
- `source-change-report.md/json`
- `extraction-quality-report.md/json`
- `understanding.json`

UI mở Markdown report trước. JSON phục vụ xử lý máy và gỡ lỗi.

[← Artifact và rerun](03-artifacts-and-scoped-rerun.md) · [Mục lục](README.md) · [Tiếp theo: Reliability, security và LLM →](05-reliability-security-and-llm.md)
