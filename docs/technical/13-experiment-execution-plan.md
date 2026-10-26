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

- Trước khi thi công, Anvil tạo **file split cố định** (chỉ số train/test và các fold) từ dữ liệu đã pin và giao thức đánh giá, rồi ghi hash. Tập test **chỉ có chỉ số, không có nhãn** trong workspace của agent; nhãn test giữ ở vùng chỉ Anvil đọc.
- Code của agent phải xuất **dự đoán** của từng phương án theo định dạng cố định (`predictions/<variant>.csv`) và `metrics.json` tự báo cáo.
- TW-07 dùng **bộ đánh giá viết sẵn của Anvil** (Python, không phải code LLM) để tính lại metric từ dự đoán và nhãn giữ riêng. Lệch so với số agent tự báo thì ghi Evidence `failed`. Đây là thứ thay harness thủ công.

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
| `experiment` | 2,5 GiB | 2 | 30 phút/phương án | Chạy thí nghiệm thật |

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

[← Mục lục](README.md) · [Kế hoạch 11 (nền UI và luồng)](11-simplification-and-core-flow-plan.md)
