# System 3 — Blueprint Parser & Project Control Plane

> Tài liệu này mô tả cách **System 3** nhận output từ **System 2**, parse thành cấu trúc chuẩn, verify bằng dataset/runtime thật, rồi điều khiển toàn bộ vòng đời sinh code, chạy test, debug, xuất artifact và rollback.
>
> Mục tiêu: người mới đọc có thể hiểu hệ thống đang làm gì; agent đọc có thể biết chính xác cần vận hành theo flow nào.

---

## 1. System 3 là gì?

**System 3** là hệ thống nhận **Master Development Blueprint** từ System 2 và biến nó thành một project có thể chạy, test, verify và bàn giao.

System 3 **không phân tích lại bài toán từ đầu**. System 2 đã làm việc đó.

System 3 tập trung vào:

```text
System 2 Blueprint
+ Dataset thật
+ Runtime / sandbox capabilities
        ↓
Practical verification
        ↓
Executable SPEC / PLAN / TASKS
        ↓
Code generation
        ↓
Sandbox run / test / debug
        ↓
Verified executable project
```

Nói ngắn gọn:

> **System 3 = Blueprint-to-Verified-Project System**

---

## 2. Input chính của System 3

System 3 nhận 4 nhóm input chính.

### 2.1. Master Development Blueprint từ System 2

Đây là tài liệu bàn giao cho coding agent. Một blueprint tốt thường có các phần:

```text
Problem Profile
Requirements Contract
High-Level Pipeline
Selected Technology Stack
Modular Design Package
Execution Blueprint
Codebase Structure
Codebase Modules
Function-File Mapping
```

Trong ví dụ System 2 hiện tại, blueprint đã chỉ rõ:

```text
Requirement ID → Design Module → Codebase Module → File → Function
```

Ví dụ:

```text
FR-02: Target Variable Generation
→ DM-02
→ CB-02 src/target_generation/
→ churn_labeler.py
→ calculate_churn_label()
```

### 2.2. Dataset thật

System 3 cần dataset thật để verify thực tế, không chỉ verify lý thuyết.

Dataset có thể đến từ:

```text
- File upload trực tiếp
- Google Drive connector
- Local path
- S3 / MinIO / object storage
- Database hoặc data warehouse trong tương lai
```

Khuyến nghị:

```text
Google Drive chỉ nên là data source.
System 3 nên import/copy dataset về storage riêng,
gắn hash và tạo DatasetVersion để đảm bảo reproducibility.
```

### 2.3. Runtime / sandbox capabilities

Ví dụ:

```yaml
sandbox_capabilities:
  python_version: "3.11"
  has_gpu: false
  has_docker: true
  internet_access: false
  max_memory_mb: 8192
  max_runtime_seconds: 7200
```

### 2.4. User approval policy

Với MVP:

```text
System 3 không được tự fix.
Mọi thay đổi đều phải tạo proposal và chờ user approve.
```

---

## 3. Vì sao cần parse Blueprint sang cấu trúc chuẩn?

System 2 có thể xuất ra Markdown rất dễ đọc cho người, nhưng System 3 cần vận hành bằng dữ liệu có cấu trúc.

Nếu chỉ giữ Markdown thô, hệ thống sẽ gặp vấn đề:

```text
- Khó build dashboard
- Khó trace requirement đến code/test/run
- Khó diff/version
- Khó validate thiếu sót
- Khó chia task/sprint tự động
- Tốn token vì agent phải đọc lại markdown nhiều lần
- Dễ hiểu sai khi format thay đổi nhẹ
```

Vì vậy System 3 nên parse blueprint thành một schema chuẩn gọi là:

```text
CanonicalBlueprint
```

Nhưng không nên parse cứng 100% toàn bộ nội dung. Cách đúng là dùng 3 lớp dữ liệu song song.

---

## 4. Ba lớp dữ liệu của Blueprint

### 4.1. Raw Blueprint

Lưu nguyên văn file gốc từ System 2.

```yaml
raw_blueprint:
  file_name: "DESIGN_B_2.md"
  content_hash: "sha256:..."
  storage_uri: "object://blueprints/bp_001/raw.md"
  imported_at: "..."
```

Mục đích:

```text
- Audit lại nguồn gốc
- So sánh với bản parsed
- Rollback nếu parser lỗi
- Giữ nguyên ngữ cảnh cho human review
```

### 4.2. Canonical Blueprint

Đây là bản JSON/YAML chuẩn để hệ thống dùng.

Nó chứa các field lõi như:

```text
project_profile
data_profile
requirements
pipeline
technology_stack
design_modules
codebase_modules
function_mappings
manual_review_items
```

Mục đích:

```text
- Dashboard render
- Verification engine dùng
- Planner dùng để sinh SPEC/PLAN/TASKS
- Code generator dùng để sinh file/function
- Test runner map kết quả về requirement
```

### 4.3. Extensions / Unparsed Blocks

Không phải phần nào trong Markdown cũng cần hoặc có thể parse ngay.

Những phần chưa map được sẽ lưu vào:

```yaml
extensions:
  custom_sections: []
  unparsed_blocks: []
  parser_warnings: []
```

Mục đích:

```text
- Không làm mất thông tin
- Không block toàn bộ hệ thống nếu có section lạ
- Cho phép System 2 mở rộng format trong tương lai
```

---

## 5. Canonical Blueprint Schema đề xuất

Đây là schema lõi nên cố định cho System 3.

```yaml
blueprint_id: "bp_001"
blueprint_version: 1
schema_version: "1.0"

raw_source:
  file_name: "DESIGN_B_2.md"
  content_hash: "sha256:..."
  original_text_uri: "object://blueprints/bp_001/raw.md"

project_profile:
  business_goal: "..."
  technical_objective: "..."
  success_criteria: []
  constraints: []
  missing_information: []
  manual_review_items: []

data_profile:
  data_type: "tabular"
  source: "..."
  time_coverage: "..."
  target_definition: "..."
  tables:
    - name: "orders"
      expected_rows: "~99,441"
      key_fields:
        - "order_id"
        - "customer_id"
      columns: []

requirements:
  - id: "FR-01"
    type: "FR"
    priority: "HIGH"
    source: "user::dataset_schema"
    requirement: "..."
    acceptance_criteria: "..."
    manual_review_required: false

pipeline:
  - phase_id: "PHASE-1"
    name: "Feature Engineering"
    objective: "..."
    steps:
      - step_id: "1.1"
        name: "RFM Feature Engineering"
        tool: "pandas"
        inputs: []
        outputs: []
        addresses:
          - "FR-03"

technology_stack:
  - task: "Model Training - Logistic Regression"
    solution: "scikit-learn LogisticRegression"
    type: "external"
    addresses:
      - "FR-04"
      - "NFR-01"
    rationale: "..."
    risk_level: "medium"

design_modules:
  - id: "DM-01"
    name: "Data Integration & Quality Validation"
    purpose: "..."
    phase_ids:
      - "1"
    step_ids:
      - "1.1"
      - "1.2"
    owned_requirements:
      - "FR-01"
      - "DSR-01"
    inputs: []
    outputs: []
    depends_on: []
    downstream_consumers:
      - "DM-02"
      - "DM-03"
    invariants: []

codebase_modules:
  - id: "CB-01"
    path: "src/data_integration/"
    design_module: "DM-01"
    responsibility: "..."
    owned_requirements:
      - "FR-01"
    files:
      - "src/data_integration/loader.py"
      - "src/data_integration/joiner.py"

function_mappings:
  - function_name: "load_olist_datasets"
    file_path: "src/data_integration/loader.py"
    signature: "def load_olist_datasets(data_dir: str) -> Dict[str, pd.DataFrame]"
    responsibility: "Load 9 CSV files..."
    pipeline:
      phase: "1"
      step: "1.1"
    design_module: "DM-01"
    codebase_module: "CB-01"
    addresses:
      - "FR-01"
      - "DSR-01"
    depends_on: []
    called_by:
      - "join_customer_orders"
      - "validate_data_quality"
    task_execution:
      - "Read CSV files from data_dir"
      - "Validate expected columns"
      - "Return table dictionary"

manual_review_items:
  - id: "MRI-001"
    source_section: "Problem Profile / Constraints"
    issue: "Metric thresholds are missing"
    severity: "WARN"
    suggestion: "Ask user to confirm minimum acceptable ROC-AUC/F1/Recall"
    blocks_implementation: false
```

