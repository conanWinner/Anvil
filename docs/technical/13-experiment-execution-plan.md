# 13 — Triển khai phương án thí nghiệm từ System 2

Phiên bản 1 — 26/10/2026. **Kế hoạch hiện hành**, thay hướng "so sánh nhiều LLM" của [kế hoạch 11](11-simplification-and-core-flow-plan.md). Phần nền của 11 (pin nguồn, Bản hiểu, Decision, phê duyệt, sandbox, Verify, gói tái lập, UI tối giản) vẫn giữ và được dùng lại.

## 1. Mục tiêu

```text
System 1 — Research   → hướng tiếp cận, tài liệu
System 2 — Thiết kế   → blueprint: yêu cầu, dữ liệu, pipeline, CÁC PHƯƠNG ÁN THÍ NGHIỆM, cách đánh giá
System 3 — Triển khai → code chạy được + kết quả từng phương án + so sánh + gợi ý + gói tái lập
```

System 3 giúp researcher **triển khai nhanh các phương án thí nghiệm do System 2 đề ra**, chạy thật để biết phương án nào tốt, phương án nào không, rồi để **người dùng chọn**. Hệ thống được gợi ý kèm thống kê, nhưng không tự chọn thay người dùng.

- **Đơn vị so sánh là phương án thí nghiệm** (ví dụ với `DESIGN_B_2.md`: Logistic Regression, Random Forest, XGBoost, LightGBM; class weights hay SMOTE; có hay không K-means), **không phải LLM**.
- **LLM là công cụ thi công:** một *agent thi công* viết toàn bộ codebase theo Execution Blueprint; một *agent review* (nên khác model) kiểm tra code trước khi chạy.
- **Chạy trên VPS hiện tại** (2 CPU, ~4 GB RAM, ~20 GB trống), tuần tự, có giới hạn tài nguyên. Nếu bài toán vượt sức máy thì báo rõ và đề xuất runner mạnh hơn (§8); không âm thầm cắt bớt.

## 2. Luồng người dùng

| Bước | Người dùng làm | Hệ thống làm | Activity |
| --- | --- | --- | --- |
| 1. Tạo dự án | Tải blueprint System 2 + dữ liệu (nhiều CSV hoặc `.zip`); chọn agent thi công | Pin từng nguồn, kiểm tra | OP-00, OP-01 |
| 2. Phân tích | Bấm bắt đầu; trả lời Decision; chấp nhận Bản hiểu | Trích yêu cầu, **ma trận phương án**, **giao thức đánh giá**; hỏi những gì thiếu (ngưỡng metric, cột target, …) | TW-02 |
| 3. Duyệt kế hoạch | Bỏ chọn phương án không muốn chạy; xem ngân sách thời gian/RAM/token; **Phê duyệt và chạy** | Readiness + Compile thành kế hoạch có hash | TW-03, OP-04, OP-05 |
| 4. Thi công | Theo dõi | Agent viết code → sandbox chạy kiểm tra nhanh → agent sửa lỗi (có giới hạn vòng) → agent review → sửa theo review | TW-06A |
| 5. Chạy thí nghiệm | Theo dõi từng phương án | Chạy lần lượt từng phương án trong sandbox thí nghiệm, lưu dự đoán, model, thời gian, RAM | TW-06B |
| 6. Xác minh | — | **Bộ đánh giá của Anvil** tự tính lại metric từ dự đoán + nhãn giữ riêng; kiểm tra mọi phương án dùng cùng split/seed → Evidence | TW-07 |
| 7. Kết quả | Xem bảng so sánh, biểu đồ, **gợi ý**; **chọn phương án**; tải gói | Bảng metric, trade-off, gợi ý có lý do; gói chứa phương án đã chọn + toàn bộ kết quả + báo cáo | OP-08, TW-09 |
| 8. Chạy lại | Đổi phương án/tham số/agent → duyệt lại | Chỉ chạy lại phần bị ảnh hưởng | OP-01 → OP-04 |

Mapping **6 phase / 10 activity giữ nguyên**; thi công, review và chạy phương án nằm bên trong TW-06 (TW-06A Build, TW-06B Data & Experiment) như contract đã định.

## 3. Thiết kế chính

### 3.1 Ma trận phương án và giao thức đánh giá (mới, `packages/system3`)

TW-02 trích thêm hai đối tượng có truy vết nguồn:

