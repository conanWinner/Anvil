# Quy tắc UI cho Project Lifecycle

Tài liệu này là contract trình bày cho giao diện Project Lifecycle của System 3. Nó không thay đổi
domain contract hoặc biến Control-plane Operation thành Technical Workflow.

## 1. Cấu trúc thông tin bắt buộc

UI có ba tầng, không trộn lẫn:

1. **Project Lifecycle**: toàn bộ hành trình của project.
2. **6 Lifecycle Phase**: Tiếp nhận, Hiểu dự án, Sẵn sàng, Xây dựng, Xác minh, Bàn giao.
3. **10 Lifecycle Activity**: các activity `OP-*` và `TW-*` nằm trong từng phase.

Các section nội bộ như `data`, `features`, `experiments` và `explainability` có thể vẫn tồn tại trong
read model cũ. UI phải ánh xạ chúng vào phase **Xây dựng**; không được hiển thị thành phase thứ 7 hoặc
thứ 8.

Projection hiện tại nằm tại:

```text
packages/web/src/features/system3/lifecycle-view.ts
```

## 2. Mỗi activity phải trả lời năm câu hỏi

Khi người dùng chọn một Lifecycle Activity, màn hình phải cho biết:

1. Anvil đang hoặc sẽ làm gì?
2. Activity dùng đầu vào nào?
3. Activity tạo kết quả nào?
4. Vì sao activity chưa thể đi tiếp?
5. Người dùng có thể làm gì tiếp theo?

Mã activity được hiển thị để hỗ trợ đối soát, nhưng nhãn tiếng Việt là nội dung chính. UI phải phân
biệt rõ:

- **OP**: thao tác backend theo quy tắc, không mặc định có Workflow Run.
- **TW**: quy trình kỹ thuật do Anvil Workflow Runtime thực thi.

Không hiển thị “Chưa có run” như lỗi đối với một activity `OP-*`.

Năm câu trả lời này phải nằm trong cùng một workspace, không bị chia qua nhiều lớp tab. Trạng thái và
hành động tiếp theo nằm ngay cạnh tiêu đề; đầu vào, kết quả và Evidence hiển thị thành các nhóm có thể
quét trực tiếp. Lịch sử và thông tin kỹ thuật dùng disclosure.

## 3. Quy tắc riêng cho OP-00

Trang Nguồn đầu vào là trang chi tiết của **OP-00 — Tiếp nhận nguồn đầu vào**, không phải một trình
upload file độc lập.

Trang này luôn hiển thị:

- Trạng thái phase Tiếp nhận.
- Bốn bước dễ hiểu: nhận file, kiểm tra, lưu phiên bản bất biến, phát hiện thay đổi.
- Source Registry và phiên bản đang dùng.
- Báo cáo tiếp nhận gần nhất.
- Lịch sử báo cáo, kể cả khi danh sách đang rỗng.
- Intake Gate và hành động “Tiếp tục Hiểu dự án”.

Nguồn được migrate từ Anvil cũ không có báo cáo OP-00 lịch sử. UI phải nói rõ điều đó và cho phép
người dùng xác nhận bằng OP-01 hoặc tải phiên bản mới. Không được tạo báo cáo giả để lấp khoảng trống
lịch sử.

### Quy tắc trình bày OP-01

OP-01 chỉ hiển thị dữ liệu của lần kiểm tra hiện tại trong ba nhóm chính:

- **Đầu vào đã dùng** chỉ chứa phiên bản nguồn đang kiểm tra và phiên bản nguồn trước được dùng để
  so sánh. Không đưa bản đồ quan hệ vào đây như một tệp người dùng đã cung cấp.
- **Kết quả đã tạo** chỉ chứa Báo cáo ảnh hưởng hiện tại. Báo cáo của các lần kiểm tra cũ nằm trong
  **Lịch sử hoạt động**, được đánh dấu đã thay thế và vẫn mở xem được tại chỗ.
