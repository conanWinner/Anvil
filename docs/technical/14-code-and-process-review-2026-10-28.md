# 14 — Đánh giá code và quy trình triển khai Anvil

Ngày review: 28/10/2026. Baseline: `3d550f87713d92a923e7cb1adebb0182cfde243c`, nhánh `feat/system3-run-trace`, version `0.5.0`.

## Kết luận: cần sửa trước khi xác nhận sẵn sàng phát hành

**Phần triển khai có nền tảng tốt và bộ test đang đạt, nhưng chưa thể kết luận “Claude code và triển khai đã ổn hoàn toàn”.** Có lỗi đóng gói Docker, phạm vi sandbox của gói bàn giao quá rộng, retry Claude có thể lặp thao tác, bộ chấm chưa cô lập lỗi từng phương án và script build có nguy cơ mất chỉnh sửa cục bộ.

Luồng chạy từ source trên Linux phù hợp để tiếp tục thử nghiệm có kiểm soát. Chưa nên dùng kết quả review này làm phê duyệt production, Docker release hoặc chứng nhận chất lượng mô hình.

“Claude code” được đánh giá ở hai nghĩa: chất lượng phần triển khai có Claude tham gia và tích hợp Claude Code provider. Commit `69a79d1` có dòng `Co-Authored-By: Claude Opus 5.5`; dòng này không chứng minh mọi file đều do Claude viết. Luồng thí nghiệm hiện gọi builder/reviewer qua Pi/9router, không mặc định đi qua Claude Code SDK.

## 1. Phát hiện cần sửa

### F1 — P1: Gói tái chạy cho code sinh ra đọc toàn bộ filesystem

