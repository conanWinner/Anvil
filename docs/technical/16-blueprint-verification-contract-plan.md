# 16 — Kế hoạch: hợp đồng kiểm chứng trong blueprint System 2

Ngày: 30/10/2026. Trạng thái: **lát cắt đầu đã làm (§3 "Lát cắt đầu"), các phần còn lại là kế hoạch**. Baseline: commit `a988571`.

Tài liệu này biến [định hướng 15](15-blueprint-fidelity-direction.md) thành các đợt làm cụ thể, với một điều kiện mới: **System 2 đổi được định dạng blueprint**. Lý do và phân tích hiện trạng ở 15; tiến độ ghi ở [13](13-experiment-execution-plan.md).

## 1. Ý tưởng chính

Blueprint có thêm một **hợp đồng kiểm chứng** máy đọc được. System 2, không phải agent thi công, nêu từng điều kiện nghiệm thu và cách kiểm tra. Anvil chạy các kiểm tra đó bằng code của mình.

```text
Blueprint (văn xuôi + hợp đồng kiểm chứng)
  → ghim cùng Source Version, đi qua Readiness và Approval
  → agent viết code, kiểm tra chạy trong vòng sửa lỗi
  → TW-07 chạy lại độc lập từ gói bất biến
  → requirementCoverage thật trong Evidence → bảng đạt/thiếu cho người dùng
```

So với tự suy ra từ văn xuôi, cách này có ba lợi ích:

- Không phải đoán: ngưỡng, feature bắt buộc và đáp án kiểm thử do System 2 chốt, nên không biến số tham khảo thành gate.
- Có đáp án độc lập: ca kiểm thử nhỏ với kết quả kỳ vọng kiểm được logic tạo nhãn, điều mà giữ nhãn holdout không chứng minh được (15 §4.4).
- Phát hiện mâu thuẫn sớm: khai báo thời điểm có sẵn của từng feature cho phép phát hiện lỗi kiểu FR-03 ở Readiness, trước khi tốn lượt gọi model.

## 2. Thiết kế hợp đồng

**Vị trí và định dạng hiện hành:** [đặc tả cho System 2](../system_2/verification-contract.md). Vì nằm trong blueprint, hợp đồng tự động được ghim theo Source Version và thuộc phạm vi phê duyệt; đổi hợp đồng là đổi basis.

**Blueprint là dữ liệu, không phải lệnh.** `check.kind` là danh sách đóng do Anvil diễn giải. Hợp đồng không được chứa code, lệnh hay đường dẫn; kind lạ làm điều kiện đó thành `not_verified` kèm Issue, không bị bỏ qua âm thầm.

Các kind dưới đây là dự kiến; hiện chỉ có `golden_cases` và `manual`. Mỗi kind khi làm phải có `claim` và `limitation` cố định trong code, được in vào Evidence, để giao diện không nói quá điều đã đo.

| `check.kind` | Điều đo được | Không chứng minh | Giai đoạn chạy |
| --- | --- | --- | --- |
| `golden_cases` | Đúng tập `entity_id` và `target` trên ca mẫu đã duyệt | Đúng trên toàn bộ dữ liệu; feature; leakage | Trước `prepare_data.py` đầy đủ, TW-07 |
| `manual` | Không đo; cần người xem xét | | Không chạy |
| `columns_present` | Bảng mô hình hóa có đủ cột | Giá trị cột đúng | Sau `prepare_data.py` |
| `columns_forbidden` | Không có **tên** cột cấm | Cột cấm đã được biến đổi thành feature khác | Sau `prepare_data.py` |
| `input_independence` | Đổi nội dung, độ dài, null của cột cấm trên ca mẫu thì đầu ra đã khai báo không đổi | Không leakage nói chung | Sau `prepare_data.py` |
| `row_grain` | Mỗi thực thể đúng một dòng trên bảng thật | Tập thực thể đúng nghiệp vụ | Sau `prepare_data.py` |
| `model_class` | Model thật của lần chạy chính thức đúng lớp và tạo lại được dự đoán | Chống giả mạo có chủ đích | Sau chạy thật |
| `repeat_run_equal` | Hai lần chạy độc lập cho dự đoán trùng trong dung sai | Code đã cố định seed | Sau chạy thử |
| `metric_threshold` | Metric chính thức đạt ngưỡng | Không leakage | Chỉ TW-07 |
| `runtime_limit` | Thời gian chạy trong giới hạn (RAM đỉnh chưa được đo) | Hiệu năng trên máy khác | Sau chạy thật |
| `artifact_present` | File tồn tại, không rỗng | Nội dung đúng hay đủ | Sau chạy thật |

Ghi chú theo góp ý review 30/10:

