# Anvil — Báo cáo khả năng vận hành thực tế

> **Audit lịch sử:** kết luận bên dưới chỉ áp dụng cho checkout ngày 07/09/2026. Hiện trạng và bằng chứng mới hơn nằm ở [kế hoạch 11](11-simplification-and-core-flow-plan.md).

Ngày kiểm tra: **07/09/2026**. Phạm vi sâu: System 3; phạm vi nền tảng Anvil: cấu trúc, tích hợp và bộ test monorepo. Đây là **bằng chứng của checkout được kiểm tra**, không phải chứng nhận production hay kết luận rằng mọi adapter/provider đã được chạy thật.

## 1. Kết luận

**Anvil đã có một lát cắt System 3 chạy thật xuyên suốt trên SQLite, nhưng chưa đạt sản phẩm hoàn thiện theo thiết kế.** Tạo dự án, tiếp nhận nguồn, Hiểu dự án, trả lời Decision, readiness, compile, approve, chạy Python, verify và tải gói bàn giao đều đi qua trong kiểm thử trình duyệt hiện có.

Giới hạn quan trọng nhất không phải thiếu nút bấm: Build tạo một dự án Python cố định với mô hình dự đoán lớp phổ biến nhất; Verify xác nhận hợp đồng baseline này, chưa xác minh toàn bộ yêu cầu của blueprint. Bộ test xanh không biến baseline thành một sản phẩm Customer Churn đáp ứng yêu cầu thực tế.

Trước khi dùng cho công việc thật, cần khóa chính xác dữ liệu và workflow đã được duyệt, hoàn thiện readiness và khôi phục khi lỗi, rồi triển khai/kiểm chứng đầu ra đúng phạm vi sản phẩm được chấp nhận. Danh sách task ở [Execution Brief](09-product-readiness-execution-brief.md).

## 2. Cơ sở kiểm tra và giới hạn

- Repo: `/home/conanwinner/Desktop/_CODE/Archon-dev`, nhánh `dev`.
- HEAD: `0ac0c56ab04eeca87aec8d3a11cb3a0179512752`.
- Phiên bản trong `package.json`: `0.5.0`; Bun chạy kiểm thử: `1.3.14`.
- Có thay đổi chưa commit trong System 3, API, Web, migration và tài liệu. **HEAD không chứa toàn bộ những gì đã kiểm tra.** Không coi checkout sạch của HEAD là tương đương.
- Dấu vân tay `git diff --binary HEAD` trước khi thêm báo cáo này: `c1d2704de610dcf83fa54f45e3fa08ce2e8cf027938282358af10ba91b2553f6`. Dấu vân tay này không bao gồm file untracked.
- Untracked liên quan: migrations `032–034`, toàn bộ `packages/system3/src/understanding/`, `LifecycleAttemptBar.tsx`, `UnderstandingWorkspace.tsx`. Cần giữ và kiểm tra lại trước triển khai; không chạy reset/clean hoặc tự tạo baseline mới bỏ qua các file này.
- Đọc tài liệu theo bản đồ `/docs`, đối chiếu đường đi UI → API → System 3 → workflow/action → persistence; không dùng checkbox tài liệu làm bằng chứng.
- Đã đọc trang Anvil và ba trang con trong Notion: Tổng quan, thuật ngữ, TW-02. Bản Notion TW-02 mô tả đường chạy cũ; code hiện tại và tài liệu local đã đi xa hơn.
- Chưa thử PostgreSQL, deploy production, chạy provider AI tính phí, kênh Slack/Telegram/GitHub thật, khôi phục từ bản sao lưu hoặc bộ dữ liệu nghiệp vụ do người dùng nghiệm thu.

## 3. Những phần đã có và mức độ được kiểm chứng

