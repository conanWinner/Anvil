# Anvil — Tinh giản và chạy nhiều LLM trên cùng dữ liệu

Phiên bản 4 — triển khai UI ngày 26/10/2026. **Workspace tối giản và mẫu Olist đã chạy đầu-cuối với hai LLM thật qua 9router**, Verify độc lập và gói tải về chạy lại được. Xem bảng bàn giao UI bên dưới để phân biệt phần đã kiểm tra và giới hạn còn lại. Bằng chứng luồng ngày 16/10 được giữ riêng; chưa nghiệm thu toàn bộ S0–S7.

## Mục tiêu và phạm vi

Người dùng đưa một bài toán và bộ dữ liệu vào Anvil, chọn nhiều **LLM**, duyệt một kế hoạch, chạy từng model trong môi trường riêng, xem code/kết quả và so sánh bằng cùng bộ kiểm tra. Có thể tải gói và chạy lại từng kết quả. 9router là gateway ưu tiên; không phải so sánh các thuật toán ML cố định.

Bản đầu: một người dùng, local/SQLite, Web, một workspace; nguồn Markdown và dữ liệu/file liên quan được ghim. Giữ runtime/provider/storage hiện có. Customer Churn hiện chỉ là fixture lịch sử, không giới hạn mục tiêu sản phẩm. Không tự đặt ngưỡng chất lượng, chọn model thắng hoặc công bố đã đáp ứng bài toán khi chưa có Evidence.

Baseline gốc: `27b246ab33deefc872f866ecc7dd8e94c3a9d1b9`. Nhánh triển khai: `feat/core-flow-simplification`; giữ toàn bộ diff đang có. Kế hoạch này thay thứ tự ưu tiên của [09](09-product-readiness-execution-brief.md); [08](08-product-readiness-audit.md) chỉ là audit theo baseline cũ.

## Trải nghiệm và giới hạn

1. Một form nhận tên, bài toán/blueprint và dữ liệu; thông số ít dùng nằm trong disclosure.
2. Người dùng chủ động chạy Hiểu dự án, trả lời Decision và chấp nhận Bản hiểu.
3. Backend kiểm tra sẵn sàng và chuẩn bị kế hoạch: cùng Input Snapshot, danh sách provider/model, prompt, quyền, ngân sách và bộ kiểm tra; người dùng xem rồi **Phê duyệt và chạy**.
4. Mỗi LLM có workspace/run/output riêng; không đọc output của đối thủ. Hiện trạng thái, lỗi và chi phí/usage nếu có; thiếu usage phải ghi chưa biết. Một model lỗi không được tính là đã so sánh thành công.
5. Bảng so sánh gắn code/output, phép kiểm tra và Evidence cho từng model. Bàn giao chỉ bắt đầu khi người dùng yêu cầu.

Đây là nhóm thao tác, không thay mapping **6 Lifecycle Phase / 10 Lifecycle Activity** trong [contract](../lifecycle_activity/README.md). OP không tạo Workflow Run mặc định. Multi-model là phần thực thi bên trong TW-06, không thêm phase/activity. Giữ ranh giới System 3 Control Plane và Anvil Workflow Runtime.

Giữ Source Version/Input Snapshot bất biến, provenance, Approval Manifest, Evidence, auth, input validation, isolation và accessibility. Đổi nguồn/model/prompt/quyền làm thay đổi basis phải đánh giá lại kế hoạch và approval. Không tự bắt đầu Understanding, trả lời Decision hoặc bàn giao. Không đoán tiến trình đã chết để đánh failed/cancelled.

## Cắt bớt trước

| Nhóm | Xử lý |
| --- | --- |
| Wizard và chọn lựa chỉ có một mặc định | Gộp một form, bỏ bước chuyển trang dư |
| Điều hướng project | Một workspace chính; giữ URL cũ như đường chi tiết |
| JSON/hash/ID/node/log/attempt | Đưa vào Chi tiết kỹ thuật/lịch sử; không mất khả năng đối soát |
| Compile và các bước đủ điều kiện | Nối ở backend, có idempotency và trạng thái bền vững; không dùng tab trình duyệt làm coordinator |
| Provider/tier/routing | Một gateway 9router, danh sách LLM rõ ràng; không thêm fallback tự động |
| Builder/marketplace/adapters/OCR/SHAP/AutoML/multi-tenant | Hoãn mở rộng; không nằm trên đường bắt đầu |
| File/dependency/route nghi dư | Chỉ đề xuất bỏ sau kiểm tra caller, hồi quy và tương thích; không xóa dữ liệu/file/history nếu chưa được phép |

## Kế hoạch cải thiện UI — 26/10/2026

Phần này là backlog UX ưu tiên tiếp theo, cụ thể hóa S3/S7 và phần mẫu của S4–S6; không thay Evidence hoặc đánh dấu lại các task cũ. Baseline lập kế hoạch: nhánh `feat/core-flow-simplification`, HEAD `27b246ab33deefc872f866ecc7dd8e94c3a9d1b9` **cộng toàn bộ worktree chưa commit**. Trước khi làm phải đọc lại diff; HEAD riêng lẻ không đại diện code đã đánh giá.

### Hiện trạng đã kiểm tra

Đã đọc code và xem giao diện chạy thật ở 1280px/390px, có hai agent Luna medium rà soát độc lập. Đây là đánh giá, chưa triển khai UI mới hoặc chạy lại luồng LLM. Ảnh và số đo: `/tmp/anvil-ux-audit-BOcUsr/`.

**Kết luận:** màn hình chính đang ưu tiên cấu trúc điều khiển nội bộ; mục tiêu chạy nhiều LLM và xem kết quả bị chìm. Thu gọn CSS chưa đủ vì người dùng vẫn phải tự chuẩn bị bộ kiểm tra.