---

## 6. Required và Optional sections

Không phải mọi project đều giống nhau. Vì vậy schema cần chia thành required và optional.

### 6.1. Required cho MVP

Với MVP của System 3, đặc biệt cho tabular ML/data analysis, nên bắt buộc có:

```text
- project_profile
- data_profile
- requirements
- pipeline
- design_modules
- codebase_modules
- function_mappings
- constraints
- manual_review_items
```

Nếu thiếu một trong các section lõi này, System 3 nên block và yêu cầu bổ sung.

### 6.2. Optional

Các phần sau có thể optional tùy project:

```text
- technology_stack
- notebooks
- deployment
- monitoring
- PlantUML diagrams
- benchmark notes
- research citations
```

Nếu có thì parse. Nếu không có thì không block, trừ khi requirement yêu cầu trực tiếp.

---

## 7. Parser pipeline

Parser nên chạy theo thứ tự sau.

```text
Markdown Blueprint
→ Raw source storage
→ Markdown AST parser
→ Section extractor
→ Table parser
→ Code block parser
→ ID/link extractor
→ Canonical schema builder
→ Traceability graph builder
→ Schema validator
→ Parser report
```

### 7.1. Raw source storage

Lưu nguyên file gốc và hash.

```text
Input: DESIGN_B_2.md
Output:
- raw.md
- content_hash
- BlueprintVersion
```

### 7.2. Section extractor

Tách các heading chính:

```text
## 1. PROBLEM PROFILE
## 2. REQUIREMENTS CONTRACT
## 3. HIGH-LEVEL PIPELINE
## 4. SELECTED TECHNOLOGY STACK
## 5. MODULAR DESIGN PACKAGE
## 6. EXECUTION BLUEPRINT
```

### 7.3. Table parser

Parse Markdown table thành object.

Ví dụ Requirements Contract:

```text
| ID | Type | Priority | Source | Requirement | Acceptance Criteria |
```

Parse thành:

```yaml
requirements:
  - id: "FR-01"
    type: "FR"
    priority: "HIGH"
    source: "..."
    requirement: "..."
    acceptance_criteria: "..."
```

### 7.4. Code block parser

Parse các block:

```text
- json block
- yaml block
- python function block
- plantuml block
- project tree block
```

Ví dụ Python block:

```python
def calculate_churn_label(customer_df: pd.DataFrame, cutoff_date: str, window_days: int = 90) -> pd.Series:
    ...
```

Parse thành:

```yaml
function_name: "calculate_churn_label"
file_path: "src/target_generation/churn_labeler.py"
signature: "def calculate_churn_label(...) -> pd.Series"
```

### 7.5. ID extractor

Tách các ID quan trọng:

```text
FR-01, FR-02, NFR-01, DSR-01
DM-01, DM-02
CB-01, CB-02
Phase 1, Step 1.1
file path
function name
```

### 7.6. Canonical schema builder

Ghép các section đã parse thành `CanonicalBlueprint`.

### 7.7. Traceability graph builder

Build graph:

```text
Requirement
→ Design Module
→ Codebase Module
→ File
→ Function
→ Test
→ Run
→ Artifact
```

### 7.8. Schema validator

Kiểm tra schema có đủ và nhất quán không.

---

## 8. Validation rules sau khi parse

Sau khi có `CanonicalBlueprint`, System 3 phải validate.

### 8.1. Structural validation

Kiểm tra format cơ bản:

```text
- Có project_profile không?
- Có requirements không?
- Có pipeline không?
- Có design_modules không?
- Có codebase_modules không?
- Có function_mappings không?
```

### 8.2. Traceability validation

Kiểm tra trace có đầy đủ không:

```text
- Requirement nào không có design module?
- Design module nào không có codebase module?
- Codebase module nào không có file?
- Function nào không map về requirement?
- Requirement HIGH nào không có test dự kiến?
```

### 8.3. Dependency validation

Kiểm tra phụ thuộc:

```text
- depends_on có trỏ đến module/function tồn tại không?
- called_by có trỏ đến function tồn tại không?
- Có circular dependency nguy hiểm không?
- Module order có thể implement theo sprint không?
```