| Phần | Đã có trong checkout | Bằng chứng và giới hạn |
| --- | --- | --- |
| Nền tảng Anvil | CLI, Web/API, provider registry, adapter, Workflow Runtime, SQLite/PostgreSQL adapter, isolation | Cấu trúc package và `bun run test` toàn monorepo thành công. Chưa phải smoke test mọi dịch vụ ngoài đời thật. |
| OP-00 Source Intake | Tiếp nhận nguồn, phiên bản bất biến, lưu trữ và báo cáo intake, trạng thái legacy | [source-storage.ts](../../packages/system3/src/source-storage.ts), [store.ts](../../packages/system3/src/store.ts), E2E SQLite. Còn cần test crash/concurrency trên DB thật. |
| OP-01 Change Detection | Impact Manifest, phân loại thay đổi, quan hệ phụ thuộc và đề xuất chạy lại bảo thủ | [Tài liệu OP-01](../lifecycle_activity/01-change-detection.md), các handler/store/compiler và unit test. Không chứng minh mọi đường reuse dùng đúng dữ liệu. |
| TW-02 Understand Project | Input Snapshot ghim nguồn; cây Markdown; JSON/PDF readers; quality/coverage; dataset profile; candidate và activation; Decision gắn snapshot | [understanding/](../../packages/system3/src/understanding/), [templates.ts](../../packages/system3/src/templates.ts), API và E2E. Không đồng nghĩa đã hiểu đúng mọi tài liệu tùy ý. |
| AI hỗ trợ Understanding | Có nhánh gọi `provider.sendQuery` thật, giới hạn loại kết quả và kiểm tra trích dẫn | [api.ts](../../packages/server/src/routes/api.ts), `createUnderstandingSemanticFallback`. Có code tích hợp, chưa chạy smoke test provider thật. Không còn đúng nếu nói toàn bộ TW-02 chỉ có regex và không thể gọi AI. |
| TW-03 / OP-04 / OP-05 | Lưu Readiness Contract, compile và Approval Manifest; version/conflict checks | Luồng E2E thành công; còn thiếu gate và có sai lệch plan/runtime được nêu dưới đây. |
| TW-06 Execute | Sinh file Python, chạy test, pipeline, experiment, tạo tar.gz thật | [baseline-capabilities.ts](../../packages/system3/src/baseline-capabilities.ts), unit/integration capability test và E2E. Chỉ là majority-class baseline cố định. |
| TW-07 Verify | Tách bước Verify, tạo Evidence Map và gate baseline | `requirementCoverage.status = not_verified`, `verified = 0`. Có xác minh thực thi baseline, chưa có xác minh đầy đủ yêu cầu. |
| OP-08 / TW-09 Delivery | Bàn giao có hành động riêng, artifact được lưu với hash, size và manifest | E2E đi tới download. Chưa kiểm tra dựng lại từ gói trên môi trường sạch độc lập. |
| Lifecycle UI | 6 phase/10 activity, inline resource viewer, history/raw disclosure, responsive rail | Web unit test và E2E; xem ảnh desktop/mobile. Chất lượng Decision và mật độ thông tin còn vấn đề. |
| Lifecycle Attempt | Có model, migration, preview/create/continue, working path/isolation và history | Code hiện có, store tests và preview UI được kiểm tra. E2E hiện tại không chứng minh tạo worktree thật cho nhiều attempt, replay, crash và tiếp tục. |

## 4. Những phần chưa hoàn thiện

### F01 — Chất lượng đầu ra chỉ ở mức baseline (P0 cho cam kết sản phẩm)

`baseline-capabilities.ts` chứa chuỗi Python `modelPy`: lấy `Counter(labels).most_common(1)` rồi đo accuracy trên chính tập nhãn đó. Scaffolder tạo cấu trúc cố định, không hiện thực các module/code contract được trích xuất từ blueprint. Evidence Map ghi rõ mọi requirement là `not_verified`; G5 chỉ kiểm tra `executionStatus` của baseline.

Đây là giới hạn được code công khai, không phải bằng chứng hệ thống cố tình báo sai. Tuy nhiên, không được trình bày “delivery thành công” như “mọi yêu cầu đã hoàn thành”. Cần xác định phạm vi template được hỗ trợ và có tiêu chí nghiệm thu thật. Task T00, T10–T13.

### F02 — Dữ liệu TW-06 chưa luôn được ghim đến thời điểm sử dụng (P0)

Trong `System3CapabilityRegistry.execute`, nhánh `system3.project-scaffolder` gọi `readLatestSource(projectId, 'dataset')`. API callback đọc danh sách nguồn đang active. API execute có kiểm tra source hash trước khi bắt đầu, nhưng cách resolve tại node không dùng Source Version đã được phê duyệt.

**Đã xác nhận bằng đường code:** tồn tại khoảng cách giữa kiểm tra và sử dụng. **Chưa tái hiện race đồng thời:** thay nguồn trong khoảng này có nguy cơ làm dữ liệu thực thi khác dữ liệu được duyệt. Không gọi đây là sự cố đã quan sát ở production. Task T03.

Đường rerun `experiment` giải nén archive cũ rồi chuyển `projectDir` cho experiment; không thấy bước áp dụng dataset/config mới trong đường này. Nếu scope được chọn cho thay đổi tương ứng, có nguy cơ chạy lại trên input cũ. Cần regression test qua API để xác nhận toàn bộ đường lựa chọn scope, không chỉ test template. Task T03.

