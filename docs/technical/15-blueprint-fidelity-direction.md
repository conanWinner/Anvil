# 15 — Định hướng phát triển: code bám sát blueprint System 2

Ngày: 30/10/2026. Trạng thái: **đề xuất để thảo luận, chưa triển khai**.

Baseline đối chiếu: nhánh `fix/system3-approval-dialog`, commit `a988571`. Có thay đổi sẵn ở hai file UI, `.claude/launch.json` và `baocao/`; tài liệu này không sửa các phần đó. Phạm vi khảo sát là code đọc blueprint, lập kế hoạch thí nghiệm, builder/reviewer và Verify; chưa chạy lại model thật, sandbox hoặc kiểm thử đầu-cuối.

Tài liệu bổ sung hướng phát triển cho [kế hoạch 13](13-experiment-execution-plan.md), không thay thế sổ tiến độ hiện hành. [DESIGN_B_2.md](../system_2/DESIGN_B_2.md) được dùng làm ví dụ cụ thể, không làm khuôn cứng cho mọi dự án.

## 1. Định hướng chính

**Nên phát triển Anvil theo hướng mỗi yêu cầu trong blueprint đều có phần triển khai và cách kiểm chứng tương ứng.** Agent vẫn viết code, nhưng Anvil phải biết yêu cầu nào đã được hiểu, được đưa vào kế hoạch, được thực hiện và có bằng chứng đạt.

Hiện tại, đường thí nghiệm tập trung vào tạo dữ liệu, huấn luyện các phương án và chấm metric. Để code sát System 2 hơn, cần mở rộng từ “chạy thí nghiệm thành công” sang “hoàn thành đúng phạm vi blueprint đã duyệt”. Tăng chất lượng prompt hữu ích, nhưng không đủ để kiểm soát việc bỏ sót yêu cầu.

Chuỗi cần nối liền:

```text
Nguồn blueprint đã ghim phiên bản
  → Yêu cầu và điều kiện nghiệm thu có tham chiếu nguồn
  → Phạm vi đã duyệt + cách kiểm chứng từng điều kiện
  → Nhiệm vụ triển khai theo module và phụ thuộc
  → Code + kết quả chạy + kiểm thử
  → Evidence cho từng điều kiện
  → Bàn giao kèm phần đạt, phần thiếu và ngoại lệ đã chấp nhận
```

Phương án nhẹ nhất để bắt đầu: dùng dữ liệu Understanding đã có, bổ sung bảng đối chiếu yêu cầu và một nhóm kiểm tra nghiệp vụ. Chưa cần viết lại runtime, thêm cơ sở dữ liệu đồ thị hay hệ thống tìm kiếm tài liệu.

## 2. “Sát blueprint” cần được hiểu thế nào?

| Khía cạnh | Điều cần bảo đảm | Bằng chứng phù hợp |
| --- | --- | --- |
| Đúng bài toán | Đúng đối tượng, target, nhãn dương, mốc thời gian và dữ liệu được phép dùng | Ca kiểm thử nghiệp vụ có kết quả kỳ vọng độc lập |
| Đủ chức năng | Không bỏ tính năng, báo cáo hoặc phương án bắt buộc | Danh sách điều kiện nghiệm thu và kết quả từng điều kiện |
| Đúng thiết kế | Giữ module, đầu vào/đầu ra, hàm và đường dẫn bắt buộc | Kiểm tra cấu trúc kết hợp test hành vi |
| Đúng ràng buộc | Đúng công nghệ, tài nguyên, cách chia và cách đánh giá đã duyệt | Runtime lock, cấu hình ghim, số đo và kiểm tra thực thi |
| Đủ bàn giao | Có code, kết quả, hướng dẫn và các báo cáo được yêu cầu | Kiểm tra gói và chạy tái lập |

Không đo bằng tỷ lệ câu chữ giống blueprint hoặc số file được tạo. Một file có đúng tên nhưng chứa `pass` không đáp ứng yêu cầu. Metric tốt cũng không chứng minh nhãn được tạo đúng hay báo cáo SHAP đã tồn tại.

Tách rõ ba loại nội dung: **bắt buộc**, **tùy chọn**, **chưa quyết định**. “LightGBM được khuyến nghị”, “K-means tùy chọn” và “cần có baseline Logistic Regression” không có cùng ý nghĩa. Số benchmark từ tài liệu tham khảo không tự trở thành ngưỡng nghiệm thu.

