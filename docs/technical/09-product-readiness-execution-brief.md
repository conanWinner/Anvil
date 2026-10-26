# Anvil — Execution Brief: từ baseline chạy được đến sản phẩm dùng thật

Phiên bản kế hoạch: **1 — 07/09/2026**. Trạng thái: **đã lập kế hoạch; chưa triển khai các task dưới đây**.

> **Backlog cũ, đã thay bằng [kế hoạch 11](11-simplification-and-core-flow-plan.md).** Giữ để đối chiếu quyết định và baseline ngày 07/09/2026; trạng thái task bên dưới không phải tiến độ hiện tại.

Đọc cùng [báo cáo hiện trạng và bằng chứng](08-product-readiness-audit.md). Tài liệu này dành cho tab **Sol medium** tiếp tục công việc; không cần gọi lại Astra. Không suy ra rằng lựa chọn model trong tài liệu tự thay đổi model của tab.

## 1. Mục tiêu và phạm vi

Một người dùng có thể cài Anvil, kết nối repo, đưa nguồn vào System 3, xem/điều chỉnh Bản hiểu, giải quyết Decision, duyệt kế hoạch chính xác, chạy trong môi trường được cô lập, kiểm chứng kết quả và nhận gói có thể dựng lại. Khi đầu vào chưa đủ, yêu cầu chưa hỗ trợ hoặc kiểm chứng thất bại, sản phẩm phải nói rõ và chặn đúng bước; không chuyển sang “hoàn tất” chỉ vì một script thoát với mã 0.

Phạm vi đề xuất cho bản phát hành đầu tiên: **Anvil single-developer + một Product Workflow Template Customer Churn có hợp đồng rõ ràng**, vận hành chính qua Web/API, giữ khả năng CLI và các adapter của nền tảng. “Một template” không cho phép bỏ qua yêu cầu bắt buộc thuộc phạm vi đã chấp nhận.

Chưa mặc định đưa vào phạm vi: mọi loại dự án tùy ý, mọi mô hình ML, mọi provider/adapter được chứng nhận tương đương, tự merge/push/deploy, multi-tenant, huấn luyện phân tán hoặc nâng cấp lớn giao diện ngoài System 3. Nếu người dùng muốn những phần này, ghi thành quyết định và milestone riêng; không âm thầm coi chúng đã có.

Không thay toàn bộ runtime hay viết lại monorepo. Giữ ranh giới System 3 Control Plane với Anvil Workflow Runtime; không đưa dataset/churn/experiment policy vào `packages/workflows`.

## 2. Điểm xuất phát và quyền thực hiện

- Baseline: `dev`, HEAD `0ac0c56ab04eeca87aec8d3a11cb3a0179512752`, **cộng thay đổi chưa commit** nêu trong báo cáo. Đọc lại `git status --short` và `git diff`; giữ nguyên công việc có trước.
- Đã kiểm chứng: toàn bộ `bun run test` đạt; System 3 82 test đạt; một E2E SQLite xuyên suốt đạt hai lần. Type-check đạt. Release validation còn hai lỗi lint.
- Chưa kiểm chứng: PostgreSQL runtime/migration, provider/adapter thật, recovery/multi-process, chất lượng model thực tế, tái tạo gói ở môi trường sạch.
- Không xóa dữ liệu, artifact, branch hay worktree; không reset hoặc format. Recovery ưu tiên tạo attempt/record mới và giữ lịch sử. Cleanup là hành động riêng cần xác nhận mục tiêu.
- Bản kế hoạch local không tự cấp quyền tạo/sửa Notion, Linear, PR, commit, push hoặc deploy. Khi được phép xuất bản: Notion giữ brief/decision; Linear giữ task/dependency/evidence; Git giữ code. Không nhân bản toàn bộ brief vào từng issue.
- Bắt đầu bằng T01 và các kiểm tra an toàn đã rõ. Các thay đổi về phạm vi/metrics/provider tính phí chờ quyết định ở T00; không tự chọn thay người dùng.

## 3. Những quyết định cần chốt (T00)