| Vấn đề đã kiểm tra | Hướng xử lý đề xuất |
| --- | --- |
| `/` chuyển sang console runtime, còn luồng chính nằm ở `/console/projects` (`App.tsx`) | Đưa điểm vào mặc định về danh sách dự án; giữ URL công cụ cũ |
| So sánh LLM mặc định tắt và nằm trong disclosure; khi bật cần model refs, prompt, requirement IDs và harness (`NewProjectPage`) | Đưa chọn LLM thành nội dung chính; model cấu hình sẵn có tên dễ chọn; thông số provider ở phần nâng cao |
| Mẫu Olist chỉ điền blueprint/CSV; không điền cấu hình so sánh | Trước tiên cung cấp một bài toán mẫu có prompt, requirement IDs và harness xác định, kiểm chứng thật. CSV mẫu hiện tại không phải benchmark churn |
| Project đã hoàn tất vẫn hiện “Chưa có lượt chạy” do thanh Lifecycle Attempt dùng dữ liệu riêng (`LifecycleAttemptBar`) | Phân biệt lượt chạy vòng đời với kết quả thực thi hiện có; không suy ra chưa từng chạy khi thiếu attempt record |
| Project so sánh đã hoàn tất mở OP-08; kết quả model chỉ xuất hiện khi chọn TW-06/TW-07 (`FlowPage`, `LifecyclePhaseDetail`) | Kết quả là nội dung mặc định sau Verify; trạng thái bàn giao là hành động phụ |
| Header, thanh attempt, rail 6 phase/10 activity và các thẻ giải thích xuất hiện trước nội dung chính | Một trạng thái và một CTA chính; thu gọn lịch sử và vòng đời, giữ đầy đủ cấu trúc khi mở |
| Ở project so sánh đã xem, mobile bắt đầu nội dung activity sau khoảng 700px; form bật comparison cao 1401px ở desktop | Đưa hành động cần làm vào màn hình đầu; giảm khối giải thích và metadata lặp |

Nguồn code cần đối chiếu: [entry route](../../packages/web/src/App.tsx), [form/workspace](../../packages/web/src/features/system3/System3App.tsx), [projection](../../packages/web/src/features/system3/lifecycle-view.ts), [attempt](../../packages/web/src/features/system3/LifecycleAttemptBar.tsx). API sẵn có `GET /api/providers/pi/models` trả `ref/provider/id/name`; catalog rỗng là trạng thái không xác định, không chứng minh không có model. Compiler hiện kiểm tra requirement IDs thuộc Bản hiểu và vẫn ràng buộc template/target lịch sử; không thể chỉ ẩn trường rồi coi bài toán bất kỳ đã được hỗ trợ.

### Phạm vi và quyết định thiết kế

**Đầu ra ưu tiên:** người mới dùng một bộ mẫu, chọn hai LLM qua 9router, chủ động phân tích/duyệt/chạy, thấy code/output riêng và tải gói chạy lại; không viết Python hoặc gọi API tay trên đường mẫu.

- Giữ danh sách dự án làm điểm vào; hai màn hình làm việc chính là **Tạo dự án** và **Workspace dự án**. Không thêm wizard, tab trạng thái hoặc chế độ simple/advanced song song.
- Workspace dùng cùng projection trong `lifecycle-view.ts`. Giữ đúng 6 phase/10 activity trong một rail có thể mở; mặc định thu gọn rail, ưu tiên activity cần xử lý hoặc kết quả TW-07 đã xác minh. Không thêm phase hay đổi tên domain.
- Tiếp nhận vẫn bắt buộc Markdown, CSV tùy chọn. Nhãn chính là **Mô tả bài toán (.md)**, định dạng Blueprint Markdown ghi trong mô tả ngắn. Chưa bổ sung nhập văn bản tự do/OCR.
- Với dự án mới, chọn nhiều LLM là nội dung chính. Legacy baseline vẫn mở được; không tự chuyển cấu hình dự án cũ hoặc chạy baseline khi thiếu cấu hình comparison.
- Giữ Pi/9router, Source Intake và Inline Resource Viewer; không thêm dependency, migration, provider adapter, renderer framework hoặc route API mới nếu contract sẵn có đáp ứng.
- Tiếp tục dùng token xanh dương–cyan–teal và font hiện có. Nền trung tính, căn trái; bảng kết quả là trọng tâm. Một nút chính/một trạng thái ở đầu workspace; bỏ tiêu đề, lời hướng dẫn và card lặp. Mobile gộp cột trong cùng hàng model, không tạo dashboard khác.
- Giữ approval, pinned inputs, provenance, Evidence, isolation và lỗi actionable. Chi phí chưa có dữ liệu phải ghi **Chưa xác định**; không suy ra miễn phí từ catalog.
- Hoãn full churn 9 bảng/ML/SHAP, ngôn ngữ và dependency mới, marketplace, builder, adapter, chấm điểm thắng tự động và hủy riêng từng model. Không xóa route, file, dữ liệu hay lịch sử trong đợt UI.

### Luồng và bố cục cần đạt

```text
Tạo dự án
  [Dùng bài toán mẫu Olist]     [Dùng tệp của tôi]
  Tên · Mô tả bài toán (.md) · Dữ liệu CSV
  Các LLM đã cấu hình: [chọn] [chọn]
  Bộ kiểm tra: mẫu có sẵn / cần cấu hình
  [Tạo dự án]

Workspace dự án
  Tên · dữ liệu đang dùng
  Trạng thái / điều còn thiếu            [Hành động tiếp theo]
  Câu hỏi cần trả lời hoặc bản duyệt — chỉ hiện đúng lúc
  Model             Trạng thái     Kiểm tra     Code     Output
  LLM A             ...            ...         [Xem]    [Xem]
  LLM B             ...            ...         [Xem]    [Xem]
  [Chi tiết vòng đời: 6 phase / 10 activity]
  [Lịch sử và kỹ thuật]
```

Tên LLM, dữ liệu và bộ kiểm tra chỉ được điền sẵn từ cấu hình/mẫu hợp lệ. Chọn mẫu không gọi LLM. Nút **Bắt đầu phân tích** là hành động chủ động riêng sau khi tạo; không tự bắt đầu Understanding trong effect khi mở trang.