- Số quan hệ, mức độ đầy đủ và đường ảnh hưởng nằm trong **Thông tin kỹ thuật dùng khi kiểm tra**.
  UI phải nói rõ đây là dữ liệu nội bộ của OP-01, không phải tệp nguồn do người dùng tải lên.

Nếu nhiều báo cáo được tạo trong cùng một giây, báo cáo hiện tại được chọn theo phiên bản nguồn trước,
sau đó mới theo thời điểm và phiên bản bộ kiểm tra. Không được dùng thứ tự mã định danh ngẫu nhiên để
quyết định báo cáo hiện tại.

## 4. Friendly-first, technical-second

Nội dung chính dùng tiếng Việt dễ hiểu. Các giá trị sau nằm trong disclosure hoặc Technical Console:

- Content hash đầy đủ.
- Operation ID, Source Version ID và artifact ID.
- Raw JSON, log, event và node I/O.
- Storage metadata nội bộ.

Trạng thái phải luôn có chữ, không chỉ dựa vào màu. Artifact và Evidence không được dùng như hai từ
đồng nghĩa.

## 5. Xem đầu vào và kết quả ngay trong activity

Mỗi `OP-*` và `TW-*` phải có danh sách **Đầu vào liên quan** và **Kết quả liên quan**. Mỗi mục trong
hai danh sách phải mở được bằng **Inline Resource Viewer** ngay trên màn hình Lifecycle Activity đang
chọn:

- Không chuyển sang route khác chỉ để xem nội dung.
- Không mở tab trình duyệt mới theo mặc định.
- Không làm mất phase, activity, vị trí cuộn hoặc bộ lọc hiện tại.
- Desktop dùng panel bên cạnh hoặc drawer đủ rộng; mobile dùng full-screen sheet có nút quay lại.
- “Mở trong trang riêng”, “Tải xuống” và “Sao chép liên kết” là hành động phụ khi thật sự cần.

Viewer phải hỗ trợ cả đầu vào lẫn đầu ra, gồm Source Version, Input Snapshot, Knowledge Snapshot,
Decision, Readiness Contract, Execution Plan, Approval Manifest, artifact, Evidence, báo cáo xác minh
và Delivery Manifest. Không gọi mọi resource là Artifact: Decision, snapshot, manifest và record
control-plane vẫn giữ đúng tên domain, nhưng có cùng trải nghiệm mở xem tại chỗ.

Mỗi resource hiển thị tối thiểu:

1. Tên và ý nghĩa dễ hiểu.
2. Activity hoặc Workflow Node đã tạo ra nó.
3. Phiên bản và thời điểm tạo.
4. Nguồn hoặc resource cha mà nó sử dụng.
5. Resource hoặc activity tiếp theo đang sử dụng nó.
6. Trạng thái hiện hành, stale hoặc đã được thay thế.

## 6. Artifact Presentation Layer

Nguồn sự thật vẫn được lưu ở định dạng bất biến phù hợp cho máy xử lý, ví dụ JSON, CSV, Markdown,
log hoặc file nhị phân. Không thay thế hoặc ghi đè bản gốc bằng nội dung trình bày. UI phải đưa bản
gốc qua **Artifact Presentation Layer** để tạo read model thân thiện trước khi hiển thị.

Presentation Layer phải:

- Chọn renderer theo `resource kind` và `schema version`; không đoán ý nghĩa chỉ từ tên file.
- Trình bày bằng heading, đoạn giải thích, fact card, bảng, checklist, timeline, callout, file tree,
  Evidence list hoặc nút tải xuống tùy loại nội dung.
- Render Markdown an toàn; trình bày JSON thành báo cáo theo domain; trình bày CSV thành bảng mẫu,
  schema và thống kê; trình bày source code bằng cây file và syntax highlighting.
- Với file không thể render trực tiếp như archive, hiển thị metadata, content hash, manifest và danh
  sách file trước khi cho tải xuống.