- `experimentVariant`: `id`, tên, loại (model / kỹ thuật / biến thể tùy chọn), thư viện, tham số gợi ý, yêu cầu liên quan, có bắt buộc hay tùy chọn.
- `evaluationProtocol`: kiểu bài toán (phân loại/hồi quy), cột target, cách chia (time-series split / holdout, số fold, seed), metric chính và phụ, ngưỡng (nếu System 2 có), ràng buộc tài nguyên.

Thiếu thông tin quan trọng (target, metric chính, cách chia) thì tạo **Decision**, không tự đoán. Không có ngưỡng metric thì chỉ so sánh tương đối và ghi rõ trong kết quả.

### 3.2 Anvil giữ split và tự chấm (thay cho harness người dùng tự viết)

Thi công chia **hai giai đoạn**, vì với dữ liệu thô nhiều bảng thì nhãn do code tạo ra (ví dụ DM-02 tạo target churn):

1. **Chuẩn bị dữ liệu:** agent viết `prepare_data.py` → review → Anvil chạy trong sandbox ra **bảng mô hình hóa** (mỗi dòng một thực thể, có cột id và target). Code này bị khóa sau khi chạy.
2. **Chia và giữ nhãn:** `anvil_eval.py split` (code của Anvil, không phải của agent) chia theo giao thức (`stratified_holdout` hoặc `time_holdout`), ghi `agent/train.csv` và `agent/test_features.csv` (**không có target**) cho agent; nhãn test nằm ở `holdout/`, không bao giờ mount vào sandbox của agent.
3. **Phương án:** code từng phương án chỉ thấy dữ liệu của agent, tự làm cross-validation trên train, xuất `predictions/<variant>.csv` (`id,score[,label]`) và tùy chọn `reported/<variant>.json` (số liệu train/CV).
4. **Chấm:** `anvil_eval.py evaluate` tính ROC-AUC, PR-AUC, F1, Recall, Precision, Accuracy trên tập test từ dự đoán. Đây là **số chính thức**; số agent tự báo chỉ là tham khảo, ghi rõ chưa xác minh. Dự đoán thiếu/trùng id hay score ngoài [0, 1] → `invalid_predictions`; không có file → `missing`.
5. **Gợi ý:** `rankExperimentVariants` xếp theo metric chính, nêu ngưỡng (nếu có), các phương án gần tốt nhất nhưng nhanh hơn; phương án chưa xác minh không bao giờ được gợi ý.

### 3.3 Thi công bằng agent, mọi lệnh chạy trong sandbox

- Agent thi công chỉ có công cụ **đọc/ghi file** trong workspace; **không có Bash trên máy chủ**. Mọi lệnh chạy (kiểm tra nhanh trên mẫu nhỏ, test) đi qua sandbox; lỗi được đưa lại cho agent (`loop`, tối đa N vòng, cấu hình trong kế hoạch).
- Agent review đọc code + blueprint + giao thức, tìm: rò rỉ dữ liệu (dùng nhãn test, fit trên toàn bộ dữ liệu), sai split/seed, metric tính sai, thiếu phương án, lệch blueprint. Lỗi chặn quay lại agent thi công (giới hạn vòng); hết vòng thì dừng và hiện cho người dùng, không chạy tiếp.
- Báo cáo review là artifact có trong kết quả và trong gói.

### 3.4 Runtime và sandbox thí nghiệm

- **ML runtime** có phiên bản: venv Python dựng bằng `uv` từ file lock cố định (pandas, numpy, scikit-learn, xgboost, lightgbm, imbalanced-learn, shap, matplotlib, joblib). Hash của lock nằm trong Runtime Profile và Approval Manifest; gói tái lập kèm lock.
- Hai profile sandbox (cùng `systemd-run` + `bwrap`, không mạng, runtime mount chỉ đọc):

| Profile | RAM | CPU | Thời gian | Dùng cho |
| --- | --- | --- | --- | --- |
| `check` | 512 MiB | 1 | 60 giây | Kiểm tra nhanh trên mẫu nhỏ trong vòng thi công |
| `experiment` | 2 GiB | 2 | 30 phút/phương án | Chạy thí nghiệm thật (VPS 4 GB còn ~2,4 GB trống khi server chạy) |

- **Một thí nghiệm tại một thời điểm** trên toàn máy (hàng đợi); phương án vượt giới hạn được ghi `failed: resource_limit`, không bị coi là kém về chất lượng.

### 3.5 Kết quả, gợi ý và lựa chọn