1. **Phạm vi đầu ra:** xác nhận Customer Churn là template đầu tiên; lập danh sách requirement được hỗ trợ. Blueprint vượt khả năng template phải bị báo unsupported hoặc yêu cầu điều chỉnh phạm vi, không được âm thầm rơi về majority baseline.
2. **Dữ liệu và nghiệm thu:** dataset được phép sử dụng; target, positive class, thời điểm dự đoán, cách chia train/validation/test, metric và ngưỡng chấp nhận. Không tự đặt “accuracy ≥ 90%”, mặc định target tên `target`, hay dùng dữ liệu nhạy cảm.
3. **Vận hành:** ưu tiên local/SQLite hay cần PostgreSQL ngay; provider và kênh thực tế nào phải được nghiệm thu; ngân sách cho một smoke test AI có giới hạn.

Giả định lập kế hoạch: bắt đầu local/SQLite, CPU, một template và dữ liệu thử được cho phép; live provider/chi phí chưa được nghiệm thu trong audit. Đây là đề xuất, không phải quyết định đã được người dùng phê duyệt.

## 4. Milestone và điều kiện thoát

| Mốc | Nội dung | Điều kiện thoát |
| --- | --- | --- |
| M0 — Baseline kiểm chứng được | T00–T01 | Phạm vi/điều chưa chốt rõ ràng; worktree được bảo toàn; validate xanh. |
| M1 — Lifecycle đáng tin cậy | T02–T09 | Đúng nguồn và DAG đã duyệt; gate/retry/replay không sai; không ghi đè lịch sử; tests DB/concurrency tương ứng đạt. |
| M2 — Kết quả thực có thể nghiệm thu | T10–T13 | Build theo hợp đồng template; experiment đúng phương pháp; từng yêu cầu bắt buộc có Evidence; gói dựng lại độc lập được. |
| M3 — Sẵn sàng giao cho người dùng | T14–T16 | UX desktop/mobile được xem thật; môi trường hỗ trợ được nghiệm thu; cài đặt/recovery/tài liệu/kiểm thử phát hành hoàn tất. |

M1 có thể bàn giao như bản alpha baseline có giới hạn. Không gọi M1 là đã hoàn thiện toàn bộ sản phẩm. Không công bố phần trăm hoàn thành khi T00 chưa chốt danh sách yêu cầu.

## 5. Task có thể đưa vào Linear

Các mã T00–T16 là mã kế hoạch local, **chưa phải issue ID trên Linear**. Mỗi task khi thực hiện phải ghi code diff, test đã chạy, kết quả, giới hạn còn lại; chỉ đánh Done khi đủ điều kiện nghiệm thu. Mức model là gợi ý cho công việc, không tự cấp quyền tạo sub-agent.

### T00 — Chốt hợp đồng bản phát hành và tiêu chí nghiệm thu

- Ưu tiên: P0. Phụ thuộc: không. Thực hiện: Sol medium cùng người dùng.
- Đầu ra: decision log trả lời ba nhóm câu hỏi ở mục 3; ma trận requirement → hỗ trợ/không hỗ trợ → phép kiểm tra → người xác nhận.
- Nghiệm thu: phân biệt rõ alpha baseline với sản phẩm R1; mỗi yêu cầu bắt buộc có tiêu chí đo được; phần chưa rõ tiếp tục là Decision, không được agent tự trả lời.
- Không chặn T01 và việc viết regression test cho các invariant an toàn đã rõ. Chặn cam kết chất lượng ở T10–T13 khi chưa có phạm vi phù hợp.

### T01 — Khôi phục release validation và khóa baseline bàn giao

- Ưu tiên: P0. Phụ thuộc: không. Model phù hợp: Terra medium hoặc Sol medium.
- Khu vực: `LifecycleAttemptBar.tsx`, root validation, worktree hiện tại.
- Công việc: sửa hai cleanup callback thiếu kiểu trả về tại dòng 63/74; rà soát diff hiện có và migration `032–034`, không bỏ qua file untracked; không disable lint hoặc đổi test để né lỗi.
- Nghiệm thu: `NODE_OPTIONS=--max-old-space-size=4096 bun run validate` exit 0; lưu baseline và output tóm tắt; `git diff --check` đạt. Chỉ commit/push nếu được phép riêng.
- Rollback: revert riêng thay đổi của task; không khôi phục cả file về HEAD vì sẽ mất công việc có trước.