- Với nội dung lớn, hiển thị preview có giới hạn và nói rõ phần nào chưa được tải; không làm treo UI.
- Dùng template xác định trước cho dữ liệu nghiệp vụ. LLM chỉ được tạo phần diễn giải tùy chọn, phải
  được gắn nhãn và không được thay thế dữ liệu gốc.
- Giữ provenance từ presentation về resource gốc và phiên bản renderer đã dùng.

Raw JSON, raw log, hash đầy đủ và metadata lưu trữ chỉ xuất hiện khi người dùng chủ động mở **Thông
tin kỹ thuật**. Nếu renderer lỗi hoặc chưa hỗ trợ một loại resource, UI phải hiển thị lỗi thân thiện
và hành động tải xuống; tuyệt đối không đổ raw JSON ra làm fallback chính.

### Contract API hiện tại

UI không tự đọc bảng database hoặc đoán loại resource từ filename. Backend cung cấp ba endpoint đã
được giới hạn theo project:

```text
GET /api/system3/projects/{projectId}/activities/{activityId}
GET /api/system3/projects/{projectId}/resources/{resourceType}/{resourceId}
GET /api/system3/projects/{projectId}/resources/{resourceType}/{resourceId}/content
```

- Endpoint activity trả riêng `inputs`, `outputs`, `evidence`, `technicalResources` và `history` cho
  một trong đúng 10 Lifecycle Activity. Resource lịch sử có thể được gắn trực tiếp vào mục history để
  mở tại chỗ mà không đưa nó trở lại danh sách kết quả hiện tại.
- Endpoint resource trả các presentation block đã có kiểu rõ ràng như callout, facts, bảng,
  checklist, timeline, Evidence hoặc download.
- Endpoint content chỉ được gọi khi người dùng chủ động mở **Thông tin kỹ thuật** hoặc tải bản gốc.
  Presentation response không nhúng raw JSON.
- Mọi lookup đều kèm `projectId`; API không nhận storage key từ client và không trả storage key cho
  giao diện chính.

Metadata persisted cho resource gồm activity tạo ra, Workflow Run/Node nếu có, tên và mô tả dễ đọc,
media type, schema version, trạng thái, lý do stale, Source Version đầu vào và resource cha. Phiên bản
cũ vẫn mở được và được gắn `superseded`; nguồn thay đổi làm resource phụ thuộc chuyển thành `stale`
thay vì bị xóa.

## 7. Điều hướng và hành động

- Màn hình Lifecycle chỉ dùng một trục điều hướng nội bộ: 6 nhóm phase chứa đúng 10 activity. Không
  xếp chồng hero lớn, thẻ metric, phase tab, activity card và resource tab trước nội dung chính.
- Project context phải gọn; không lặp cùng trạng thái ở nhiều card. Phần đầu màn hình ưu tiên activity
  đang chọn, lý do bị chặn và một hành động tiếp theo rõ ràng.
- Workspace ưu tiên activity cần xử lý hoặc kết quả Verify hiện hành. Rail nằm trong disclosure
  **Chi tiết vòng đời**, mặc định thu gọn; mở ra vẫn đúng 6 phase/10 activity và là trục điều hướng
  duy nhất. Desktop dùng rail dọc, mobile cuộn ngang; workspace được đặt trước rail trong thứ tự đọc.
- Polling không đổi lựa chọn activity chủ động hoặc đóng resource đang xem. Blocker, operation đang
  chạy/unknown và basis stale được ưu tiên khi chọn mặc định; Verify xong mở kết quả, không tự mở OP-08.
- Project chưa đạt Intake Gate phải dẫn người dùng về trang Nguồn đầu vào.
- Flow luôn cho phép mở activity OP-00 và OP-01 để xem chi tiết.
- Sau OP-01, TW-02 chỉ bắt đầu khi người dùng chủ động bấm tiếp tục.
- Hành động Compile, Approve, Execute và Delivery phải xuất hiện tại activity tương ứng hoặc CTA cấp
  project; không giấu trong Technical Console.