## 3. Hiện trạng đã đối chiếu với code

| Thành phần | Đã có trong code | Khoảng cách cần giải quyết |
| --- | --- | --- |
| Understanding | Bộ trích xuất có `requirements`, `pipeline`, `technologyStack`, `moduleDesign`, `executionBlueprint`; giữ tham chiếu nguồn | Tận dụng các dữ liệu này ở Build/Verify, không chỉ trình bày Bản hiểu |
| Kiểm tra Bản hiểu | Kiểm tra thiếu điều kiện nghiệm thu, ID trùng, tham chiếu không tồn tại, yêu cầu không được thiết kế tham chiếu | Độ bao phủ khi đọc tài liệu không phải độ hoàn thành của code sinh ra |
| Kế hoạch thí nghiệm | Trích model/kỹ thuật, suy ra protocol, giữ `requirementIds` và hash kế hoạch | Chưa biểu diễn đầy đủ điều kiện nghiệm thu của từng module/chức năng |
| Builder | Nhận blueprint gốc, viết `prepare_data.py`, `train_variant.py` và module hỗ trợ; chạy thử và sửa có giới hạn | Hai điểm vào chạy được chưa bảo đảm cây code, hàm, báo cáo và test của chương 6 được thực hiện đủ |
| Reviewer | Đọc blueprint và code; phát hiện leakage, sai target, thiếu model; có `question` khi cần người dùng quyết định | Finding hiện có severity/file/message, chưa có kết quả bắt buộc cho từng điều kiện nghiệm thu |
| Verify thí nghiệm | Chấm lại dự đoán và so kết quả; xuất Evidence | Code ghi rõ `requirementCoverage: { status: 'not_verified', verified: 0, total: 0 }` |

Các nguồn code chính:

- [Understanding schemas](../../packages/system3/src/understanding/schemas.ts), [extractors](../../packages/system3/src/understanding/extractors/index.ts), [quality checks](../../packages/system3/src/understanding/quality.ts).
- [Experiment plan](../../packages/system3/src/experiment-plan.ts), [test trên blueprint mẫu](../../packages/system3/src/experiment-plan.test.ts).
- [Builder và reviewer](../../packages/system3/src/experiment-builder.ts), [Verify thí nghiệm](../../packages/system3/src/experiment-capabilities.ts).

Một số giới hạn cụ thể cần đưa ra trước lúc duyệt:

1. `deriveExperimentPlan` lấy metric xuất hiện đầu tiên làm metric chính; mặc định tỷ lệ test `0.2`, seed `42` cho stratified holdout, nhận biết time-aware qua từ khóa. Đây là quy tắc suy ra của Anvil, không nhất thiết là lựa chọn rõ ràng của System 2.
2. Ngưỡng metric hiện được trích từ success criteria. Điều kiện nằm trong bảng yêu cầu hoặc phần khác cần được đối chiếu để tránh bỏ sót hay lấy nhầm số tham khảo.
3. Prompt hiện có giới hạn 2 GB, 2 CPU và yêu cầu tìm siêu tham số nhỏ; blueprint mẫu nói môi trường 8 GB. Giới hạn chặt hơn không tự sai, nhưng có thể khiến agent giản lược công việc nếu không có bước kiểm tra tính khả thi.
4. Response builder giới hạn 40 file mỗi lượt; chương 6 của blueprint mẫu có hơn 40 mục `File:`. Cần chia nhiệm vụ, không giả định một lần sinh có thể hoàn tất toàn bộ thiết kế.
5. Verify có thể đạt khi không có metric mismatch và có ít nhất một phương án được xác minh. Trạng thái này không tương đương tất cả phương án hoặc mọi yêu cầu đều đạt.

Các nhận định trên là đọc code tại baseline; chưa phải đánh giá chất lượng một gói code sinh mới.

## 4. Những phần nên phát triển

### 4.1. Chuẩn hóa từng điều kiện nghiệm thu, giữ nguyên nguồn

Tái sử dụng `requirements` thay vì tạo bộ đọc mới. Một yêu cầu thường chứa nhiều điều kiện; tách chúng thành các mục con ổn định, ví dụ `FR-02.AC-01`, nhưng giữ nguyên câu gốc và vị trí trong Source Version.

Mỗi mục cần tối thiểu:

- ID yêu cầu/điều kiện; nội dung gốc; Source Version và vị trí nguồn.
- Mức bắt buộc/tùy chọn/chờ quyết định; phạm vi đã duyệt.
- Module, file hoặc hàm liên quan; quan hệ phụ thuộc.
- Cách kiểm chứng, kết quả kỳ vọng và Evidence cần có.
- Trạng thái kết quả và phiên bản code/dữ liệu/bộ kiểm tra đã dùng.

LLM có thể đề xuất cách tách điều kiện và test. Chưa được biến suy đoán đó thành yêu cầu chính thức. Điều kiện thiếu rõ ràng phải hiện là thiếu; không điền ngưỡng hoặc nghiệp vụ bằng phỏng đoán.

Bảng đối chiếu này là dữ liệu domain của System 3. Bản đầu có thể lưu cùng snapshot/kế hoạch và Evidence đã có; chỉ thêm bảng DB nếu thực sự cần truy vấn hoặc cập nhật độc lập.

### 4.2. Duyệt cách hiểu trước khi viết code

Ở TW-03 và OP-04, mỗi yêu cầu trong phạm vi phải có cách triển khai khả thi và cách nghiệm thu. Hiện riêng lựa chọn do Anvil đề xuất: metric chính, tỷ lệ chia, số fold, ngân sách và công nghệ thay thế.

OP-05 ghi nhận chính xác các lựa chọn được chấp nhận. Không hỏi lại cho mọi chi tiết lập trình nhỏ; chỉ hỏi khi thay đổi ý nghĩa nghiệp vụ, phạm vi, ràng buộc bắt buộc hoặc quyền thực thi.

Các trường hợp phải làm rõ:

- Blueprint yêu cầu feature được tạo sau thời điểm dự đoán, nhưng đồng thời cấm leakage.
- Module nói một dòng cho mỗi khách hàng tại mỗi thời điểm; contract chạy lại chỉ cho một dòng mỗi khách hàng.
- Yêu cầu nói 9 bảng nhưng chỉ có 5 bảng dữ liệu thật.
- Có nhiều metric nhưng chưa chọn metric ưu tiên; số tham khảo chưa được người dùng xác nhận.
- Cần thư viện không có trong runtime hoặc tài nguyên vượt môi trường được phép dùng.

Không tự đảo nhãn, loại khách hàng khó, bỏ feature hoặc đổi thuật toán để chạy qua. Decision phải dẫn tới thay đổi nguồn hoặc quyết định có phiên bản; cập nhật lại kế hoạch và approval khi basis thay đổi.

### 4.3. Triển khai theo module có đầu ra kiểm chứng được

Giữ `prepare_data.py` và `train_variant.py` làm điểm vào mỏng; chúng gọi các module được blueprint yêu cầu. Không bắt buộc dồn toàn bộ logic vào hai file này.

Mỗi nhiệm vụ Build nhận: đoạn nguồn liên quan, yêu cầu cần đáp ứng, contract đầu vào/đầu ra, interface phụ thuộc đã chốt, file được sửa và kiểm tra phải đạt. Luôn gửi kèm các ràng buộc chung để việc chia nhỏ ngữ cảnh không làm mất yêu cầu xuyên suốt.

Thứ tự khởi đầu phù hợp với ví dụ churn:

1. Tích hợp dữ liệu và kiểm tra chất lượng.
2. Tạo target với các ca kiểm thử đã chốt.
3. Feature engineering và kiểm tra mốc thời gian.
4. Tiền xử lý, cross-validation và các model.
5. Giải thích, phân tích threshold và báo cáo.
6. Đóng gói, batch scoring hoặc phần khác nếu nằm trong phạm vi đã duyệt.

Đây là nhóm công việc bên trong TW-06, không phải Lifecycle Phase hay Lifecycle Activity mới. Không mặc định tạo một agent cho mỗi module. Một builder làm tuần tự và một reviewer hiện tại đủ cho bước đầu.

Trước mỗi nhóm, kiểm tra ngân sách context/output và số file. Nếu không đủ, chia nhỏ tiếp; không cắt mất điều kiện bắt buộc. Sửa lỗi chỉ ở phạm vi cần thiết, sau đó chạy kiểm tra hồi quy cho phần phụ thuộc.

### 4.4. Kiểm chứng bằng hành vi và kết quả thật