| Tình huống | Nội dung ưu tiên và hành động chính |
| --- | --- |
| Upload lỗi một phần / Intake chưa sẵn sàng | Nêu tệp lỗi; **Bổ sung hoặc thử lại nguồn**, giữ project/tệp đã tiếp nhận |
| Chưa phân tích | **Bắt đầu phân tích**; chưa có run không trình bày như lỗi |
| Đang xử lý | Trạng thái operation bền vững; không hiện nút chạy trùng |
| Cần Decision | Hiện câu hỏi, lý do và lựa chọn thực; **Lưu câu trả lời**; không tự trả lời |
| Có Bản hiểu để chấp nhận | Tóm tắt bài toán/đầu vào/yêu cầu; **Chấp nhận Bản hiểu**; nối Readiness/Compile ở backend |
| Thiếu dataset/bộ kiểm tra hoặc runtime | Nêu đúng blocker; **Bổ sung dữ liệu**, **Cấu hình bộ kiểm tra** hoặc **Xem lỗi môi trường** |
| Kế hoạch sẵn sàng | **Xem và phê duyệt kế hoạch**; dialog ghi rõ model, input, bộ kiểm tra, quyền và giới hạn, rồi **Phê duyệt và chạy** |
| Đang chạy / đang Verify | Trạng thái từng model theo dữ liệu thật; một model lỗi không che model còn lại; chưa có API tiến độ thì ghi đang chờ kết quả |
| Verify hoàn tất / có kết quả một phần | Ưu tiên bảng kết quả; phân biệt chạy xong với kiểm tra đạt. **Yêu cầu bàn giao** chỉ khi gate cho phép; lỗi chặn bàn giao được giải thích |
| Đã bàn giao | **Tải gói chạy lại**; bảng kết quả vẫn hiện, không mở mặc định OP-08 |
| Nguồn/model/prompt/harness thay đổi hoặc operation unknown | Ưu tiên cảnh báo basis cũ/phục hồi; kết quả cũ có nhãn. Không dùng approval cũ hoặc tự coi operation đã chết |

Đây là các tình huống trình bày, không thêm lifecycle state, activity hoặc state machine backend. Kết quả chỉ dùng làm workspace mặc định khi còn hiện hành; blocker/operation đang chạy được ưu tiên trước. Khi người dùng đã chọn activity hoặc mở resource thì polling không tự đổi lựa chọn, đóng viewer hoặc kéo trang.

### Task thực hiện

Phạm vi và điều kiện nghiệm thu của từng task ở bảng này; kết quả triển khai nằm ở bảng bàn giao ngày 26/10 bên dưới.

| Task | Phụ thuộc | Phạm vi chính | Điều kiện hoàn tất |
| --- | --- | --- | --- |
| **UI-0 — Chốt baseline và contract** | Không | Ghi diff nền, ảnh/số thao tác hiện tại; cập nhật mục 7/10/11 của `07` theo thiết kế này | Có checklist trước/sau cho mẫu và project cũ; contract vẫn đúng 6/10, inline, approval; không ghi nhận thiết kế thành đã triển khai |
| **UI-1 — Một trạng thái và hành động kế tiếp** | UI-0 | `lifecycle-view.ts`, `System3App.tsx`, `LifecycleAttemptBar.tsx` | Projection chọn đúng blocker/action theo bảng trên; legacy có execution không báo chưa từng chạy vì thiếu attempt; unknown không tự đổi terminal; test trạng thái/selection đạt |
| **UI-2 — Rút gọn workspace và điểm vào** | UI-1 | `App.tsx`, Shell/ProjectNav/FlowPage trong `System3App.tsx`, `system3.css` | `/` mở `/console/projects`; `/console` và deep link cũ vẫn hoạt động. Bỏ card/tiêu đề lặp; rail thu gọn mở đủ 6/10; CTA đầu màn hình ở 1280×900 và 390×844 với nội dung ngắn chuẩn |
| **UI-3 — Hoàn chỉnh một mẫu chạy được** | UI-0 | `public/samples/olist/`, form chọn mẫu; kiểm tra `capabilities.ts`/`compiler.ts` khi cần | Mẫu điền đủ Markdown/CSV/prompt/requirements/harness. Có ví dụ output đúng/sai, self-check độc lập; compiler chấp nhận IDs sau Understanding; không sửa target/template bằng dữ liệu giả để lách gate |
| **UI-4 — Form và chọn model dễ dùng** | UI-2, UI-3 | `NewProjectPage`, `api.ts` và API types hiện có | Model lấy từ Pi catalog, lọc `router9/`, chọn 2–4 khác nhau bằng tên; ref giữ trong config/chi tiết. Mẫu không cần nhập prompt/IDs/harness; custom thiếu config có đường sửa rõ; tạo/upload retry không sinh project hoặc nguồn trùng |
| **UI-5 — Bảng kết quả và xem code/output** | UI-1, UI-2 | `LifecyclePhaseDetail`, `ResourceViewer.tsx`, activity presentation hiện có | Một hàng/model, trạng thái thực thi riêng kết quả checks; code/output mở đúng run inline, gắn đúng hash. Verify xong ưu tiên TW-07; không dẫn vào Technical Console để xem kết quả; dữ liệu chưa có hiện lý do |
| **UI-6 — Các đường thiếu đầu vào và lỗi** | UI-3, UI-4, UI-5 | `store.ts`, UnderstandingWorkspace, form/workspace; route/domain chỉ khi có lỗi contract được chứng minh | Sửa thiếu nguồn/config/Decision, provider lỗi và refresh không mất tiến độ. Đổi basis bắt đánh giá/duyệt lại; kết quả partial/stale/unknown không được trình bày thành thành công hoặc tự retry gọi model |
| **UI-7 — Nghiệm thu luồng tối thiểu** | UI-6 | Test Web/domain/backend liên quan, Playwright, mẫu và tài liệu sử dụng | Offline gates đạt; hai LLM thật qua 9router cùng input/prompt/harness, Verify độc lập, tải/tái chạy gói; xem render desktop/mobile, keyboard/focus; đo trước/sau và ghi giới hạn |

**Thứ tự bàn giao:** A = UI-0 → UI-1 → UI-2 → UI-5, nhìn kết quả rõ trên project hiện có; B = UI-3 → UI-4, người mới thiết lập được mẫu; C = UI-6 → UI-7, chứng minh đầu-cuối. UI-3 có thể làm độc lập với UI-1/UI-2, nhưng A được review trước khi đưa form mới vào đường chính. Không gọi B/C hoàn tất chỉ vì A đã gọn hơn.

### Chi tiết đầu vào và phạm vi mẫu

