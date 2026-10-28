# MASTER DEVELOPMENT BLUEPRINT

> Mẫu thí nghiệm System 2 cho System 3: dự đoán đơn hàng Olist bị đánh giá thấp. Dữ liệu: 5 bảng Kaggle Olist.

## 1. PROBLEM PROFILE

**Business Goal:** Phát hiện sớm các đơn hàng có nguy cơ bị khách đánh giá thấp (1–2 sao) để đội vận hành can thiệp trước khi khách viết đánh giá.

**Technical Objective:** Binary Classification — dự đoán xác suất một đơn hàng nhận review_score ≤ 2, chỉ dùng thông tin có trước thời điểm khách tạo đánh giá (đơn hàng, sản phẩm, thanh toán, giao hàng).

### Success Criteria

- Báo cáo ROC-AUC (metric chính), PR-AUC, F1-Score và Recall trên tập kiểm tra giữ riêng.
- ROC-AUC ≥ 0.70 trên tập kiểm tra.
- So sánh các phương án mô hình bằng cùng một cách chia dữ liệu và cùng seed.

### Data Profile

- **Data type:** tabular
- **Volume:** ~99,000 đơn hàng có đánh giá; tỷ lệ đánh giá 1–2 sao khoảng 15%.
- **Tables:** `olist_orders_dataset.csv`, `olist_order_items_dataset.csv`, `olist_order_payments_dataset.csv`, `olist_order_reviews_dataset.csv`, `olist_products_dataset.csv`.

### Constraints

- CPU-only, RAM 2GB cho mỗi lần chạy, chỉ dùng thư viện Python có sẵn trong runtime.
- Không dùng nội dung đánh giá (`review_comment_title`, `review_comment_message`) hay thời điểm trả lời đánh giá làm feature — đây là thông tin có sau nhãn.

## 2. REQUIREMENTS CONTRACT

| ID     | Type | Priority | Source        | Requirement                                                                                                                                                                | Acceptance Criteria                                                                                                                                                                                                   |
| ------ | ---- | -------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-01  | FR   | HIGH     | user::query   | Tạo bảng dữ liệu mỗi dòng một đơn hàng có đánh giá, ghép đơn hàng với sản phẩm, thanh toán và giao hàng.                                                                   | Mỗi `order_id` xuất hiện đúng một lần; đơn không có đánh giá bị loại.                                                                                                                                                 |
| FR-02  | FR   | HIGH     | user::query   | Tạo target: 1 nếu review_score của đơn ≤ 2, ngược lại 0. Nếu một đơn có nhiều đánh giá, dùng đánh giá tạo sớm nhất.                                                        | Tỷ lệ lớp 1 trùng với phân phối review_score của dữ liệu.                                                                                                                                                             |
| FR-03  | FR   | HIGH     | user::query   | Feature từ đơn hàng: số sản phẩm, tổng giá, phí vận chuyển, số kỳ trả góp, loại thanh toán, độ trễ giao hàng so với ngày dự kiến, thời gian giao, danh mục sản phẩm chính. | Không dùng cột nào của bảng đánh giá ngoài nhãn; không dùng thông tin sau thời điểm tạo đánh giá: độ trễ giao hàng và thời gian giao chỉ tính khi ngày giao thực tế trước thời điểm tạo đánh giá, ngược lại để trống. |
| FR-04  | FR   | HIGH     | user::query   | Huấn luyện và đánh giá nhiều mô hình phân loại: Logistic Regression (baseline), Random Forest, XGBoost, LightGBM.                                                          | Mỗi mô hình được đánh giá bằng ROC-AUC, PR-AUC, F1-Score, Recall trên cùng tập kiểm tra.                                                                                                                              |
| NFR-01 | NFR  | HIGH     | constraints   | Mỗi mô hình huấn luyện xong trong 20 phút trên 2 CPU, RAM 2GB.                                                                                                             | Không vượt giới hạn tài nguyên của sandbox.                                                                                                                                                                           |
| NFR-02 | NFR  | MEDIUM   | self_inferred | Kết quả tái lập được với seed cố định.                                                                                                                                     | Chạy lại cùng dữ liệu và seed cho cùng dự đoán.                                                                                                                                                                       |