- Bảng so sánh: mỗi hàng một phương án; cột metric (đã xác minh), thời gian train, RAM đỉnh, trạng thái, Evidence; biểu đồ cột cho metric chính.
- **Gợi ý**: xếp hạng theo metric chính của giao thức, đánh dấu phương án trong ngưỡng hoặc gần nhất ngưỡng; nêu trade-off (độ chính xác, thời gian, khả năng giải thích). Ghi rõ đây là gợi ý; nút **Chọn phương án này** do người dùng bấm (FR-06).
- Gói bàn giao: code toàn bộ, phương án đã chọn đánh dấu, mọi `metrics.json`/dự đoán, báo cáo review, báo cáo so sánh (FR-08), lock runtime, `reproduce.sh`.

## 4. Giữ và thay

| Thành phần | Xử lý |
| --- | --- |
| Pin nguồn, Bản hiểu, Decision, Readiness, Compile, Approval, Verify, Delivery, lịch sử | Giữ, mở rộng contract |
| Python sandbox (`python-sandbox.ts`) | Giữ; thêm profile và mount runtime |
| So sánh nhiều LLM (`model-comparison*`) | Ẩn khỏi form tạo dự án; giữ code cho dự án cũ đến khi có quyết định xóa |
| Baseline majority-class (`project-scaffolder`, `runPython` chạy trên host) | Thay bằng thi công bằng agent + sandbox; giữ cho dự án cũ đến khi chuyển xong |
| Bộ mẫu Olist tổng hợp theo bang | Thay bằng mẫu churn nhỏ (Olist đầy đủ đã có trên VPS) cho kiểm thử nhanh |

## 5. Các giai đoạn triển khai

| Giai đoạn | Nội dung | Điều kiện hoàn tất |
| --- | --- | --- |
| **P0** | Commit mốc; UI toàn màn hình; giải thích mục đích; docs trỏ về kế hoạch 13 | Diff đã commit theo nhóm; render 1280/1920/390 không tràn |
| **P1** | ML runtime (uv + lock) + profile sandbox `check`/`experiment` + hàng đợi thí nghiệm | Test sandbox opt-in: import sklearn/lightgbm trong sandbox, vượt RAM/thời gian bị dừng đúng, không mạng |
| **P2** | Contract `experimentVariant` + `evaluationProtocol`; TW-02 trích từ `DESIGN_B_2.md`; Decision khi thiếu; UI duyệt/bỏ chọn phương án | Test trích xuất trên `DESIGN_B_2.md` ra đúng 4 model + biến thể; thiếu target sinh Decision |
| **P3** | Split do Anvil giữ + bộ đánh giá Anvil + Evidence theo phương án | Test: dự đoán đúng → passed; số tự báo lệch → failed; dùng nhãn test bị phát hiện |
| **P4** | Workflow TW-06A: agent thi công (chỉ file tools) + vòng sửa qua sandbox `check` + agent review | Chạy thật trên mẫu nhỏ: code qua review, chạy được trong sandbox |
| **P5** | TW-06B chạy từng phương án; trang kết quả, gợi ý, chọn phương án; gói bàn giao | Olist churn: các phương án có metric đã xác minh, chọn và tải gói, tái lập không gọi LLM |
| **P6** | Đường chạy lại; nghiệm thu đầu-cuối trên VPS; `bun run validate`; docs | Đạt nghiệm thu §6 |

Thứ tự: P0 → P1 → P3 → P2 → P4 → P5 → P6 (P3 trước P2 vì bộ đánh giá là nền để tin kết quả). Mỗi giai đoạn commit riêng, có thể revert độc lập.

## 6. Nghiệm thu đầu-cuối

Trên VPS, với `DESIGN_B_2.md` + Olist (bản thu nhỏ có tái lập nếu bản đầy đủ vượt giới hạn — ghi rõ):

1. Người dùng thao tác: tạo dự án → phân tích → trả lời Decision → duyệt kế hoạch → chọn phương án → tải gói. Không viết Python, không gọi API tay.
2. Ít nhất Logistic Regression + một mô hình cây có metric **do Anvil tính lại** khớp số agent báo (sai lệch < 1e-6), cùng split hash.
3. Báo cáo review có trong kết quả; lỗi chặn của review không bị bỏ qua.
4. Gói tái lập chạy lại ra cùng metric trên máy có cùng runtime lock, không gọi LLM.
5. Không có lệnh nào của code do LLM sinh chạy ngoài sandbox.

## 7. Rủi ro