### T02 — Ghim định nghĩa thực thi đúng với Approval Manifest

- Ưu tiên: P0. Phụ thuộc: T01. Model phù hợp: Sol high.
- Khu vực: `compiler.ts`, `templates.ts`, `contracts.ts`, execution/verify/delivery routes và persistence.
- Công việc: tạo plan và bundle DAG từ cùng nguồn định nghĩa; lưu/hash định nghĩa và basis thực thi, node order, capability/schema versions, permissions, timeout và runtime profile. Loại sai lệch TW-02 năm node cũ và workflow delivery gộp cũ.
- Nghiệm thu: sửa definition/capability/source sau phê duyệt không làm request cũ chạy âm thầm trên bản mới; replay thực thi đúng basis hoặc báo không còn runtime tương thích. Test so sánh DAG đã duyệt với DAG thực chạy cho full/experiment/delivery, không chỉ snapshot tên node.
- Bằng chứng: unit compiler/template + API integration approve/execute/tamper; không phá phiên bản lịch sử. Migration nếu cần phải có đường đọc legacy rõ ràng.

### T03 — Dùng đúng Source Version trong mọi chế độ chạy và reuse

- Ưu tiên: P0. Phụ thuộc: T02. Model phù hợp: Sol high.
- Khu vực: `capabilities.ts`, source port ở API, scaffolder/materializer, `templates.ts`, artifact lineage.
- Công việc: thay resolve `readLatestSource` trong Build bằng nguồn đã ghim từ approval/attempt; kiểm tra hash tại lúc đọc. Reuse code khác reuse data/results: áp dụng input/config mới đã duyệt khi chạy lại experiment; chỉ reuse kết quả khi dependency basis tương đương.
- Nghiệm thu: duyệt dataset A, upload B trước/lúc node chạy → execution chỉ dùng A hoặc fail closed có giải thích. Rerun với B thật sự tạo báo cáo hash/số dòng của B, không lấy lại `data/input.csv` của archive A. Full/replay/current/experiment/delivery đều có test đúng nguồn và giữ nguyên artifact A.
- Bằng chứng: regression cấp capability và API SQLite với hai dataset phân biệt rõ kết quả; không dựa riêng vào fixture mock `readLatestSource`.

### T04 — Hoàn thiện Readiness và Decision theo snapshot

- Ưu tiên: P0. Phụ thuộc: T01. Model phù hợp: Sol high.
- Khu vực: readiness schemas/capabilities, `saveReadinessContract`, routes và UI blocker.
- Công việc: đánh giá requirements, extraction quality, target, dataset/profile, runtime/capability theo activity cần chạy; trả trạng thái/lý do như `data_required`. Đếm Decision đúng active/selected Knowledge Snapshot, không trộn candidate/lịch sử.
- Nghiệm thu: Understanding thiếu dataset vẫn tạo candidate; công việc cần data không được ready khi thiếu dataset/target. Pending của snapshot lịch sử không chặn active hợp lệ; active pending thì chặn. Input/snapshot thay giữa check và save không ghi được contract sai basis.
- Bằng chứng: bổ sung regression cho trường hợp audit `dataset:null + 1 requirement + 0 pending`, API transaction tests và UI next action.

### T05 — Idempotency, request đồng thời và recovery có chủ sở hữu

- Ưu tiên: P0. Phụ thuộc: T02, T04. Model phù hợp: Sol high.
- Khu vực: mutating routes, operation store, unique constraints, activity state transitions.
- Công việc: lập ma trận mọi OP/TW action; resolve same-key/same-payload trước optimistic-version rejection khi thích hợp. Same key khác payload phải conflict. Đặt claim/commit trong transaction; request lặp không sinh duplicate run/version/artifact.
- Nghiệm thu: hai request đồng thời chỉ tạo một operation; retry sau thành công trả cùng kết quả; crash trước/sau write/commit có đường recover rõ; restart không tự đánh failed cho công việc có thể chạy ở tiến trình khác.
- Bằng chứng: test HTTP + DB thật với barrier điều khiển race, fault injection ở điểm commit, không dùng sleep/staleness để thay thế kiểm chứng ownership. Recovery không xóa lịch sử hay overwrite input.