- Mẫu ưu tiên là **tổng hợp 1.000 khách hàng Olist theo bang**: tổng khách hàng, tổng đơn và số khách hàng từng bang, xuất JSON xác định. Đây là bài tập sinh/chạy code trên dữ liệu thật; không tuyên bố huấn luyện hoặc dự báo churn.
- Bổ sung một Markdown mô tả đúng bài tập; giữ `DESIGN_B_2.md` và mẫu nguồn cũ truy cập được. Chọn mẫu mới phải cho xem đúng tên/mục tiêu; không âm thầm dùng blueprint 9 bảng để nghiệm thu bài tập tổng hợp nhỏ.
- Harness stdlib đọc CSV và candidate JSON độc lập; kiểm schema, tổng số khách hàng, tổng đơn, tập bang và số liệu từng bang. Expected values tính từ input ghim; không tin trường `passed` do model tự viết hoặc hardcode đáp án trong code mẫu.
- Mỗi tiêu chí có requirement ID có thật trong Bản hiểu và nội dung đọc được trong bản duyệt. Mẫu cung cấp bộ kiểm tra, không tự duyệt thay người dùng. Giữ nguồn Kaggle, giấy phép và hash CSV hiện có.
- **Gate sớm của UI-3:** thử readiness/compiler với đúng blueprint nhỏ trước khi nối UI. Nếu template churn đang chặn, chỉ bổ sung policy comparison tối thiểu trong `packages/system3` và test hồi quy legacy; không đưa logic Olist vào runtime, không bỏ validation chung hoặc thêm workflow engine mới. Ghi rõ diff domain này, không coi là đổi nhãn UI thuần túy.
- Đường tệp riêng tiếp tục nhận prompt/requirement IDs/harness qua **Cấu hình bộ kiểm tra**; cho xem, sửa và validate trước compile/approval. Chưa có cấu hình thì được lưu/tiếp nhận/phân tích, nhưng không chạy comparison hoặc âm thầm chuyển baseline. Nếu đường hiện có chưa giữ được draft an toàn, giữ trường bắt buộc trong form đến khi UI-6 chứng minh được đường bổ sung; không thêm persistence tùy tiện.
- API catalog chỉ là gợi ý cấu hình, không bảo đảm request thành công. Catalog rỗng/lỗi: hiện lý do và **Tải lại danh sách model**, giữ draft/tệp. Có thể nhập ref thủ công trong phần nâng cao với validation hiện có; không tự chọn/thay LLM hoặc bổ sung key trong browser.

### Kiểm chứng, số đo và điều kiện dừng

| Nhóm | Kịch bản bắt buộc |
| --- | --- |
| Projection | Legacy không có attempt, project mới, pending Decision, thiếu dataset/config, chờ duyệt, đang chạy/Verify, completed, partial failure, stale và unknown; giữ explicit selection khi poll |
| Form | Mẫu đủ đầu vào; custom uploads; 0/1/2/4/5 và model trùng; catalog lỗi/rỗng; file tải lỗi/HTML/oversize; submit kép, upload một phần và retry |
| Kết quả | Không đánh đồng completed/passed; code/output đúng model; missing/unsupported renderer thân thiện; Escape trả focus; không đổi route/scroll/selected activity khi xem resource |
| Lifecycle và quyền | Mở rail đúng 6 phase/10 activity; OP không có “thiếu run” giả; intake provenance legacy; input/prompt/model/harness đổi thì approval hết hiệu lực; không execute trước approval hoặc tự delivery |
| Đầu-cuối | Offline fixture đi hết mẫu; live chỉ hai LLM tiết kiệm đã cấu hình, chạy tuần tự qua 9router; chung hashes, code/output riêng, Verify rerun harness và chạy lại archive không gọi provider |
| Render và thao tác | Xem 1280×900/390×844, keyboard-only, focus, reduced motion, không tràn ngang; mẫu và project legacy có dữ liệu thật |

Chỉ tiêu UX dự kiến: không cần mở Technical Console hoặc tự viết harness trên đường mẫu; một CTA chính ở đầu workspace; sau Verify thấy ít nhất hàng model đầu tiên trong màn hình đầu khi thu gọn chi tiết; tối đa một thao tác mở code/output từ hàng model. Ghi số click/chuyển route, số trường phải nhập, số lần cuộn tìm CTA trước/sau trên cùng fixture và viewport; số nhập văn bản/tải tệp ghi riêng. Loại thời gian chờ LLM khỏi số đo thao tác. Mục tiêu giảm ít nhất 30% thao tác điều hướng/chọn cấu hình trên đường mẫu so với baseline UI-0; chưa có baseline thì không công bố đã đạt.

Lệnh tối thiểu khi triển khai, chạy từng lệnh và từng package phù hợp với diff:

```bash
bun test packages/web/src/features/system3/lifecycle-view.test.ts
bun test packages/web/src/features/system3/store.test.ts
bun --filter @anvil/web type-check
bun --filter @anvil/web test
bun --filter @anvil/web test:e2e e2e/system3-samples.test.ts e2e/system3-projects.test.ts --workers=1
```

Thêm test compiler/capability/sandbox/server nếu sửa các lớp đó; test thường không gọi mạng/credential. Tách E2E live có opt-in khỏi fixture offline; dựng namespace test riêng, không chạy test tạo project vào dữ liệu sử dụng hiện tại. Lint file đổi với zero warnings; kiểm tra Markdown/relative links và diff. Trước PR vẫn phải `bun run validate`; nếu guard UID 0 chặn Claude tests thì báo nguyên nhân, chạy bằng user phù hợp, không tắt guard hoặc ghi full suite đã đạt.

[Contract 07](07-system3-lifecycle-ui.md) đã cập nhật cho workspace và rail thu gọn. Không đổi AGENTS.md, mapping 6/10 hoặc schema cơ sở dữ liệu.

### Tổ chức, rủi ro và khôi phục

- Điều phối tự làm phần phụ thuộc; nếu dùng lại agent thì Luna medium cho audit/test cơ học, tối đa hai agent hoạt động và một kiểm tra nặng. Giao task không chồng file; UI-1/UI-2/UI-4/UI-5 cùng chạm `System3App.tsx` phải làm nối tiếp. Không tạo thêm đội agent chỉ để viết kế hoạch.
- Dùng giới hạn VPS và `btop` ở phần Kiểm chứng bên dưới. Catalog/fixture không cần gọi LLM; chỉ live nghiệm thu mới tiêu token; không tự đổi model khi 429/503.
- Rủi ro chính: template churn chặn mẫu; chọn kết quả mặc định che blocker; upload config gây invalidation; nhầm attempt với execution; mất focus khi poll; break legacy bookmark. Mỗi rủi ro có gate/test ở UI-1/UI-3/UI-6/UI-7, không chữa bằng fallback im lặng.
- Trước mỗi task lưu snapshot các file sắp sửa và Git diff; đổi ít file, không migration nếu không cần. Rollback chỉ đảo đúng thay đổi task dựa trên snapshot/patch, giữ worktree nền; không dùng reset/clean hoặc ghi đè chỉnh sửa khác. Dự án đã tạo, Source Version, runs và Evidence luôn giữ nguyên.
- Bàn giao từng mốc ghi task đã/chưa làm, file đổi, lệnh/kết quả, ảnh/số đo và blocker/next action. Không push, merge, deploy hoặc xóa dữ liệu trong kế hoạch này.