| Rủi ro | Cách xử lý |
| --- | --- |
| VPS 4 GB không đủ cho dữ liệu đầy đủ/XGBoost tuning | Profile 2,5 GiB, một thí nghiệm một lúc, giới hạn tuning trong kế hoạch; vượt giới hạn thì `resource_limit` + đề xuất §8 |
| Agent viết code sai/rò rỉ dữ liệu | Split do Anvil giữ, nhãn test không có trong workspace, review agent, bộ đánh giá độc lập |
| Chi phí token không kiểm soát | Ngân sách token/vòng sửa trong kế hoạch được duyệt; vượt thì dừng chờ người dùng |
| Tải wheel ML cần mạng lúc cài | Cài một lần khi dựng runtime (ngoài sandbox), sandbox thí nghiệm vẫn không mạng |

## 8. Khi VPS không đủ sức

Thứ tự đề xuất: (1) thu nhỏ dữ liệu có ghi rõ + giới hạn tuning; (2) nâng VPS lên 4 CPU / 8–16 GB (đúng giả định 8 GB của blueprint); (3) runner từ xa qua SSH tới máy mạnh hơn, dùng cùng runtime lock và giao thức. (3) chỉ làm khi có máy cụ thể.

## 9. Tiến độ

| Giai đoạn | Trạng thái | Bằng chứng / ghi chú |
| --- | --- | --- |
| P0 | Xong 26/10 | Commit mốc `0dce48b`; layout toàn màn hình, docs trỏ về kế hoạch 13 (`9a3c986`) |
| P1 | Xong 26/10 | `uv` 0.13.5; lock `packages/system3/runtime/requirements-ml.lock` (27 gói có hash: numpy 2.5.4, pandas 3.1.0, scikit-learn 1.9.1, xgboost-cpu 3.4.1, lightgbm 4.7.0, shap 0.54.1); `bun run system3:ml-runtime` dựng venv 526 MB tại `$ANVIL_HOME/runtimes/system3-ml/<hash>`. Host cần `libgomp1` (đã cài). `runExperimentSandbox` profile `check`/`experiment`, hàng đợi một thí nghiệm. Test opt-in `ANVIL_SANDBOX_TESTS=true`: import ML stack offline, chỉ `/work/out` ghi được, vượt RAM/thời gian bị dừng; sandbox Python cũ vẫn đạt |
| P3 (lõi) | Xong 26/10 | `runtime/python/anvil_eval.py` + `experiment-evaluation.ts`: giao thức đánh giá (zod), split giữ nhãn, chấm lại từ dự đoán, xếp hạng gợi ý. Test: 2 test xếp hạng + 1 test sandbox (split 200→150/50, test_features không có target, oracle AUC 1, dự đoán thiếu dòng/không có bị bắt). Chưa nối vào workflow/Evidence (làm ở P4–P5) |
| P2 (lõi) | Xong 26/10 | `experiment-plan.ts`: suy ra ma trận phương án + giao thức từ Bản hiểu V2 (bảng công nghệ, success criteria, yêu cầu) — không gọi LLM. Bảng mô hình hóa theo contract cột `entity_id`/`target`/`cutoff_time`. Test trên `DESIGN_B_2.md`: đúng 4 model (LR baseline, RF, XGBoost, LightGBM khuyến nghị), SMOTE, K-means tùy chọn, `time_holdout`, metric chính ROC-AUC, gap `no_thresholds` không chặn; blueprint thiếu thông tin sinh gap chặn. Chưa hiển thị trên UI/duyệt kế hoạch |
| P4 (lõi + nối luồng) | Xong 26/10, chưa nghiệm thu qua Web | `experiment-builder.ts`: agent thi công chỉ trả nội dung file (Pi, không tool); Anvil chạy `prepare_data.py` → split → smoke mẫu phân tầng → agent review (thấy thống kê split) → sửa có giới hạn; thử lại khi JSON hỏng (2 lần). Agent **không được đổi target/tập thực thể/metric**: nếu blueprint mâu thuẫn với dữ liệu thì trả `question` → run dừng `needs_decision`. Reviewer không được chặn yêu cầu blueprint đã nêu (chỉ cảnh báo). Nối: `experiment-config.json` → Readiness v3 (pin plan hash, runtime lock, dataset) → Compile → action `system3.experiment-execute` → Verify `system3.experiment-verify` chấm lại độc lập |
| P5 (Web) | Nghiệm thu 26/10 | Form mặc định chế độ thí nghiệm (blueprint + nhiều CSV, chọn agent thi công/review, bộ mẫu Olist review-risk 8.000 đơn); thẻ kế hoạch thí nghiệm; trang kết quả: gợi ý có lý do, bảng metric có thanh, cảnh báo dữ liệu, báo cáo review, chọn phương án → ghi `selectedVariant` vào manifest bàn giao |