### T06 — Hợp đồng CSV và giới hạn bộ nhớ xuyên suốt

- Ưu tiên: P1. Phụ thuộc: T01. Model phù hợp: Terra medium; nâng Sol high nếu thay streaming contract.
- Khu vực: `understanding/dataset-profiler.ts`, baseline dataset validator và generated data reader.
- Công việc: thống nhất semantics CSV header/quoted fields/newlines/BOM/encoding; lỗi cột trùng hoặc malformed phải được giải thích. Đặt giới hạn cardinality, row hashing, dữ liệu lớn; nếu dùng thống kê ước lượng phải gắn nhãn.
- Nghiệm thu: cùng file cho kết quả row/column nhất quán ở Intake/Understanding/Build; không âm thầm rename làm đổi target. Có fixture quoted header, multiline, missing value, duplicate header, nhiều giá trị distinct và đo peak memory trong giới hạn đã chốt.
- Bằng chứng: test parser/validator dùng cùng fixture và ít nhất một execution Python; quá giới hạn bị chặn có báo cáo, không OOM không rõ nguyên nhân.

### T07 — Hoàn thiện chất lượng Bản hiểu và áp dụng Decision

- Ưu tiên: P1. Phụ thuộc: T04, T06. Model phù hợp: Sol medium.
- Khu vực: `understanding/`, source pointers/reports, decision resolution, Knowledge Snapshot activation.
- Công việc: ma trận MD/JSON/PDF/unsupported; requirement coverage và nguồn dẫn rõ ràng. Sau chọn/đổi target, tạo projection/profile phù hợp với dataset đã ghim; không chỉ đổi nhãn target trên một distribution cũ.
- Nghiệm thu: tài liệu thiếu/mâu thuẫn/không hỗ trợ không báo đã hiểu đầy đủ; trích xuất có pointer mở được; candidate không đổi active cho tới activation hợp lệ; Decision không ghi đè lịch sử hoặc tự tạo acceptance criterion mang nghĩa đã duyệt.
- Bằng chứng: fixtures có expected facts/quality/decisions và test activate/change-source race; ít nhất một blueprint được người dùng đối chiếu, không chỉ fixture dễ đọc.

### T08 — Lifecycle Attempt và migration trên DB/isolation thật

- Ưu tiên: P0 trước dùng rerun thực tế. Phụ thuộc: T03, T05. Model phù hợp: Sol high.
- Khu vực: migrations `032–034`, SQLite/PG schema setup, attempt store/routes, `@anvil/git`/isolation.
- Công việc: kiểm chứng tạo attempt từ commit/basis xác định, replay/current, activity/downstream, continue và trạng thái chưa merge. Bảo toàn nguồn/artifact cũ; failure khi tạo môi trường để lại trạng thái recovery có thể hiểu được.
- Nghiệm thu: hai attempt có working path/branch và lineage riêng; replay dùng nguồn lịch sử; current ghim nguồn tại lúc tạo; run không sửa live checkout. Không tự merge hoặc xóa worktree. Cleanup preview/chặn run đang sống cần test bằng spy/fixture an toàn, không dùng dữ liệu của người dùng.
- Bằng chứng: DB integration + Git repo tạm + API/E2E tạo attempt thật (không dừng ở preview). Nâng cấp DB cũ và khởi động lần hai vẫn giữ lịch sử/constraints.

### T09 — Bảo đảm quyền, hủy và ngân sách của AI fallback

- Ưu tiên: P0 trước bật cho nguồn không tin cậy; nếu tắt AI thì P1. Phụ thuộc: T02, T07. Model phù hợp: Sol high.
- Khu vực: `createUnderstandingSemanticFallback`, provider adapters/capabilities, usage/provenance records.
- Công việc: kiểm tra semantics no-tools ở provider được hỗ trợ; ghép signal hủy và timeout; giới hạn tổng attempts/tokens/cost theo operation; ghim provider/model/prompt/schema/policy basis. Thiếu khả năng enforce thì fail closed hoặc dùng deterministic path có giải thích.
- Nghiệm thu: prompt injection từ source không cấp tool/quyền; hủy activity dừng request; retry không vượt budget đã chốt; usage thiếu phải ghi unknown, không ghi 0 giả. Không lưu secret trong prompt/report/log.
- Bằng chứng: contract tests per-provider, mock malicious/timeout/budget; harness E2E có provider giả lập hoặc chế độ deterministic rõ ràng, không tự dùng credential môi trường. Tách smoke test thật có giới hạn, chỉ chạy sau khi người dùng cho phép provider và chi phí.