## 3. HIGH-LEVEL PIPELINE

### Phase 1: Data Preparation

- **Mục tiêu:** Ghép 5 bảng thành bảng mỗi đơn hàng một dòng, tạo target theo FR-02 và feature theo FR-03.
  - **Step 1.1**: Ghép đơn hàng, sản phẩm, thanh toán (pandas)
  - **Step 1.2**: Tạo target và feature giao hàng (pandas)

### Phase 2: Model Training & Evaluation

- **Mục tiêu:** Huấn luyện từng phương án mô hình trên tập train, chọn siêu tham số bằng cross-validation trên train, dự đoán xác suất cho tập kiểm tra.
  - **Step 2.1**: Logistic Regression baseline (scikit-learn)
  - **Step 2.2**: Tree-based models (scikit-learn, xgboost, lightgbm)

## 4. SELECTED TECHNOLOGY STACK

| Task                                               | Final Solution                      | Type      | Addresses             | Rationale / Trade-off                                                                    |
| -------------------------------------------------- | ----------------------------------- | --------- | --------------------- | ---------------------------------------------------------------------------------------- |
| Model Training - Logistic Regression               | scikit-learn LogisticRegression     | Bên ngoài | FR-04, NFR-01, NFR-02 | Baseline tuyến tính, nhanh, dễ giải thích; cần chuẩn hóa feature số và one-hot danh mục. |
| Model Training - Random Forest                     | scikit-learn RandomForestClassifier | Bên ngoài | FR-04, NFR-01, NFR-02 | Học quan hệ phi tuyến, ít cần tiền xử lý; tốn RAM hơn khi nhiều cây.                     |
| Model Training - XGBoost                           | xgboost.XGBClassifier               | Bên ngoài | FR-04, NFR-01, NFR-02 | Gradient boosting mạnh với dữ liệu bảng; dùng scale_pos_weight cho lớp thiểu số.         |
| Model Training - LightGBM (Primary Recommendation) | lightgbm.LGBMClassifier             | Bên ngoài | FR-04, NFR-01, NFR-02 | Nhanh và tiết kiệm bộ nhớ trên dữ liệu bảng cỡ trăm nghìn dòng.                          |
| Class Imbalance Handling - Class Weights           | class_weight / scale_pos_weight     | Bên ngoài | FR-04                 | Lớp 1 chiếm ~15%; dùng trọng số lớp thay vì lấy mẫu lại.                                 |
| Data Manipulation - pandas & numpy                 | pandas, numpy                       | Bên ngoài | FR-01, FR-02, FR-03   | Thư viện tiêu chuẩn cho dữ liệu bảng.                                                    |

## 5. MODULAR DESIGN PACKAGE

### DM-01 — Order Table Builder

- **Purpose:** Ghép các bảng và tạo một dòng cho mỗi đơn hàng có đánh giá, kèm target (FR-01, FR-02).
- **Owned requirements:** FR-01, FR-02
- **Inputs:** 5 CSV Olist
- **Outputs:** Bảng đơn hàng có target

### DM-02 — Feature Engineering

- **Purpose:** Tạo feature đơn hàng, thanh toán, giao hàng, danh mục (FR-03).
- **Owned requirements:** FR-03
- **Inputs:** Bảng đơn hàng từ DM-01
- **Outputs:** Bảng feature

### DM-03 — Model Experiments

- **Purpose:** Huấn luyện và dự đoán cho từng phương án mô hình (FR-04).
- **Owned requirements:** FR-04, NFR-01, NFR-02
- **Inputs:** Tập train và feature tập kiểm tra
- **Outputs:** Xác suất dự đoán cho tập kiểm tra

## 6. EXECUTION BLUEPRINT

#### File: `prepare_data.py`

Đọc 5 CSV, tạo bảng mỗi đơn hàng một dòng có target và feature theo FR-01–FR-03. FR-01, FR-02, FR-03.

#### File: `train_variant.py`

Huấn luyện một phương án mô hình theo tham số `--variant`, xuất xác suất dự đoán cho tập kiểm tra. FR-04, NFR-01, NFR-02.
