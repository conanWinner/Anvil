# Bộ mẫu Olist cho Anvil

Nguồn: [Brazilian E-Commerce Public Dataset by Olist](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce), được nêu trong [DESIGN_B_2.md](../../../../../docs/system_2/DESIGN_B_2.md).
Dữ liệu gốc và CSV dẫn xuất áp dụng [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), tách biệt với giấy phép mã nguồn Anvil.

## Mẫu thí nghiệm (mặc định): dự đoán đơn hàng bị đánh giá thấp

**Tạo dự án** → **Bộ mẫu Olist** (chế độ *Thí nghiệm theo System 2*) điền sẵn `review-risk-blueprint.md` và 5 bảng trong `review-risk/` (8.000 đơn hàng có đánh giá, ~14,6% bị chấm 1–2 sao). Blueprint theo đúng 6 phần của System 2, nêu 4 phương án mô hình (Logistic Regression baseline, Random Forest, XGBoost, LightGBM), metric chính ROC-AUC và ngưỡng ROC-AUC ≥ 0.70. Không cần prompt hay bộ kiểm tra: Anvil tự chia dữ liệu, giữ nhãn và tự chấm.

Tập con được tạo tất định từ archive Kaggle gốc bằng `python3 scripts/prepare-olist-experiment-sample.py <thư-mục-9-csv> packages/web/public/samples/olist/review-risk 8000` (chọn 8.000 `order_id` có đánh giá theo thứ tự SHA-256, giữ items/payments/reviews/products tương ứng).

## Mẫu so sánh LLM (chế độ cũ)

Chọn chế độ *So sánh nhiều LLM* trong **Cấu hình bộ kiểm tra và nâng cao** trước khi bấm **Bộ mẫu Olist**.

## Dùng trong giao diện

**Tạo dự án** → **Dùng bộ mẫu Olist** → chọn 2–4 LLM → **Tạo dự án**. Mẫu điền sẵn bài toán tổng hợp theo bang, CSV, prompt và bộ kiểm tra. Tiếp tục **Bắt đầu phân tích**, xem và chấp nhận Bản hiểu, rồi **Xem và phê duyệt kế hoạch** → **Phê duyệt và chạy**. Kết quả có code/output riêng cho từng model; **Yêu cầu bàn giao** tạo gói chạy lại.

CSV mẫu có 1.000 khách hàng thật, mỗi dòng là một `customer_unique_id`. Chỉ dùng đơn `delivered` có thời điểm mua không sau 31/08/2018 23:59:59. Gộp khách hàng/đơn hàng, đếm đơn và lấy lần mua cuối; chọn 1.000 ID đầu tiên theo thứ tự SHA-256 để tái tạo ổn định.

`target = 1` khi thời gian từ lần mua cuối đến mốc trên **lớn hơn 90 ngày**, ngược lại bằng 0. Đây là nhãn dẫn xuất do Anvil chuẩn bị; bộ Olist gốc không có nhãn churn. Bài tập tổng hợp bỏ qua cột này. Chỉ chọn `target` khi tự dùng blueprint churn cũ.

Mẫu chỉ sử dụng hai bảng customers/orders, không thực hiện pipeline tích hợp 9 bảng hoặc huấn luyện/SHAP. Không dùng thời điểm mua cuối để tuyên bố chất lượng dự báo: nhãn đã được suy ra trực tiếp từ trường này; đánh giá thực tế cần tách thời gian quan sát và thời gian đánh giá.

## Demo so sánh LLM: tổng hợp khách hàng theo bang

`customer-summary-blueprint.md`, `customer-summary-prompt.md` và `customer-summary-harness.py` là bài tập code demo riêng, dùng chính CSV 1.000 khách hàng bên trên. Blueprint theo cấu trúc sáu phần mà Understanding hiện trích xuất: Problem Profile, Requirements Contract, High-Level Pipeline, Selected Technology Stack, Modular Design Package và Execution Blueprint. Bài tập yêu cầu đếm khách hàng và đơn theo `customer_state`; không dùng `target` hoặc `last_purchase_date`, không huấn luyện và không dự đoán churn. Candidate in JSON ra stdout; Anvil chuyển stdout thành `/work/candidate-output.json` cho harness chạy riêng. Blueprint gốc `DESIGN_B_2.md` và provenance/license phía trên vẫn được giữ nguyên cho luồng intake cũ.

`customer-summary-comparison.json` là cấu hình comparison hợp lệ để tải vào UI; hai model trong file chỉ là giá trị ví dụ và phải được thay bằng model người dùng chọn. Cấu trúc backend là `{ "schemaVersion": 1, "models": ["router9/<model-id>", "router9/<model-id>"], "prompt": "...", "harness": "...", "requirementIds": ["FR-01", "FR-02", "FR-03"] }`. `customer-summary-harness.py` đọc input đã ghim tại `/work/input.csv` và Anvil-captured output `/work/candidate-output.json`; checker tự tính số khách hàng, tổng đơn và breakdown từng bang, không chạy code candidate. Output candidate phải có đúng các khóa `total_customers`, `total_orders`, `by_state`; mỗi bang có đúng `customers` và `orders`. Chạy `python3 check_customer_summary_harness.py` để kiểm tra output hợp lệ, bị sửa, thiếu và stdout không phải JSON.

## Tái tạo CSV

Tải archive gốc bằng URL công khai (không cần khóa trong lần tải đã kiểm tra):

```bash
curl -fL https://www.kaggle.com/api/v1/datasets/download/olistbr/brazilian-ecommerce -o /path/to/brazilian-ecommerce.zip
python3 scripts/prepare-olist-sample.py /path/to/brazilian-ecommerce.zip
```

Chạy script từ checkout Anvil; chỉ dùng Python stdlib. Archive gốc có 9 CSV: customers, geolocation, order_items, order_payments, order_reviews, orders, products, sellers và product_category_name_translation. Giữ bản gốc ngoài Git; chỉ CSV mẫu nhỏ được kèm Web.

[source.json](source.json) ghi nguồn, giấy phép, SHA-256 archive/CSV mẫu, mốc tạo nhãn, số dòng và phân phối nhãn. Script có self-check số khách hàng, tính duy nhất, hai lớp nhãn và quy tắc 90 ngày; không gọi LLM.