### 8.4. Manual review validation

Nếu blueprint có `[Manual Review Required]`, System 3 phải tạo `DecisionRequest`.

Ví dụ:

```yaml
decision_request:
  id: "DR-001"
  source: "manual_review_item"
  issue: "Metric thresholds are missing"
  options:
    - "Use comparative evaluation for POC"
    - "Ask user to provide thresholds"
    - "Return to System 2"
  status: "pending_user_decision"
```

### 8.5. Dataset compatibility validation

So sánh data thật với data profile trong blueprint:

```text
- Expected files vs actual files
- Expected columns vs actual columns
- Expected row count vs actual row count
- Expected keys vs actual keys
- Join success rate
- Timestamp validity
- Missing value rates
```

### 8.6. Runtime feasibility validation

Kiểm tra môi trường thật:

```text
- Python version
- Dependency installability
- CPU/GPU requirement
- RAM constraint
- Runtime limit
- Internet access
- Disk limit
```

### 8.7. ML safety validation

Kiểm tra các lỗi ML phổ biến:

```text
- Target leakage
- Feature window nhìn vào tương lai
- Train/test split không temporal
- Fit scaler trước split
- Dùng test set để chọn model
- Metric không phù hợp class imbalance
- Không có seed/reproducibility control
```

---

## 9. Rule cho parser trong MVP

MVP nên dùng rule rõ ràng.

```text
Nếu parse được >= 90% các section core:
  Cho phép đi tiếp sang validation.

Nếu thiếu required section:
  BLOCKED, yêu cầu user/System 2 bổ sung.

Nếu có section lạ:
  Lưu vào extensions, không block.

Nếu có Manual Review Required:
  Tạo DecisionRequest, không tự sửa.

Nếu parser không chắc:
  Gắn confidence score thấp và yêu cầu user review.
```

Ví dụ parser report:

```yaml
parser_report:
  status: "parsed_with_warnings"
  core_parse_coverage: 0.94
  required_sections_missing: []
  optional_sections_missing:
    - "monitoring"
  unparsed_blocks_count: 3
  warnings:
    - "Found custom benchmark note not mapped to canonical field"
```

---

## 10. Không auto-fix trong MVP

Với MVP, System 3 không được tự ý sửa blueprint, spec, config hoặc code.

Flow bắt buộc:

```text
Detect issue
→ Explain issue
→ Propose change
→ Show impact
→ Wait for user approval
→ Apply only after approval
```

### 10.1. ChangeRequest

Mọi thay đổi phải đi qua `ChangeRequest`.

```yaml
change_request:
  id: "CR-001"
  source: "system3_verifier"
  status: "pending_user_approval"
  change_type: "minor"
  target_artifacts:
    - "SPEC.md"
    - "config.yaml"
  issue:
    type: "missing_runtime_command"
    description: "Blueprint has run_pipeline.py but does not define exact verification commands."
  proposal:
    action: "Add explicit validate/train/evaluate/test commands."
  impact:
    scope: "No model or pipeline change"
    files_affected:
      - "SPEC.md"
      - "TASKS.md"
      - "config.yaml"
  requires_approval: true
```

### 10.2. PatchProposal

Khi code/test/run fail, agent chỉ được tạo patch proposal.

```yaml
patch_proposal:
  id: "PP-001"
  failure:
    command: "pytest tests/test_churn_labeler.py"
    exit_code: 1
    summary: "KeyError: customer_unique_id"
  diagnosis: "The loader did not normalize column names before joining."
  proposed_patch:
    files:
      - "src/data_integration/loader.py"
    diff_summary: "Normalize column names after loading CSV files."
  risk_level: "low"
  status: "pending_user_approval"
```

---

## 11. Project Control Plane

Sau khi parse thành cấu trúc chuẩn, dashboard của System 3 nên hoạt động như một **Project Control Plane**.

```text
Project Control Plane
├── Blueprint Control
├── Dataset Control
├── Verification Control
├── Spec / Plan / Task Control
├── Codebase Control
├── Execution Control
├── Debug / Patch Control
├── Experiment / Run Control
├── Report / Artifact Control
└── Version / Rollback Control
```