### F03 — Execution Plan và workflow thực thi chưa cùng một nguồn định nghĩa (P0)

[compiler.ts](../../packages/system3/src/compiler.ts) vẫn mô tả TW-02 với năm node cũ và delivery với `system3-verify-deliver`. [templates.ts](../../packages/system3/src/templates.ts) hiện tạo TW-02 hai node và tách Verify/Deliver. `definitionHash` được tính từ plan; API còn dựng bundle workflow tại thời điểm chạy.

Có cơ chế hash, capability policy và approval, nhưng chưa đủ để khẳng định toàn bộ DAG thực thi chính là DAG đã được duyệt. Task T02.

### F04 — Readiness thiếu điều kiện dữ liệu và phạm vi Decision không nhất quán (P0)

Gate trong `capabilities.ts` chỉ yêu cầu có requirement và không có Decision pending. Đã chạy chẩn đoán không ghi dữ liệu bằng registry với analysis hợp schema: `dataset = null`, một requirement và `pendingDecisionCount = 0`; kết quả `ready = true`. Đây là kết quả ở cấp capability, không phải tuyên bố toàn bộ API Build cho phép chạy không có dataset.

Hiểu dự án không có dataset là hợp lệ; trước công việc cần dữ liệu, Readiness phải trả `data_required` có giải thích. Ngoài ra, API dùng Decision của snapshot active, trong khi `saveReadinessContract` đếm mọi Decision pending của project, có thể bị lịch sử/candidate khác chặn. Task T04.

### F05 — Idempotency, concurrency và recovery chưa được chứng minh đầy đủ (P0)

API analyze kiểm tra `expectedVersion` trước `beginProjectOperation`; readiness/compile cũng cần kiểm tra thứ tự tương tự. Request lặp lại cùng key/body sau khi version đổi có thể bị trả conflict thay vì operation gốc. Một số đường execute/approve đã có xử lý lặp; không phải toàn hệ thống thiếu idempotency.

Store tests dùng database giả lập ở nhiều trường hợp. Chưa có bằng chứng đủ cho hai request đồng thời, restart giữa lưu file và commit record, hai tiến trình cùng sở hữu operation hoặc tạo attempt thất bại một phần. Task T05, T08, T15.

### F06 — CSV và quyết định target chưa có hợp đồng xuyên suốt (P1)

Profiler mới có parser streaming, nhưng `system3.dataset-validator` vẫn tách header bằng `split(',')`, không tương đương CSV có dấu ngoặc kép hoặc newline trong field. Các tập distinct/row hash trong profiler tăng theo dữ liệu; giới hạn file không tự chứng minh giới hạn RAM đủ an toàn. Cần kiểm tra lại profile/target distribution sau Decision đổi target và tránh đổi tên cột âm thầm giữa các bước. Task T06, T07.

### F07 — AI fallback cần kiểm chứng quyền và ngân sách thực tế (P1, P0 trước bật cho nguồn không tin cậy)

Đã có `allowed_tools: []`, timeout 15 giây/lần và tối đa hai lần thử, ngân sách yêu cầu `0.025 USD/lần`. Chưa chứng minh mọi provider thực thi cùng semantics no-tools/no-network/budget. `AbortSignal.timeout` ở bridge chưa ghép signal hủy của activity; provider/model/policy được resolve từ config hiện hành. Không được suy ra rằng khai báo config đã tạo sandbox hoặc đảm bảo tổng chi phí. E2E hiện có không chứng minh cô lập AI fallback khỏi config/credential của môi trường; cần harness xác định cho CI. Task T09.

### F08 — UI còn lộ thông tin kỹ thuật và quá dài (P1)

Ảnh từ E2E tại 1280×720 và 390×844 cho thấy danh sách Decision dài, nhiều câu có cùng tiêu đề chung, một số nội dung chứa đoạn JSON nguồn (`flag`, `issue`...). Inputs/Outputs nằm sâu phía dưới trên mobile. Modal xem trước attempt dùng được nhưng không đủ chứng minh toàn bộ UX đã đạt yêu cầu task-first.

Ảnh kiểm tra nằm ở `/tmp/anvil-lifecycle-attempt-desktop.png` và `/tmp/anvil-lifecycle-attempt-compact.png`; đây là bằng chứng tạm thời, không phải artifact được commit. Task T14.

### F09 — Chưa đạt release gate và tài liệu bị lệch (P0/P1)