| Lớp kiểm tra | Ví dụ | Giới hạn cần công khai |
| --- | --- | --- |
| Cấu trúc | File/hàm bắt buộc, chữ ký hàm, import, contract dữ liệu | Tên đúng chưa chứng minh logic đúng |
| Nghiệp vụ | Nhãn churn, phép join, cutoff, feature chỉ dùng dữ liệu được phép | Phải có kết quả kỳ vọng độc lập với code builder |
| Thực nghiệm | Đủ phương án, đúng split/fold, đúng thuật toán, metric tính lại | Điểm tốt chưa chứng minh không leakage |
| Đầu ra | SHAP, biểu đồ, báo cáo, model và hướng dẫn đủ nội dung | Có file chưa chứng minh nội dung có ý nghĩa |
| Tài nguyên/tái lập | Peak RAM, thời gian, hai lần chạy cùng cấu hình | Phải ghi rõ máy, dữ liệu và runtime thực tế |

Dùng công cụ sẵn có trước: Python `ast` cho cấu trúc, `unittest`/assert cho hành vi, bộ chấm Anvil hiện có cho metric. Không cần thêm framework kiểm thử mới chỉ để nối yêu cầu với bằng chứng.

Builder được viết test để tự sửa, nhưng test do builder tự đặt đáp án không đủ làm bằng chứng độc lập. Bộ kiểm tra do Anvil quản lý phải nằm ngoài vùng builder được sửa; input, output thực và kết luận được Anvil thu thập. Reviewer hỗ trợ đánh giá ngữ nghĩa khó tự động hóa, không thay thế test độc lập.

Đặc biệt: nhãn holdout hiện được tách từ bảng do `prepare_data.py` tạo ra. Giữ nhãn riêng giúp bảo vệ bước huấn luyện, nhưng **không chứng minh logic tạo nhãn đúng**. FR-02 cần được kiểm tra từ giao dịch gốc và quy tắc nghiệp vụ đã chốt.

Với time-series CV: kiểm tra mốc train/validation từng fold, thời gian nhãn hoàn tất, cách fit preprocessing và trường hợp trùng khách hàng giữa các cửa sổ. Time holdout cuối cùng không thay thế cross-validation tối thiểu 3 fold mà blueprint mẫu nêu.

Threshold và siêu tham số chỉ chọn trên train/validation. Không đưa metric holdout trở lại vòng sửa để tối ưu lặp vô hạn; thay đổi thích nghi theo holdout phải được ghi nhận và có tập kiểm tra mới khi cần kết luận độc lập.

### 4.5. Review theo điều kiện, không chỉ trả verdict tổng

Mở rộng báo cáo review để mỗi finding gắn với `requirementId`, điều kiện nghiệm thu, vị trí code và kiểm tra liên quan. Mỗi điều kiện phải có kết luận, kể cả “chưa đủ bằng chứng”.

Tách hai vấn đề:

- **Code sai yêu cầu đã rõ:** trả builder sửa, giữ nguyên yêu cầu.
- **Yêu cầu tự mâu thuẫn hoặc chưa rõ:** tạo Decision cho người dùng, không cho builder và reviewer thay phiên thêm/bỏ cùng một feature.

Kết quả test sai do bộ kiểm tra hiểu sai blueprint cũng cần phân loại riêng. Thay đổi đáp án nghiệm thu phải được review và ghim phiên bản, không sửa âm thầm để code qua.

### 4.6. Gate bàn giao phản ánh đúng độ hoàn thành

Đề xuất trạng thái cho từng điều kiện: `passed`, `failed`, `not_verified`, `blocked`, `waived`, `not_applicable`. `waived` là ngoại lệ được người dùng chấp nhận; `not_applicable` cần lý do theo phạm vi đã duyệt. Cả hai không được cộng thành `passed`.

Giữ riêng kết luận chấm metric và kết luận đáp ứng blueprint. Khi bản đồ Evidence mới đã ổn định, OP-08 chỉ xác nhận bàn giao đầy đủ nếu mọi điều kiện bắt buộc trong phạm vi đều đạt. Cho tải gói để kiểm tra không đồng nghĩa chứng nhận hoàn tất.

Nếu người dùng chấp nhận bàn giao còn thiếu, phải có quyết định rõ nội dung thiếu, lý do và đúng hash build/basis được chấp nhận. Gói được ghi là bàn giao có ngoại lệ; build thay đổi thì quyết định cũ không tự áp dụng. Đây là **đề xuất policy mới**, không phải hành vi đã có của kế hoạch 13.

UI ưu tiên bảng: **Yêu cầu | Phải tạo gì | Kết quả | Bằng chứng | Việc tiếp theo**. Mở nguồn, code, test và báo cáo inline; JSON/hash nằm trong chi tiết. Giữ 6 Lifecycle Phase và 10 Lifecycle Activity.