### T10 — Build thực hiện hợp đồng template được duyệt

- Ưu tiên: P0 cho R1. Phụ thuộc: T00, T02, T03, T04. Model phù hợp: Sol high.
- Khu vực: System 3 template/capabilities, generated project contracts, compilation UI.
- Công việc: chuyển từ bộ file cố định không phụ thuộc requirement sang implementation của template đã chấp nhận. Với phạm vi deterministic, mapping requirement/module/output phải rõ; với provider-generated code, phải là execution plan có policy và verification tương ứng, không gọi AI ngầm.
- Nghiệm thu: hai blueprint có khác biệt nằm trong phạm vi hỗ trợ tạo output khác biệt đúng hợp đồng; yêu cầu ngoài template bị chặn/Decision trước approve. Danh mục output và command chạy được ghi trong plan; code generate có test, không chỉ folder trống hoặc TODO giả.
- Giữ majority baseline làm phép so sánh hợp lệ, không dùng nó thay cho toàn bộ công việc được phê duyệt.

### T11 — Experiment có giá trị đánh giá thực tế

- Ưu tiên: P0 cho R1. Phụ thuộc: T00, T06, T10. Model phù hợp: Sol high.
- Khu vực: generated training/evaluation pipeline và System 3 experiment contracts.
- Công việc: thực hiện split phù hợp dữ liệu/time/group, preprocessing fit trên training, model/prediction artifact, metric/positive class theo quyết định, seed và dependency locks. Không chọn model bằng test set.
- Nghiệm thu: metric ngoài mẫu; có majority baseline so sánh và mô hình thuộc phạm vi được chấp nhận; leakage guards; cùng input/config/seed tái lập trong tolerance định trước. Không bảo đảm mô hình thắng baseline; nếu không đạt ngưỡng phải thể hiện thất bại thật.
- Bằng chứng: fixture bắt leakage, multiclass/binary nếu được hỗ trợ, bất cân bằng/nhãn thiếu; báo cáo trên dataset được cho phép và manifest của split/config/model.

### T12 — Verification độc lập theo requirement và gate bàn giao

- Ưu tiên: P0 cho R1. Phụ thuộc: T00, T10, T11. Model phù hợp: Sol high.
- Khu vực: TW-07, evidence schemas/builders, G5, OP-08 và presentation.
- Công việc: requirement → validator → observed result → Evidence có lineage. Verify đọc artifact đã ghim và chạy phép kiểm độc lập cần thiết, không chỉ tin `status: passed` từ bước build.
- Nghiệm thu: sửa artifact, thiếu required file, metric dưới ngưỡng hoặc requirement chưa verified thì không được bàn giao như sản phẩm hoàn chỉnh. Scope exception nếu có phải là quyết định rõ ràng được duyệt; không hard-code tất cả requirement nằm ngoài scope.
- Bằng chứng: positive/negative/tamper tests; Evidence Map nêu verified/failed/not_verified và phương pháp cho từng yêu cầu; báo cáo completion không đồng nhất workflow success với product acceptance.

### T13 — Gói bàn giao dựng lại được và giải nén an toàn

- Ưu tiên: P0 cho R1. Phụ thuộc: T03, T08, T12. Model phù hợp: Sol high.
- Khu vực: packager/materializer, delivery manifest, download và reproduction instructions.
- Công việc: pin source/plan/approval/runtime/schema/validator/code/dependency/split/model lineage cần thiết; giữ các hash/size đã có. Kiểm tra archive paths, symlink/hardlink và giới hạn giải nén trước materialize; không chỉ kiểm tên có `..`.
- Nghiệm thu: tải gói, đưa vào môi trường sạch không có thư mục runtime cũ, chạy lệnh README và tái tạo kết quả trong tolerance. Mọi nguồn cần mà không được phép đóng gói phải được khai báo cùng cách cung cấp/check hash; gói không chứa secret.
- Bằng chứng: offline reproduction test khi hợp đồng cho phép; corrupted archive/path/link fixtures bị từ chối; delivery-scoped rerun giữ Evidence/source lineage đúng, không “làm mới” bằng việc đổi nhãn.