- `model_class` không dùng `run_manifest.json` do agent tự xuất: Random Forest có thể khai XGBoost, và mã agent ghi được mọi thứ trong `/work/out`. Khi làm: lần chạy chính thức lưu model, một bước của Anvil trong sandbox riêng nạp model, kiểm tra lớp estimator rồi dự đoán lại và so với CSV chính thức. Trước khi làm được thì giữ `not_verified`.
- `input_independence` không đổi cả bảng đánh giá: FR-03 cần `review_creation_date` và target cần `review_score`. Hợp đồng nêu rõ cột được đổi và cột đầu ra được so; chạy bản gốc hai lần trước, nếu đã khác nhau thì là `not_verified`.
- `repeat_run_equal`: test không được dựa vào xác suất hai lần Random Forest khác nhau; dùng ca không tất định có kiểm soát, và có ca đối chứng mô hình tất định không đặt seed vẫn qua mà không ghi "đã cố định seed".
- `artifact_present` không tính báo cáo stub là đạt nội dung; thêm kiểm tra nội dung khi có yêu cầu cụ thể như FR-08 của Customer Churn.

**Trạng thái mỗi điều kiện:** theo 15 §4.6: `passed`, `failed`, `not_verified`, `blocked`, `waived`, `not_applicable` (hai trạng thái cuối chưa có). Chỉ kiểm tra của Anvil mới cho ra `passed`. Ý kiến của agent review được ghi riêng và điều kiện vẫn là `not_verified`, đúng nguyên tắc chỉ Evidence mới xác nhận yêu cầu.

**Độ phủ.** Mẫu số là mọi yêu cầu trong basis đã duyệt; yêu cầu không có trong hợp đồng vẫn hiện `not_verified`. `declaredChecks` (độ đạt của các kiểm tra đã khai báo) tách khỏi `requirementCoverage` (độ đáp ứng cả blueprint). Yêu cầu có mọi điều kiện đã duyệt đều đạt chỉ là `criteria_passed`, chưa phải đạt: một điều kiện không chứng minh hết điều kiện nghiệm thu nhiều ý, nên `verified` luôn là 0 cho tới khi hợp đồng khai báo được độ phủ đầy đủ của một yêu cầu.

**Tương thích ngược.** Blueprint không có hợp đồng vẫn chạy như hiện tại, kế hoạch không có thêm trường nào nên hash cũ vẫn đúng, và độ phủ là 0/N chứ không phải 0/0. Kế hoạch duyệt trước thay đổi này không có danh sách yêu cầu trong Verify nên ghi `total: null`. Không tự nâng trạng thái dự án cũ.

## 3. Các đợt triển khai

Mỗi đợt là một nhánh và PR riêng về `dev`, hoàn tác độc lập. Chính sách và kiểm tra nằm trong `packages/system3`; `packages/workflows` không đổi.

**Thứ tự (đổi theo góp ý review 30/10):** lát cắt đầu đi hết từ fixture đến Evidence → mở rộng các kind ở đợt 3 → đợt 1 và đợt 2 (UI, truy vết). Khai báo của agent ở đợt 2 không được làm tăng độ phủ.

### Lát cắt đầu — FR-02 của review-risk, từ fixture đến Evidence (đã làm)

Gộp đợt 0 và phần đầu đợt 3, chỉ với `golden_cases` và `manual`. Kết quả và kiểm chứng ở [13](13-experiment-execution-plan.md).

- Đọc Markdown và JSON (`schemaVersion: 2`), ghim vào Bản hiểu, kế hoạch và Approval.
- `golden_cases` chạy trong sandbox từ fixture đủ 5 bảng, so chính xác tập `entity_id` và `target`; lỗi thành phản hồi cho builder.
- TW-07 chạy lại từ gói bất biến, dùng hợp đồng trong bundle đã duyệt; Evidence đủ mọi yêu cầu.
- Không phân loại lỗi môi trường thành `failed`: Anvil chạy script của mình trước, script đó lỗi thì là `blocked`.
- Split được ghim với code tạo ra nó: file có từ lúc split mà đổi thì Anvil tạo lại split và chạy thử lại trước khi coi là sẵn sàng. Ca mẫu đạt không phải bằng chứng split và code đồng nhất.
- `failed` hoặc `blocked` ở TW-07 chặn cổng G5; `not_verified` chưa chặn (§5).

### Đợt 1 — Bản hiểu đối chiếu được với nguồn

Dữ liệu đã có: mỗi thành phần tài liệu có trạng thái `extracted`, `ignored_with_reason`, `unsupported` hoặc `unclassified` (`understandingCoverageEntrySchema`), mỗi giá trị có `sourcePointers`. Điểm thiếu là giao diện: `UnderstandingWorkspace.tsx` chỉ hiện mục tiêu, tối đa 6 yêu cầu và các con số tổng; người dùng không kiểm tra được Anvil đã đọc đủ blueprint chưa.