---

## 12. Thành phần trong Project Control Plane

### 12.1. Blueprint Control

Quản lý blueprint từ System 2.

Chức năng:

```text
- Import blueprint
- Parse blueprint
- Xem raw Markdown
- Xem parsed JSON
- Xem requirements
- Xem modules
- Xem function mappings
- Approve/reject blueprint
- Return to System 2 nếu thiếu nghiêm trọng
```

Output:

```text
BlueprintVersion
CanonicalBlueprint
ParserReport
TraceabilityGraph
```

### 12.2. Dataset Control

Quản lý dataset thật.

Chức năng:

```text
- Upload dataset
- Connect Google Drive
- Import dataset vào storage riêng
- Tạo DatasetVersion
- Validate schema
- Validate row count
- Validate join keys
- Validate timestamp logic
- Sinh data profile
```

Output:

```text
DatasetVersion
DatasetManifest
SchemaValidationReport
DataProfileReport
JoinValidationReport
```

### 12.3. Verification Control

Kiểm tra blueprint có thực sự executable không.

Chức năng:

```text
- Verify completeness
- Verify traceability
- Verify dataset compatibility
- Verify runtime feasibility
- Verify dependency feasibility
- Verify ML safety
- Generate DecisionRequests
```

Output:

```text
PracticalVerificationReport
BlockingIssues
Warnings
DecisionRequests
ChangeRequests
```

### 12.4. Spec / Plan / Task Control

Sinh artifact implement sau khi verify.

Artifact:

```text
SPEC.md
PLAN.md
TASKS.md
config.yaml
test_plan.yaml
run_commands.yaml
```

Chức năng:

```text
- View spec/plan/tasks
- View diff between versions
- Approve spec
- Approve plan
- Approve task list
- Lock version before code generation
```

### 12.5. Codebase Control

Quản lý code được sinh ra.

Chức năng:

```text
- View file tree
- View generated files
- View file/function status
- View code diff
- Trace file/function về requirement
- Approve/reject code patch
- Rollback file/code snapshot
```

Status của file/function:

```text
not_started
generated
needs_review
approved
tested
failed
verified
```

### 12.6. Execution Control

Quản lý sandbox và command execution.

Chức năng:

```text
- Create workspace
- Create venv/Docker sandbox
- Install dependencies
- Run command
- Stop command
- Rerun command
- Capture stdout/stderr
- Capture exit code
- Capture memory/time usage
```

Ví dụ command:

```bash
pytest tests/
python run_pipeline.py --stage validate-data
python run_pipeline.py --stage train
python run_pipeline.py --stage evaluate
python run_pipeline.py --stage interpret
```

### 12.7. Debug / Patch Control

Quản lý lỗi và đề xuất sửa.

Flow:

```text
Run failed
→ Collect logs
→ Diagnose
→ Propose patch
→ User approve/reject
→ Apply patch
→ Rerun
```

### 12.8. Experiment / Run Control

Quản lý từng lần chạy experiment.

Một run gồm:

```yaml
run_id: "run_004"
dataset_version: "dsv_001"
blueprint_version: "bp_v1"
spec_version: "spec_v2"
code_snapshot: "code_017"
config_version: "cfg_003"
model: "lightgbm"
metrics:
  roc_auc: 0.86
  f1: 0.71
  recall: 0.78
status: "completed"
```

Chức năng:

```text
- View run history
- Compare runs
- Filter by model/config/status
- Rerun same config
- Rerun with modified config
- Select best run
```

### 12.9. Report / Artifact Control

Quản lý output cuối cùng.

Artifact có thể gồm:

```text
generated_project.zip
SPEC.md
PLAN.md
TASKS.md
README.md
implementation_report.md
verification_report.md
test_report.json
sandbox_run_log.txt
metrics.json
data_quality_report.html
model_comparison_report.html
interpretability_report.html
model.joblib
model_metadata.json
prediction_output.csv
```

### 12.10. Version / Rollback Control

Quản lý version và rollback.

Mọi thứ nên có version:

```text
BlueprintVersion
DatasetVersion
SpecVersion
PlanVersion
TaskVersion
CodeSnapshot
ConfigVersion
RunVersion
ArtifactVersion
```