### T14 — Hoàn thiện UX tác vụ và tài nguyên dễ đọc

- Ưu tiên: P1. Phụ thuộc: T04, T07, T08, T12. Model phù hợp: Terra medium hoặc Sol medium.
- Khu vực: `UnderstandingWorkspace`, `ResourceViewer`, `System3App`, `LifecycleAttemptBar`, activity projections.
- Công việc: câu hỏi Decision có tiêu đề cụ thể, lựa chọn/hệ quả/source rõ; không đổ JSON nguồn vào phần chính. Giảm lặp status/cards và chiều dài trên mobile, nhưng không giấu Inputs/Outputs/Evidence sau nhiều tab. Phân biệt baseline pass với requirement verified.
- Nghiệm thu: đúng 6 phase/10 activity; mọi resource mở inline và giữ route/scroll/focus; lỗi/unsupported friendly-first; keyboard/reduced-motion; attempt history và blocker có next action đúng. Xem thật desktop/mobile với dữ liệu nhiều Decision/artifact và ghi nhận ảnh trước/sau.
- Bằng chứng: unit, E2E và visual inspection; DOM assertion hoặc screenshot chưa được xem không đủ hoàn thành.

### T15 — Nghiệm thu môi trường, DB, provider và vận hành

- Ưu tiên: P0 cho môi trường cam kết hỗ trợ. Phụ thuộc: T01–T14 và các lựa chọn T00. Model phù hợp: Sol high cho DB/recovery; Sol medium cho runbook/smoke.
- Khu vực: CI, migrations, installation/CLI, server startup, provider/adapter, backup/restore, runtime logs.
- Công việc: ma trận clean install + upgrade + restart cho SQLite, và PostgreSQL nếu công bố hỗ trợ; Python/tar/Bun/dependencies preflight. Chạy provider/kênh thật đã được cho phép, xử lý thiếu credential và mất kết nối rõ ràng.
- Nghiệm thu: fresh setup qua tài liệu không cần sửa DB thủ công; backup/restore được thử vào DB mới riêng biệt; timeout/cancel/ambiguous-owner có hành động khôi phục; logs liên kết operation/run/attempt mà không lộ secret.
- Bằng chứng: CI/terminal logs, E2E lifecycle + negative cases và smoke matrix. Không thử restore đè database người dùng; môi trường chưa test phải ghi chưa chứng nhận thay vì gắn nhãn production-ready.

### T16 — Đồng bộ tài liệu, bằng chứng và bàn giao release

- Ưu tiên: P1. Phụ thuộc: T15. Model phù hợp: Sol medium; Luna medium có thể rà link nếu delegation được phép.
- Khu vực: `/docs`, README/runbooks, Notion/Linear khi được phép, release checklist.
- Công việc: cập nhật hiện tại/thiết kế đích theo code đã nghiệm thu; gắn issue/PR/test/evidence vào từng task. Không ghi lại audit lịch sử thành kết quả mới; thêm ngày/baseline báo cáo tiếp theo. Đồng bộ Notion TW-02 bằng thay đổi có phạm vi, giữ lịch sử.
- Nghiệm thu: người khác đọc brief rồi cài/chạy/khôi phục theo hướng dẫn; không còn link mồ côi; tất cả P0 của phạm vi release Done với Evidence; known limitations công khai. Validate/test/E2E trên đúng commit dự định phát hành đạt.
- Chỉ commit/push/PR/release/deploy khi có quyền tương ứng. Kế hoạch hoàn thành không đồng nghĩa phần mềm đã triển khai lên máy người dùng.

## 6. Thứ tự điều phối đề xuất