### Bài học từ chạy live (Olist, `gpt-6-luna` qua 9router)

1. `DESIGN_B_2.md` trên Olist: agent tự đảo nhãn hoặc thu hẹp tập khách hàng để vượt kiểm tra lệch lớp (~99% churn); reviewer chặn đúng. Sau khi thêm luật `question`, agent dừng sau 10 giây và hỏi đúng chỗ mơ hồ của blueprint (DM-02 và định nghĩa nghiệp vụ mâu thuẫn; dữ liệu chỉ đến 08/2018). Đây là đầu vào cần trả về System 2/người dùng.
2. Lệch lớp nặng nhưng học được (<1% lớp thiểu số) chỉ là cảnh báo; chặn cứng khi một lớp có dưới 5 mẫu.
3. Reviewer phải biết hợp đồng đánh giá của Anvil (code không tính metric test) và không được chặn yêu cầu blueprint; nếu không sẽ dao động giữa các bản sửa.
4. Cấu hình model 9router ở tài liệu 12 (`contextWindow 32000`, `maxTokens 2048`) quá nhỏ cho thi công (prompt ~30k token, đầu ra cả codebase); lần chạy live dùng bản sao cấu hình với 200k/32k.


### Lần chạy thành công đầu tiên (script, 26/10, dữ liệu Olist đầy đủ)

Blueprint `review-risk-blueprint.md`, 5 bảng Olist gốc, `gpt-6-luna` thi công và review, 7 lượt gọi LLM, ~25 phút. Anvil giữ 19.735/98.673 đơn để chấm, tỷ lệ lớp dương 14,7% ở cả train/test.

| Phương án | ROC-AUC | PR-AUC | F1 | Recall | Thời gian |
| --- | --- | --- | --- | --- | --- |
| Logistic Regression (baseline) | 0,621 | 0,233 | 0,287 | 0,445 | 22 giây |
| Random Forest | 0,772 | 0,467 | 0,495 | 0,482 | 682 giây |
| XGBoost (gợi ý) | 0,774 | 0,471 | 0,481 | 0,591 | 31 giây |
| LightGBM | 0,771 | 0,470 | 0,479 | 0,588 | 28 giây |

Ba mô hình cây đạt ngưỡng ROC-AUC ≥ 0,70 của blueprint; baseline không đạt. Gợi ý XGBoost; LightGBM gần bằng và nhanh hơn. Review vòng 3 cho qua dù vòng 2 nêu `order_approved_at` có thể sau thời điểm đánh giá — review bằng LLM không ổn định tuyệt đối; bản sửa định tuyến lỗi về đúng giai đoạn (`d8fe6e9`) xử lý nguyên nhân agent không sửa `prepare_data.py`.


### Nghiệm thu qua Web (26/10)

- `e2e/system3-experiment-live.test.ts` (opt-in `ANVIL_LIVE_9ROUTER=true`) đạt **1/1 trong 17 phút** trên server cô lập (`ANVIL_HOME` tạm, runtime ML cài riêng, cổng 3191/5199): form mặc định → bộ mẫu Olist review-risk → Tạo và bắt đầu phân tích → Chấp nhận Bản hiểu → thẻ *Kế hoạch thí nghiệm* (4 phương án, ROC-AUC) → Phê duyệt và chạy → *Kết quả thí nghiệm* 4 hàng → chọn Logistic Regression (khác gợi ý) → tải gói. Manifest bàn giao ghi `selectedVariant: logistic_regression`; gói chứa code, dữ liệu agent đã thấy, nhãn giữ riêng, dự đoán, đánh giá, review, lock runtime và `reproduce.sh`.
- Kết quả trên 8.000 đơn (1.600 dòng kiểm tra): Random Forest 0,772 (gợi ý, đạt ngưỡng), XGBoost 0,755, LightGBM 0,745, Logistic Regression 0,610; chấm lại độc lập khớp (0 mismatch).
- E2E offline: minimal-ui 2/2, samples 3/3 (gồm test mới cho chế độ thí nghiệm), projects 3/3, source-intake 1/1.
- `bun run validate` từng bước: check bundled/skill/schema/pi-vendor-map đạt; type-check đạt; Prettier đạt; lint **theo từng package** đạt (lint toàn repo trong một tiến trình hết heap trên VPS 4 GB); test: server 442, system3 142, web 473, workflows 1175, adapters/cli/core/git/isolation/paths đạt; providers đạt khi chạy test Claude/registry bằng user không phải root (guard UID 0 có sẵn, như kế hoạch 11 ghi nhận).

### Còn lại

