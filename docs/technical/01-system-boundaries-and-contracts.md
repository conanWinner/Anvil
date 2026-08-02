# 01 — Ranh giới hệ thống và contract nội bộ

Tài liệu này giải thích trách nhiệm của từng tầng và cách các tầng chuyển dữ liệu cho nhau.

## 1. Sơ đồ kiến trúc

```text
Product UI
    ↓
Backend API
    ↓
System 3 Control Plane
    ↓
Workflow Compiler
    ↓
Generic Anvil Workflow Runtime
    ↓
Storage / Artifact / Evidence
```

## 2. System 3 Control Plane sở hữu gì?

- Project Lifecycle và 6 Lifecycle Phase.
- Project, Source Version và Input Snapshot.
- Knowledge Snapshot, requirement, issue và Decision.
- Ý nghĩa nghiệp vụ của dataset và target.
- Product Workflow Template và Project Workflow Version.
- Readiness, Change Detection và Impact Manifest.
- Chính sách capability và permission.
- Evidence projection, delivery semantics và dữ liệu phục vụ UI.

## 3. Generic Anvil Workflow Runtime sở hữu gì?

- Thực thi DAG: chạy các bước theo quan hệ phụ thuộc.
- Technical Workflow, Workflow Run và Workflow Node.
- Action, AI, Bash và script node.
- Retry, timeout và tín hiệu hủy.
- Provider session.
- Run event, node event và log.
- Worktree/isolation.
- Thư mục artifact dùng chung.
- Primitive kỹ thuật dùng chung cho approval và loop.

Không đưa khái niệm Customer Churn, target column, SHAP, dataset readiness hoặc model experiment vào `packages/workflows`.

## 4. Quan hệ giữa các loại workflow

```text
Product Workflow Template
        +
Project sources, knowledge, decisions, runtime và capabilities
        ↓
Project Workflow Version
        ↓
Workflow Compilation
        ↓
Execution Plan
        ↓
Technical Workflow
        ↓
Workflow Run → Artifact → Evidence
```

Quy tắc:

1. Không gọi toàn bộ hành trình project là workflow; gọi là Project Lifecycle.
2. Workflow Compilation tạo Execution Plan, không “sinh ra workflow”.
3. Technical Workflow là định nghĩa tái sử dụng; Workflow Run là một lần chạy cụ thể.
4. Upload, Compile Preview, Approve và state transition là Control-plane Operation, trừ khi chúng thật sự gọi runtime.

## 5. Contract chuyển dữ liệu giữa các activity

Mỗi activity chỉ nhận đúng dữ liệu nó cần. Không truyền toàn bộ context hoặc raw source tùy ý.

```typescript
interface System3ExecutionHandoff<TPayload> {
  projectId: string;
  operationId: string;
  workflowRunId?: string;
  inputSnapshotId: string;
  upstreamArtifactIds: string[];
  expectedProjectVersion: number;
  definitionHash?: string;
  capabilityRegistryHash?: string;
  timeoutMs: number;
  payload: TPayload;
}
```

Quy tắc bắt buộc:

1. Backend tra lại mọi ID; không tin đường dẫn do client gửi.
2. Mọi thao tác ghi dùng optimistic concurrency để chặn ghi lên project đã đổi phiên bản.
3. Retry cùng Idempotency-Key không tạo Workflow Run hoặc chi phí provider mới.
4. Gói bàn giao chỉ chứa ID, hash và dữ liệu tổng hợp cần thiết.
5. Raw dataset không nằm trong event, prompt gỡ lỗi hoặc thông báo lỗi.
6. Output phải qua Zod validation trước khi lưu hoặc chuyển tiếp.

## 6. Bản đồ đổi tên trong code

| Tên/copy hiện tại | Tên chuẩn | Lưu ý |
|---|---|---|
| “workflow” dùng cho toàn bộ project | `Project Lifecycle` | Chỉ đổi copy sản phẩm; không đổi runtime workflow route |
| `phase` trên UI | `Lifecycle Phase` | Field kỹ thuật có thể giữ nếu context đã rõ |
| `Customer Churn Reference` / `templateId` | `Product Workflow Template` / `productWorkflowTemplateId` | Template chưa gắn riêng với project |
| `productWorkflowVersionId` | `projectWorkflowVersionId` | Cần migration tương thích cho DB và API |
| `workflowVersion` trên UI | `projectWorkflowVersion` | Không dùng template ID thay cho project version |
| `workflowSteps` trong Project Flow | `workflowNodes` hoặc `technicalWorkflowNodes` | Chỉ đổi nếu phần tử thật sự là DAG node |
| `system3-*` workflow identifier | Giữ nguyên | Đây là tên Technical Workflow hợp lệ |
| `WorkflowRun` / `workflowRunId` | Giữ nguyên | Đây là entity của generic runtime |

Việc đổi tên phải là task riêng. Không bulk replace từ `workflow`, vì nhiều occurrence đang dùng đúng nghĩa runtime.

[← Mục lục kỹ thuật](README.md) · [Tiếp theo: Input, output và versioning →](02-input-output-and-versioning.md)
