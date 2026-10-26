# Tổng hợp khách hàng Olist theo bang

## 1. PROBLEM PROFILE

**Business Goal:** Tạo một bản tổng hợp minh bạch về khách hàng và số đơn theo bang từ CSV Olist mẫu.

**Technical Objective:** Viết chương trình Python offline, dùng thư viện chuẩn, đọc `/work/input.csv` và in đúng một JSON object ra stdout.

### Data Profile

Mỗi dòng là một khách hàng duy nhất. Các cột dùng trong bài tập: `customer_unique_id`, `order_count`, `customer_state`. Có thêm `last_purchase_date` và `target` trong CSV nhưng phải bỏ qua; bài tập không phân loại, huấn luyện hoặc dự đoán churn.

### Constraints

- CPU-only, RAM 1GB, Python standard library only.
- Không hard-code kết quả theo mẫu; tính từ mọi dòng CSV.
- Không ghi log hoặc văn bản giải thích ra stdout; lỗi đầu vào phải trả exit code khác 0.

## 2. REQUIREMENTS CONTRACT

| ID    | Type | Priority | Source                | Requirement                              | Acceptance Criteria                                                                               |
| ----- | ---- | -------- | --------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| FR-01 | FR   | HIGH     | Olist sample exercise | Count customers.                         | `total_customers` equals the number of input rows, with each `customer_unique_id` counted once.   |
| FR-02 | FR   | HIGH     | Olist sample exercise | Sum customer orders.                     | `total_orders` equals the sum of `order_count` across all input rows.                             |
| FR-03 | FR   | HIGH     | Olist sample exercise | Summarize customers and orders by state. | `by_state` has exactly the input states; each state's customer count and order sum match the CSV. |

## 3. HIGH-LEVEL PIPELINE

Read and validate the CSV header and rows, aggregate customer/order counts by `customer_state`, then emit the result as JSON. FR-01, FR-02, FR-03.

## 4. SELECTED TECHNOLOGY STACK

Python 3 standard library `csv` and `json`. FR-01, FR-02, FR-03.

## 5. MODULAR DESIGN PACKAGE

### DM-01 — Customer summary

Read `/work/input.csv`; aggregate totals and per-state counts; serialize one JSON object to stdout. FR-01, FR-02, FR-03.

## 6. EXECUTION BLUEPRINT

#### File: `solution.py`

The program reads `/work/input.csv` and emits one JSON object to stdout with exactly `total_customers`, `total_orders`, and `by_state`. Each `by_state` value has exactly `customers` and `orders`, both nonnegative integers. Include every input state and no other states. Do not create or read `/work/candidate-output.json`; Anvil captures stdout and supplies it to the independent comparison harness. FR-01, FR-02, FR-03.

The harness output schema is a JSON object with one `checks` array. Each check has `requirementId` (one of FR-01, FR-02, FR-03), boolean `passed`, and string `detail`. The harness derives expected totals from the pinned input and never runs candidate code.

For a hypothetical three-row input with two rows in SP and one in RJ, output could look like this (illustrative only; these values are not expected results for the bundled 1,000-row CSV):

```json
{
  "total_customers": 3,
  "total_orders": 5,
  "by_state": { "SP": { "customers": 2, "orders": 4 }, "RJ": { "customers": 1, "orders": 1 } }
}
```
