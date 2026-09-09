# TW-02 — Hiểu dự án

> Tên kỹ thuật: **Understand Project**. Thuộc phase **Understanding — Hiểu dự án**.

## Nói ngắn gọn

Activity này đọc các nguồn đã được lưu để tạo một **bản hiểu dự án có thể kiểm tra lại**.

Kết quả cần trả lời được:

- Dự án muốn giải quyết vấn đề gì?
- Kết quả cần tạo ra là gì?
- Có những yêu cầu nào?
- Dữ liệu dự kiến trông như thế nào?
- Dataset thật đã được liên kết và kiểm tra chưa?
- Điều gì còn thiếu, mâu thuẫn hoặc cần người dùng quyết định?
- Mỗi kết luận lấy từ vị trí nào trong nguồn?

## Khi nào chạy?

- Sau khi project có blueprint hợp lệ.
- Sau khi nguồn liên quan thay đổi và OP-01 đề xuất cập nhật Understanding.
- Sau khi dataset được liên kết muộn và cần đối chiếu với mô tả từ System 2.

## Đầu vào cố định của một lần chạy

Trước khi chạy, hệ thống tạo **Understanding Input Snapshot**. Đây là một bản ghi cố định gồm:

- Những Source Version nào sẽ được đọc.
- Content hash của từng nguồn.
- Phiên bản bộ đọc tài liệu.
- Phiên bản quy tắc trích xuất.

Nhờ vậy, activity không âm thầm đọc “file mới nhất” giữa lúc đang chạy. Khi xem lại kết quả, hệ thống luôn chứng minh được nó đã dùng đúng phiên bản nào.

## Hệ thống xử lý như thế nào?

### Bước 1 — Kiểm tra Input Snapshot

Hệ thống xác nhận các nguồn vẫn tồn tại, content hash còn đúng, blueprint có mặt và định dạng được hỗ trợ.

### Bước 2 — Chọn bộ đọc phù hợp

Mỗi loại nguồn dùng một bộ đọc riêng:

| Nguồn | Cách đọc |
|---|---|
| System 2 JSON có schema được hỗ trợ | Bộ đọc System 2 chính thức |
| Markdown có cấu trúc rõ | Bộ đọc theo heading và bảng |
| Markdown không theo mẫu | Đọc cấu trúc trước; chỉ dùng AI hỗ trợ ở đoạn thật sự không hiểu |
| PDF có lớp chữ | Bộ đọc bố cục, giữ số trang và vùng chữ |
| Dataset CSV | Bộ kiểm tra dataset theo từng phần để tránh nạp toàn bộ vào bộ nhớ |
| Constraints YAML/JSON | Bộ đọc ràng buộc |
| Data dictionary | Bộ đọc mô tả cột |

### Các hệ thống xử lý tài liệu hiện nay làm như thế nào?

Qua đối chiếu tài liệu chính thức của một số hệ thống phổ biến, có thể rút ra một nguyên tắc chung: **đọc cấu trúc tài liệu trước, chỉ chia nhỏ khi thật sự cần**. Không nên cắt đều theo một số lượng ký tự cố định ngay từ đầu, vì cách đó dễ tách tiêu đề khỏi nội dung, làm vỡ bảng và làm mất mối liên hệ giữa các phần.