## 5. Ví dụ cụ thể với blueprint Customer Churn

Các dòng sau là kế hoạch kiểm chứng đề xuất, chưa phải kết quả đã đạt. Phải giải quyết các mục `Manual Review Required` trước khi dùng số liệu chưa được xác nhận làm gate.

| Yêu cầu | Bằng chứng cần có | Không được dùng thay thế |
| --- | --- | --- |
| FR-01: tích hợp dữ liệu | Bảng nguồn thật, join cardinality, tỷ lệ join với mẫu số rõ ràng, missing và timestamp report | CSV đầu ra tồn tại |
| FR-02: churn 90 ngày | Ca biên 89/90/91 ngày theo quy ước đã chốt; mua lại; nhiều đơn; chưa đủ thời gian quan sát; cutoff metadata | Class distribution hoặc AUC cao |
| FR-03: feature engineering | Kiểm tra giá trị feature trên dữ liệu nhỏ tính tay; danh sách feature, thời điểm khả dụng, correlation report | Chỉ kiểm tra tên cột |
| FR-04/NFR-03: đánh giá | Fold manifests, thứ tự thời gian, tối thiểu 3 fold khi đã chốt, metric từng fold, confusion matrix | Một lần chia holdout |
| FR-05: giải thích | Kết quả global/local từ đúng model và đúng feature; hình và hướng dẫn đọc; xử lý minh bạch nếu ít hơn 20 feature | Cài được thư viện `shap` |
| FR-07: threshold | Đường PR/ROC, candidate thresholds và cách chọn trên validation; không bịa chi phí FP/FN | Mặc định `0.5` không giải thích |
| NFR-01/DSR-02 | Số đo tài nguyên trên phạm vi dữ liệu đã duyệt; hai lần chạy độc lập cùng seed/runtime và dung sai đã chốt | Sandbox giới hạn RAM hoặc chấm lại cùng file dự đoán |
| FR-08: báo cáo | PDF hoặc notebook có các mục yêu cầu, lấy số từ Evidence và ghi rõ hạn chế | Chỉ README hoặc bảng metric |

Đường dẫn/hàm bắt buộc ở chương 6 phải được kiểm tra đúng. Mục thiết kế mâu thuẫn với contract hoặc ghi tùy chọn cần được làm rõ trước; không sinh hàng loạt file rỗng để đạt “đúng cấu trúc”.

## 6. Lộ trình nhỏ, có điều kiện hoàn tất

| Đợt | Việc triển khai | Vùng code dự kiến | Điều kiện hoàn tất |
| --- | --- | --- | --- |
| 1 — Nhìn thấy độ lệch | Bảng yêu cầu/điều kiện/nguồn; đánh dấu bắt buộc, tùy chọn, chưa rõ; hiển thị mặc định do Anvil suy ra | Understanding, `experiment-plan.ts`, Readiness/Compile, UI Bản hiểu | Mỗi yêu cầu được ghi nhận hoặc có lý do chưa xử lý; không có kết luận đã đạt khi chưa có Evidence |
| 2 — Một lát cắt đúng nghiệp vụ | FR-02 từ nguồn đến test độc lập, Build và Evidence; chặn kết luận đạt khi target sai | Builder, capabilities, kiểm tra trong sandbox | Cố ý đổi 90 thành 89, đảo nhãn hoặc dùng dữ liệu tương lai thì phát hiện; đúng nghiệp vụ thì qua |
| 3 — Mở rộng độ bao phủ | Nhiệm vụ theo module, checklist review; FR-01/03/04/NFR-03 rồi SHAP, threshold, báo cáo | `packages/system3`, runtime ML và gói kết quả | Mọi điều kiện trong phạm vi có trạng thái; file/hàm đúng và test hành vi đạt; phần chưa hỗ trợ hiện rõ |
| 4 — Bàn giao theo Evidence | Gate đầy đủ, ngoại lệ có phiên bản, invalidation/rerun và gói tái lập | Verify, project flow, delivery, API/Web | Không dùng Evidence hoặc ngoại lệ cũ cho code/nguồn mới; gói thể hiện trung thực phần đạt và phần thiếu |

Ưu tiên **đợt 1 + đợt 2** trước. FR-02 là điểm bắt đầu tốt vì nếu nhãn sai, mọi metric phía sau vẫn có thể trông hợp lý nhưng giải sai bài toán.