## Task và điều kiện nghiệm thu

Mỗi task ghi trạng thái và bằng chứng thật, không coi code/fixture mock là nghiệm thu live. Có thể làm phần độc lập trước khi mốc hoàn tất; không bật hành vi phụ thuộc khi contract chưa đạt.

| Task | Phụ thuộc | Công việc tối thiểu | Đạt khi |
| --- | --- | --- | --- |
| **S0 — Môi trường/baseline** | Không | Khôi phục Bun/dependencies theo lockfile, doctor, Web/server và fixture local riêng; đo đường đi | Khởi động được, test nền liên quan có kết quả, biết bước lỗi và số thao tác hiện tại |
| **S1 — 9router** | S0 cho live | Dùng Pi/custom endpoint hiện có trước khi thêm adapter; cấu hình model và credential an toàn | Request thật qua Anvil tới 9router; streaming, schema validation, cancel/timeout, lỗi và provenance được kiểm chứng; test offline không gọi mạng |
| **S2 — Điều phối an toàn** | S0 | Chấp nhận Bản hiểu → Readiness → Compile; phê duyệt → Execute → Verify; dùng operation hiện có | Không cần gọi API tay; retry/refresh/restart không sinh run/approval trùng, không dùng basis cũ; Delivery vẫn do người dùng yêu cầu |
| **S3 — Workspace gọn** | S2 cho tự nối | Một form, một workspace, Decision chung, resource inline, một hành động chính, kỹ thuật thu gọn | UI thật ở desktop và 390px; đủ 6/10, focus/bàn phím/reduced motion; có đường xử lý thiếu dữ liệu/lỗi provider; báo số thao tác trước/sau |
| **S4 — Chạy nhiều LLM** | S1–S3 | Chọn ít nhất hai LLM qua 9router; ghim cùng dữ liệu và bài toán; từng run/code/output cô lập và có giới hạn | Hai LLM thật dùng cùng input hash, có code/output riêng và chạy lại được; lỗi/hủy của từng run hiển thị đúng; không tự thay model |
| **S5 — So sánh và Evidence** | S4 | Cùng bộ kiểm tra/tiêu chí trên các output, kết quả theo model và requirement | So sánh truy được về input/model/run; test lỗi, artifact sửa, requirement thiếu Evidence không thành đạt; không tin riêng cờ passed của Build |
| **S6 — Bàn giao chạy lại** | S5 cho nghiệm thu toàn bộ | Code/config/dependency lock, manifest, Evidence, lệnh chạy/test từng model; archive an toàn | Giải nén thư mục mới và tái chạy theo hướng dẫn; không phụ thuộc đường dẫn máy tạo; chặn path/link traversal và giới hạn byte/file/count |
| **S7 — Thu gọn phần dư** | S4–S6 | Đo lại UX, lập danh sách component/route/config/dependency không còn dùng và tác động | Đường chính không cần phần dư; kiểm tra hồi quy đạt; việc xóa cụ thể chỉ sau xác nhận theo AGENTS.md |

**M1:** S0–S3 chạy đầu-cuối, có 9router thật và kiểm tra gián đoạn; chỉ gọi là thông luồng.
**M2:** S4–S6 có ít nhất hai LLM thật, so sánh có Evidence, gói chạy lại được; đây là đầu ra cốt lõi.
**M3:** S7 thu gọn sau khi M2 ổn định. Không mở rộng tính năng ngoài các mốc này.

## 9router và các điểm chưa chốt

- Hướng cấu hình: [12 — 9router qua Pi](12-9router-setup.md). Alias `router9/<model-id>` hợp parser; `9router/...` hiện không hợp lệ. Chỉ thêm adapter khi chứng minh đường có sẵn thiếu contract cần thiết.
- Cấu hình Codex local chỉ ra gateway `http://127.0.0.1:20128/v1`; hai smoke Anvil/Pi đã thành công trước reboot (xem S1). Xác minh giao thức, model ID và cách cấp credential trước live; không sao chép secret vào repo/log/tài liệu.
- Đã kiểm chứng hai model Luna trên CSV đếm dòng và mẫu tổng hợp Olist 1.000 khách hàng. Bài toán riêng cần dữ liệu và harness tương ứng của người dùng; không mặc định mọi bài toán là Customer Churn hoặc tự đặt business metric.
- Với Understanding: enforce policy không có tool khi cần. Với code: chỉ cấp quyền công cụ và môi trường trong kế hoạch đã duyệt, không chạy code LLM ngoài isolation.

## Kiểm chứng và khôi phục

Ưu tiên test hiện có, nhỏ nhất phù hợp; CI dùng fixture xác định và không lấy credential môi trường. Live dùng dữ liệu thử, request/token có giới hạn; lưu bằng chứng model/input hash, thời điểm và kết quả, không lưu secret.

Sau sự cố VPS treo ngày 16/10/2026: máy hiện có 2 CPU, RAM 3,8 GiB và swap 2 GiB. Khôi phục 5 phiên Luna medium nhưng chỉ giao tối đa 2 agent làm việc cùng lúc; các phiên còn lại chờ. Giữ `btop` ở pane `w2:p6`, đối chiếu RAM khả dụng, swap và load trước/sau mỗi lượt kiểm tra. Nếu RAM khả dụng dưới 768 MiB hoặc CPU trên 90% kéo dài 60 giây/load 1 phút trên 3, ngắt tác vụ kiểm tra và giảm agent đang làm; chỉ tiếp tục khi RAM khả dụng trên 1,2 GiB và load dưới 2 ổn định. Đây là ngưỡng vận hành, không phải kết luận nguyên nhân sự cố.

Chỉ một test/type-check/lint/build/Playwright cùng lúc, dùng `flock /tmp/anvil-heavy-check.lock`; Node mặc định giới hạn heap 768 MiB và `--v8-pool-size=1`; Vite/esbuild dùng `GOMAXPROCS=1`. Type-check server cần heap 1536 MiB, chỉ chạy riêng khi đủ RAM và giới hạn một lõi bằng `taskset -c 0`. Không chạy script root có fan-out song song trên VPS này; chạy từng package hoặc dùng Bun `--sequential`. Không tự dừng 9router, Herdr hay dịch vụ của người dùng; không xóa cache/dữ liệu để giảm tải.