`bun run validate` dừng ở hai lỗi `@typescript-eslint/explicit-function-return-type` tại `LifecycleAttemptBar.tsx:63` và `:74`. Không sửa runtime trong lượt lập kế hoạch này. Notion TW-02 còn mô tả thiết kế/caveat cũ, trong khi local đã có pipeline mới; không nên tiếp tục điều phối task theo Notion cũ mà không ghi mốc audit. Task T01, T16.

## 5. Các kiểm tra đã chạy

| Lệnh / kiểm tra | Kết quả ở baseline audit |
| --- | --- |
| `NODE_OPTIONS=--max-old-space-size=4096 bun run validate` | Không đạt: hai lỗi lint nêu trên. Các bước bundled/schema/vendor-map và toàn bộ type-check trước lint đã đạt; validate chưa chạy đến format/tests. |
| `bun run test` | Đạt toàn monorepo, exit 0; đã chạy riêng sau validate. Không dùng `bun test` tại root. |
| `bun --filter @anvil/system3 test` | 82 pass, 0 fail, 12 file. |
| `bun --filter @anvil/web test` | Đạt các batch, exit 0. |
| `bun test packages/server/src/routes/system3-activity-resources.test.ts` | 2 pass; chỉ kiểm tra helper, không thay thế integration test API. |
| `bun run format:check` | Đạt tại baseline trước khi thêm tài liệu audit. |
| `CI=true bunx playwright test e2e/system3-projects.test.ts --workers=1 --retries=0 --reporter=line` trong `packages/web` | 1 pass / 14.1 giây. Chạy lại có `CAPTURE_SYSTEM3_UI=true`: 1 pass / 15.5 giây và đã xem hai ảnh. |
| Registry readiness với dataset null, 1 requirement, 0 pending decision | `ready = true`, xác nhận gate thiếu kiểm tra dataset ở cấp capability. |

E2E dùng server và `ANVIL_HOME` tạm. Lần chạy trong sandbox gặp giới hạn bind/connect; lần được cấp quyền localhost chạy thành công. Không quy lỗi sandbox thành lỗi sản phẩm. Test này dùng blueprint ví dụ và CSV nhỏ, không chứng minh chất lượng mô hình trên dữ liệu nghiệp vụ. Chưa thực hiện smoke test provider có kiểm soát hoặc kiểm toán usage/chi phí; không suy ra từ E2E xanh rằng AI fallback đã hoạt động thành công hoặc không phát sinh request ra ngoài.

Kiểm tra tài liệu sau khi thêm báo cáo/brief: Prettier đạt, `git diff --check` đạt và 43 liên kết local được kiểm tra, không có đích bị thiếu. Không sửa code triển khai trong lượt lập kế hoạch này.

## 6. Cách đọc tiến độ từ đây

- **Đã có code** khác **đã kiểm thử**; **đã kiểm thử** khác **đã nghiệm thu sản phẩm**.
- Không dùng phần trăm hoàn thành tùy ý khi chưa có danh mục yêu cầu được chốt.
- Mốc đầu: baseline đáng tin cậy và release gates xanh. Mốc sau: template Customer Churn đáp ứng tiêu chí thực tế. Mốc cuối: cài đặt, vận hành, khôi phục và bàn giao được nghiệm thu.
- Báo cáo này không có nghĩa đã sửa các vấn đề. Trạng thái ban đầu của các task triển khai là chưa thực hiện.

## Nguồn

- [Tổng quan local](../1.%20Tổng%20quan%20hệ%20thống.md), [10 Lifecycle Activities](../lifecycle_activity/README.md), [thiết kế kiểm thử](06-implementation-and-testing.md), [thiết kế UX](07-system3-lifecycle-ui.md).
- [Anvil trên Notion](https://app.notion.com/p/3d4c8033b73d80bf93a8fbe4f92825f7), [Tổng quan Notion](https://app.notion.com/p/3d4c8033b73d8090b597ccba858acfeb), [thuật ngữ Notion](https://app.notion.com/p/3d4c8033b73d808bbf7ec95735d5196a), [TW-02 Notion — có nội dung cũ](https://app.notion.com/p/3d4c8033b73d80399c3afe7808fc6509).
- [API](../../packages/server/src/routes/api.ts), [System 3 store](../../packages/system3/src/store.ts), [compiler](../../packages/system3/src/compiler.ts), [capabilities](../../packages/system3/src/capabilities.ts), [baseline capabilities](../../packages/system3/src/baseline-capabilities.ts), [templates](../../packages/system3/src/templates.ts), [E2E](../../packages/web/e2e/system3-projects.test.ts).

[← Mục lục kỹ thuật](README.md) · [Execution Brief →](09-product-readiness-execution-brief.md)