- Trả lời câu hỏi của agent ngay trong UI (hiện phải cập nhật blueprint rồi phân tích/duyệt lại).
- Chạy ở nơi khác (Kaggle/Colab) rồi tải dự đoán lên để Anvil chấm (§10 bước 4).
- Trần chi phí token; hàng đợi thí nghiệm giữa nhiều tiến trình Anvil.

## 10. Đợt 2 — Tách "viết code + kiểm thử" khỏi "chạy thật"

**Mục tiêu:** người dùng xem gói code đã kiểm thử trước, rồi tự chọn cách chạy: trên VPS (lần lượt hoặc song song N phương án, chọn tập con) hoặc ở nơi khác (Kaggle/Colab/máy riêng) và tải dự đoán lên để Anvil chấm.

**Luồng:**

1. Phê duyệt → **TW-06A Build**: agent viết code, smoke test trên mẫu, review. Kết quả là _gói build_ (code, `data/agent`, `data/holdout`, review, split). Dự án quay về trạng thái đã duyệt, chờ người dùng chọn cách chạy; không chạy Verify.
2. Người dùng chọn → **TW-06B Run**:
   - _Trên VPS_: chọn phương án (tập con của tập đã duyệt) và số phương án chạy song song (giới hạn theo RAM/CPU máy; mặc định 1). Chạy lại một phần: các phương án không chạy lại được mang sang từ lần chạy trước của cùng gói build.
   - _Nơi khác_ (đợt sau): tải gói chạy-ngoài (không có nhãn test), chạy ở đó, tải `predictions/*.csv` lên; Anvil chấm bằng nhãn nó giữ và ghi rõ nguồn "chạy ngoài".
3. **TW-07 Verify** chấm lại độc lập như hiện tại → kết quả, gợi ý, người dùng chọn → bàn giao.

**Thiết kế:**

- Một bundle TW-06 đã duyệt, thêm runtime binding `experimentRun` (object) — không đổi hình đồ thị. Giá trị: `{ stage: 'build' }` hoặc `{ stage: 'run', buildArtifact: {executionId, storageKey, contentHash}, variantIds, parallelism, carryOver? }`. Capability kiểm tra: `variantIds ⊆` tập đã duyệt, gói build cùng approval và đúng hash, `parallelism` trong giới hạn máy. Đổi blueprint/dữ liệu/agent vẫn cần duyệt lại; chọn tập con/song song/chạy lại thì không.
- Build hoàn tất: artifact `experiment_build`, dự án `executing → approved`, attempt chờ ở TW-06. Run hoàn tất: như hiện tại (`verifying` → TW-07).
- Song song: hàng đợi sandbox thành semaphore theo số slot; mỗi slot giữ hồ sơ 2 GB/2 CPU. Số slot tối đa = min(⌊RAM khả dụng·0.8 / 2 GB⌋, ⌊CPU/2⌋), tối thiểu 1.
- UI: sau build hiện thẻ "Code đã sẵn sàng" (review, split, file code) với lựa chọn phương án, số song song và nút "Chạy"; sau một lần chạy có nút "Chạy lại phương án lỗi".

**Thứ tự:** (1) môi trường server: runtime ML, giới hạn model, dữ liệu khỏi `/tmp` · (2) tách build/run + tập con + chạy lại một phần · (3) song song có giới hạn tài nguyên · (4) chạy ngoài + tải dự đoán lên · (5) trả lời câu hỏi agent trong UI, trần chi phí token.


[← Mục lục](README.md) · [Kế hoạch 11 (nền UI và luồng)](11-simplification-and-core-flow-plan.md)

**Tiến độ đợt 2 (27/10):**

- (1) Runtime ML đã cài vào `/var/lib/anvil`; script chuyển server khỏi `/tmp` (dừng server, chép dữ liệu, sửa đường dẫn trong DB, nâng giới hạn model, chạy bằng systemd) đã viết và thử trên bản sao DB, chờ người vận hành chạy.
- (2) Xong: binding `experimentRun`, artifact `experiment_build`, chọn tập con, chạy lại một phần (mang kết quả sang), thẻ "Code đã sẵn sàng" và "Chạy lại một phần". Review còn lỗi chặn sau các vòng sửa ở giai đoạn build không làm hỏng build mà hiện cho người dùng quyết định.
- (3) Xong phần lõi: semaphore theo số slot của máy (VPS 4 GB/2 CPU = 1 slot).
- Live qua web: lần 1 review chặn feature giao hàng mà blueprint yêu cầu (đã đổi thành hiện cho người dùng); lần 2 build đạt và hiện thẻ chọn, bước chạy lỗi do `within()` so khớp đường dẫn sai (đã sửa, có test; lỗi này cũng làm kiểm tra đường dẫn của `python-sandbox` lỏng hơn dự định).
- Live qua web lần 3 (27/10, Olist 8.000 đơn, 14,3 phút): build → thẻ "Code đã sẵn sàng" (review đạt) → chạy 4 phương án lần lượt → Verify → chọn Logistic Regression và tải gói; manifest ghi `selectedVariant: logistic_regression`. ROC-AUC: Random Forest 0,772 (gợi ý), Logistic Regression 0,771, XGBoost 0,766, LightGBM 0,758 trên 1.600 dòng kiểm tra.