| Hệ thống | Cách xử lý chính | Điều Anvil nên học |
|---|---|---|
| [LangChain](https://docs.langchain.com/oss/python/integrations/splitters/markdown_header_metadata_splitter) | Chia Markdown theo cấp tiêu đề và giữ tiêu đề làm thông tin đi kèm. Nếu một phần vẫn quá dài thì mới chia tiếp bên trong phần đó. | Dùng cây tiêu đề làm ranh giới chính; không để phần chồng lặp vượt qua ranh giới của hai mục khác nhau. |
| [Unstructured](https://docs.unstructured.io/open-source/core-functionality/chunking) | Trước tiên tách tài liệu thành các thành phần như tiêu đề, đoạn văn và bảng. Chỉ thành phần quá lớn mới bị chia; bảng được xử lý riêng. | Tách theo thành phần có nghĩa, giữ bảng nguyên vẹn khi có thể và lưu liên kết về thành phần gốc. |
| [Docling](https://docling-project.github.io/docling/concepts/chunking/) | Dùng cấu trúc phân cấp của tài liệu; có thể chia phần quá lớn, ghép các phần nhỏ có cùng tiêu đề và lặp lại đầu bảng khi bảng bị chia. | Có thể ghép những đoạn quá nhỏ trong cùng một mục, nhưng phải giữ đường dẫn tiêu đề và đầu bảng để người đọc hiểu ngữ cảnh. |
| [Google Document AI](https://docs.cloud.google.com/document-ai/docs/layout-parse-chunk) | Tạo cấu trúc dạng cây và đưa tiêu đề cha hoặc đầu bảng vào phần nội dung được chia. | Khi chia một phần dài, mỗi phần con vẫn phải biết nó thuộc chương, mục và bảng nào. |
| [Azure AI Search](https://learn.microsoft.com/en-us/azure/search/cognitive-search-skill-document-intelligence-layout) | Nhận dạng cấu trúc, cấp tiêu đề, thứ tự và vị trí của từng phần trong tài liệu. | Giữ cả thứ tự và vị trí nguồn, không chỉ giữ nội dung chữ. |

Điểm giống nhau của các cách làm trên là:

1. Nhận dạng cấu trúc trước khi chia nhỏ.
2. Giữ quan hệ cha – con giữa tiêu đề và nội dung.
3. Xử lý bảng, danh sách và khối mã theo quy tắc riêng.
4. Chỉ chia tiếp khi một phần vượt giới hạn xử lý.
5. Luôn giữ thông tin để lần ngược về tài liệu gốc.

### Quyết định áp dụng cho Anvil ở giai đoạn hiện tại

Hiện tại **chưa cần xây dựng hệ thống tìm kiếm tăng cường bằng mô hình ngôn ngữ**. TW-02 cần đọc một tập nguồn đã được cố định trong Understanding Input Snapshot để tạo bản hiểu đầy đủ. Đây là bài toán phân tích tài liệu có kiểm soát, chưa phải bài toán tìm kiếm trong một kho tài liệu rất lớn.

Anvil cũng **không nên tách tệp System 2 thành nhiều tệp vật lý chỉ để xử lý**. Thay vào đó:

- Giữ nguyên Source Version của tệp gốc, không sửa và không ghi đè.
- Tạo một cây tài liệu nội bộ gồm tiêu đề, đoạn văn, danh sách, bảng, khối mã và vị trí nguồn.
- Các bộ trích xuất đọc cây này để tạo yêu cầu, ràng buộc, mô tả dữ liệu và câu hỏi cần người dùng quyết định.
- Chỉ chia một thành phần khi nó quá lớn đối với bộ xử lý; việc chia này là nội bộ và không làm thay đổi tệp gốc.
- Khi cần hiển thị, giao diện vẫn mở tài liệu gốc hoặc báo cáo thân thiện, không bắt người dùng quản lý hàng chục tệp nhỏ.

Cách này đơn giản hơn, giữ được khả năng kiểm tra lại và vẫn cho phép bổ sung cơ chế tìm kiếm sau này nếu quy mô nguồn thực sự tăng lớn.

### Cách Anvil phân tích Markdown từ System 2

#### 1. Giữ nguyên nguồn gốc

Tệp được lưu thành một Source Version bất biến, kèm tên tệp, mã kiểm tra nội dung, nguồn gửi lên và thời điểm tiếp nhận. Mọi kết quả phía sau đều trỏ về phiên bản này.

TW-02 không chép nguyên cả tài liệu vào Knowledge Snapshot. Hệ thống giữ ba lớp riêng:

1. **Nguồn gốc:** toàn bộ tệp System 2, không thay đổi.
2. **Nội dung trích xuất:** câu chữ có tính ràng buộc, số liệu, mã yêu cầu, tên mô-đun, tên tệp và tên hàm.
3. **Bản hiểu đã chuẩn hóa:** dữ liệu có cấu trúc để các activity sau sử dụng.

Các câu có tính ràng buộc như yêu cầu, điều kiện nghiệm thu, giới hạn tài nguyên và quyết định công nghệ phải giữ nguyên nội dung gốc. Bản tóm tắt dễ đọc chỉ là phần trình bày bổ sung, không được thay thế nội dung gốc.

#### 2. Đọc một lần thành cây tài liệu

Không dùng một biểu thức chính quy lớn để đọc Markdown. Bộ đọc mục tiêu gồm:

| Công cụ                                                                               | Trách nhiệm                                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`remark-parse`](https://github.com/remarkjs/remark/tree/main/packages/remark-parse)  | Chuyển Markdown thành cây cú pháp có tiêu đề, đoạn văn, danh sách, khối mã và vị trí nguồn |
| [`remark-gfm`](https://github.com/remarkjs/remark-gfm)                                | Bổ sung cách đọc bảng, danh sách đánh dấu và các cấu trúc Markdown thường dùng trên GitHub |
| [`unist-util-visit-parents`](https://github.com/syntax-tree/unist-util-visit-parents) | Duyệt cây và biết mỗi thành phần đang nằm dưới những tiêu đề cha nào                       |
| `@hono/zod-openapi`                                                                   | Kiểm tra dữ liệu đầu ra của từng bộ trích xuất theo cấu trúc đã quy định                   |

Nếu `@anvil/system3` dùng các công cụ này, package phải khai báo chúng là phụ thuộc trực tiếp. Không được dựa vào việc một package giao diện đã cài chúng.

Trong từng mục, cây tài liệu phải phân biệt tối thiểu:

- Tiêu đề từ `#` đến `######`.
- Đoạn văn.
- Danh sách có thứ tự và không có thứ tự.
- Bảng và từng hàng trong bảng.
- Khối mã hoặc cấu hình.
- Trích dẫn.
- Nội dung chưa được hỗ trợ hoặc chưa phân loại.

Hệ thống duyệt cây một lần để tạo **bảng chỉ mục tài liệu** gồm đường dẫn tiêu đề, loại thành phần, thứ tự, dòng bắt đầu, dòng kết thúc và nội dung gốc. Sáu bộ trích xuất và hai bước kiểm soát phía sau cùng dùng lại bảng chỉ mục này; chúng không quét lại văn bản thô nhiều lần.

#### 3. Phân biệt cấp tiêu đề và ý nghĩa tiêu đề

Dấu `#`, `##`, `###` cho biết quan hệ cha – con, nhưng không tự cho biết một mục là yêu cầu, dữ liệu hay ràng buộc. Ví dụ, `## Yêu cầu`, `## Requirements` và `## Các chức năng cần có` có thể cùng chỉ một nhóm nội dung.

Quá trình phân loại gồm:

1. Bộ đọc Markdown xác định cấp và đường dẫn tiêu đề.
2. Chuẩn hóa khoảng trắng và số thứ tự nhưng vẫn giữ tên gốc.
3. So khớp chính xác với tên chuẩn.
4. Nếu chưa khớp, dùng bảng tên tương đương có phiên bản.
5. Nếu vẫn chưa nhận ra, đánh dấu `chưa phân loại`; không tự đoán.

Phiên bản ở đây là phiên bản của quy tắc ánh xạ, không phải phiên bản của dấu `#` hoặc `##`. Khi bảng tên tương đương thay đổi, hệ thống có thể giải thích vì sao cùng một nguồn lại cho kết quả khác.

#### 4. Nhận dạng sáu chương chính của System 2

Tệp ví dụ [`DESIGN_B_2.md`](../system_2/DESIGN_B_2.md) có 92 tiêu đề: một tiêu đề cấp 1, chín tiêu đề cấp 2, 40 tiêu đề cấp 3 và 42 tiêu đề cấp 4. Sáu chương chính được đánh số là:

1. `PROBLEM PROFILE`.
2. `REQUIREMENTS CONTRACT`.
3. `HIGH-LEVEL PIPELINE`.
4. `SELECTED TECHNOLOGY STACK`.
5. `MODULAR DESIGN PACKAGE`.
6. `EXECUTION BLUEPRINT`.

Ba tiêu đề `PART A`, `PART A.1` và `PART B` trong chương 6 cũng dùng cấp `##`, nhưng không phải ba chương mới. Vì vậy, bộ phân loại phải dùng cả cấp tiêu đề, số chương, tên chuẩn và ranh giới nội dung; không được coi mọi `##` là một chương chính.

`DESIGN_B_2.md` chỉ là ví dụ cụ thể, không phải hợp đồng đầu vào duy nhất. Nếu tài liệu System 2 có tên mục khác, bảng tên tương đương có phiên bản sẽ xử lý. Nếu thiếu một chương bắt buộc hoặc xuất hiện cấu trúc chưa hỗ trợ, TW-02 phải báo rõ thay vì tự dịch chuyển nội dung sang chương khác.

#### 5. Sáu bộ trích xuất nội dung

Mỗi chương chính được giao cho một bộ trích xuất TypeScript riêng:

| Bộ trích xuất               | Nội dung tạo ra                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| Hồ sơ vấn đề                | Mục tiêu kinh doanh, mục tiêu kỹ thuật, tiêu chí thành công, mô tả dữ liệu và ràng buộc      |
| Hợp đồng yêu cầu            | Mã, loại, mức ưu tiên, nguồn, nội dung yêu cầu và điều kiện nghiệm thu                       |
| Quy trình giải pháp cấp cao | Giai đoạn, bước, đầu vào, đầu ra, thứ tự và yêu cầu liên quan                                |
| Lựa chọn công nghệ          | Công nghệ, mục đích, loại, lý do lựa chọn và đánh đổi                                        |
| Thiết kế mô-đun             | Mã mô-đun, trách nhiệm, đầu vào, đầu ra, yêu cầu liên quan và quan hệ phụ thuộc              |
| Thiết kế triển khai         | Cấu trúc thư mục, tệp, lớp, hàm, tham số, kết quả trả về và liên kết tới mô-đun hoặc yêu cầu |

Không phải mỗi tiêu đề tạo ra một nhóm mới. Các tiêu đề con được giữ trong đúng chương chính và được xử lý theo loại thành phần. Một mục có nhiều loại nội dung thì từng thành phần bên trong có thể được đưa tới các trường khác nhau.

Mỗi kết quả trích xuất phải giữ:

- Nội dung gốc đối với thông tin có tính ràng buộc.
- Dữ liệu đã chuẩn hóa.
- Mã Source Version.
- Đường dẫn tiêu đề.
- Vị trí dòng hoặc khoảng ký tự.
- Mã kiểm tra nội dung gốc.
- Phiên bản bộ đọc và phiên bản quy tắc trích xuất.

Nội dung của chương 6 chỉ được ghi nhận là **thiết kế do System 2 khai báo**. TW-02 không biến nó thành Execution Plan đã được phê duyệt. OP-04 mới thực hiện Workflow Compilation từ trạng thái dự án đủ điều kiện, và OP-05 mới ghi nhận phê duyệt.

#### 6. Biểu thức chính quy chỉ xử lý mẫu nhỏ

Biểu thức chính quy không làm bộ đọc Markdown chính. Sau khi cây tài liệu đã xác định loại thành phần, biểu thức chính quy nhỏ có thể được dùng để nhận dạng:

- Số chương từ `1.` đến `6.`.
- Mã yêu cầu như `FR-01`, `NFR-01` hoặc `DSR-01`.
- Mã mô-đun như `DM-01`.
- Mã cấu trúc mã nguồn như `CB-01`.
- Dấu hiệu `[Manual Review Required]`.
- Số thứ tự hoặc khoảng trắng cần chuẩn hóa.

Không dùng biểu thức chính quy để tự phân tích bảng, danh sách lồng nhau, khối mã hoặc toàn bộ cấu trúc tài liệu.

#### 7. Quét xuyên suốt để phát hiện vấn đề và Decision

Đây không phải bộ trích xuất chương thứ bảy. Nó nhận bảng chỉ mục tài liệu và kết quả của cả sáu bộ trích xuất, rồi thực hiện ba loại kiểm tra:

1. **Dấu hiệu được ghi rõ:** tìm `Manual Review Required`, `TBD`, “chưa xác định” hoặc nội dung yêu cầu người dùng xác nhận.
2. **Trường bắt buộc còn thiếu:** ví dụ yêu cầu không có điều kiện nghiệm thu hoặc mô-đun không có đầu ra.
3. **Mâu thuẫn và tham chiếu chéo:** ví dụ mô-đun trỏ tới mã yêu cầu không tồn tại, hai phần khai báo hai target khác nhau hoặc giới hạn RAM không khớp.

Các kiểm tra cấu trúc dùng Zod. Các đối chiếu mã và quan hệ dùng `Map` và `Set` của TypeScript cùng bộ quy tắc có phiên bản.

Không phải mọi vấn đề đều là Decision:

- Lỗi tham chiếu hoặc định dạng thường yêu cầu sửa nguồn.
- Thông tin thiếu có thể tạo yêu cầu bổ sung.
- Chỉ khi có câu hỏi quan trọng mà Anvil không có quyền tự chọn thì mới tạo Decision cho người dùng hoặc tác nhân được ủy quyền trả lời.

#### 8. Kiểm tra độ bao phủ và khả năng lần ngược về nguồn

Đây cũng không phải chương thứ tám của System 2. Trong khi sáu bộ trích xuất chạy, mỗi thành phần của cây tài liệu được ghi vào **sổ theo dõi độ bao phủ** với một trong các trạng thái:

| Trạng thái | Ý nghĩa |
|---|---|
| `đã trích xuất` | Đã tạo ra dữ liệu có cấu trúc |
| `đã bỏ qua có lý do` | Không cần đưa vào Bản hiểu nhưng vẫn giữ liên kết nguồn và lý do |
| `không được hỗ trợ` | Bộ đọc chưa có cách xử lý an toàn |
| `chưa phân loại` | Chưa có quy tắc xác định ý nghĩa |

Bước này kiểm tra tối thiểu:

- Có chương chính nào chưa được đọc không?
- Có tiêu đề, bảng, danh sách hoặc khối mã nào chưa có trạng thái không?
- Có kết quả nào thiếu vị trí nguồn không?
- Có mã yêu cầu hoặc mã mô-đun bị trùng không?
- Có tham chiếu tới yêu cầu, mô-đun, tệp hoặc hàm không tồn tại không?
- Có nội dung bị bỏ qua mà không ghi lý do không?

Báo cáo chất lượng phải nêu số lượng đã nhận dạng, đã trích xuất, bị bỏ qua, không được hỗ trợ và chưa phân loại. TW-02 không được báo thành công chỉ vì chương trình chạy hết. Thành công nghĩa là nội dung quan trọng đã được đọc, có nguồn chứng minh và mọi phần chưa hiểu đã được công khai.

#### 9. Chỉ chia thành phần quá lớn

Nếu một thành phần vượt giới hạn an toàn, thứ tự xử lý là:

1. Chia giữa hai đoạn văn hoặc hai mục danh sách.
2. Với bảng, chia theo nhóm hàng và lặp lại hàng tiêu đề ở mỗi phần.
3. Không cắt giữa một dòng cấu hình hoặc một khối mã nếu chưa có quy tắc an toàn.
4. Nếu vẫn không thể chia an toàn, dừng phần đó và ghi cảnh báo vào báo cáo chất lượng.

Không dùng kích thước cố định cho mọi tài liệu. Giới hạn chỉ là hàng rào bảo vệ; cấu trúc và ý nghĩa mới là ranh giới chính.

Luồng xử lý hoàn chỉnh là:

```text
Tệp System 2 gốc
        ↓
Đọc một lần thành cây tài liệu và bảng chỉ mục
        ↓
Chạy 6 bộ trích xuất nội dung
        ↓
Đối chiếu xuyên suốt để phát hiện vấn đề và Decision
        ↓
Kiểm tra độ bao phủ và vị trí nguồn
        ↓
Tạo Candidate Knowledge Snapshot và báo cáo chất lượng
```

### Thứ tự ưu tiên giữa các định dạng đầu vào

Nếu System 2 có thể cung cấp cả dữ liệu có cấu trúc và Markdown, thứ tự nên là:

1. Dùng JSON có cấu trúc và có phiên bản làm nguồn chính để máy xử lý.
2. Dùng Markdown làm bản người đọc và để đối chiếu tính đầy đủ.
3. Nếu chỉ có Markdown, dùng quy trình cây tài liệu ở trên.
4. PDF phải có bộ đọc bố cục riêng; không được coi phần chữ lấy ra từ PDF là Markdown sạch.

Việc OP-00 chấp nhận một tệp chỉ chứng minh tệp đã được lưu và nhận dạng ở mức tiếp nhận. Nó không chứng minh TW-02 đã hiểu đúng toàn bộ nội dung.

### Ví dụ từ tệp System 2 tới Bản hiểu dự án

Giả sử nguồn có cấu trúc:

```text
# Dự án dự báo khách hàng rời bỏ
## Mục tiêu
Giảm tỷ lệ khách hàng rời bỏ.
## Dữ liệu
### Biến mục tiêu
churn_status
## Yêu cầu xem xét thủ công
Xác nhận khoảng thời gian dùng để tạo nhãn.
```

Bộ đọc không tạo bốn tệp mới. Nó tạo cây nội bộ, rồi sinh ra:

- Một mục tiêu có vị trí nguồn `Mục tiêu`.
- Một mô tả biến mục tiêu ở trạng thái `declared_unverified` vì chưa kiểm tra dữ liệu thật.
- Một Decision yêu cầu người dùng xác nhận khoảng thời gian tạo nhãn.
- Các liên kết để giao diện mở đúng đoạn nguồn khi người dùng xem từng kết luận.

### Trạng thái triển khai hiện tại

Phạm vi TW-02 mô tả trong tài liệu này đã được triển khai. Đường chạy hiện tại có hai nút kỹ thuật:

1. `verify-input-snapshot`: mở đúng từng phiên bản nguồn đã cố định và kiểm tra mã nội dung.
2. `analyze-understanding`: đọc cấu trúc, chạy sáu bộ trích xuất, đối chiếu dữ liệu, kiểm tra chất lượng và tạo báo cáo.

Các phần đã có trong mã nguồn:

- Cây tài liệu Markdown dùng `remark-parse`, `remark-gfm` và `unist-util-visit-parents`.
- Bảng tên chương tương đương và quy tắc trích xuất đều có phiên bản.
- Sáu bộ trích xuất tương ứng sáu chương chính của System 2.
- Vị trí nguồn gồm phiên bản nguồn, đường dẫn tiêu đề, dòng, mã đoạn trích; JSON dùng đường dẫn JSON, PDF dùng trang và vùng chữ.
- Bộ đọc System 2 JSON có phiên bản; bộ đọc YAML/JSON cho ràng buộc và từ điển dữ liệu.
- Nguồn bổ sung được ghép theo trường có nghĩa: cột mục tiêu, danh sách cột dự kiến, bộ nhớ, ràng buộc, chính sách và cách bàn giao. Nếu hai nguồn mâu thuẫn, hệ thống yêu cầu sửa nguồn thay vì tự chọn.
- Bộ đọc PDF theo bố cục. PDF chỉ có ảnh sẽ bị từ chối rõ ràng vì hiện chưa có nhận dạng chữ từ ảnh.
- Bộ kiểm tra CSV đọc theo dòng, không gửi dòng dữ liệu thô cho mô hình ngôn ngữ.
- Sổ độ bao phủ, kiểm tra mã trùng, tham chiếu sai, trường bắt buộc thiếu, nội dung chưa hỗ trợ và nội dung chưa phân loại.
- Bảy loại báo cáo dễ đọc; báo cáo hồ sơ dữ liệu chỉ được tạo khi có dữ liệu thật.
- Báo cáo thay đổi nhận Bản hiểu đang hoạt động trước đó để nêu đúng yêu cầu mới và yêu cầu bị bỏ.
- Bản hiểu nháp không tự thay bản đang hoạt động. Người dùng phải xử lý quyết định và kích hoạt rõ ràng.
- Với cột mục tiêu còn thiếu, UI chỉ cho chọn một cột thật trong Dataset đã kiểm tra. Câu trả lời được kiểm tra, lưu riêng và được áp dụng cho Readiness, kế hoạch và thực thi; Bản hiểu gốc vẫn không bị ghi đè.
- Hỗ trợ ngữ nghĩa có giới hạn chỉ chạy khi còn đoạn chưa phân loại; tối đa hai lần thử, 15 giây mỗi lần, ngân sách 0,025 USD, không có công cụ và chỉ nhận kết quả có trích dẫn nguyên văn trong nguồn.

Giới hạn còn chủ động giữ lại:

- Chưa nhận dạng chữ trong PDF dạng ảnh.
- Chưa cần hệ thống tìm kiếm tăng cường bằng mô hình ngôn ngữ; mỗi lần TW-02 vẫn đọc tập nguồn đã được cố định.
- JSON System 2 chỉ được nhận khi đúng phiên bản cấu trúc đang hỗ trợ; phiên bản lạ bị từ chối thay vì đoán.

Trường `provider: 'claude'` ở cấp quy trình vẫn không có nghĩa mọi lần chạy đều gọi mô hình. Hai nút chính là bộ xử lý xác định; lời gọi mô hình chỉ xuất hiện trong nhánh hỗ trợ ngữ nghĩa nêu trên.

### Vị trí mã nguồn đã thay đổi

| Phần | Vị trí chính |
|---|---|
| Hợp đồng dữ liệu và khả năng tương thích bản cũ | `packages/system3/src/contracts.ts` |
| Cây Markdown, vị trí nguồn và bảng tên chương | `packages/system3/src/understanding/document-index.ts` |
| Sáu bộ trích xuất | `packages/system3/src/understanding/extractors/index.ts` |
| Bộ đọc System 2 JSON, PDF và nguồn bổ sung | `packages/system3/src/understanding/system2-json-reader.ts`, `pdf-layout-reader.ts`, `supplemental-reader.ts` |
| Đọc CSV theo dòng | `packages/system3/src/understanding/dataset-profiler.ts` |
| Điều phối phân tích, kiểm tra chất lượng và tạo báo cáo | `packages/system3/src/understanding/index.ts`, `quality.ts`, `reports.ts` |
| Hai nút của quy trình TW-02 | `packages/system3/src/templates.ts`, `packages/system3/src/capabilities.ts` |
| Lưu Bản chụp đầu vào, bản hiểu nháp, báo cáo, quyết định và kích hoạt | `packages/system3/src/store.ts`, `migrations/032_system3_understanding_v2.sql`, `migrations/033_system3_decision_binding.sql` |
| Giao diện lập trình và cách trình bày tài nguyên | `packages/server/src/routes/api.ts`, `schemas/system3.schemas.ts`, `system3-activity-resources.ts` |
| Khu vực TW-02 trên giao diện | `packages/web/src/features/system3/UnderstandingWorkspace.tsx`, `System3App.tsx`, `ResourceViewer.tsx`, `system3.css` |
| Kiểm thử | `packages/system3/src/understanding/understanding.test.ts`, `templates.test.ts`, `packages/web/e2e/system3-projects.test.ts` |

### Bước 3 — Đọc blueprint

Hệ thống lấy ra mục tiêu kinh doanh, mục tiêu kỹ thuật, target, yêu cầu, module, giới hạn runtime và các mục cần người dùng xem lại.

Mỗi thông tin phải giữ **source pointer — vị trí nguồn**, ví dụ tên file, heading hoặc dòng liên quan. Hệ thống không được tự tạo mã yêu cầu hay tự quyết định target nếu nguồn chưa nói rõ.

### Bước 4 — Đánh giá thông tin dataset

Activity này hỗ trợ hai trường hợp.

#### Chưa liên kết dataset

Hệ thống lấy **Dataset Declaration — mô tả dữ liệu dự kiến** từ tài liệu System 2, ví dụ:

- Mỗi dòng dự kiến đại diện cho một khách hàng.
- Target dự kiến là `churn_status`.
- Các cột dự kiến cần có.
- Quy tắc về thời gian hoặc tránh rò rỉ dữ liệu.

Đây chỉ là điều tài liệu nói rằng dataset **nên có**. Hệ thống phải hiển thị:

- Trạng thái: `Chưa liên kết Dataset`.
- Số dòng/cột: `Chưa kiểm tra`.
- Dữ liệu thiếu, trùng lặp, phân phối target: `Chưa kiểm tra`.

Thiếu dataset không làm activity Hiểu dự án thất bại. Tuy nhiên, Readiness sẽ yêu cầu dataset trước activity nào thực sự cần dữ liệu.

#### Đã liên kết dataset

Hệ thống tạo **Dataset Profile — kết quả quan sát file thật**, gồm số dòng/cột, cấu trúc cột, target, dữ liệu thiếu, dòng trùng và cảnh báo. Sau đó nó đối chiếu file thật với mô tả từ System 2.

Nếu hai bên không khớp, hệ thống tạo issue hoặc decision thay vì âm thầm chọn một bên.

### Bước 5 — Đọc constraints

Hệ thống lấy các giới hạn về runtime, chính sách và bàn giao, đồng thời ghi rõ phần nào đang mâu thuẫn.

### Bước 6 — Ghép thành bản hiểu dự án

Thông tin từ các nguồn được ghép thành một **Candidate Knowledge Snapshot — bản hiểu dự án nháp**. Đây chưa phải bản chính thức cho đến khi vượt qua kiểm tra chất lượng và được chấp nhận.

Mỗi thông tin có một trạng thái dễ hiểu:

| Trạng thái kỹ thuật | Cách hiểu |
|---|---|
| `confirmed` | Đã có nguồn và được xác nhận |
| `declared_unverified` | Tài liệu có nói nhưng chưa kiểm tra thực tế |
| `assumption` | Đang là giả định |
| `conflict` | Các nguồn đang mâu thuẫn |
| `missing` | Còn thiếu |
| `blocked` | Chưa thể tiếp tục |
| `stale` | Có thể đã cũ vì nguồn liên quan thay đổi |

### Bước 7 — Kiểm tra chất lượng

Hệ thống kiểm tra mục tiêu, mã yêu cầu, vị trí nguồn, target, constraints và các phần chưa đọc được. Kết quả có thể là:

- `passed` — đạt.
- `decision_required` — cần người dùng trả lời.
- `revision_required` — tài liệu cần được sửa hoặc bổ sung.
- `blocked` — có lỗi khiến activity không thể tạo kết quả tin cậy.

Activity không được báo thành công chỉ vì bộ đọc tài liệu không phát sinh lỗi.

### Bước 8 — Tạo báo cáo và câu hỏi

Hệ thống tạo báo cáo dễ đọc và các Decision nếu có thông tin quan trọng mà nó không được tự suy đoán.

### Bước 9 — Công bố bản nháp

- Nếu đạt và không còn câu hỏi chặn: bản nháp có thể được kích hoạt thành bản hiểu hiện tại.
- Nếu cần quyết định: giữ bản nháp và chờ người dùng.
- Nếu cần sửa nguồn: giữ bản hiểu hiện tại, không thay bằng bản nháp chưa đạt.
- Nếu bị chặn: lưu chẩn đoán nhưng không phá bản hiểu đang dùng.

### Bước 10 — Người dùng xem và chấp nhận

Người dùng có thể xem thay đổi, trả lời Decision, thay nguồn hoặc chấp nhận bản hiểu mới. Với câu hỏi về cột mục tiêu, người dùng chọn một cột đã có thật trong Dataset; không thể gửi một câu trả lời tự do rồi để hệ thống tự đoán. Khi chấp nhận, backend chuyển Candidate Knowledge Snapshot thành bản đang hoạt động và giữ bản cũ trong lịch sử. Câu trả lời được áp dụng như một lớp quyết định có phiên bản cho các bước sau, không sửa nội dung gốc của Bản hiểu.

Đây là một thao tác điều khiển nhỏ bên trong phase Understanding, không được tính thêm thành Lifecycle Activity thứ 11.

## Kết quả và báo cáo

| Báo cáo | Nội dung dành cho người dùng |
|---|---|
| `project-overview.md` | Mục tiêu, loại dự án, runtime và kết quả cần bàn giao |
| `requirements-report.md` | Danh sách yêu cầu, trạng thái và nguồn |
| `dataset-understanding.md` | Mô tả dữ liệu dự kiến, trạng thái liên kết và kết quả đối chiếu |
| `dataset-profile.md` | Chỉ có khi dataset thật đã được liên kết và kiểm tra |
| `open-issues-and-decisions.md` | Điều còn thiếu, mâu thuẫn và câu hỏi cần trả lời |
| `source-change-report.md` | Khác biệt với bản hiểu trước |
| `extraction-quality-report.md` | Mức độ đọc được tài liệu và cảnh báo |

Các file JSON kỹ thuật vẫn được lưu để hệ thống xử lý, nhưng UI nên mở bản Markdown dễ đọc trước.

## Decision lấy từ đâu?

Decision có thể đến từ:

- Mục `Manual Review Required` trong blueprint System 2.
- Target chưa rõ hoặc có nhiều lựa chọn.
- Hai nguồn đưa ra thông tin mâu thuẫn.
- Một thông tin bắt buộc còn thiếu.

AI không tự trả lời Decision. Người dùng trả lời trên UI; câu trả lời được kiểm tra theo loại câu hỏi, lưu cùng bản hiểu liên quan và dùng ở Readiness, kế hoạch và thực thi.

## Người dùng nhìn thấy gì trên UI?

- Tổng quan dự án.
- Yêu cầu và nguồn của từng yêu cầu.
- Dataset: phần tài liệu khai báo và phần dữ liệu thực tế phải tách rõ.
- Vấn đề và câu hỏi cần xử lý.
- Những gì đã đổi so với phiên bản trước.
- Danh sách báo cáo với nút xem, so sánh và tải xuống.

## Điều activity này không làm

- Không tự phê duyệt bản hiểu dự án.
- Không tự đoán target hoặc acceptance criteria còn thiếu.
- Không tuyên bố đã kiểm tra dataset nếu dataset chưa được liên kết.
- Không build, chạy thử nghiệm hoặc giao sản phẩm.

[← OP-01 Change Detection](01-change-detection.md) · [Danh sách](README.md) · [Tiếp theo: TW-03 Readiness →](03-readiness.md)