Chức năng:

```text
- View timeline
- Compare versions
- Show reason for change
- Show approval record
- Rollback spec/config/code/file/run state
```

---

## 13. Master Traceability Graph

Đây là lõi của dashboard.

```text
Requirement
  ↓
Design Module
  ↓
Codebase Module
  ↓
File
  ↓
Function
  ↓
Test
  ↓
Run
  ↓
Metric / Artifact
```

Ví dụ:

```text
FR-02: Generate churn label
  ↓
DM-02: Target Variable Generation
  ↓
CB-02: src/target_generation/
  ↓
src/target_generation/churn_labeler.py
  ↓
calculate_churn_label()
  ↓
tests/test_churn_labeler.py
  ↓
pytest tests/test_churn_labeler.py
  ↓
Status: passed
  ↓
Artifact: class_distribution_report.json
```

Mục tiêu:

```text
User luôn biết:
- Requirement này được implement ở đâu
- File nào liên quan
- Function nào liên quan
- Test nào verify
- Run nào đã pass/fail
- Artifact nào được sinh ra
```

---

## 14. State machine tổng thể

```text
BLUEPRINT_IMPORTED
→ BLUEPRINT_PARSED
→ DATASET_IMPORTED
→ BLUEPRINT_VALIDATED
→ DATASET_VALIDATED
→ PRACTICALITY_REVIEWED
→ USER_APPROVAL_REQUIRED
→ APPROVED
→ EXECUTABLE_SPEC_GENERATED
→ PLAN_GENERATED
→ TASKS_GENERATED
→ CODE_GENERATION_STARTED
→ SPRINT_RUNNING
→ SPRINT_TESTING
→ SPRINT_FAILED
→ PATCH_PROPOSED
→ USER_APPROVAL_REQUIRED
→ PATCH_APPROVED
→ SPRINT_VERIFIED
→ FULL_VERIFICATION
→ PROJECT_PACKAGED
→ COMPLETED
```

Nếu user reject hoặc issue quá lớn:

```text
→ RETURN_TO_SYSTEM_2
```

Nếu fail quá nhiều:

```text
→ MAX_DEBUG_ATTEMPTS_REACHED
```

---

## 15. Flow hoạt động chuẩn của System 3

```text
1. Import System 2 Blueprint
2. Save raw Markdown and hash
3. Parse Blueprint into CanonicalBlueprint
4. Build Traceability Graph
5. Import Dataset
6. Create DatasetVersion
7. Validate Dataset against Blueprint
8. Verify runtime/dependency/ML safety
9. Generate Practical Verification Report
10. Create DecisionRequests / ChangeRequests if needed
11. Wait for user approval
12. Generate executable SPEC.md
13. Generate PLAN.md
14. Generate TASKS.md
15. User approve spec/plan/tasks
16. Generate code by module/task
17. User review/approve generated code or patch
18. Run tests in sandbox
19. If fail: diagnose + PatchProposal + user approval
20. Apply approved patch
21. Rerun tests
22. Run full pipeline
23. Save metrics/logs/artifacts
24. Generate reports
25. Package verified project
26. Save all versions and allow rollback
```

---

## 16. Storage model đề xuất

### 16.1. Database lưu metadata

Dùng PostgreSQL hoặc database quan hệ tương tự để lưu:

```text
Project
BlueprintVersion
DatasetVersion
SpecVersion
PlanVersion
TaskVersion
CodeSnapshot
ConfigVersion
Run
Artifact
ChangeRequest
PatchProposal
ApprovalRecord
```

### 16.2. Object storage lưu file lớn

Dùng local filesystem, MinIO hoặc S3-compatible storage để lưu:

```text
raw blueprint files
datasets
logs
reports
artifacts
model files
zipped projects
```

Không nên lưu CSV/parquet/model/log lớn trực tiếp trong database.

---

## 17. MVP implementation plan

### Phase 1 — Blueprint Parser MVP

```text
- Import Markdown blueprint
- Save raw source + hash
- Parse core sections
- Parse requirements table
- Parse design modules
- Parse codebase modules
- Parse function-file mapping
- Build CanonicalBlueprint JSON
- Generate ParserReport
```

