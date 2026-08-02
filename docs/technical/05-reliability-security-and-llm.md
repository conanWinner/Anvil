# 05 — Độ tin cậy, bảo mật, theo dõi và LLM

Tài liệu này gom các quy tắc dùng chung để hệ thống xử lý lỗi an toàn, không làm mất lịch sử và không gửi dữ liệu nhạy cảm sai chỗ.

## 1. Các trạng thái không thành công

| Loại | Ví dụ | Hành vi sản phẩm |
|---|---|---|
| Input rejected | Sai MIME hoặc file quá lớn | Không tạo Source Version |
| Revision required | Markdown không đủ cấu trúc | Giữ source và chỉ rõ phần cần sửa |
| Decision required | Target chưa rõ | Tạm dừng tiến trình nghiệp vụ, không báo runtime failure chung |
| Data required | Thiếu dataset cho activity cần dữ liệu thật | Readiness bị chặn và UI hướng dẫn liên kết dataset |
| Capability unsupported | Thiếu parser, model hoặc runtime | Compile dừng an toàn và nêu lý do |
| Execution failed | Test hoặc process lỗi | Giữ artifact/log và cho rerun đúng scope |
| Verification failed | Evidence không đạt | Không cho Delivery |
| Ownership unknown | Process khác có thể còn chạy | Không tự đánh dấu failed hoặc abandoned |

## 2. Retry và khôi phục

- Source persistence phải content-addressed và idempotent.
- OP-00 phải ghi `staged → pending → ready`; project chỉ đổi sau khi blob chính thức đã được kiểm tra.
- Lần thử lại OP-00 dùng cùng operation progress đã ghim; không resolve lại “latest file”.
- Báo cáo tiếp nhận, kể cả lần bị từ chối, là artifact bất biến có thể đọc lại trên UI.
- Deterministic parser chỉ retry theo policy và không tạo snapshot trùng.
- LLM fallback có retry, token budget và schema validation giới hạn.
- Execution subprocess có timeout và explicit failure.
- Verification retry độc lập trên immutable artifact.
- Delivery retry cùng Idempotency-Key trả cùng kết quả.

Nếu ownership của OP-00 không rõ, UI hiển thị cảnh báo và yêu cầu thao tác chủ động. Chỉ khi người
dùng xác nhận thì backend mới nhận lại quyền xử lý operation. Nếu bytes chưa kịp vào vùng staged,
hệ thống hướng dẫn chọn lại file thay vì giả vờ có thể khôi phục.

Nếu Understanding lỗi sau khi đã tạo Dataset Profile:

- Dataset Profile có thể được lưu dưới status `draft` hoặc `failed-run-output`.
- Active Knowledge Snapshot cũ không bị thay thế.
- UI hiển thị đúng node lỗi và diagnostics.
- Retry có thể dùng intermediate artifact nếu input hash và parser version còn khớp.

## 3. Chính sách dùng LLM

LLM không phải đường đọc mặc định. Chỉ dùng khi:

- Markdown không có canonical System 2 contract.
- Structural parser không hiểu một phần quan trọng.
- Cần phân loại text thành candidate fact hoặc issue.

Input cho LLM:

- Chỉ section cần xử lý.
- Instruction ổn định và có phiên bản.
- Output schema bắt buộc.
- Context và token budget giới hạn.
- Không có raw dataset row, secret hoặc nội dung project không liên quan.

Output:

```typescript
interface SemanticExtractionCandidate {
  value: unknown;
  sourcePointer: string;
  confidence: number;
  status: 'declared_unverified' | 'assumption' | 'missing';
  explanation: string;
}
```

Validation:

1. Zod parse thành công.
2. Source pointer tồn tại.
3. Không tạo Requirement ID không có trong nguồn.
4. Không tự trả lời Manual Review.
5. Confidence thấp tạo issue, không publish fact confirmed.
6. Prompt/response debug được redacted và có retention policy.

## 4. An toàn dữ liệu

1. Raw source lưu read-only và content-addressed.
2. Filename được sanitize; storage key không nhận trực tiếp từ client.
3. Dataset row không xuất hiện trong log, SSE hoặc LLM prompt.
4. Preview API giới hạn content type và size.
5. Artifact download resolve qua server-side descriptor.
6. Capability khai báo permission trước Compile.
7. Approval không tự mở rộng permission.
8. Archive extraction chặn absolute path, `..`, symlink và archive bomb.
9. Source Version đã tham gia Delivery không bị xóa âm thầm.
10. Error response không lộ filesystem path, secret hoặc raw row.

## 5. Theo dõi hệ thống

Mỗi Control-plane Operation hoặc Technical Workflow ghi lại:

- `operationId`.
- `workflowRunId` nếu runtime được gọi.
- Project, Source và Input Snapshot ID.
- Node start/completed/failed event.
- Duration và timeout.
- Parser/capability version.
- Input/output schema ID.
- Artifact ID và hash.
- LLM model, token và cost nếu có fallback.
- Retry history.

Technical Console hiển thị dữ liệu theo dõi chi tiết. Product UI chỉ hiển thị thông tin giúp người dùng hiểu trạng thái và hành động tiếp theo.

[← UI và API](04-understanding-ui-and-api.md) · [Mục lục](README.md) · [Tiếp theo: Triển khai và kiểm thử →](06-implementation-and-testing.md)