1. Sol medium đọc AGENTS, báo cáo và toàn bộ brief; đối chiếu live worktree, báo drift quan trọng.
2. Làm T01; song song về mặt kế hoạch có thể chốt T00. Sau đó T02 → T03 và T04 → T05; các task này dễ đụng cùng `api.ts`/`store.ts`, mặc định triển khai nối tiếp để tránh xung đột.
3. T06 → T07; sau đó T08/T09 theo dependency. Chốt M1 bằng test âm và test restart/race, không chỉ happy path.
4. T10 → T11 → T12 → T13; T14 sau khi contract/output ổn định.
5. T15 → T16; bàn giao kết quả thực tế, phần chưa đạt và một bước tiếp theo rõ ràng.

Không mặc định spawn agent. Khi được phép delegation: chỉ giao phần độc lập, chỉ rõ file sở hữu, input/output, acceptance và validation; Sol kiểm tra lại trước nhận. Astra chỉ dùng ở lượt lập kế hoạch đầu; không làm fallback triển khai. Sol high dùng cho concurrency/security/migration/cross-package; không tự chọn max/ultra. Không đặt deadline tùy ý trước khi T00 và baseline được chốt.

## 7. Kiểm chứng chung và định nghĩa Done

Mỗi task: test tái hiện trước sửa khi có bug; thay đổi nhỏ; kiểm tra liên quan; ghi Evidence và phần chưa test. Không thay tests để hợp thức hóa kết quả baseline không đáp ứng requirement.

```bash
git status --short
git diff --check
bun --filter @anvil/system3 test
bun --filter @anvil/web test
bun run test
NODE_OPTIONS=--max-old-space-size=4096 bun run validate
```

Kiểm thử E2E hiện có, chạy trong `packages/web`:

```bash
CI=true bunx playwright test e2e/system3-projects.test.ts --workers=1 --retries=0 --reporter=line
```

Các lệnh hiện có không bao phủ toàn bộ task; phải thêm test theo acceptance. E2E dùng data root tạm và cần quyền localhost. Không dùng server đang giữ DB thật làm test target. Không chạy `bun test` từ repo root vì mock-module pollution.

**Release Done** chỉ khi: phạm vi được duyệt; tất cả required acceptance checks đạt; validate xanh; install/upgrade/recovery/reproduction thực tế đạt trên môi trường được hỗ trợ; UX đã được xem thật; known limitations và quyền bàn giao rõ ràng. Không có ngưỡng “đã chạy đủ lâu” hoặc “agent nói xong” thay thế các điều kiện này.

## 8. Rủi ro và rollback

- **Dirty worktree lớn:** review theo phạm vi; không checkout/reset toàn file. Giữ diff có trước; không tự commit chung thay đổi không hiểu rõ.
- **Migration và lịch sử:** ưu tiên additive/versioned schema, test DB cũ; rollback application không được làm code cũ đọc nhầm dữ liệu schema mới. Khi không tương thích, dừng và forward-fix trên dữ liệu được bảo toàn.
- **Approval drift:** thay định nghĩa tạo version/compilation/approval mới; không sửa manifest đã được duyệt.
- **Provider/chi phí:** deterministic tests trước; live test chỉ với quyền và ngân sách; không tự chuyển sang provider mạnh/tốn hơn khi thất bại.
- **Sinh code/giải nén:** chạy trong isolation, quyền hẹp, kiểm tra đường dẫn/link; không dùng live checkout làm nơi thử dữ liệu không tin cậy.
- **Scope creep:** yêu cầu vượt template được công khai ở T00/T10; không thay kiến trúc lớn để né một gate chưa thiết kế xong.

## 9. Prompt bàn giao sang tab Sol medium

> Đọc AGENTS.md, docs/technical/08-product-readiness-audit.md và docs/technical/09-product-readiness-execution-brief.md đầy đủ. Kiểm tra baseline và giữ mọi thay đổi có trước. Bạn là điều phối/triển khai chính, bắt đầu T01 rồi theo dependency; chốt các quyết định T00 với tôi trước khi thay đổi phạm vi sản phẩm. Không gọi Astra lại, không tự tạo sub-agent, không xóa dữ liệu, không tự push/deploy hoặc ghi Notion/Linear khi chưa được cho phép. Mỗi task phải có test và Evidence; báo rõ phần đã đạt và chưa đạt, không chỉ cập nhật trạng thái Done.

[← Báo cáo hiện trạng](08-product-readiness-audit.md) · [Mục lục kỹ thuật](README.md)