```bash
bun run cli doctor
bun run cli validate workflows
bun run cli validate commands
bun --filter @anvil/web test:e2e e2e/system3-projects.test.ts
bun run type-check
bun run lint
bun run format:check
bun run test
```

Không chạy `bun test` trần từ root. Trước PR chạy `bun run validate`. Đổi bundled workflows/schema thì regenerate theo AGENTS.md; đổi API thì đồng bộ OpenAPI/Web types với server port 3090. Giữ kiểm tra SQLite/PostgreSQL nếu đổi persistence. UI phải xem render thật, không chỉ DOM/types.

Diff nhỏ theo task; giữ URL/lịch sử cũ và tránh migration không cần thiết. Khi lỗi đảo riêng diff mới; không reset worktree hoặc xóa dữ liệu. Không tự push/merge/deploy. Không đánh failed cho operation chỉ vì thua claim hoặc đoán timeout; trạng thái chưa rõ phải có hành động phục hồi rõ ràng.

## Tiến độ và bàn giao

### UI ngày 26/10/2026

| Task | Đã triển khai / bằng chứng | Giới hạn |
| --- | --- | --- |
| UI-0 | Snapshot diff nền `/tmp/anvil-ui-implementation-before-dd4sdn_1`; audit ảnh `/tmp/anvil-ux-audit-BOcUsr`; cập nhật contract 07 | Chưa có baseline toàn bộ thao tác của mẫu tổng hợp mới |
| UI-1 | Projection ưu tiên operation/blocker/Decision; completed comparison mở TW-07; legacy execution không bị hiểu là chưa chạy; giữ explicit selection khi poll | Không tự suy đoán operation đã chết |
| UI-2 | `/` mở danh sách dự án; workspace nằm trước rail; 6 phase/10 activity, lịch sử và kỹ thuật thu gọn | Giữ route cũ; không xóa dữ liệu/component |
| UI-3 | Mẫu tổng hợp 1.000 khách hàng, đủ Markdown/CSV/prompt/FR-01–03/harness. Self-check kiểm output đúng/sai/thiếu | Chỉ Python stdlib, CSV và JSON; không phải pipeline churn đầy đủ |
| UI-4 | Chọn 2–4 model từ catalog Pi/9router; retry catalog giữ draft; mẫu không cần nhập harness. Validation model rỗng/trùng/quá số lượng và retry tải mẫu đã kiểm tra | Tệp riêng vẫn cần prompt/IDs/harness trước khi tạo; catalog không bảo đảm provider nhận request |
| UI-5 | Bảng một hàng/model; code/output đúng model mở inline; Escape trả focus; nhãn kết quả cũ khi basis đổi | Chi phí/usage chưa biết; không tự chọn model thắng |
| UI-6 | `data_required` vẫn chặn đúng; baseline cũ đi hết luồng. Comparison Readiness v3 ghim config; Understanding/Compile/Execute không đòi target giả; kiểm tra hash và approval giữ nguyên | Chưa nghiệm thu restart HTTP giữa tiến trình hoặc hủy từng model qua UI |
| UI-7 | E2E offline 6/6; live Olist 1/1 (38,2 giây); hai model cùng input/prompt/harness hash, hai run/code riêng; Verify đạt 3/3 mỗi model. Archive chạy lại cả index 0/1 đều đạt, không gọi provider. Render thật 1280×900/390×844, không tràn ngang, hàng model đầu trong viewport; code/output inline, focus/scroll và nhãn stale đạt. Sau chỉnh compact, bốn test form/mẫu chạy lại đều đạt | Chưa kết luận giảm 30% tổng thao tác; chưa nghiệm thu 3–4 model |

Luồng mẫu: **Dùng bộ mẫu Olist → chọn LLM → Tạo dự án → Bắt đầu phân tích → chấp nhận Bản hiểu → Xem và phê duyệt kế hoạch → Phê duyệt và chạy → xem code/output → Yêu cầu bàn giao → Tải gói chạy lại**. Tạo dự án/chọn mẫu không khởi chạy model. Chỉ dùng hai model tiết kiệm đã cấu hình: `router9/cx/gpt-6-luna`, `router9/cx/gpt-5.6-luna`.

Thay đổi domain có chủ đích: contract v2 baseline giữ quy tắc target; contract v3 comparison chứa config đã xác thực từ Source Version. TW-02 xác minh config với bytes/hash ghim; Readiness và Compile kiểm tra cùng basis. Execute chỉ bỏ yêu cầu target đối với plan v3 có comparison đã ghim và được phê duyệt; kiểm tra runtime, nguồn, capability và Approval Manifest vẫn áp dụng. Không đưa logic Olist vào runtime.

Bằng chứng live nằm trong namespace thử riêng `/tmp/anvil-ui-tests-fcigfosb/data`, không tạo test vào dữ liệu sử dụng:

- Project `ac8b973b-0d38-43a9-a294-9fa4ae9922c6`; Verification `ff83e03a-cf4f-464c-a657-9bafbe59a579`.
- Run `eac9b42fa84ef5fc047abc1b9d843a92` và `083bef1e7bcedc5cd35a5e6daa0ebea9`; chung input hash `sha256:c4a3841c37bebd97e51428be0aee149305a59be8f4bb0f8c9f7e7aacc55382ba`.
- Ảnh/gói: `/tmp/anvil-ui-olist-live-results-3`; bản giải nén mới: `/tmp/anvil-olist-reproduce-pyf0_gn3/generated_project`; report hash/check: `/tmp/anvil-ui-olist-evidence.json`. Đây là bằng chứng local tạm thời, không phải artifact đã publish.
- Web unit tests: 467 đạt; System 3: 140 đạt, gồm ba test sandbox có opt-in; năm nhóm backend liên quan: 19 đạt. Type-check Web/System 3/server đạt. Lint các source đổi đạt, zero warnings; format source/fixture, build production Web, self-check harness, relative links và `git diff --check` đạt. Build ghi vào thư mục tạm, không publish. Không chạy lại toàn bộ `bun run validate` hoặc tạo PR.