**Đợt 3 (27/10) — theo dõi lượt chạy và giao diện mới:**

- Trace trực tiếp: mỗi bước của TW-06 (agent viết/sửa code, sandbox chạy `prepare_data.py`, Anvil chia dữ liệu, chạy thử trên mẫu, review, chạy từng phương án, chấm điểm) được ghi ngay khi bắt đầu và khi kết thúc (sự kiện `system3_progress` trong `workflow_events`, không cần migration). API `GET /api/system3/operations/{id}/trace`; stream operation gửi thêm sự kiện `trace`. Trang **Lượt chạy** hiện tiến trình theo giai đoạn, thời gian, số lượt gọi agent, số lần chạy sandbox và chi tiết từng bước (log, nội dung gửi lại agent); bước chưa kịp báo kết quả khi lượt chạy đã dừng hiện "Bị ngắt".
- Giao diện System 3: nền sáng (ngà), tiêu đề/nhãn JetBrains Mono, màu nhấn xanh lá; sidebar 7 tab (Tổng quan, Nguồn dữ liệu, Bản hiểu, Kế hoạch & duyệt, Lượt chạy, Kết quả, Bàn giao). Tổng quan giữ nguyên luồng thao tác cũ; mỗi tab giai đoạn dùng lại cùng chi tiết hoạt động. Chế độ tối giữ nguyên.
- Profile dataset không còn dừng ở cột có trên 50.000 giá trị khác nhau (ví dụ `order_id`): cột đó được ghi "≥ N" (`distinctCountCapped`). Đã chạy trên bộ Olist Kaggle đầy đủ (5 bảng, 99–113 nghìn dòng/bảng): profile được cả 5 bảng, mỗi bảng ≤ 1,3 giây.
- Kiểm chứng: test system3/server/web đạt; E2E offline 9/9 (2 test live bỏ qua) sau khi cập nhật điều hướng mới; trace kiểm tra trên giao diện với lượt chạy giả lập (lịch sử, trực tiếp qua SSE, bị ngắt; desktop, điện thoại, chế độ tối). Sửa thêm lỗi form Tạo dự án tràn ngang 2px ở màn 390px (cột grid co theo nội dung). Chưa chạy lại test sandbox thật (máy dev không cho user `nobody` đọc runtime trong thư mục tạm) và chưa chạy live với model thật sau thay đổi này.

**Đợt 4 (27/10) — chạy đầu-cuối trên web với model thật và sửa lỗi:**