### Phase 2 — Traceability Graph

```text
- Requirement → DM mapping
- DM → CB mapping
- CB → File mapping
- File → Function mapping
- Function → Requirement mapping
- Graph API for dashboard
```

### Phase 3 — Dataset Registry MVP

```text
- Upload dataset
- Store files in object storage/local storage
- Create DatasetVersion
- File manifest with sha256
- Basic schema validation
```

### Phase 4 — Practical Verification MVP

```text
- Blueprint completeness validation
- Dataset compatibility validation
- Dependency feasibility check
- Runtime capability check
- ML safety checklist
- DecisionRequest generation
```

### Phase 5 — Spec/Plan/Task Materialization

```text
- Generate SPEC.md
- Generate PLAN.md
- Generate TASKS.md
- Generate config.yaml
- Generate test_plan.yaml
- Require user approval before code generation
```

### Phase 6 — Code/Execution Control

```text
- Generate code by module/task
- Local sandbox/venv execution
- Run pytest
- Capture logs
- Generate PatchProposal on failure
- Apply only approved patch
```

### Phase 7 — Run/Artifact/Version Control

```text
- Track runs
- Save metrics/logs/artifacts
- Create code snapshots
- Compare versions
- Rollback spec/config/code
```

---

## 18. Definition of Done

System 3 run được coi là hoàn thành khi:

```text
- Blueprint được import và lưu raw source
- Blueprint được parse thành CanonicalBlueprint
- Required sections được validate
- Dataset thật được import và version hóa
- Dataset được validate với blueprint
- Practical verification report được tạo
- Tất cả blocking decision đã được user xử lý
- SPEC.md / PLAN.md / TASKS.md được sinh và approve
- Code được sinh theo module/task
- Tests được chạy trong sandbox
- Debug patches nếu có đều được user approve
- Full project verification pass
- Reports/logs/artifacts được sinh
- Project được package
- Mọi version có thể rollback
```

---

## 19. Nguyên tắc cốt lõi

```text
1. Blueprint-first
   Không code nếu chưa parse và verify blueprint.

2. Dataset-verified
   Không kết luận khả thi nếu chưa kiểm tra dataset thật.

3. User-approved
   MVP không auto-fix. Mọi thay đổi cần user approve.

4. Spec/Plan/Task-driven
   Code chỉ bắt đầu sau khi SPEC/PLAN/TASKS được sinh và approve.

5. Traceable
   Mọi file/function/test/run phải trace được về requirement.

6. Sandbox-verified
   Code chỉ hợp lệ khi đã chạy/test trong sandbox.

7. Versioned
   Blueprint, dataset, spec, plan, task, code, config, run, artifact đều có version.

8. Rollbackable
   Agent làm sai thì rollback được, không cần prompt lại từ đầu.
```

---

## 20. Câu mô tả ngắn cho agent

Khi agent vận hành trong System 3, hãy tuân thủ:

```text
Bạn không được phân tích lại bài toán từ đầu.
Bạn nhận Master Development Blueprint từ System 2.
Bạn phải parse blueprint thành CanonicalBlueprint.
Bạn phải verify blueprint với dataset/runtime thật.
Bạn phải tạo DecisionRequest cho mọi điểm cần user quyết định.
Bạn không được tự fix trong MVP nếu user chưa approve.
Bạn phải sinh SPEC.md, PLAN.md, TASKS.md trước khi code.
Bạn phải sinh code theo trace Requirement → DM → CB → File → Function.
Bạn phải chạy test trong sandbox.
Nếu lỗi, bạn chỉ được tạo PatchProposal và chờ user approve.
Bạn phải lưu logs, metrics, artifacts và version cho rollback.
```

---

## 21. Tóm tắt một câu

> **System 3 nên parse Markdown Blueprint từ System 2 thành CanonicalBlueprint cố định ở phần lõi, giữ raw Markdown gốc để audit, lưu phần mở rộng vào extensions, rồi dùng cấu trúc đó để verify dataset/runtime thật, sinh SPEC/PLAN/TASKS, generate code, chạy sandbox, quản lý run/artifact/version, và cho user kiểm soát toàn bộ thông qua Project Control Plane.**