Số đo UI có thể đối chiếu trên project cũ `ea1ca793-0851-41ad-99c4-acd2cf543fc6`: trước mở mặc định OP-08 và phải chọn activity có kết quả; sau mở thẳng TW-07. Code/output có nút riêng ngay tại hàng model. Audit cũ chưa ghi đủ click/cuộn cho toàn bộ luồng mẫu mới, nên không công bố mức giảm phần trăm tổng thao tác.

Ảnh cuối `/tmp/anvil-ui-final-render-LeC8AE`: bảng kết quả của cùng project cũ bắt đầu ở y≈449 desktop và y≈620 mobile; giữ đúng 6/10, không tràn ngang hoặc lỗi JavaScript. Form mẫu với hai LLM đã cấu hình có nút Tạo dự án ở y≈796 desktop và y≈792 mobile (cao 40px, trong viewport 390×844); không phải cuộn tìm nút trong tình huống này. Phần giải thích lặp đã bỏ, model trên mobile nằm hai cột. Không áp số đo này cho catalog dài hoặc thông báo lỗi mở rộng.

### Giảm thao tác và làm mới giao diện — 26/10/2026 (đợt 2)

Luồng mẫu còn: **Dùng bộ mẫu Olist → Tạo và bắt đầu phân tích → Chấp nhận Bản hiểu → Phê duyệt và chạy → Tạo và tải gói kết quả** (trước: 10 thao tác, gồm Bắt đầu phân tích, Xem và phê duyệt kế hoạch, Yêu cầu bàn giao tách riêng). Không đổi mapping 6/10, approval, Evidence hay gate bàn giao; mỗi bước vẫn do người dùng bấm.

| Thay đổi | Ghi chú |
| --- | --- |
| Form tạo dự án: thẻ chọn bộ mẫu/tệp riêng, ô chọn tệp, nút chính **Tạo và bắt đầu phân tích**; giữ **Chỉ tạo dự án** | Chờ cổng Intake (OP-00/OP-01) tối đa 30 giây; Intake lỗi thì mở workspace tại blocker, không gọi TW-02 |
| Thanh tiến độ 5 bước (Nguồn, Phân tích, Duyệt kế hoạch, Chạy & kiểm tra, Kết quả) trên workspace | Chỉ là nhóm trình bày của 6 phase (`journey.ts`) |
| OP-05: kế hoạch hiện ngay trong workspace, nút **Phê duyệt và chạy** trực tiếp; dialog vẫn mở qua **Xem chi tiết kế hoạch** | Trang Quyết định & Phê duyệt giữ nguyên |
| Comparison đã Verify: **Tạo và tải gói kết quả** gộp OP-08 + tải gói | Gate OP-08 vẫn kiểm tra ở backend |
| TW-02: trạng thái chờ/đang phân tích thay hộp lỗi; tóm tắt mục tiêu/yêu cầu trước **Chấp nhận Bản hiểu** | Projection không còn báo "Chưa bắt đầu" khi đã có bản nháp chờ duyệt |
| Danh sách dự án: trạng thái tiếng Việt + việc tiếp theo (`project-card.ts`); bảng kết quả có màu đạt/chưa đạt | Token `--s3-*`, sáng/tối |
| Sửa lỗi: chọn operation mới nhất khi trùng giây; `REPRODUCING.md` khi chạy lại chỉ bàn giao gây `EEXIST` | Test hồi quy trong `store.test.ts`, `capabilities.test.ts` |

Kiểm chứng: Web unit 124/323/26 đạt; System 3 137 đạt; type-check Web/System 3, lint, Prettier, `git diff --check` đạt. E2E offline trên server cô lập (`ANVIL_HOME` tạm, cổng 3191/5199): minimal-ui 2/2, samples 2/2, projects 3/3 (@core đi qua phê duyệt inline), source-intake 1/1. Chưa chạy live 9router (`@olist-live` đã cập nhật nhãn và luồng tải gói) và chưa chạy `bun run validate` toàn repo.

### Luồng nền ngày 16/10/2026

| Task | Trạng thái kiểm chứng ngày 16/10/2026 | Bằng chứng/còn lại |
| --- | --- | --- |
| S0 | Môi trường local chạy được | Bun 1.3.11; server loopback 3090, Web Playwright; root test/type-check chạy tuần tự. Chưa đạt toàn bộ `validate` |
| S1 | Hai model thật qua Anvil/Pi/9router | `router9/cx/gpt-6-luna`, `router9/cx/gpt-5.6-luna`; schema code được xác thực. Streaming rồi hủy đạt; timeout 500ms kết thúc aborted; usage/chi phí ghi chưa biết |
| S2 | Luồng cơ bản đã chạy đầu-cuối | `@core` đạt 1/1 (37,5s); 10 kiểm tra backend đạt, 62 assertions; claim/idempotency và Evidence của Verify thất bại được kiểm tra. Chưa nghiệm thu HTTP restart giữa tiến trình |
| S3 | Một form và workspace; render thật desktop/390px | E2E thiếu dataset đạt 1/1 (24,5s); `@core` và `@comparison` đạt. Giữ 6 phase/10 activity, resource inline, lịch sử thu gọn. Chưa đo đủ số thao tác trước/sau |
| S4 | Hai LLM thật trên cùng input đã chạy | Project thử `ea1ca793-0851-41ad-99c4-acd2cf543fc6`: hai run riêng, code/output hash riêng, chung input/prompt/harness hash; chưa nghiệm thu 3–4 model hoặc hủy qua UI từng model |
| S5 | Shared harness và Verify độc lập chạy thật | Hai model đều đạt FR-01; `@comparison` đạt 1/1 (1,5 phút). 22 kiểm tra contract/compiler/sandbox đạt, 86 assertions, gồm output bị sửa, requirement thiếu, model lỗi không cản model sau, sandbox timeout/abort/overflow |
| S6 | Gói live đã tải, giải nén và chạy lại | Hai lần `sh reproduce.sh 0` / `sh reproduce.sh 1` đều đạt FR-01 ở thư mục mới, không gọi provider. Script mới trả mã lỗi nếu harness thiếu requirement hoặc check thất bại. Archive traversal/link/byte/file/count có guard. Chưa khóa chính xác Python patch version hoặc xuất toàn bộ Approval Manifest trong gói |
| S7 | Đã kiểm kê phần có thể hoãn; chưa xóa | Các mục dưới đây vẫn có caller; chỉ thu gọn bề mặt, không kết luận file/dependency thừa |