- Hiện đủ sáu phần của blueprint, mỗi phần có số thành phần đã trích, bỏ qua có lý do, chưa hiểu. Không còn cắt ở 6 yêu cầu.
- Mỗi giá trị có trích dẫn nguồn (tệp, dòng hoặc trang); bấm vào mở đúng đoạn trong blueprint, tô sáng ngay trong trang.
- Có chế độ xem theo tài liệu: blueprint gốc với phần chưa được trích được đánh dấu, để thấy phần bị bỏ sót.
- Không tính đọc đủ là đã làm đủ: đây là độ phủ khi đọc, không phải độ hoàn thành code (15 §7).
- **Hoàn tất khi:** với `DESIGN_B_2.md` và blueprint Olist, mọi thành phần đều thấy được trạng thái; mọi trích dẫn mở đúng dòng; một đoạn cố ý viết lệch mẫu hiện là chưa hiểu thay vì biến mất.

### Đợt 2 — Ma trận truy vết

- `builderResponseSchema` thêm `traceability` (mã yêu cầu → tệp, hàm, cột, trạng thái) và `deviations`; `reviewResponseSchema` thêm kết luận theo từng điều kiện. Cập nhật cả hai JSON Schema gửi cho provider.
- `ExperimentBuildInput` nhận danh sách yêu cầu từ kế hoạch đã ghim; tăng `schemaVersion` của `experimentPlanSchema` và vẫn đọc được bản cũ. Anvil trả lại agent nếu thiếu mã bắt buộc.
- Gói bàn giao có `results/traceability.json`; `ExperimentResults.tsx` hiện bảng: Yêu cầu, Phần code, Kết quả, Bằng chứng.
- **Hoàn tất khi:** agent bỏ sót mã bắt buộc thì bị yêu cầu bổ sung; bảng trung thực ghi đây là khai báo của agent, chưa phải bằng chứng.

### Đợt 3 — Kiểm tra tự động

- Mở rộng `experiment-contract-checks.ts` theo thứ tự: `columns_*`, `row_grain`, `input_independence`, rồi `repeat_run_equal`, `model_class`, `metric_threshold`.
- Gói bàn giao cần thêm `modeling_table.csv` kèm hash để TW-07 kiểm được `columns_*` và `row_grain` trên bảng thật.
- **Hoàn tất khi:** đạt bộ đo ở §4; agent không sửa được bộ kiểm tra hay ca kiểm thử.

### Đợt 4 — Báo cáo khả thi của blueprint

*Đã làm phần lõi ngày 31/10 (tiến độ ở [13](13-experiment-execution-plan.md), Đợt 9): kiểm tra bằng code, rà soát bằng LLM có `exactQuote`, Decision trong Bản hiểu, ghim vào kế hoạch và prompt. Khác thiết kế dưới đây: thêm kiểm tra cột trống có đoán được nhãn không sau khi có bảng dữ liệu. Chưa làm: phiếu đề nghị sửa gửi System 2, kiểm tra `availableAt` theo hợp đồng, câu hỏi của agent trong lúc build chưa dùng chung Decision.*

Hiện đã kiểm tra tính nhất quán của tài liệu (`quality.ts`), dữ liệu khớp khai báo, khoảng trống của kế hoạch và runtime đã cài (TW-03). Chưa có câu trả lời cho câu hỏi: blueprint này có làm được không, và cần sửa gì?

Sau Hiểu dự án, Anvil tạo một báo cáo, mỗi mục có trích dẫn nguồn và kết luận `khả thi`, `cần làm rõ`, `cần sửa blueprint` hoặc `vượt khả năng hiện tại`:

- **Kiểm tra bằng code, tin cậy cao:** cột và bảng được nêu có trong CSV thật không; thư viện yêu cầu có trong tệp khóa runtime không; RAM, CPU và thời gian yêu cầu so với profile sandbox; kiểu bài toán có được hỗ trợ không; với hợp đồng thì thêm feature có `availableAt` sau mốc cắt, cột vừa bắt buộc vừa cấm.
- **Rà soát bằng LLM, chỉ để đề xuất:** tìm mâu thuẫn giữa các yêu cầu, chỗ mơ hồ, yêu cầu không kiểm được. Mỗi phát hiện phải có trích dẫn nguyên văn khớp với blueprint (dùng lại quy tắc `exactQuote` của hỗ trợ ngữ nghĩa), không khớp thì bị loại. Ghi rõ đây là đề xuất của LLM, không tự chặn và không tự trả lời.
- Mục cần người dùng quyết định thành Decision; câu trả lời được ghim phiên bản và đưa vào prompt, thay cho việc sửa tay blueprint rồi phân tích lại. Câu hỏi của agent trong lúc build dùng chung cơ chế này.
- Tải được **phiếu đề nghị sửa** (Markdown hoặc JSON: vị trí, vấn đề, phương án) để gửi lại System 2.
- Không tự sửa blueprint: System 2 hoặc người dùng tạo Source Version mới, rồi Anvil phân tích lại.
- **Giới hạn:** báo cáo không chứng minh được bài toán sẽ thành công. Ví dụ lệch lớp ~99% của DESIGN_B_2 trên Olist chỉ lộ ra sau khi tạo nhãn; loại lỗi này vẫn được bắt ở bước build, hoặc sớm hơn nếu hợp đồng khai báo được quy tắc nhãn.
- **Hoàn tất khi:** blueprint có mâu thuẫn kiểu FR-03, cột không tồn tại, thư viện ngoài runtime hay yêu cầu 8 GB trên sandbox 2 GB đều được báo trước lượt gọi agent thi công đầu tiên; đổi câu trả lời thì phải duyệt lại.

### Đợt 5 — Kiểm thử viết trước code (có điều kiện)

Chỉ làm nếu bộ đo cho thấy còn nhiều điều kiện quan trọng phải để `manual`. Một phiên agent riêng chỉ đọc blueprint và cấu trúc dữ liệu, viết test cho các điều kiện đó trước khi có code; Anvil giữ test và người dùng xem trước khi dùng. Test sai so với blueprint thì thành câu hỏi, không tự sửa.

## 4. Bộ đo

Thêm test có sẵn code mẫu cố ý sai, **không gọi model**, chạy trong `bun test src` (test cần sandbox thật thì đặt sau `ANVIL_SANDBOX_TESTS`). Mỗi lỗi cài vào phải bị bắt:

| Lỗi cài vào | Phải bị bắt bởi |
| --- | --- |
| Đảo nhãn, đổi `≤ 2`, lấy đánh giá muộn nhất, giữ đơn không có đánh giá, làm rơi dòng, nhân dòng do join sai (đã có) | `golden_cases` |
| Bỏ yêu cầu khỏi hợp đồng; blueprint 13 yêu cầu, hợp đồng 1 điều kiện đạt (đã có) | Yêu cầu vẫn `not_verified`; 1/1 khai báo, 13 ở mẫu số, `verified` 0 |
| Thiếu một feature của FR-03; dùng tên cột `review_comment_message` | `columns_present`, `columns_forbidden` |
| Tạo `comment_length`, `has_comment` từ cột cấm rồi bỏ cột gốc | `input_independence` |
| Nhân dòng do join sai trên bảng thật | `row_grain` |
| Huấn luyện Random Forest nhưng khai XGBoost; lưu XGBoost nhưng dự đoán bằng Random Forest | `model_class` |
| Ca không tất định có kiểm soát; đối chứng mô hình tất định không đặt seed | `repeat_run_equal` |
| Sinh file rỗng | `artifact_present` |
| `prepare_data.py` dạng stub | `golden_cases` |

Sau đợt 3, chạy thật trên Olist với model thật và ghi vào kế hoạch 13, tách riêng: tỷ lệ kiểm tra đã khai báo ở `passed`, độ phủ trên mọi yêu cầu của basis, số vòng sửa, thời gian. Không gộp thành một điểm trung bình.

## 5. Quyết định cần chốt

| Câu hỏi | Đề xuất | Lý do |
| --- | --- | --- |
| Agent có thấy ca `golden_cases` không? | Có, ở bản đầu | Lỗi dễ sửa hơn. Rủi ro là agent viết code khớp riêng các ca này; TW-07 có thể thêm ca ẩn sau |
| Thiếu điều kiện bắt buộc có chặn bàn giao không? | Chưa chặn: hiện rõ và ghi vào manifest | Giữ quyết định đợt 2 của kế hoạch 13 là người dùng tự quyết. Gate cứng và ngoại lệ gắn hash (15 §4.6) xét sau khi kiểm tra đã ổn định |
| Ai sửa exporter của System 2? | Cần người phụ trách System 2 | Code System 2 không nằm trong repo này; đợt 0 chỉ làm được đặc tả và blueprint mẫu |

## 6. Ngoài phạm vi

Chia nhiệm vụ theo module và vượt giới hạn 40 tệp (15 §4.3) là việc riêng, làm sau khi có bộ đo. Không làm RAG, nhiều agent song song hay framework kiểm thử mới; không cho blueprint chạy code tùy ý.

[← Mục lục kỹ thuật](README.md) · [Định hướng 15](15-blueprint-fidelity-direction.md) · [Kế hoạch 13](13-experiment-execution-plan.md)