- Technical Console là lớp giải thích sâu, không phải đường đi chính của người dùng.

## 8. Visual và motion

- System 3 có một surface riêng, chỉ trong `.system3-root` (đã ghi trong brand guide, mục "System 3
  surface"): theme sáng nền ngà, tiêu đề/nhãn/số JetBrains Mono, nội dung Inter, màu nhấn xanh lá.
  Token nằm trong `packages/web/src/features/system3/system3-theme.css` (`--s3-*`); theme tối giữ token
  trong `system3.css`. Không hard-code màu ngoài các token này; thêm token mới thì cập nhật cả file
  theme lẫn brand guide. Màu nền sáng được tô sẵn từ `index.html` (`data-surface="system3-light"`) để
  trang không nháy nền tối trước khi chunk System 3 tải xong.
- Màu nhấn chỉ dùng cho hành động chính, trạng thái đang chạy/đạt và điểm nhấn nhận diện. Nội dung dài
  dùng surface trung tính có độ tương phản cao.
- Chuyển động phải ngắn, có mục đích: phản hồi chọn activity, đổi phase, report mới và trạng thái đang
  chạy. Không dùng animation liên tục cho nội dung tĩnh.
- Mọi animation và transition phải tắt hoặc rút xuống gần như tức thời trong
  `@media (prefers-reduced-motion: reduce)`.
- Layout phải dùng được ở desktop, tablet và mobile; thanh phase có thể cuộn ngang trên màn hình nhỏ.
- Kiểm tra layout phải dùng project có dữ liệu thật ở desktop và mobile. Chỉ dựa vào type-check hoặc
  DOM test không đủ để phát hiện mật độ thông tin, nội dung bị cắt hoặc hành động nằm quá xa đầu trang.

## 9. Accessibility và kiểm thử

- Dùng button cho lựa chọn phase/activity và link cho điều hướng.
- Có tên accessible cho navigation, trạng thái và progress.
- Focus ring phải nhìn thấy rõ trong light và dark theme.
- Không thay đổi nội dung chỉ bằng hover.
- Inline Resource Viewer phải giữ focus đúng cách, đóng được bằng bàn phím và trả focus về resource
  vừa mở.
- E2E tối thiểu phải chứng minh: có đúng 6 phase, đủ 10 activity theo canonical mapping, OP-00 report
  hiển thị sau upload, trạng thái legacy có giải thích, resource mở inline mà không đổi route, bản
  trình bày thân thiện xuất hiện trước raw data và `prefers-reduced-motion` không bị ghi đè bởi
  animation bắt buộc.

## 10. Điều hướng cấp project

Điểm vào `/` mở danh sách dự án; `/console` vẫn giữ cho công cụ runtime cũ. Trong một dự án, sidebar
có **Pipeline** và 6 tab chi tiết theo thứ tự làm việc (nhóm "Chi tiết từng bước"); Project Lifecycle
vẫn đúng 6 phase/10 activity trong **Chi tiết vòng đời** ở Pipeline:

1. **Pipeline** — nơi khởi chạy và theo dõi cả lượt: 6 bước xếp dọc (Nguồn dữ liệu → Bản hiểu → Kế
   hoạch & duyệt → Lượt chạy → Kết quả → Bàn giao), mỗi bước có trạng thái, một dòng tóm tắt và
   link **Chi tiết** sang tab của bước. Bước hiện tại tự mở và trang tự cuộn tới khi pipeline chuyển
   bước; trong bước chỉ có phần cần thao tác (chấp nhận bản hiểu, phê duyệt và chạy, trace trực tiếp
   và chọn cách chạy, bảng kết quả và chọn phương án, tải gói), không có danh sách đầu vào/kết quả
   hay node kỹ thuật. Các bước khác mở tại chỗ khi bấm. Nguồn đổi thì có thông báo "Phân tích lại với
   nguồn mới" ngay trên trang. Chi tiết vòng đời (chọn một activity để xem đầy đủ) và lịch sử/chạy lại
   ở cuối trang.
2. **Nguồn dữ liệu** — Source Registry, OP-00 và OP-01.
3. **Bản hiểu** — TW-02: bản hiểu, câu hỏi cho người dùng và nút chấp nhận.
4. **Kế hoạch & duyệt** — TW-03, OP-04, OP-05.
5. **Lượt chạy** — TW-06: tiến trình (trace) theo giai đoạn, chọn phương án/cách chạy, và khối lỗi kèm
   nút **Chạy lại** khi bước Xây dựng dừng.
6. **Kết quả** — TW-07: bảng phương án, gợi ý theo metric chính, người dùng chọn.
7. **Bàn giao** — OP-08/TW-09, phương án đã chọn và gói tải về.

Nhãn trạng thái **Chờ bạn** dùng khi không có gì đang chạy và bước tiếp theo là của người dùng (chấp
nhận bản hiểu, chọn cách chạy). Đổi tab không tải lại trang khi dự án đã có trong store. **Quyết định &
Phê duyệt** và **Chi tiết kỹ thuật** nằm trong **Chi tiết khác**.

Các URL cũ vẫn hoạt động để giữ bookmark và liên kết hiện có. Technical Console được đặt trong
**Chi tiết khác** và đổi nhãn thành **Chi tiết kỹ thuật**. Nó phục vụ Workflow Run, node, event, log
và raw I/O; không phải nơi bắt đầu hoặc tiếp tục Project Lifecycle.

## 11. Tạo project và thao tác nâng cao

Tạo project dùng một form duy nhất gồm tên, blueprint Markdown bắt buộc và dataset CSV tùy chọn.
Nhãn chính là **Mô tả bài toán (.md)**. Chọn 2–4 LLM qua 9router là nội dung chính cho project mới,
dùng tên từ Pi catalog; nhập ref thủ công nằm trong cấu hình nâng cao. Bộ mẫu chạy code cung cấp cả
prompt, requirement IDs và harness đã kiểm tra, nêu đúng phạm vi bài tập. Tệp riêng vẫn cần cấu hình
bộ kiểm tra hợp lệ; không tự đặt tiêu chí hoặc âm thầm chuyển sang baseline khi thiếu cấu hình.
Ràng buộc ít dùng nằm trong disclosure; không có bước xác nhận riêng để lặp cùng thông tin.
Sau khi tạo và tiếp nhận nguồn, mở workspace Lifecycle. Nếu tiếp nhận lỗi sau khi project được tạo,
UI phải giữ project có thể truy cập được để người dùng sửa nguồn hoặc thử lại; không che lỗi sau
thành công một phần.

Chọn mẫu/tạo project không tự gọi LLM. **Bắt đầu phân tích**, chấp nhận Bản hiểu, phê duyệt kế hoạch
và yêu cầu bàn giao vẫn là hành động chủ động. Kết quả hiện một hàng mỗi model với trạng thái,
checks và nút xem code/output inline; completed không đồng nghĩa kiểm tra đạt. Usage thiếu ghi chưa
xác định. Attempt record thiếu không được trình bày thành chưa từng thực thi khi đã có execution.

Lịch sử lượt chạy, tùy chọn chạy lại và thao tác dọn lượt đã kết thúc nằm trong disclosure **Lịch sử
và chạy lại**. Hành động tiếp tục lượt đang chờ vẫn hiển thị cạnh trạng thái. Không xóa attempt,
worktree hay artifact khi chỉ thu gọn giao diện.

[← Tài liệu kỹ thuật](README.md) · [OP-00 Source Intake](../lifecycle_activity/00-source-intake.md)
