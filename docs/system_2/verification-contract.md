# Hợp đồng kiểm chứng trong blueprint System 2

Đặc tả định dạng cho người viết exporter System 2. Lý do và lộ trình ở [kế hoạch 16](../technical/16-blueprint-verification-contract-plan.md).

Hợp đồng là **dữ liệu**: Anvil diễn giải một danh sách `check.kind` đóng. Hợp đồng không chứa code, lệnh hay đường dẫn. Hợp đồng nằm trong blueprint nên được ghim theo Source Version và thuộc phạm vi phê duyệt; đổi hợp đồng là đổi basis, phải duyệt lại.

## Vị trí

- **Markdown:** đúng một khối mã ngôn ngữ `anvil-contract` ở cấp ngoài cùng, thường dưới heading `VERIFICATION CONTRACT`. Nội dung là JSON.
- **JSON export:** trường `verificationContract` với `schemaVersion: 2`. `schemaVersion: 1` vẫn đọc được, nhưng hợp đồng trong bản 1 chỉ tạo Issue và không được dùng.

Blueprint không có hợp đồng vẫn chạy như cũ; kế hoạch không có thêm trường nào nên hash kế hoạch cũ vẫn đúng.

## Định dạng (`contractVersion: 1`)

```json
{
  "contractVersion": 1,
  "criteria": [
    {
      "id": "FR-02.AC-01",
      "requirementId": "FR-02",
      "statement": "Target = 1 khi review_score của đánh giá tạo sớm nhất ≤ 2.",
      "check": {
        "kind": "golden_cases",
        "tables": { "orders.csv": "order_id,status\no1,delivered\n" },
        "expected": [{ "entity_id": "o1", "target": 1 }]
      }
    }
  ]
}
```

Mỗi điều kiện chỉ có bốn trường trên. Phiên bản này chưa có `level` hay `features`: trường lạ làm điều kiện không chạy và tạo Issue, để Anvil không tự hiểu `optional` thành `required`.

| `check.kind` | Ý nghĩa | Kết quả |
| --- | --- | --- |
| `golden_cases` | Chạy `prepare_data.py` trong sandbox trên `tables`, so `entity_id` và `target` với `expected` | `passed`, `failed` hoặc `blocked` |
| `manual` | Không tự động hóa được; cần người xem xét | Luôn `not_verified` |

Kind khác chưa được hỗ trợ: điều kiện vẫn hiện trong Evidence với `not_verified`, kèm Issue.

## Quy tắc của `golden_cases`

- `tables` phải có **đúng các file CSV của dữ liệu đã ghim, cùng tên và cùng cột theo đúng thứ tự**, và đủ quan hệ để pipeline chạy thật. Lệch thì build dừng trước lượt gọi agent đầu tiên.
- Tên bảng là tên file `.csv` đơn giản, không có thư mục.
- So sánh chính xác: thiếu, thừa hoặc trùng `entity_id`, hay `target` khác đáp án đều là `failed`. Cột thừa trong bảng kết quả được phép.
- `target` chỉ nhận 0 hoặc 1.

## Giới hạn định dạng hiện tại

| Mục | Giới hạn |
| --- | --- |
| Toàn hợp đồng | 256 KiB (đo bằng byte) |
| Số điều kiện | 64 |
| Số bảng mỗi ca | 16 |
| Mỗi bảng | 32 KiB (đo bằng byte), 200 dòng dữ liệu |
| `expected` | 200 dòng, không trùng `entity_id` |

Hợp đồng chưa được chứa chuỗi dạng `$tên`, vì kế hoạch đi qua input của workflow và cú pháp này trùng biến workflow. Anvil không tự bỏ nội dung: cả hợp đồng bị từ chối kèm Issue, hãy đổi nội dung trong nguồn.

## Lỗi trong hợp đồng

Không có lỗi nào bị bỏ qua âm thầm; mọi Issue đều trỏ về nguồn.

| Lỗi | Hợp đồng | Mức Issue |
| --- | --- | --- |
| Không phải JSON, sai `contractVersion`, vượt giới hạn, nhiều khối, khối lồng trong danh sách, có heading nhưng không có khối | Không dùng | `revision_required` |
| Điều kiện thiếu `id`, `requirementId` hoặc `statement` | Bỏ điều kiện đó | `revision_required` |
| Trùng `id`, `requirementId` không tồn tại, trường lạ, `golden_cases` sai định dạng | Giữ, không chạy (`not_verified`) | `revision_required` |
| Kind chưa hỗ trợ | Giữ, không chạy (`not_verified`) | `warning` |

Issue `revision_required` chặn Readiness cho đến khi nguồn được sửa.

## Kết quả có nghĩa gì

- **Mẫu số là mọi yêu cầu trong basis đã duyệt**, không phải các yêu cầu hợp đồng có nhắc tới. Blueprint 13 yêu cầu, hợp đồng 1 điều kiện đạt: `declaredChecks` là 1/1, `requirementCoverage` có `total: 13`, `verified: 0`, `criteriaPassed: 1`.
- **`criteria_passed` không có nghĩa là yêu cầu đã đạt.** Một điều kiện nghiệm thu thường có nhiều ý, và một ca mẫu không chứng minh hết. Ở phiên bản này không yêu cầu nào được ghi `passed`; bản ghi Evidence của yêu cầu vẫn là `not_verified` kèm lý do.
- **`golden_cases` là bằng chứng có giới hạn:** chỉ đúng trên các dòng của ca mẫu, agent thấy ca mẫu, và không kiểm tra feature hay leakage.
- `blocked` nghĩa là chưa chạy được (môi trường hoặc giới hạn tài nguyên), không phải kết luận về nghiệp vụ.
- Ý kiến của agent review và mọi file do agent tự khai không được tính là bằng chứng đạt.

## Không trộn nghiệp vụ

`FR-02` là mã riêng trong từng blueprint. `review-risk/FR-02` (nhãn `review_score ≤ 2`, [blueprint mẫu](../../packages/web/public/samples/olist/review-risk-blueprint.md)) khác `customer-churn/FR-02` (churn 90 ngày, [DESIGN_B_2](DESIGN_B_2.md)). Ca mẫu của blueprint này không dùng cho blueprint kia.