Luồng live dùng CSV thử 4 dòng và bài toán đếm số dòng, không chứng minh giải được bài toán tùy ý. Input hash chung: `sha256:9cc40495bf9ee6851a84813d10c7db8969990316c3e7974cfd975d9638e57b20`. Hai Workflow Run: `fdb5b268d95ecd99175ebc5374a2faad` và `b8397c6c430a163e1144d616959d8c51`. Report nguồn sự thật nằm trong Verification và `comparison.json` của gói; không dùng trường provider metadata làm bằng chứng gọi LLM.

### Giới hạn bản đầu đang chạy

- 2–4 model được cấu hình; thực thi tuần tự để phù hợp VPS. Model sinh Python dùng thư viện chuẩn; đọc CSV ghim tại `/work/input.csv`, xuất JSON. Người dùng cung cấp harness và requirement IDs, không tự bịa tiêu chí đạt.
- Chỉ hỗ trợ chạy toàn bộ. Impact dẫn đến full execution được chấp nhận; experiment/delivery-only và reuse output không hỗ trợ trong comparison.
- Sandbox Linux cần systemd và bubblewrap >= 0.9; thiếu dependency thì báo lỗi, không fallback chạy code trên host. Đã cài bubblewrap 0.9.0 trên VPS. Solution và harness chạy riêng, không mạng, UID 65534, RAM 256 MiB, một CPU, 16 process, 30 giây mỗi bước, output tối đa 64 KiB/stream. Gọi LLM timeout 60 giây.
- Code/output riêng nằm trong gói bất biến; renderer hiện có đã có preview theo hash và Verification; E2E desktop/390px đạt, đã xem code/output thật. Usage/chi phí chưa biết; chưa có hard cap tiền. Giới hạn token theo cấu hình Pi của từng model.
- Compiler/readiness vẫn dựa trên template lịch sử và kiểm tra blueprint/target. Chưa thể coi đây là hỗ trợ mọi bài toán/language/dependency.

### S7 — Thu gọn tiếp sau nghiệm thu

| Phần | Caller hiện tại và đề xuất |
| --- | --- |
| Bốn tab kỹ thuật trong `System3App.tsx` | Vẫn phục vụ audit/run; giữ sau Chi tiết kỹ thuật, không đặt trên đường so sánh chính |
| CTA baseline/Customer Churn/13 requirements | Vẫn cần cho project cũ; nội dung comparison phải theo plan, không gắn giới hạn baseline vào model mode |
| Builder và workflow links | Vẫn có caller từ WorkflowsPage/ProjectRail/Technical Console; giữ ngoài đường bắt đầu, không xóa route |
| Form model/prompt/requirement/harness | Đã có disclosure; giữ validation và harness, chỉ tiếp tục giảm lựa chọn khi có mặc định đúng cho bài toán thực tế |
| Explainability/SHAP và adapter mở rộng | Hoãn mở rộng. Không thêm bước vào lifecycle hoặc dependency mới cho core comparison |

### Lệnh và bằng chứng gần nhất

- Live UI: `ANVIL_LIVE_9ROUTER=true bun run test:e2e e2e/system3-projects.test.ts --grep '@comparison' --workers=1`; log `/tmp/anvil-comparison-e2e-0406.log`.
- Sandbox/contract/compiler: `ANVIL_SANDBOX_TESTS=true bun test packages/system3/src/python-sandbox.test.ts packages/system3/src/model-comparison.test.ts packages/system3/src/model-comparison-runner.test.ts packages/system3/src/compiler.test.ts`; log `/tmp/anvil-comparison-final-integration.log`.
- Backend regression: ba file `system3-operation-reliability.integration.test.ts`, `system3-understanding-activation.integration.test.ts`, `system3-execute-request.test.ts`; log `/tmp/anvil-server-core-regression-final.log`.
- 9router interrupt: `/tmp/anvil-provider-live-interrupt-report.json`; hủy sau chunk đầu kết thúc sau 3369ms, timeout 500ms kết thúc sau 512ms; đều aborted/error, không completed. Đây là đường Anvil/Pi; chưa phải kiểm tra nút hủy từng model trên Web.
- Reproduction: archive được kiểm tra bằng `extractProjectArchive`, chạy trong `/tmp/anvil-comparison-reproduce-hc6dKZ/project`; log `/tmp/anvil-reproduction-live.log`.
- Server/Web type-check cuối đạt (`/tmp/anvil-server-types-m2-renderer-final.log`, `/tmp/anvil-web-types-m2-last.log`). Lint các file implementation đã đổi đạt sau sửa optional-chain; formatter đã chạy trên diff và `git diff --check` đạt.
- Package System 3: 134 tests/475 assertions đạt (`/tmp/anvil-system3-full-tests-final.log`); Web domain: 13 tests/33 assertions đạt. Reproduction/renderer/archive: 10 tests/47 assertions đạt, gồm script trả mã lỗi khi check thất bại.
- Viewer trên dữ liệu live: `@comparison-preview` đạt 1/1 (16,9s), code/output hiện trong cùng workspace ở desktop/390px; Escape/focus restoration/URL và không tràn ngang đạt. Đã sửa CSS grid co vùng Markdown về 0px. Log `/tmp/anvil-comparison-preview-e2e-layout.log`, ảnh `/tmp/anvil-comparison-inline-desktop.png` và `/tmp/anvil-comparison-inline-390px.png`.
- `bun run test` toàn repo chạy tuần tự dừng tại 76 test ClaudeProvider do guard UID 0. Chạy riêng cùng file bằng user `nobody`: 90/90 tests, 169 assertions đạt (`/tmp/anvil-claude-nonroot-tests.log`), không thay guard hoặc đặt IS_SANDBOX giả. Chưa chạy lại toàn bộ suite dưới user thường; full `validate` chưa đạt, vẫn là gate trước PR.
- Khôi phục đủ 5 phiên Luna medium, tối đa 2 agent nhận việc; cuối lượt tất cả chờ. Agent cuối gặp quota 9router 429/503 nên đã ngắt retry, root kiểm tra và hoàn tất diff của agent. Không tự nâng model. `btop` vẫn mở; các kiểm tra nặng được khóa tuần tự, không dừng dịch vụ của người dùng.

Mỗi cập nhật bổ sung: diff/commit, lệnh và kết quả, giới hạn/blocker, bước tiếp theo. Agent dùng **GPT-6-Luna medium**, không tự nâng model hoặc tạo thêm agent. Điều phối review diff/test trước nghiệm thu.

[← Mục lục docs](../README.md) · [Tài liệu kỹ thuật](README.md)