Ranh giới giữ nguyên: policy, schema yêu cầu, kiểm tra nghiệp vụ và Evidence projection thuộc `packages/system3`; `packages/workflows` chỉ thực thi cơ chế chung. Tái sử dụng Source Version, Input Snapshot, Knowledge Snapshot, Execution Plan và Approval Manifest; không tạo một luồng phê duyệt song song.

## 7. Đo hiệu quả và kiểm chứng khi triển khai

Không dùng một điểm trung bình để che lỗi bắt buộc. Báo riêng:

- **Độ bao phủ trích xuất:** phần nguồn đã xử lý, chưa phân loại, bỏ qua có lý do; không gọi đây là độ hoàn thành code.
- **Độ hoàn thành yêu cầu:** số điều kiện bắt buộc đạt trên tổng số bắt buộc áp dụng theo basis đã duyệt; công khai riêng ngoại lệ và phần chưa kiểm chứng.
- **Đúng thiết kế:** số contract file/hàm bắt buộc đã kiểm tra; đi cùng kiểm tra hành vi.
- **Hiệu quả thi công:** số vòng sửa, thời gian và chi phí cho mỗi nhóm yêu cầu được chứng minh.

Kiểm thử quan trọng khi xây phần mới:

1. Cùng Source Version và chính sách cho cùng contract/hash; mỗi điều kiện có truy vết. Đổi diễn đạt heading không làm mất yêu cầu; nội dung không đọc được phải báo rõ.
2. Blueprint thiếu target, có metric mâu thuẫn, đánh dấu tùy chọn hoặc chỉ nêu benchmark phải ra trạng thái đúng; không tự biến số tham khảo thành gate.
3. Cố ý bỏ module, sinh stub, đổi target, fit preprocessing trên toàn dữ liệu, bỏ SHAP hoặc giả báo cáo thì không được chứng nhận đầy đủ.
4. Các test nghiệp vụ được chạy thực trong sandbox; builder không sửa được bộ kiểm tra chính thức hoặc nhãn holdout. Nội dung blueprint không được cấp thêm quyền thực thi.
5. Thay code, dữ liệu, requirement hoặc validator thì Evidence liên quan hết hiệu lực; giữ nguyên lịch sử cũ để đối chiếu.
6. Kiểm tra UI bằng dự án có dữ liệu thật ở desktop và màn hình hẹp: thấy rõ phần thiếu, mở Evidence inline và dùng được bàn phím.

Chạy test file liên quan trong lúc sửa; dùng `bun run test` cho các package tách biệt, không chạy `bun test` trần từ root. Trước PR chạy `bun run validate`; nếu thay workflow/schema/API thì sinh lại các file tương ứng theo AGENTS.md. Kiểm tra sandbox và model thật phải ghi riêng kết quả, không suy từ unit test.

## 8. Giới hạn và cách triển khai an toàn

Đợt này chỉ tạo tài liệu định hướng, chưa thay đổi runtime hoặc trạng thái dự án. Khi triển khai, thêm schema có phiên bản và giữ đọc được kết quả cũ; dự án cũ tiếp tục hiện `not_verified`, không tự nâng thành đã tuân thủ blueprint.

Triển khai báo cáo độ lệch trước, ổn định bộ kiểm tra rồi mới áp gate bàn giao mới cho basis đã duyệt tương ứng. Nếu cần quay lui, ngừng áp dụng phiên bản policy mới; giữ nguyên nguồn, snapshot, build và Evidence đã ghi, không xóa hoặc sửa lịch sử.

Chưa cần RAG/vector DB, nhiều agent song song, framework kiểm thử mới, triển khai tự động hoặc hỗ trợ mọi loại bài toán. Chỉ mở rộng khi có blueprint cụ thể vượt khả năng hiện có và có tiêu chí nghiệm thu tương ứng.

Hướng triển khai đầu tiên: **bảng đối chiếu yêu cầu + FR-02 được kiểm chứng độc lập từ dữ liệu gốc đến Evidence**. Sau đó dùng kết quả để mở rộng từng nhóm yêu cầu, thay vì cố sinh toàn bộ codebase trong một lượt.

[← Mục lục kỹ thuật](README.md) · [Kế hoạch hiện hành 13](13-experiment-execution-plan.md) · [TW-02 Understanding](../lifecycle_activity/02-understand-project.md) · [TW-07 Verify](../lifecycle_activity/07-verify.md)