- Chạy 3 dự án Olist (bộ mẫu 8.000 đơn, `router9/cx/gpt-6-luna` cho cả agent thi công và review) qua giao diện web, server chạy bằng user thường: Tạo dự án → Bản hiểu → Phê duyệt → Build (trace trực tiếp) → chạy phương án song song 2 → Verify → Kết quả → Bàn giao. Lần 2: gợi ý XGBoost 0,781; chọn LightGBM, manifest ghi `selectedVariant: lightgbm`. Lần 3: chạy lại riêng TW-06 qua lượt chạy lại → Verify tự chạy → bàn giao được.
- Sandbox: server không chạy root thì `systemd-run` dùng user manager (`--user`) thay vì xin quyền system manager qua polkit (vốn chạy sandbox bằng root và không ghi được thư mục kết quả của server). Giới hạn RAM/CPU vẫn áp dụng; 7 test sandbox thật đạt khi chạy bằng user thường. Build bắt đầu bằng bước "Kiểm tra sandbox" (`sandbox_check`): sandbox không đọc được dữ liệu hoặc không ghi được kết quả thì dừng trước lượt gọi agent đầu tiên với thông báo rõ, không gửi lỗi môi trường cho agent sửa.
- Lượt chạy lại (attempt): chạy lại riêng TW-06 nay tự Verify như đường chính (trước đây dự án kẹt ở "đang xác minh"); attempt đã xong không còn chặn các bước sau (trước đây không thể Bàn giao); khi bắt đầu execution/verification/delivery bị từ chối thì attempt trở lại "chờ" thay vì kẹt "đang chạy"; bản xem trước chặn chạy lại riêng Xây dựng khi kế hoạch không còn ở trạng thái chờ chạy.
- Lỗi cuối cùng của lượt chạy là lỗi của node thất bại (ví dụ "Agent đã dùng hết số vòng sửa ở bước chuẩn bị dữ liệu…"), không còn "Workflow did not complete successfully". Trang Lượt chạy có khối "Bước Xây dựng dừng vì lỗi" kèm nút Chạy lại.
- Giao diện: trang tự cập nhật khi phân tích xong sau "Tạo và bắt đầu phân tích"; bỏ hộp "Cần xử lý trước khi chấp nhận" sau khi đã chấp nhận; nhãn "Chờ bạn" khi bước đang chờ người dùng; trace ghi "gửi lại agent" chỉ khi thật sự có vòng sửa sau đó và "Sửa …" cho lượt agent do review yêu cầu; bảng Kết quả không bẻ chữ/số; thanh lượt chạy dùng token màu System 3 và không tràn ngang; xác nhận dọn lượt chạy ngay trong trang (trình duyệt nhúng chặn `confirm()`); Bàn giao từ thanh lượt chạy với dự án thí nghiệm chuyển sang trang Kết quả để người dùng chọn; trang Bàn giao hiện phương án đã chọn; đổi tab không còn tải lại cả trang; câu chữ người dùng thấy bớt thuật ngữ nội bộ.
- Dự án cục bộ mới ghi `worktree.baseBranch: main` vào `.anvil/config.yaml` trong commit khởi tạo (repo không có remote nên không dò được nhánh mặc định, mỗi workflow trước đây ghi cảnh báo kèm stack).
- Live lần 2 cho thấy review lật qua lật lại: vòng 1 chặn feature giao hàng vì rò rỉ theo thời gian (agent bỏ feature mà FR-03 yêu cầu), vòng 2 chặn vì thiếu FR-03 (agent thêm lại). Nay review có trường `question`: lo ngại về một yêu cầu của blueprint thành câu hỏi cho người dùng và build dừng ở "cần bạn quyết định" (giai đoạn review), không gửi cho agent sửa; builder được dặn không bỏ yêu cầu của blueprint để qua review/sandbox mà phải hỏi. Có test sandbox thật cho trường hợp này. Ghi chú, tóm tắt, phát hiện và câu hỏi của agent phải viết bằng tiếng Việt (trước đây có lúc lẫn tiếng Tây Ban Nha).
- Màn tải đầu tiên của trang dự án không còn nháy nền tối: `index.html` tô sẵn nền sáng System 3 (`data-surface="system3-light"`) theo URL và theme đã lưu; System 3 giữ thuộc tính này theo theme và gỡ khi sang `/console`. Bảng màu System 3 đã ghi vào brand guide (mục "System 3 surface") và doc 07 (§8, §10 cập nhật theo 7 tab).
- Pipeline một trang (28/10): tab đầu tiên của dự án là **Pipeline** — 6 bước xếp dọc, bước hiện tại tự mở với đúng phần cần thao tác (chế độ `compact` của chi tiết activity), các tab còn lại là "Chi tiết từng bước". Live (Olist, `gpt-6-luna`), toàn bộ trên một trang: tạo dự án → chấp nhận bản hiểu → phê duyệt và chạy → agent dừng hỏi về FR-03 (đúng quy tắc mới, bằng tiếng Việt) → tải blueprint đã làm rõ → "Phân tích lại với nguồn mới" → chấp nhận → build (review đạt) → chạy 4 phương án song song 2 → Verify → chọn Random Forest (gợi ý, ROC-AUC 0,770) → tải gói; manifest ghi `selectedVariant: random_forest`. Blueprint mẫu `review-risk-blueprint.md` tự mâu thuẫn ở FR-03 (cần độ trễ giao hàng nhưng cấm thông tin sau thời điểm đánh giá); đã làm rõ: chỉ tính khi ngày giao thực tế trước thời điểm tạo đánh giá. Sửa kèm: sau khi phân tích lại, các bước sau Bản hiểu hiện "Đang chờ" thay vì kết quả/lỗi của nền cũ; form thêm nguồn thẳng hàng; khung đầu trang Nguồn dữ liệu dùng nền phẳng của System 3; nhãn "Chờ bạn" cho phê duyệt và bàn giao.