- Vị trí: [experiment-capabilities.ts:208](../../packages/system3/src/experiment-capabilities.ts#L208).
- `REPRODUCE_SH` dùng `bwrap --unshare-all --ro-bind / /`. Nó chỉ chặn ghi lên mount gốc; không chặn đọc các file mà tài khoản chạy có quyền đọc. Khác với sandbox nội bộ, script cũng không xóa môi trường bằng `--clearenv` và không áp dụng giới hạn RAM/CPU/thời gian tương đương.
- Khi người dùng chạy `reproduce.sh` trong gói bàn giao, code agent có thể đọc home, file cấu hình và `data/holdout` theo đường dẫn gốc. Không có mạng trực tiếp không đồng nghĩa bí mật không thể bị chép vào output. Việc giữ riêng nhãn test cũng không còn được bảo đảm trong đường tái chạy này.
- Sửa tối thiểu: mount riêng runtime, code, `data/agent` và output; xóa môi trường, không mount home/holdout. Dùng cùng nguyên tắc isolation của sandbox nội bộ.
- Nghiệm thu: script tái chạy không đọc được file sentinel ngoài mount và nhãn holdout, vẫn tạo được dự đoán. Đây là phát hiện từ code; phiên review không chạy code không tin cậy để thử đọc file thật.

### F2 — P1: Dockerfile bỏ sót workspace bắt buộc `@anvil/system3`

- Vị trí: [Dockerfile:28](../../Dockerfile#L28), [Dockerfile:138](../../Dockerfile#L138), [Dockerfile:153](../../Dockerfile#L153); dependency nằm ở [packages/server/package.json](../../packages/server/package.json).
- Cả hai bước copy manifest trước `bun install` đều không có `packages/system3/package.json`. Production stage cũng không copy source/runtime của package này, trong khi server import trực tiếp `@anvil/system3`.
- Build sạch không có đủ workspace để resolve dependency; kể cả vượt qua bước install bằng cache hoặc chỉnh tay, production image vẫn thiếu source System 3. Đây là lỗi đường Docker, không phủ nhận luồng chạy từ source.
- Sửa tối thiểu: thêm package manifest ở cả hai stage và source/runtime ở production stage. Sau đó kiểm tra riêng điều kiện sandbox: image hiện không thiết lập bubblewrap, ML runtime và systemd manager để chạy thí nghiệm.
- Nghiệm thu: build image sạch, khởi động server, kiểm tra health và một luồng System 3. Chưa chạy Docker build trong phiên này; kết luận dựa trên dependency và toàn bộ danh sách COPY.

### F3 — P1: Claude provider tự retry sau khi đã phát sự kiện dùng công cụ

- Vị trí: [provider.ts:1101](../../packages/providers/src/claude/provider.ts#L1101), [provider.ts:1125](../../packages/providers/src/claude/provider.ts#L1125); phân loại retry ở [provider.ts:940](../../packages/providers/src/claude/provider.ts#L940).
- `sendQuery()` chuyển event cho caller, nhưng khi subprocess gặp lỗi `crash`/`rate_limit`, lại gọi `query()` với cùng prompt mà không kiểm tra đã có tool chạy hay chưa. Khi không có resume ID đầu vào, vòng sau tiếp tục mở phiên mới; không ghim session vừa khởi tạo để bảo đảm tiếp tục đúng chỗ.
- Tình huống: Claude đã sửa file hoặc gọi công cụ có tác dụng bên ngoài rồi subprocess lỗi. Prompt chạy lại có thể lặp thao tác. Retry lỗi trước khi bắt đầu là hợp lý; retry sau tác dụng phụ cần chính sách khác.
- **Đã tái hiện bằng SDK giả lập:** mỗi lượt phát `system/init` và `assistant/tool_use`, sau đó ném `process exited with code 1`; provider gọi SDK **4 lần**, nhận 4 chunk. Không chạy shell hoặc thao tác bên ngoài thật.
- Sửa tối thiểu: không tự replay sau khi đã có khả năng phát sinh tác dụng phụ; trả lỗi có session/progress để tiếp tục có kiểm soát. Chỉ retry tự động lỗi được xác định an toàn trước thực thi.
- Kiểm tra đã lưu: `bun /tmp/anvil-review-claude-retry.ts`; log `/tmp/anvil-review-claude-retry.log`. Đây là bằng chứng local với mock SDK, không phải test Claude API thật.

### F4 — P1: Script build binary có thể làm mất chỉnh sửa chưa commit

- Vị trí: [build-binaries.sh:34](../../scripts/build-binaries.sh#L34), [build-binaries.sh:37](../../scripts/build-binaries.sh#L37).
- Script ghi đè `packages/paths/src/bundled-build.ts`, rồi EXIT trap dùng `git checkout --` để lấy lại bản trong index. Nó không lưu nội dung file trước khi chạy và không chặn khi file có thay đổi chưa stage.
- Nếu người dùng đang chỉnh file này, chạy build thành công hoặc thất bại đều có thể làm mất phần chỉnh sửa. Quy trình này trái quy tắc giữ nguyên dữ liệu và worktree của dự án.
- Sửa tối thiểu: fail sớm khi file không sạch, hoặc giữ và phục hồi chính xác bytes ban đầu; tốt hơn là sinh build constants trong vùng build riêng. Không dùng reset/checkout để “dọn” thay đổi của người dùng.
- Nghiệm thu: fixture có nội dung chưa commit vẫn giữ nguyên sau build thành công và sau build lỗi. Không chạy script này trên worktree hiện tại để tái hiện mất dữ liệu.

### F5 — P2: Đầu ra lỗi của một phương án làm dừng bộ chấm toàn nhóm

- Vị trí: [anvil_eval.py:170](../../packages/system3/runtime/python/anvil_eval.py#L170), [anvil_eval.py:186](../../packages/system3/runtime/python/anvil_eval.py#L186), [anvil_eval.py:199](../../packages/system3/runtime/python/anvil_eval.py#L199).
- CSV có thêm cột `target` vẫn vượt kiểm tra `id,score`, nhưng merge đổi tên thành `target_x`/`target_y`; truy cập `merged['target']` gây `KeyError`.
- File `reported/<variant>.json` chỉ là số liệu tham khảo nhưng `json.loads()` không được bắt lỗi. JSON hỏng gây `JSONDecodeError` sau khi dự đoán đã được chấm hợp lệ.
- `evaluate()` dùng comprehension chung nên một exception làm mất kết quả của mọi phương án trong lần chấm, ảnh hưởng cả TW-06B và Verify.
- **Đã tái hiện cả hai lỗi** trên evaluator thật bằng fixture hai dòng; baseline cùng dự đoán hợp lệ trả `verified`. Python local dùng pandas `2.3.3`, scikit-learn `1.8.0`, không phải ML runtime khóa phiên bản của sản phẩm.
- Sửa tối thiểu: chọn/validate các cột dự đoán trước merge; lỗi đầu vào được quy về trạng thái của đúng phương án. Báo lỗi JSON tham khảo riêng, không làm mất metric chính thức của phương án khác.
- Nghiệm thu: nhóm có một phương án tốt, một CSV thêm `target`, một JSON tham khảo hỏng vẫn sinh báo cáo đầy đủ và trạng thái từng phương án.

## 2. Quy trình đã có nhưng cần làm rõ

### Review có lỗi chặn vẫn có thể chạy và đạt Verify

[experiment-builder.ts:709](../../packages/system3/src/experiment-builder.ts#L709) trả `ready` sau khi hết vòng sửa nếu `reportUnresolvedReview` được bật. [ExperimentRun.tsx:89](../../packages/web/src/features/system3/ExperimentRun.tsx#L89) hiển thị cảnh báo và vẫn cho người dùng bấm chạy. [experiment-capabilities.ts:652](../../packages/system3/src/experiment-capabilities.ts#L652) xác định Verify đạt từ metric khớp và ít nhất một phương án hợp lệ, không từ kết luận code review.

Đây là lựa chọn đã được ghi ở kế hoạch 13 đợt 2, không coi riêng việc cho chạy là bug ngoài ý muốn. Tuy nhiên cần phân biệt rõ **“chấm lại khớp”**, **“code review đạt”** và **“đáp ứng blueprint”**. Code đang ghi `requirementCoverage: not_verified`; không được diễn giải Evidence `passed` thành tất cả yêu cầu nghiệp vụ đã đạt. Nếu cho bỏ qua lỗi chặn, nên ghi quyết định chấp nhận ngoại lệ gắn với chính build/review đó, thay vì chỉ có nút chạy chung.

### Tài liệu và quy tắc UI chưa đồng nhất

- `AGENTS.md` yêu cầu token blue–cyan–teal của ứng dụng; doc 07 và `system3-theme.css` mô tả surface ngà/xanh lá riêng.
- Doc 07 §11 còn mô tả chọn 2–4 LLM, trong khi README và kế hoạch 13 chuyển trọng tâm sang builder + reviewer và phương án thí nghiệm.
- Kế hoạch 13 có lịch sử nghiệm thu live nhưng một số phần thiết kế ban đầu vẫn nói lỗi review phải chặn cứng. Cần ghi rõ phần nào đã bị thay thế, tránh hai agent hoặc người triển khai làm theo hai quy tắc khác nhau.

### Giới hạn vận hành được ghi nhận, chưa phải chức năng đã hoàn thành

Hàng đợi sandbox chỉ trong một tiến trình (`experiment-sandbox.ts`), chưa có trần chi phí token, chưa trả lời câu hỏi của agent ngay trên UI, chưa chạy ngoài rồi nhập dự đoán. `experimentHostSlots()` dựa trên tổng RAM và CPU, không phải ngân sách còn lại của toàn máy hay tất cả tiến trình. Giữ triển khai một tiến trình cho đến khi có cơ chế điều phối tài nguyên tương ứng.

## 3. Những phần đang làm tốt

- Ranh giới domain System 3 và Workflow Runtime được thể hiện qua package/capability; workflow không bị đồng nhất với toàn bộ Project Lifecycle.
- Có kiểm tra approval/project/completed execution trước khi lấy gói build; archive được kiểm tra hash và giải nén với kiểm tra đường dẫn, loại entry, kích thước và ghi file độc quyền.
- Sandbox nội bộ tách code, agent data và output; giữ nhãn holdout riêng; chấm metric bằng evaluator của Anvil thay vì tin số agent tự báo.
- Có preflight sandbox trước lượt gọi builder đầu tiên, vòng sửa giới hạn, reviewer question và trace cho tiến trình.
- Build/run tách riêng; người dùng chọn tập phương án, mức song song và phương án bàn giao. Code bảo vệ tập phương án chạy là tập con đã duyệt.
- Có test package isolation, test source pinning/approval, schema parity và kiểm tra generated files. Kiểm tra tự động hiện tại đạt nhiều trường hợp quan trọng, dù chưa bao phủ các lỗi mới nêu trên.

## 4. Bằng chứng kiểm tra trong phiên review

| Kiểm tra | Kết quả |
| --- | --- |
| Baseline Git | Nhánh `feat/system3-run-trace`, HEAD `3d550f8`; lúc bắt đầu chỉ có `.claude/launch.json` chưa tracked |
| Generated defaults, skill, schema, Pi vendor map | Cả 4 check đạt |
| `bun run type-check` qua validate | Đạt các workspace có script và scripts TypeScript |
| `bun run format:check` độc lập | Đạt trước khi thêm báo cáo |
| `bun run test` | Exit 0; **5.612 pass, 11 skip, 0 fail** |
| Test providers | 662 pass; có mock, không chứng minh Claude đăng nhập/gọi API thật |
| Test System 3 | 149 pass, 10 skip; các test sandbox/ML opt-in không chạy mặc định |
| Kiểm tra bổ sung evaluator | Tái hiện `JSONDecodeError` và `KeyError 'target'` |
| Kiểm tra bổ sung Claude retry | 4 lần gọi SDK sau event tool use, dùng mock |
| `git diff --check` | Đạt trước khi thêm báo cáo |
| `NODE_OPTIONS=--max-old-space-size=4096 bun run validate` | **Đạt, exit 0**: generated checks, type-check, lint không warning, format và tests |
| Browser desktop/compact với activity thật | Chưa xác minh lại: Brave không kết nối được remote debugging, Chrome không có DevToolsActivePort |
| Docker, binary, PostgreSQL live, Claude/9router live, VPS deployment | Không chạy lại trong phiên này |

Log local: `/tmp/anvil-review-20261028-validate.log`, `/tmp/anvil-review-20261028-tests.log`, `/tmp/anvil-review-20261028-format.log`. Fixture evaluator được giữ tại `/tmp/anvil-review-evaluator-e2eui43p`. Các đường dẫn `/tmp` là bằng chứng tạm thời trên máy này, không phải artifact được version trong Git.

Các lần live ngày 26–28/10 trong kế hoạch 13 là **bằng chứng được tài liệu trước đó ghi lại**, không được tính thành lần nghiệm thu trực tiếp của review này.

Báo cáo và liên kết mục lục sau khi thêm đã qua Prettier; full validate đánh giá baseline code trước thay đổi tài liệu. Không chạy lại các bộ test chức năng chỉ vì thêm Markdown.

## 5. Phạm vi và giới hạn kết luận

Đây là review xuyên các lớp kiến trúc, code và quy trình, ưu tiên luồng đang phát triển: docs/contract, System 3 build/run/evaluate/verify, server execution/trace, UI điều khiển chạy, Claude provider, Docker, CI và script phát hành. Repo có 932 file tracked TypeScript/TSX/Python; không tuyên bố đọc thủ công từng dòng của tất cả file hoặc audit sâu mọi adapter/auth path.

Bộ test toàn repo đạt không thay thế kiểm chứng sandbox thật, layout trình duyệt hoặc triển khai server. Không có thay đổi source chức năng, migration, credential, commit, push hoặc triển khai trong phạm vi báo cáo này. Không dùng lỗi phát hiện để tự sửa ngoài yêu cầu review.

## 6. Định hướng khắc phục

**Ưu tiên sửa ranh giới an toàn và tính đúng của kết quả trước khi mở rộng tính năng.** Giữ kiến trúc hiện tại, dùng test hồi quy nhỏ để khóa từng lỗi; chưa cần viết lại System 3 hoặc thay provider.

Phương án vận hành đơn giản nhất trong giai đoạn sửa: chạy từ source trên một tiến trình Linux đáp ứng sandbox, giới hạn số phương án theo tài nguyên máy. Chưa cam kết Docker chạy được ML chỉ vì image khởi động và health check đạt.

Các mục dưới đây là **kế hoạch đề xuất, chưa triển khai**. Kết quả validate ở §4 thuộc baseline review, không phải bằng chứng các bản sửa tương lai đã đạt. Không mở rộng sang runner từ xa, hàng đợi phân tán hoặc thay đổi toàn bộ UI trong đợt này.

## 7. Kế hoạch thực hiện

### Đợt A — Khóa các nguy cơ an toàn

| Mã | Phạm vi và cách sửa đề xuất | Điều kiện nghiệm thu |
| --- | --- | --- |
| A1 / F1 | Sửa template `REPRODUCE_SH` trong `experiment-capabilities.ts`: bỏ mount `/`, chỉ mount thư viện hệ thống cần thiết, runtime đã xác thực, code, agent data và output; `--clearenv`, dựng lại danh sách biến môi trường tối thiểu. Áp dụng giới hạn tài nguyên bằng cơ chế sandbox đang có; thiếu điều kiện thì dừng với hướng dẫn rõ, không chạy ngoài sandbox. Cập nhật hướng dẫn tái lập cùng template. | Test trên chính script được xuất trong gói: không đọc được sentinel ngoài mount, home hoặc holdout; không nhận biến môi trường bí mật; không có mạng; chỉ output được ghi. Một phương án hợp lệ vẫn chạy, quá RAM/thời gian bị dừng. |
| A2 / F3 | Sửa retry trong Claude provider và test hiện có. Theo dõi tiến trình của từng lần gọi; lỗi sau event công cụ hoặc trạng thái thực thi không rõ phải kết thúc với lỗi có ngữ cảnh. Chỉ retry trường hợp được chứng minh chưa thực thi; không coi “chưa nhận event” là bằng chứng tuyệt đối chưa có tác dụng phụ. Không tự gửi lại prompt hoặc tự resume phiên sau lỗi mơ hồ. | Mock phát tool event rồi crash chỉ gọi SDK một lần; không lặp thao tác. Lỗi an toàn trước thực thi vẫn retry có giới hạn; auth và abort không retry. Giữ thông tin session nếu có để người dùng xử lý, không đưa prompt/credential vào log. |
| A3 / F4 | Sửa script build để kiểm tra file đích trước mọi bước ghi. Tối thiểu: từ chối khi file có chỉnh sửa staged/unstaged, giữ bản sao bytes ban đầu và phục hồi từ bản sao thay vì `git checkout --`. Không ghi đè nếu file đã bị tiến trình khác sửa sau bước sinh constants; giữ backup và báo đường dẫn phục hồi. | Fixture riêng chứng minh nội dung không đổi khi bị từ chối, build thành công, build lỗi và bị ngắt có thể bắt được. Nếu bị SIGKILL thì backup còn nguyên và hướng dẫn phục hồi rõ. Không thử bằng dữ liệu đang làm của người dùng. |

A1–A3 không phụ thuộc nhau về logic; mỗi mục nên có diff và bằng chứng riêng để dễ review. Kế hoạch này không yêu cầu hoặc tự cho phép tạo sub-agent.

### Đợt B — Sửa đóng gói và độ tin cậy của bộ chấm

| Mã | Phạm vi và cách sửa đề xuất | Điều kiện nghiệm thu |
| --- | --- | --- |
| B1 / F2 | Thêm manifest `system3` trước install ở cả hai stage và source/runtime trong production image. Kiểm tra danh sách workspace thực tế để không sót package khác. Tách rõ hỗ trợ Web/API khỏi khả năng chạy sandbox ML; không bật privileged container hoặc mount host root/systemd socket chỉ để làm test xanh. | Build sạch bằng frozen lockfile; server khởi động, import System 3 và phục vụ route được. Nếu Docker chưa hỗ trợ ML, readiness/preflight phải trả lỗi môi trường rõ trước khi gọi agent; tài liệu nói đúng giới hạn. Chỉ công bố hỗ trợ ML Docker sau test sandbox đầu-cuối trên chính image. |
| B2 / F5 | Validate cột CSV theo contract `id,score[,label]` trước merge; đề xuất từ chối cột dư để lỗi sinh code dễ nhận biết. JSON tham khảo hỏng tạo cảnh báo riêng, không đổi metric chính thức đã tính. Bắt lỗi đầu vào dự kiến theo từng phương án; lỗi hạ tầng hoặc lỗi lập trình không được âm thầm chuyển thành kết quả thành công. | Nhóm hỗn hợp vẫn có đủ hàng kết quả: phương án tốt được chấm, CSV dư `target` là `invalid_predictions`, JSON tham khảo hỏng có cảnh báo. Thử thêm thiếu/trùng ID, NaN/Infinity và score ngoài miền. TW-07 chấm lại khớp trên runtime khóa phiên bản. |

B2 không cần thay schema công khai nếu dùng được trường cảnh báo hiện có. Nếu phải thêm contract cảnh báo, sửa schema sở hữu, API types và renderer cùng nhau; không thêm trường runtime mà UI bỏ qua.

### Đợt C — Chốt ý nghĩa review, Evidence và tài liệu

1. **C1 — Quyết định chính sách lỗi review:** giữ quyền người dùng chạy ngoại lệ như kế hoạch 13, nhưng đề xuất yêu cầu chấp nhận rõ lỗi chặn. Quyết định gắn với hash build và review cụ thể, có lý do; build/review thay đổi thì quyết định cũ không còn hiệu lực. Tái sử dụng Decision và cơ chế invalidation hiện có. Đây là thay đổi hành vi cần chốt trước khi triển khai, không tự thay bằng chặn cứng toàn bộ.
2. **C2 — Trình bày đúng kết quả:** phân biệt “code review đạt”, “metric được chấm lại khớp” và “yêu cầu blueprint đã được xác minh”. Kiểm tra cả UI, Evidence và manifest bàn giao; không gắn nhãn đạt toàn diện khi `requirementCoverage` vẫn `not_verified` hoặc còn ngoại lệ review.
3. **C3 — Đồng bộ tài liệu:** ghi phần thiết kế đã bị thay thế trong kế hoạch 13; sửa nội dung so sánh 2–4 LLM còn sót ở doc 07. Với màu/theme, lấy AGENTS hiện hành làm ràng buộc cho đến khi người dùng chốt thay đổi; không sửa quy tắc chỉ để hợp thức hóa UI. Giữ lịch sử nghiệm thu và liên kết mục lục.

Nghiệm thu C1–C3: gọi trực tiếp API không bỏ qua được điều kiện chấp nhận ngoại lệ; thay build làm quyết định cũ mất hiệu lực; UI và gói bàn giao mô tả cùng trạng thái. Sau thay đổi giao diện, kiểm tra bằng bàn phím và render dự án có dữ liệu ở desktop lẫn màn hình 390 px.

### Đợt D — Nghiệm thu trước phát hành

Chỉ bắt đầu kết luận phát hành sau A, B và các quyết định C liên quan đã hoàn tất:

1. Chạy test hẹp tương ứng khi sửa; sau khi tích hợp chạy `NODE_OPTIONS=--max-old-space-size=4096 bun run validate`. Không dùng `bun test` ở repo root.
2. Trên Linux có ML runtime khóa phiên bản và systemd/bubblewrap phù hợp, chạy `ANVIL_SANDBOX_TESTS=true bun --filter @anvil/system3 test`. Test skip không được tính là đạt sandbox. Chỉ dùng fixture và output dành riêng cho kiểm tra; mọi thao tác xóa cần đúng phạm vi được cho phép.
3. Kiểm tra artifact thực tế: image Docker sạch, binary sau A3 nếu phát hành binary, gói bàn giao chứa script đã sửa. Không chạy script build có nguy cơ mất dữ liệu trước khi A3 được xử lý.
4. Nghiệm thu Web với activity thật: Intake → Understanding → Readiness/Compile/Approve → Build → chọn phương án/chạy → Verify → chọn phương án/bàn giao. Bao gồm nguồn thay đổi, reviewer đặt câu hỏi, phương án lỗi, chạy lại một phần và hủy lượt chạy. Kiểm tra desktop và compact, không thay bằng DOM assertion.
5. Kiểm chứng provider live riêng nếu tuyên bố hỗ trợ Claude Code: đăng nhập/kết nối, một yêu cầu giới hạn và hủy yêu cầu. Kết quả Pi/9router không được dùng thay cho Claude SDK. Không tự gọi dịch vụ tính phí chỉ vì đang thực hiện kế hoạch review.

Mỗi mục hoàn tất phải ghi: commit được kiểm tra, môi trường/runtime, lệnh chạy, pass/fail/skip, đường dẫn bằng chứng và giới hạn còn lại. Đưa test tái hiện hiện nằm trong `/tmp` vào bộ test phù hợp khi sửa; không dùng file tạm làm bằng chứng dài hạn duy nhất.

## 8. Bàn giao và phương án quay lui

| Nhóm | Trạng thái ban đầu | Bằng chứng cần bổ sung khi hoàn tất |
| --- | --- | --- |
| A1–A3 | Chưa triển khai | Test isolation gói xuất, test retry an toàn, test bảo toàn file build |
| B1–B2 | Chưa triển khai | Build/image smoke và báo cáo chấm nhóm hỗn hợp trên ML runtime |
| C1–C3 | Đề xuất cần chốt chính sách | Decision/contract đã thống nhất, test API/UI, docs cùng nội dung |
| D | Chưa nghiệm thu bản sửa | Full validate, sandbox thật, Web desktop/compact và artifact triển khai |

Giữ mỗi nhóm sửa độc lập, không kèm migration hoặc refactor không cần thiết. Nếu cần migration cho quyết định ngoại lệ, ưu tiên thêm trường/bảng và giữ dữ liệu cũ; xác định cách đọc bản cũ trước khi áp dụng. Khi bản sửa lỗi, dừng đường thực thi liên quan, giữ nguồn, artifact và log; không rollback bằng xóa dữ liệu hoặc reset worktree. Việc quay về revision đã kiểm chứng phải thực hiện trong phạm vi được người dùng cho phép, và không bật lại sandbox rộng hoặc retry không an toàn chỉ để khôi phục khả năng chạy.

**Điều kiện chốt “đã ổn”:** lỗi P1/P2 trên được sửa và có test hồi quy; đúng artifact triển khai chạy được; giới hạn hỗ trợ được công bố rõ. Hiện tại: **cần sửa, chưa duyệt phát hành**.

[← Mục lục kỹ thuật](README.md) · [Kế hoạch hiện hành](13-experiment-execution-plan.md)
